import { getAuthSession, getStoredToken } from './auth';
import { isNocoConfigured, loadStateFromNoco, saveStateToNoco } from './nocodb';

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

function currentStateKey() {
  const { userId } = getAuthSession();
  return `boarding_state_v1:${userId || 'guest'}`;
}

// In-memory state snapshot (synchronous access for existing code paths)
let memoryState = null;
let activeStateKey = '';
let adminViewUserId = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('nhatro_admin_view_user_id') || '' : '';

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
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('boarding_state_updated'));
}


function shouldUseNocoState() {
  return isNocoConfigured();
}

async function loadStateFromServer(options = {}) {
  const { tables = null } = options;
  if (adminViewUserId) {
    if (shouldUseNocoState()) {
      try {
        const state = await loadStateFromNoco({ tables, userId: adminViewUserId });
        if (state) return state;
      } catch (e) {
        // Fall back to the admin server endpoint for non-Noco/local storage.
      }
    }
    try {
      const resp = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(adminViewUserId)}/state`), { headers: authHeaders() });
      if (!resp.ok) throw new Error('Không thể tải dữ liệu tài khoản đã chọn');
      const json = await resp.json();
      return json?.state || null;
    } catch (e) {
      return null;
    }
  }
  if (shouldUseNocoState()) {
    try {
      const state = await loadStateFromNoco({ tables });
      if (state) return state;
    } catch (e) {
      // noco fails, fallback next
    }
  }

  try { 
    const resp = await fetch(apiUrl('/api/state'), { headers: authHeaders() }); 
    if (!resp.ok) return null;
    const json = await resp.json();
    if (json && json.state) return json.state;
  } catch (e) {
    // server unavailable, ignore
  }
  return null;
}

async function saveStateToServer(state, options = {}) {
  const { tables = null } = options;
  let saved = false;
  let lastError = null;

  if (shouldUseNocoState()) {
    try {
      console.log('save to nocodb', state);
      const nocoSaved = await saveStateToNoco(state, { tables });
      if (nocoSaved) {
        saved = true;
      } else {
        throw new Error('NocoDB từ chối lưu dữ liệu. Kiểm tra lại cấu trúc bảng và tên cột.');
      }
    } catch (e) {
      // Khi NocoDB là nguồn dữ liệu chính, không âm thầm ghi sang backend JSON.
      // Nếu fallback, giao diện có vẻ đã lưu nhưng lần tải sau vẫn mất dữ liệu từ NocoDB.
      throw e;
    }
  }

  if (!saved) {
    try {
      console.log('save to backend state', state);
      const res = await fetch(apiUrl('/api/state'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ state }),
      });
      const data = res.ok ? null : await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || 'Không thể lưu dữ liệu');
      }
      saved = true;
    } catch (e) {
      lastError = e;
    }
  }

  if (!saved && lastError) {
    throw lastError;
  }

  return saved;
}

function applyDefaults(s) {
  const defaultSettings = {
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
  return {
    rooms: s.rooms || [],
    tenants: s.tenants || [],
    readings: s.readings || [],
    invoices: s.invoices || [],
    payments: s.payments || [],
    rentPeriods: s.rentPeriods || [],
    paymentAllocations: s.paymentAllocations || [],
    deposits: s.deposits || [],
    depositTransactions: s.depositTransactions || [],
    settings: { ...defaultSettings, ...(s.settings || {}) }
  };
}

function mergeStateSlices(base, incoming, tables = null) {
  if (!incoming) return applyDefaults(base || {});
  if (!tables || tables.length === 0) {
    return applyDefaults(incoming);
  }

  const next = applyDefaults(base || {});
  tables.forEach((table) => {
    if (table === 'settings') next.settings = incoming.settings || next.settings;
    else if (table in next) {
      if (Array.isArray(incoming[table])) next[table] = incoming[table];
    }
  });
  if (incoming.__meta) next.__meta = incoming.__meta;
  return next;
}

function ensureSessionBoundary() {
  const key = currentStateKey();
  if (activeStateKey && activeStateKey !== key) {
    memoryState = null;
    isReady = false;
    isHydrating = false;
  }
  activeStateKey = key;
  return key;
}

// loadState remains synchronous for compatibility; it returns the in-
// export function loadState(){
//   if (!memoryState) {
//   // initialize with seed so UI has something to show immediately
//       memoryState = seed();
//   // persist seed to DB asynchronously
//       (async ()=>{ try{ await dbSet(KEY, memoryState); }catch(e){} })();
//   // also notify listeners that state is available
//       if(typeof window !== 'undefined' && window.dispatchEvent){ try{ window.dispatchEvent(new Event('boarding_state_updated')); }catch(e){} }
//   }
//  return applyDefaults(memoryState);
// } 
let isReady = false;

export function isStateReady() {
  return isReady;
}
let isHydrating = false;

// Compare state to avoid unnecessary re-render
function isSameState(a, b) {
  const aLastModified = a?.__meta?.lastModified;
  const bLastModified = b?.__meta?.lastModified;
  if (!aLastModified || !bLastModified) return false;
  return aLastModified === bLastModified;
}

function hasStateChanged(nextState, prevState, tables = null) {
  if (!prevState) return true;
  if (!tables || tables.length === 0) return !isSameState(nextState, prevState);
  return JSON.stringify(nextState) !== JSON.stringify(prevState);
}
export function loadState() {
  ensureSessionBoundary();
  return applyDefaults(memoryState || {
    rooms: [],
    tenants: [],
    readings: [],
    invoices: [],
    payments: [],
    rentPeriods: [],
    paymentAllocations: [],
    deposits: [],
    depositTransactions: [],
    settings: {
      bankCode: 'VCB',
      accountNo: '',
      accountName: '',
      qrNoteTemplate: 'Tien phong {room} {month}',
      landlordName: '',
      landlordPhone: '',
      landlordAddress: '',
      occupancyMode: 'month',
      meterRoomScope: 'occupied',
      useTuyaMonthlyUsage: false,
    }
  });
}
export function resetStateSession() {
  adminViewUserId = '';
  try { sessionStorage.removeItem('nhatro_admin_view_user_id'); } catch (e) {}
  activeStateKey = currentStateKey();
  memoryState = null;
  isReady = false;
  isHydrating = false;
  if (typeof window !== 'undefined' && window.dispatchEvent) {
    try { window.dispatchEvent(new Event('boarding_state_updated')); } catch (e) {}
  }
}

export async function hydrateState(options = {}) {
  const { tables = null, force = false } = options;
  if (isHydrating && !force) return;
  ensureSessionBoundary();
  isHydrating = true;
  const requestedAdminViewUserId = adminViewUserId;
  try {
    // Load from server / NocoDB only, scoped by requested tables.
    const serverState = await loadStateFromServer({ tables });
    // A user may have switched the admin preview while this request was in
    // flight. Never overwrite the newly selected account with stale data.
    if (requestedAdminViewUserId !== adminViewUserId) return;
    const nextState = mergeStateSlices(memoryState, serverState, tables);
    if (serverState && hasStateChanged(nextState, memoryState, tables)) {
      memoryState = nextState;
      window.dispatchEvent(new Event('boarding_state_updated'));
    }

    isReady = true;
    window.dispatchEvent(new Event('boarding_state_ready'));

  } catch (e) {
    console.error('hydrateState error', e);
  } finally {
    isHydrating = false;
  }
}

export async function reloadStateForAdminView() {
  return hydrateState({ force: true });
}
function seed(){
  const uid = () => Math.random().toString(36).slice(2);
  const monthKey = (d=new Date())=>{ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); return `${y}-${m}`; };
  const r1={ id:uid(), name:'P101', baseRent:2500000, electricRate:3500, waterRate:12000 };
  const r2={ id:uid(), name:'P102', baseRent:2700000, electricRate:3500, waterRate:12000 };
  const t1={ id:uid(), name:'Nguyen Van A', cccd:'012345678901', phone:'0901234567', roomId:r1.id };
  const readings=[{ id:uid(), roomId:r1.id, month:monthKey(), electricStart:100, electricEnd:120, waterStart:30, waterEnd:32, createdAt:new Date().toISOString() }];
  const s={ rooms:[r1,r2], tenants:[t1], readings, invoices:[], payments:[], rentPeriods:[], paymentAllocations:[], deposits:[], depositTransactions:[], settings:{ bankCode:'VCB', accountNo:'', accountName:'', qrNoteTemplate:'Tien phong {room} {month}', landlordName:'', landlordPhone:'', landlordAddress:'', occupancyMode:'month', meterRoomScope:'occupied' }, __meta: { lastModified: new Date().toISOString() } };
  return s;
}

function normalizeStateBeforePersist(state = {}) {
  // A payment can be allocated to multiple rental months. Keep every payment
  // and allocation; invoiceId-only payments from older data remain valid.
  if (Array.isArray(state.paymentAllocations) || Array.isArray(state.rentPeriods)) {
    return {
      ...state,
      invoices: Array.isArray(state.invoices) ? state.invoices : [],
      payments: Array.isArray(state.payments) ? state.payments : [],
      rentPeriods: Array.isArray(state.rentPeriods) ? state.rentPeriods : [],
      paymentAllocations: Array.isArray(state.paymentAllocations) ? state.paymentAllocations : [],
      deposits: Array.isArray(state.deposits) ? state.deposits : [],
      depositTransactions: Array.isArray(state.depositTransactions) ? state.depositTransactions : [],
    };
  }
  const invoices = Array.isArray(state.invoices) ? state.invoices : [];
  const sourcePayments = Array.isArray(state.payments) ? state.payments : [];
  const invoiceById = new Map(
    invoices
      .filter((inv) => inv?.id !== null && inv?.id !== undefined && inv?.id !== '')
      .map((inv) => [String(inv.id), inv])
  );
  const paymentsByInvoiceId = new Map();
  const STATUS_PAID = 'Đã thanh toán';
  const STATUS_UNPAID = 'Chưa thanh toán';
  const LEGACY_STATUS_UNPAID = 'Chưa thanh toán';
  const isUnpaid = (status = '') => {
    const s = String(status || '').trim();
    return s === STATUS_UNPAID || s === LEGACY_STATUS_UNPAID;
  };

  for (const payment of sourcePayments) {
    const invoiceId = payment?.invoiceId;
    if (invoiceId === null || invoiceId === undefined || invoiceId === '') continue;
    const invoiceIdKey = String(invoiceId);
    const invoice = invoiceById.get(invoiceIdKey);
    if (!invoice) continue;
    if (isUnpaid(invoice.status)) continue;
    if (!paymentsByInvoiceId.has(invoiceIdKey)) {
      paymentsByInvoiceId.set(invoiceIdKey, payment);
    }
  }

  const normalizedInvoices = invoices.map((invoice) => {
    if (!invoice?.id) return invoice;
    const hasPayment = paymentsByInvoiceId.has(String(invoice.id));
    if (hasPayment) {
      const payment = paymentsByInvoiceId.get(String(invoice.id));
      return { ...invoice, status: STATUS_PAID, paidAt: payment?.paidAt || invoice.paidAt };
    }
    return { ...invoice, status: STATUS_UNPAID, paidAt: undefined };
  });

  return {
    ...state,
    invoices: normalizedInvoices,
    payments: Array.from(paymentsByInvoiceId.values()),
  };
}

export function saveState(next){ 
  try{
    if (adminViewUserId) return;
    ensureSessionBoundary();
    const prevState = memoryState;
    const normalized = normalizeStateBeforePersist(next);
    const withMeta = { ...normalized, __meta: { lastModified: new Date().toISOString() } };
    // update in-memory snapshot
    memoryState = withMeta;
    (async ()=>{
      // Persist only changed tables (no whole-state sync).
      const tableKeys = ['rooms', 'tenants', 'readings', 'invoices', 'payments', 'rentPeriods', 'paymentAllocations', 'deposits', 'depositTransactions', 'settings'];
      const changed = [];
      for (const key of tableKeys) {
        const a = prevState?.[key];
        const b = withMeta?.[key];
        if (key === 'settings') {
          if (JSON.stringify(a || {}) !== JSON.stringify(b || {})) changed.push(key);
        } else {
          if (JSON.stringify(a || []) !== JSON.stringify(b || [])) changed.push(key);
        }
      }
      try {
        await saveStateToServer(withMeta, { tables: changed.length ? changed : null });
      } catch (e) {
        memoryState = prevState;
        if (typeof window !== 'undefined' && e?.message) {
          window.alert(e.message);
          window.dispatchEvent(new Event('boarding_state_updated'));
        }
        return;
      }
      // notify same-tab listeners that state changed (after DB write)
      if(typeof window !== 'undefined' && window.dispatchEvent){
        try{ window.dispatchEvent(new Event('boarding_state_updated')); }catch(e){}
      }
    })();
  }catch(e){ /* ignore write errors */ }
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
