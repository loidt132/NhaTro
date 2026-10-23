import { getAuthSession, getStoredToken } from './auth';

// Data layer of the web app. Every kind of data has its own server API
// (/api/rooms, /api/tenants, ... see server/resources.js) and every add / edit / delete is
// sent to the server the moment the user does it — there is no "save the whole state"
// step. This module keeps an in-memory copy so screens can read it synchronously
// (loadState); a write updates that copy at once (optimistic) and is undone, with a
// 'boarding_state_save_error' event, if the server rejects it.
//
//   hydrateState({ tables })      GET the requested collections from the server
//   commit([ops.create(...), ...]) write one or several records (several = one transaction)
//   saveSettings(patch)           PUT /api/settings
//   importData(data)              upsert a backup file's records

/** Trống = fetch `/api` cùng origin; dev: `VITE_API_ORIGIN` trong `.env.development`. */
function resolveApiBase() {
  return (import.meta.env.VITE_API_ORIGIN || '').replace(/\/+$/, '');
}

function apiUrl(path) {
  const base = resolveApiBase();
  const p = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

function authHeaders() {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(method, path, body) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Không thể kết nối tới server.');
  return data;
}

// Collections of the state -> their API path.
const COLLECTIONS = {
  rooms: 'rooms',
  tenants: 'tenants',
  readings: 'readings',
  invoices: 'invoices',
  payments: 'payments',
  rentPeriods: 'rent-periods',
  paymentAllocations: 'payment-allocations',
  deposits: 'deposits',
  depositTransactions: 'deposit-transactions',
};
const COLLECTION_KEYS = Object.keys(COLLECTIONS);

const DEFAULT_SETTINGS = {
  bankCode: 'VCB',
  accountNo: '',
  accountName: '',
  qrNoteTemplate: 'Tien phong {room} {month}',
  landlordName: '',
  landlordPhone: '',
  landlordAddress: '',
  occupancyMode: 'month',
  meterRoomScope: 'occupied',
  // Tuya monthly usage requires an additional permission. Keep it opt-in so
  // the starting electric meter can be entered manually by default.
  useTuyaMonthlyUsage: false,
};

function currentStateKey() {
  const { userId } = getAuthSession();
  return `boarding_state_v1:${userId || 'guest'}`;
}

// In-memory copy (synchronous access for screens)
let memoryState = null;
let activeStateKey = '';
let adminViewUserId = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('nhatro_admin_view_user_id') || '' : '';
let isReady = false;

const notifyUpdated = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('boarding_state_updated'));
};
const notifyError = (message) => {
  if (typeof window !== 'undefined' && message) {
    window.dispatchEvent(new CustomEvent('boarding_state_save_error', { detail: { message } }));
  }
};

export function getAdminViewUserId() {
  return adminViewUserId;
}

export function setAdminViewUserId(userId = '') {
  adminViewUserId = String(userId || '');
  try {
    if (adminViewUserId) sessionStorage.setItem('nhatro_admin_view_user_id', adminViewUserId);
    else sessionStorage.removeItem('nhatro_admin_view_user_id');
  } catch (e) { /* storage is optional */ }
  memoryState = null;
  isReady = false;
  notifyUpdated();
}

function applyDefaults(s = {}) {
  const out = {};
  COLLECTION_KEYS.forEach((key) => { out[key] = s[key] || []; });
  out.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
  return out;
}

function ensureSessionBoundary() {
  const key = currentStateKey();
  if (activeStateKey && activeStateKey !== key) {
    memoryState = null;
    isReady = false;
  }
  activeStateKey = key;
  return key;
}

export function isStateReady() {
  return isReady;
}

// Synchronous read of the in-memory copy.
export function loadState() {
  ensureSessionBoundary();
  return applyDefaults(memoryState || {});
}

export function resetStateSession() {
  adminViewUserId = '';
  try { sessionStorage.removeItem('nhatro_admin_view_user_id'); } catch (e) { /* storage is optional */ }
  activeStateKey = currentStateKey();
  memoryState = null;
  isReady = false;
  notifyUpdated();
}

