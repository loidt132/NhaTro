// Per-user app state (rooms, tenants, invoices, ...) stored in PostgreSQL
// (Neon). Backs /api/state: the browser sends/receives the whole collection
// for each table and this module diffs it against the database.
const db = require('./db');
const { encryptRow, decryptRow } = require('./cryptoFields');

const DATA_TABLE_KEYS = ['rooms', 'tenants', 'readings', 'invoices', 'payments', 'rentPeriods', 'paymentAllocations', 'deposits', 'depositTransactions'];
const CREATED_BY_FIELD = 'created_by';
const UPDATED_BY_FIELD = 'updated_by';
// Bookkeeping columns that are never part of the app's own record.
// Ownership columns never travel to the browser. created_at / updated_at do:
// they are part of the app's records (the web app sorts and compares by them).
const SYSTEM_COLUMNS = new Set([CREATED_BY_FIELD, UPDATED_BY_FIELD]);
const AUDIT_TIME_COLUMNS = new Set(['created_at', 'updated_at']);

function isConfigured() {
  return db.isConfigured();
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

// Always stamps the audit columns: a new row gets created_at (the app's own
// value if it sent one, else now) and updated_at = now; an existing row keeps
// its created_at and gets updated_at = now.
function withOwnership(record, userId, existing = null) {
  const nowIso = new Date().toISOString();
  return {
    ...sanitizeWritablePayload(record),
    isDeleted: false,
    [CREATED_BY_FIELD]: userId,
    [UPDATED_BY_FIELD]: userId,
    created_at: existing?.created_at || record.created_at || nowIso,
    updated_at: nowIso,
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// True when every field the app sent already has that value in the database
// (extra DB-only columns such as isDeleted or null columns don't count).
function isSamePayload(existing, record) {
  const columnsToCompare = Object.keys(record).filter((key) => !SYSTEM_COLUMNS.has(key) && !AUDIT_TIME_COLUMNS.has(key));
  return columnsToCompare.every((key) => {
    const a = existing[key];
    const b = record[key];
    if ((a === null || a === undefined || a === '') && (b === null || b === undefined || b === '')) return true;
    if (typeof a === 'number' && b !== '' && b !== null && Number(b) === a) return true;
    if (key === 'status' && b === 'Còn nợ') return a === 'Chưa thanh toán';
    return stableStringify(a) === stableStringify(b);
  });
}

async function fetchOwnedRows(key, userId) {
  const rows = await db.listOwnedRows(db.TABLES[key], userId);
  return rows.map((row) => decryptRow(key, row));
}

async function syncCollection(key, userId, records = []) {
  const table = db.TABLES[key];
  const existingRows = await fetchOwnedRows(key, userId);
  const existingByAppId = new Map();
  existingRows.forEach((row) => {
    if (row?.id) existingByAppId.set(String(row.id), row);
  });

  const toWrite = [];
  const nextIds = new Set();
  for (const record of records) {
    if (!record?.id) continue;
    const idKey = String(record.id);
    nextIds.add(idKey);
    const existing = existingByAppId.get(idKey);
    if (existing && isSamePayload(existing, record)) continue;
    toWrite.push(withOwnership(record, userId, existing));
  }
  const toDelete = [...existingByAppId.keys()].filter((idKey) => !nextIds.has(idKey));
  if (toWrite.length === 0 && toDelete.length === 0) return;

  await db.withTransaction(async (client) => {
    for (const row of toWrite) {
      await db.upsertRow(table, encryptRow(key, row), { client });
    }
    for (const idKey of toDelete) {
      await db.softDeleteRow(table, idKey, userId, { client });
    }
  });
}

function settingsRow(row) {
  if (!row) return {};
  const clean = stripSystemColumns(row);
  delete clean.isDeleted;
  delete clean.created_at;
  delete clean.updated_at;
  return clean;
}

async function loadSettings(userId) {
  const rows = await db.listOwnedRows(db.TABLES.settings, userId);
  return settingsRow(rows[0]);
}

async function saveSettings(userId, settings = {}) {
  const table = db.TABLES.settings;
  const rows = await db.listOwnedRows(table, userId);
  const row = rows[0];
  const baseId = row?.id || `settings:${userId}`;
  const payload = withOwnership({ id: baseId, ...settings }, userId, row);

  await db.withTransaction(async (client) => {
    if (!row || !isSamePayload(settingsRow(row), { id: baseId, ...settings })) {
      await db.upsertRow(table, payload, { client });
    }
    for (const extraRow of rows.slice(1)) {
      await db.softDeleteRow(table, extraRow.id, userId, { client });
    }
  });
}

async function loadStateForUser(userId, tables = null) {
  const wantedKeys = tables && tables.length ? DATA_TABLE_KEYS.filter((key) => tables.includes(key)) : DATA_TABLE_KEYS;
  const entries = await Promise.all(wantedKeys.map(async (key) => [key, (await fetchOwnedRows(key, userId)).map(stripSystemColumns)]));
  const state = Object.fromEntries(entries);
  if (!tables || tables.length === 0 || tables.includes('settings')) {
    state.settings = await loadSettings(userId);
  }
  return state;
}

async function saveStateForUser(userId, state = {}, tables = null) {
  const wantedKeys = tables && tables.length ? DATA_TABLE_KEYS.filter((key) => tables.includes(key)) : DATA_TABLE_KEYS;
  for (const key of wantedKeys) {
    await syncCollection(key, userId, Array.isArray(state[key]) ? state[key] : []);
  }
  if (!tables || tables.length === 0 || tables.includes('settings')) {
    await saveSettings(userId, state.settings || {});
  }
}

module.exports = {
  isConfigured,
  loadStateForUser,
  saveStateForUser,
};
