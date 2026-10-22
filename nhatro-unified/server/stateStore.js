// Per-landlord state persistence on PostgreSQL (Neon): the browser sends whole
// collections to /api/state and this syncs them into the tables (upsert by
// business id, soft delete for rows that are gone). Nothing is written to
// local disk — required on Vercel, whose function filesystem is read-only.
const db = require('./db');
const { encryptRow, decryptRow } = require('./cryptoFields');

const DATA_TABLE_KEYS = ['rooms', 'tenants', 'readings', 'invoices', 'payments', 'rentPeriods', 'paymentAllocations', 'deposits', 'depositTransactions'];
const CREATED_BY_FIELD = 'created_by';
const MODIFIED_BY_FIELD = 'modified_by';
// Bookkeeping columns that never go back to the browser or in from it.
const SYSTEM_COLUMNS = new Set(['Id', 'ID', 'created_at', 'updated_at', 'CreatedAt', 'UpdatedAt', 'createdBy', 'updatedBy', 'ncRecordId', CREATED_BY_FIELD, MODIFIED_BY_FIELD]);

function isConfigured() {
  return db.isConfigured();
}

function stripSystemColumns(row = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (!SYSTEM_COLUMNS.has(key)) clean[key] = value;
  }
  return clean;
}

function sanitizeWritablePayload(payload = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (SYSTEM_COLUMNS.has(key)) continue;
    clean[key] = key === 'status' && value === 'Còn nợ' ? 'Chưa thanh toán' : value;
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

async function fetchOwnedRows(key, userId, client = null) {
  const rows = await db.listRows(key, { where: { [CREATED_BY_FIELD]: String(userId) }, activeOnly: true }, client);
  return rows.map((row) => decryptRow(key, row));
}

// True when every field the browser sent already has the same stored value,
// so an unchanged row costs no write.
function sameAsStored(stored, record) {
  return Object.entries(record).every(([field, value]) => {
    if (!(field in stored)) return true; // not a column; ignored on write anyway
    return String(stored[field] ?? '') === String(value ?? '');
  });
}

async function syncCollection(key, userId, records, client) {
  const existingRows = await fetchOwnedRows(key, userId, client);
  const existingById = new Map(existingRows.map((row) => [String(row.id), row]));

  const nextIds = new Set();
  for (const record of records) {
    if (!record?.id) continue;
    const idKey = String(record.id);
    nextIds.add(idKey);
    const stored = existingById.get(idKey);
    if (stored && sameAsStored(stored, sanitizeWritablePayload(record))) continue;
    const owned = withOwnership(record, userId, Boolean(stored));
    if (stored) owned[CREATED_BY_FIELD] = String(userId);
    await db.upsertRow(key, encryptRow(key, owned), client);
  }

  const removed = [...existingById.keys()].filter((id) => !nextIds.has(id));
  if (removed.length) {
    await db.softDeleteRows(key, { id: removed, [CREATED_BY_FIELD]: String(userId) }, client);
  }
}

function normalizeSettingsRow(row) {
  return row ? stripSystemColumns(row) : {};
}

async function loadSettings(userId) {
  const rows = await fetchOwnedRows('settings', userId);
  return normalizeSettingsRow(rows[0]);
}

async function saveSettings(userId, settings, client) {
  const rows = await fetchOwnedRows('settings', userId, client);
  const row = rows[0];
  const payload = withOwnership({ id: row?.id || `settings:${userId}`, ...settings }, userId, Boolean(row));
  if (row) payload[CREATED_BY_FIELD] = String(userId);
  await db.upsertRow('settings', payload, client);

  const extra = rows.slice(1).map((r) => r.id);
  if (extra.length) await db.softDeleteRows('settings', { id: extra, [CREATED_BY_FIELD]: String(userId) }, client);
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
  // One transaction: a failed save leaves the previous state intact.
  await db.withTransaction(async (client) => {
    for (const key of wantedKeys) {
      await syncCollection(key, userId, Array.isArray(state[key]) ? state[key] : [], client);
    }
    if (!tables || tables.length === 0 || tables.includes('settings')) {
      await saveSettings(userId, state.settings || {}, client);
    }
  });
}

module.exports = {
  isConfigured,
  loadStateForUser,
  saveStateForUser,
};