// ---- reading: one GET per requested collection ------------------------------------
export async function hydrateState(options = {}) {
  const { tables = null } = options;
  ensureSessionBoundary();
  const wanted = tables && tables.length ? tables : [...COLLECTION_KEYS, 'settings'];
  const requestedAdminViewUserId = adminViewUserId;
  const owner = requestedAdminViewUserId ? `?ownerUserId=${encodeURIComponent(requestedAdminViewUserId)}` : '';
  try {
    const slices = await Promise.all(wanted.map(async (key) => {
      if (key === 'settings') return [key, (await request('GET', `/api/settings${owner}`))?.settings || {}];
      if (!COLLECTIONS[key]) return null;
      return [key, (await request('GET', `/api/${COLLECTIONS[key]}${owner}`))?.[key] || []];
    }));
    // The admin may have switched the previewed account while the requests were in
    // flight. Never overwrite the newly selected account with stale data.
    if (requestedAdminViewUserId !== adminViewUserId) return;
    const next = applyDefaults(memoryState || {});
    let changed = !memoryState;
    for (const slice of slices) {
      if (!slice) continue;
      const [key, value] = slice;
      if (JSON.stringify(next[key]) !== JSON.stringify(value)) changed = true;
      next[key] = value;
    }
    if (changed) {
      memoryState = next;
      notifyUpdated();
    }
    isReady = true;
    window.dispatchEvent(new Event('boarding_state_ready'));
  } catch (e) {
    console.error('hydrateState error', e);
  }
}

export async function reloadStateForAdminView() {
  return hydrateState({ force: true });
}

// ---- writing: every add / edit / delete goes to the server right away -------------
export const ops = {
  create: (table, record) => ({ action: 'create', table, record }),
  update: (table, id, patch) => ({ action: 'update', table, id, patch }),
  remove: (table, id) => ({ action: 'delete', table, id }),
  upsert: (table, record) => ({ action: 'upsert', table, record }),
};

const nowIso = () => new Date().toISOString();

// The current in-memory copy, created on first use.
function currentState() {
  ensureSessionBoundary();
  if (!memoryState) memoryState = applyDefaults({});
  return memoryState;
}

// Applies one op to the in-memory copy; returns a function that undoes it. Both always
// work on whatever the current copy is, so overlapping writes and a refresh in between
// cannot undo each other's changes.
function applyLocally(op) {
  const table = op.table;
  const id = op.id ?? op.record?.id;
  const list = () => currentState()[table] || [];
  const setList = (next) => { currentState()[table] = next; };

  if (op.action === 'upsert') {
    return applyLocally(list().some((r) => r.id === id)
      ? { action: 'update', table, id, patch: op.record }
      : { action: 'create', table, record: op.record });
  }
  if (op.action === 'create') {
    setList([{ created_at: nowIso(), updated_at: nowIso(), ...op.record }, ...list()]);
    return () => setList(list().filter((r) => r.id !== id));
  }
  const index = list().findIndex((r) => r.id === id);
  if (index === -1) return () => {};
  const previous = list()[index];
  if (op.action === 'update') {
    setList(list().map((r) => (r.id === id ? { ...r, ...op.patch, updated_at: nowIso() } : r)));
    return () => setList(list().map((r) => (r.id === id ? previous : r)));
  }
  // delete
  setList(list().filter((r) => r.id !== id));
  return () => {
    const restored = [...list()];
    restored.splice(Math.min(index, restored.length), 0, previous);
    setList(restored);
  };
}

function normalizeOps(opList) {
  return opList.filter(Boolean).map((op) => (
    op.action === 'create' || op.action === 'upsert'
      ? { ...op, record: { ...op.record, id: op.record?.id || uid() } }
      : op
  ));
}

const READ_ONLY_MESSAGE = 'Đang xem dữ liệu của tài khoản khác (chỉ đọc), không thể chỉnh sửa.';

// commit([ops...]) — one op is one REST call; several ops are one /api/batch transaction
// (all saved or none). The local copy changes at once; if the server refuses, the change
// is undone and 'boarding_state_save_error' is raised. Resolves with the rows the server
// saved (it stamps created_at / updated_at / created_by / updated_by itself).
export async function commit(opList) {
  const list = normalizeOps(Array.isArray(opList) ? opList : [opList]);
  if (list.length === 0) return [];
  if (adminViewUserId) {
    notifyError(READ_ONLY_MESSAGE);
    throw new Error(READ_ONLY_MESSAGE);
  }
  const undo = list.map((op) => applyLocally(op)).reverse();
  notifyUpdated();

  try {
    let rows;
    if (list.length === 1 && list[0].action !== 'upsert') {
      const op = list[0];
      const path = `/api/${COLLECTIONS[op.table]}`;
      if (op.action === 'create') rows = [await request('POST', path, op.record)];
      else if (op.action === 'update') rows = [await request('PUT', `${path}/${encodeURIComponent(op.id)}`, op.patch)];
      else { await request('DELETE', `${path}/${encodeURIComponent(op.id)}`); rows = [null]; }
    } else {
      rows = (await request('POST', '/api/batch', {
        ops: list.map((op) => ({ action: op.action, resource: op.table, id: op.id ?? op.record?.id, data: op.record ?? op.patch })),
      })).results;
    }
    list.forEach((op, i) => {
      const row = rows[i];
      if (!row || !Array.isArray(currentState()[op.table])) return;
      currentState()[op.table] = currentState()[op.table].map((r) => (r.id === row.id ? row : r));
    });
    notifyUpdated();
    return rows;
  } catch (error) {
    undo.forEach((fn) => fn());
    notifyError(error?.message || 'Không thể lưu dữ liệu');
    notifyUpdated();
    throw error;
  }
}

