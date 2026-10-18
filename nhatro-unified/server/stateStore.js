// Server-side mirror of web/src/utils/nocodb.js's collection-sync pipeline.
// Lets the backend read/write the same NocoDB tables the browser writes to
// directly, so /api/state works as a real (not local-file) fallback and the
// server never needs to persist app data to disk — required on Vercel,
// whose function filesystem is read-only outside /tmp.
const fetchApi =
  typeof global.fetch === 'function'
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

function firstEnv(...names) {
  for (const name of names) {
    if (!name) continue;
    const value = process.env[name];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

// Read lazily (not as module-level consts): index.js loads .env files as a
// side effect *after* requiring this module, so capturing process.env at
// require-time would always see an empty config.
function nocodbUrl() {
  return firstEnv('NOCODB_URL', 'VITE_NOCODB_URL').replace(/\/+$/, '');
}

function nocodbApiKey() {
  return firstEnv('NOCODB_API_KEY', 'VITE_NOCODB_API_KEY');
}

function tables() {
  return {
    rooms: firstEnv('NOCODB_TABLE_ROOMS', 'TABLE_ROOMS', 'VITE_TABLE_ROOMS'),
    tenants: firstEnv('NOCODB_TABLE_TENANTS', 'TABLE_TENANTS', 'VITE_TABLE_TENANTS'),
    readings: firstEnv('NOCODB_TABLE_READINGS', 'TABLE_READINGS', 'VITE_TABLE_READINGS'),
    invoices: firstEnv('NOCODB_TABLE_INVOICES', 'TABLE_INVOICES', 'VITE_TABLE_INVOICES'),
    payments: firstEnv('NOCODB_TABLE_PAYMENTS', 'TABLE_PAYMENTS', 'VITE_TABLE_PAYMENTS'),
    rentPeriods: firstEnv('NOCODB_TABLE_RENT_PERIODS', 'TABLE_RENT_PERIODS', 'VITE_TABLE_RENT_PERIODS'),
    paymentAllocations: firstEnv('NOCODB_TABLE_PAYMENT_ALLOCATIONS', 'TABLE_PAYMENT_ALLOCATIONS', 'VITE_TABLE_PAYMENT_ALLOCATIONS'),
    deposits: firstEnv('NOCODB_TABLE_DEPOSITS', 'TABLE_DEPOSITS', 'VITE_TABLE_DEPOSITS'),
    depositTransactions: firstEnv('NOCODB_TABLE_DEPOSIT_TRANSACTIONS', 'TABLE_DEPOSIT_TRANSACTIONS', 'VITE_TABLE_DEPOSIT_TRANSACTIONS'),
    settings: firstEnv('NOCODB_TABLE_SETTINGS', 'TABLE_SETTINGS', 'VITE_TABLE_SETTINGS'),
  };
}

const DATA_TABLE_KEYS = ['rooms', 'tenants', 'readings', 'invoices', 'payments', 'rentPeriods', 'paymentAllocations', 'deposits', 'depositTransactions'];
const CREATED_BY_FIELD = 'created_by';
const MODIFIED_BY_FIELD = 'modified_by';
const SYSTEM_COLUMNS = new Set([
  'Id', 'ID', 'created_at', 'updated_at', 'CreatedAt', 'UpdatedAt',
  'createdBy', 'updatedBy', 'ncRecordId', CREATED_BY_FIELD, MODIFIED_BY_FIELD,
]);
const MAX_RETRIES = 4;
const BASE_RETRY_MS = 800;
const WARNED_MISSING_TABLES = new Set();

function isConfigured() {
  return Boolean(nocodbUrl() && nocodbApiKey());
}

function hasTableConfig(key) {
  return Boolean(tables()[key]);
}

function warnMissingTable(key) {
  if (WARNED_MISSING_TABLES.has(key)) return;
  WARNED_MISSING_TABLES.add(key);
  console.warn(`[stateStore] NocoDB table is not configured: ${key}`);
}

function nocoHeaders() {
  return { 'Content-Type': 'application/json', 'xc-token': nocodbApiKey() };
}

function tableUrl(key, suffix = '') {
  const tableId = tables()[key];
  if (!tableId) throw new Error(`Missing NocoDB table id for ${key}`);
  return `${nocodbUrl()}/api/v2/tables/${encodeURIComponent(tableId)}/records${suffix}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelay(res, attempt) {
  const retryAfter = res.headers.get('Retry-After');
  const retrySeconds = Number(retryAfter);
  if (Number.isFinite(retrySeconds) && retrySeconds > 0) return retrySeconds * 1000;
  return BASE_RETRY_MS * (attempt + 1);
}

async function fetchJson(url, options = {}) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const res = await fetchApi(url, { ...options, headers: { ...nocoHeaders(), ...(options.headers || {}) } });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      await sleep(getRetryDelay(res, attempt));
      continue;
    }
    const contentType = res.headers.get('content-type') || '';
    const payload = res.status === 204
      ? null
      : contentType.includes('application/json')
        ? await res.json()
        : await res.text();
    if (!res.ok) {
      throw new Error(typeof payload === 'string' ? payload : `NocoDB request failed: ${res.status}`);
    }
    return payload;
  }
  throw new Error('NocoDB request retry exhausted');
}

function getRowId(row) {
  const candidate = row?.Id ?? null;
  if (candidate === null || candidate === undefined || candidate === '') return null;
  return candidate;
}

function stripSystemColumns(row = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (SYSTEM_COLUMNS.has(key)) continue;
    clean[key] = value;
  }
  return clean;
}

function sanitizeWritablePayload(payload = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (SYSTEM_COLUMNS.has(key)) continue;
    if (key === 'status' && value === 'Còn nợ') {
      clean[key] = 'Chưa thanh toán';
      continue;
    }
    clean[key] = value;
  }
  return clean;
}

function withOwnership(record, userId, isUpdate) {
  return {
    ...sanitizeWritablePayload(record),
    isDeleted: false,
    ...(isUpdate ? {} : { [CREATED_BY_FIELD]: userId }),
    [MODIFIED_BY_FIELD]: userId,
  };
}

function buildOwnedWhere(userId, extraWhere = '') {
  const base = `(${CREATED_BY_FIELD},eq,${userId})~and(isDeleted,neq,true)`;
  const combined = extraWhere ? `${base}~and${extraWhere}` : base;
  return encodeURIComponent(combined);
}

async function fetchOwnedRows(key, userId) {
  if (!hasTableConfig(key)) {
    warnMissingTable(key);
    return [];
  }
  const data = await fetchJson(tableUrl(key, `?where=${buildOwnedWhere(userId)}&limit=1000`));
  return data?.list || [];
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isSamePayload(a, b) {
  return stableStringify(a) === stableStringify(b);
}

async function createRow(key, payload) {
  await fetchJson(tableUrl(key), { method: 'POST', body: JSON.stringify(payload) });
}

async function updateRow(key, rowId, payload) {
  const canUseSystemId = !(rowId === null || rowId === undefined || rowId === '');
  const body = canUseSystemId ? [{ ...payload, Id: rowId }] : [{ ...payload }];
  await fetchJson(tableUrl(key), { method: 'PATCH', body: JSON.stringify(body) });
}

async function softDeleteRow(key, rowId) {
  if (rowId === null || rowId === undefined || rowId === '') return;
  await fetchJson(tableUrl(key), { method: 'PATCH', body: JSON.stringify([{ Id: rowId, isDeleted: true }]) });
}

async function syncCollection(key, userId, records = []) {
  if (!hasTableConfig(key)) {
    warnMissingTable(key);
    return;
  }

  const existingRows = await fetchOwnedRows(key, userId);
  const existingByAppId = new Map();
  existingRows.forEach((row) => {
    const clean = stripSystemColumns(row);
    if (clean?.id) existingByAppId.set(String(clean.id), { rowId: getRowId(row), data: clean });
  });

  const nextIds = new Set();
  for (const record of records) {
    if (!record?.id) continue;
    const idKey = String(record.id);
    nextIds.add(idKey);

    const existing = existingByAppId.get(idKey);
    const ownedRecord = withOwnership(record, userId, Boolean(existing));
    if (!existing) {
      await createRow(key, ownedRecord);
      continue;
    }
    if (!isSamePayload(existing.data, record)) {
      await updateRow(key, existing.rowId, ownedRecord);
    }
  }

  for (const [idKey, existing] of existingByAppId.entries()) {
    if (!nextIds.has(idKey)) {
      await softDeleteRow(key, existing.rowId);
    }
  }
}

function normalizeSettingsRow(row) {
  if (!row) return {};
  return stripSystemColumns(row);
}

async function loadSettings(userId) {
  if (!hasTableConfig('settings')) {
    warnMissingTable('settings');
    return {};
  }
  const data = await fetchJson(tableUrl('settings', `?where=${buildOwnedWhere(userId)}&limit=1000`));
  const row = (data?.list || [])[0];
  return normalizeSettingsRow(row);
}

async function saveSettings(userId, settings = {}) {
  if (!hasTableConfig('settings')) {
    warnMissingTable('settings');
    return;
  }
  const data = await fetchJson(tableUrl('settings', `?where=${buildOwnedWhere(userId)}&limit=1000`));
  const rows = data?.list || [];
  const row = rows[0];
  const baseId = row?.id || `settings:${userId}`;
  const payload = withOwnership({ id: baseId, ...settings }, userId, Boolean(row));

  if (!row) {
    await createRow('settings', payload);
  } else if (!isSamePayload(normalizeSettingsRow(row), settings)) {
    await updateRow('settings', getRowId(row), payload);
  }

  for (const extraRow of rows.slice(1)) {
    await softDeleteRow('settings', getRowId(extraRow));
  }
}

async function loadStateForUser(userId) {
  const entries = await Promise.all(DATA_TABLE_KEYS.map(async (key) => [key, (await fetchOwnedRows(key, userId)).map(stripSystemColumns)]));
  const state = Object.fromEntries(entries);
  state.settings = await loadSettings(userId);
  return state;
}

async function saveStateForUser(userId, state = {}) {
  for (const key of DATA_TABLE_KEYS) {
    await syncCollection(key, userId, Array.isArray(state[key]) ? state[key] : []);
  }
  await saveSettings(userId, state.settings || {});
}

module.exports = {
  isConfigured,
  loadStateForUser,
  saveStateForUser,
};