// Settings are one row per user: PUT only what changed.
export async function saveSettings(patch) {
  if (adminViewUserId) {
    notifyError(READ_ONLY_MESSAGE);
    throw new Error(READ_ONLY_MESSAGE);
  }
  const previous = currentState().settings;
  currentState().settings = { ...previous, ...patch };
  notifyUpdated();
  try {
    const data = await request('PUT', '/api/settings', patch);
    currentState().settings = { ...DEFAULT_SETTINGS, ...(data?.settings || {}) };
    notifyUpdated();
    return currentState().settings;
  } catch (error) {
    currentState().settings = previous;
    notifyError(error?.message || 'Không thể lưu cấu hình');
    notifyUpdated();
    throw error;
  }
}

// Import a backup file: every record is upserted by id (existing ones updated, new ones
// created, nothing deleted), 200 records per transaction.
export async function importData(data) {
  const list = [];
  COLLECTION_KEYS.forEach((key) => (data?.[key] || []).forEach((record) => record?.id && list.push(ops.upsert(key, record))));
  for (let i = 0; i < list.length; i += 200) {
    await request('POST', '/api/batch', {
      ops: list.slice(i, i + 200).map((op) => ({ action: 'upsert', resource: op.table, id: op.record.id, data: op.record })),
    });
  }
  if (data?.settings && Object.keys(data.settings).length) await request('PUT', '/api/settings', data.settings);
  await hydrateState();
  return list.length;
}

export const monthKey = (d=new Date())=>{ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); return `${y}-${m}`; };
export const currency = v => new Intl.NumberFormat('vi-VN').format(v||0);
export const uid = ()=> Math.random().toString(36).slice(2);

// payment/debt helpers
export const isInMonth = (inv, ym) => ym ? inv.month===ym : true;
export function calcTotals(invoices=[], payments=[], ym){
  const filtered = ym? invoices.filter(i=> isInMonth(i, ym)) : invoices;
  const paidOf = (i)=>{
    return (payments||[]).filter(p=>p.invoiceId===i.id).reduce((a,b)=>a+(+b.amount||0),0);
  };
  const sumPaid = filtered.reduce((a,i)=> a + paidOf(i), 0);
  const sumDebt = filtered.reduce((a,i)=> a + Math.max(0,(+i.total||0) - paidOf(i)), 0);
  return { sumPaid, sumDebt };
}

// Keep rent paid in advance separate from money collected against an invoice.
// An advance is recorded against a RentPeriod, while invoice payments are
// recorded directly with invoiceId.  Both screens use this helper so their
// monthly figures and remaining balances cannot drift apart.
export function calcTotalsWithAdvance(invoices=[], payments=[], rentPeriods=[], paymentAllocations=[], ym){
  const filteredInvoices = ym ? invoices.filter((invoice) => isInMonth(invoice, ym)) : invoices;
  const periodAllocations = (period) => (paymentAllocations || [])
    .filter((allocation) => String(allocation.rentPeriodId || '') === String(period?.id || ''))
    .reduce((sum, allocation) => sum + (Number(allocation.amount) || 0), 0);
  const advanceOfInvoice = (invoice) => {
    const period = (rentPeriods || []).find((item) => String(item.roomId) === String(invoice.roomId) && item.month === invoice.month);
    // A rent-period allocation can only settle the rent component, never utilities.
    return Math.min(Number(invoice.rent) || 0, period ? periodAllocations(period) : 0);
  };
  const directPaidOf = (invoice) => (payments || [])
    .filter((payment) => String(payment.invoiceId || '') === String(invoice.id))
    .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);

  // Show advances for the selected month even when its invoice has not been
  // generated yet. This is the actual prepaid monthly-rent amount.
  const periodsInMonth = ym ? (rentPeriods || []).filter((period) => period.month === ym) : (rentPeriods || []);
  const sumAdvance = periodsInMonth.reduce((sum, period) => sum + Math.min(Number(period.rent) || 0, periodAllocations(period)), 0);
  const sumPaid = filteredInvoices.reduce((sum, invoice) => {
    const remainingAfterAdvance = Math.max(0, (Number(invoice.total) || 0) - advanceOfInvoice(invoice));
    return sum + Math.min(remainingAfterAdvance, directPaidOf(invoice));
  }, 0);
  const sumDebt = filteredInvoices.reduce((sum, invoice) => {
    const settled = advanceOfInvoice(invoice) + directPaidOf(invoice);
    return sum + Math.max(0, (Number(invoice.total) || 0) - settled);
  }, 0);
  return { sumAdvance, sumPaid, sumDebt };
}
