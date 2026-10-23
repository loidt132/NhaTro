// PostgreSQL (Neon) data layer used by index.js and resources.js. Table and column names come from neon-schema.sql; only columns that
// really exist are ever interpolated into SQL (request-body keys that are not
// columns are dropped with a warning) and every value is a bound parameter.
const { Pool, types } = require('pg');

// NUMERIC/BIGINT -> number, DATE -> "YYYY-MM-DD", TIMESTAMPTZ -> ISO string,
// so rows are plain JSON-friendly objects.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1184, (v) => new Date(v).toISOString());

// collection key -> real table name.
const TABLES = {
  users: 'users',
  rooms: 'rooms',
  tenants: 'tenants',
  readings: 'readings',
  invoices: 'invoices',
  payments: 'payments',
  rentPeriods: 'rent_periods',
  paymentAllocations: 'payment_allocations',
  deposits: 'deposits',
  depositTransactions: 'deposit_transactions',
  depositRefunds: 'deposit_refunds',
  rentalContracts: 'rental_contracts',
  settings: 'settings',
  meterSubmissions: 'meter_submissions',
};

function connectionString() {
  return String(process.env.DATABASE_URL || '').trim();
}

function isConfigured() {
  return Boolean(connectionString());
}

let pool = null;
function getPool() {
  if (pool) return pool;
  if (!isConfigured()) throw new Error('Postgres chưa cấu hình — cần DATABASE_URL trên server.');
  pool = new Pool({
    connectionString: connectionString(),
    max: 5,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 10000,
    statement_timeout: 30000,
  });
  return pool;
}

async function query(text, params = []) {
  const { rows } = await getPool().query(text, params);
  return rows;
}

async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function closePool() {
  if (pool) await pool.end();
  pool = null;
  columnCache.clear();
}

const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;

const columnCache = new Map();
async function columnsOf(table) {
  if (columnCache.has(table)) return columnCache.get(table);
  const rows = await query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1`,
    [table]
  );
  if (rows.length === 0) throw new Error(`Không tìm thấy bảng "${table}" — chạy npm run migrate-to-neon.`);
  const map = new Map(rows.map((r) => [r.column_name, r.data_type]));
  columnCache.set(table, map);
  return map;
}

function forgetColumns(table) {
  columnCache.delete(table);
}

// Make a JS value acceptable for a column of the given Postgres type.
function coerce(dataType, value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (dataType === 'boolean') {
    if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.trim().toLowerCase());
    return Boolean(value);
  }
  if (dataType === 'numeric' || dataType === 'bigint' || dataType === 'integer' || dataType === 'double precision') {
    if (value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? (dataType === 'numeric' || dataType === 'double precision' ? n : Math.trunc(n)) : null;
  }
  if (dataType.startsWith('timestamp') || dataType === 'date') {
    if (value === '') return null;
    return Number.isNaN(new Date(value).getTime()) ? null : value;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

const WARNED_COLUMNS = new Set();

// INSERT ... ON CONFLICT (id) DO UPDATE. An existing row is only overwritten
// when it belongs to the same owner (created_by), so a client can never take
// over another user's record by reusing its id. `created_by` and `created_at`
// are never changed by an update. Pass `client` to run inside a transaction.
async function upsertRow(table, row, { client = null, onConflict = 'update' } = {}) {
  const columns = await columnsOf(table);
  const cols = [];
  const values = [];
  for (const [key, raw] of Object.entries(row)) {
    if (!columns.has(key)) {
      const marker = `${table}.${key}`;
      if (!WARNED_COLUMNS.has(marker)) {
        WARNED_COLUMNS.add(marker);
        console.warn(`[db] bỏ qua trường "${key}" — bảng ${table} chưa có cột này`);
      }
      continue;
    }
    const value = coerce(columns.get(key), raw);
    if (value === undefined) continue;
    cols.push(key);
    values.push(value);
  }
  if (!cols.includes('id')) throw new Error(`upsertRow(${table}): thiếu id`);

  // Audit timestamps are always passed explicitly: created_at on insert (never
  // changed by an update) and updated_at on every write.
  const nowIso = new Date().toISOString();
  for (const column of ['created_at', 'updated_at']) {
    if (!columns.has(column)) continue;
    const at = cols.indexOf(column);
    if (at === -1) {
      cols.push(column);
      values.push(nowIso);
    } else if (values[at] === null) {
      values[at] = nowIso;
    }
  }

  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const updatable = cols.filter((c) => c !== 'id' && c !== 'created_by' && c !== 'created_at');
  let conflict;
  if (onConflict === 'nothing') {
    conflict = 'ON CONFLICT (id) DO NOTHING';
  } else {
    const sets = updatable.map((c) => `${q(c)} = EXCLUDED.${q(c)}`);
    conflict = sets.length === 0
      ? 'ON CONFLICT (id) DO NOTHING'
      : `ON CONFLICT (id) DO UPDATE SET ${sets.join(', ')} ${cols.includes('created_by') ? `WHERE ${q(table)}.created_by = EXCLUDED.created_by` : ''}`;
  }
  const sql = `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${placeholders}) ${conflict}`;
  const runner = client || getPool();
  const result = await runner.query(sql, values);
  return result.rowCount;
}

// Rows owned by userId (created_by) that are not soft-deleted.
async function listOwnedRows(table, userId) {
  const columns = await columnsOf(table);
  const notDeleted = columns.has('isDeleted') ? `AND COALESCE(${q('isDeleted')}, false) = false` : '';
  return query(`SELECT * FROM ${q(table)} WHERE created_by = $1 ${notDeleted}`, [String(userId)]);
}

// Soft delete: flags the row and stamps who/when. Returns true when a live row was deleted.
async function softDeleteRow(table, id, userId, { client = null, actorId = userId } = {}) {
  const runner = client || getPool();
  const result = await runner.query(
    `UPDATE ${q(table)} SET ${q('isDeleted')} = true, updated_by = $3, updated_at = $4 WHERE id = $1 AND created_by = $2 AND COALESCE(${q('isDeleted')}, false) = false`,
    [String(id), String(userId), String(actorId), new Date().toISOString()]
  );
  return result.rowCount > 0;
}

// Columns the API never lets a request body set: ids, ownership, audit stamps and the
// soft-delete flag are always decided by the server.
const PROTECTED_COLUMNS = new Set(['id', 'created_by', 'created_at', 'updated_by', 'updated_at', 'isDeleted']);

class DbConflictError extends Error {}

// Writable fields of `data` that really are columns of `table` (others dropped with a
// one-time warning), coerced to the column types.
async function writableFields(table, data) {
  const columns = await columnsOf(table);
  const out = {};
  for (const [key, raw] of Object.entries(data || {})) {
    if (PROTECTED_COLUMNS.has(key)) continue;
    if (!columns.has(key)) {
      const marker = `${table}.${key}`;
      if (!WARNED_COLUMNS.has(marker)) {
        WARNED_COLUMNS.add(marker);
        console.warn(`[db] bỏ qua trường "${key}" — bảng ${table} chưa có cột này`);
      }
      continue;
    }
    const value = coerce(columns.get(key), raw);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

// INSERT one row. created_by/updated_by = the acting user, created_at/updated_at = now,
// passed explicitly. A duplicate id raises DbConflictError.
async function insertRow(table, { id, ownerId, actorId, data }, { client = null } = {}) {
  const fields = await writableFields(table, data);
  const nowIso = new Date().toISOString();
  const row = { id: String(id), ...fields, created_by: String(ownerId), updated_by: String(actorId), created_at: nowIso, updated_at: nowIso, isDeleted: false };
  const cols = Object.keys(row);
  try {
    const result = await (client || getPool()).query(
      `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      cols.map((c) => row[c])
    );
    return result.rows[0];
  } catch (error) {
    if (error.code === '23505') throw new DbConflictError(`${table}: id đã tồn tại`);
    throw error;
  }
}

// UPDATE the fields in `patch` of one live row owned by ownerId; stamps updated_by/updated_at.
// Returns the row, or null when there is no such row.
async function updateRow(table, id, { ownerId, actorId, patch }, { client = null } = {}) {
  const fields = await writableFields(table, patch);
  const row = { ...fields, updated_by: String(actorId), updated_at: new Date().toISOString() };
  const cols = Object.keys(row);
  const params = [String(id), String(ownerId), ...cols.map((c) => row[c])];
  const result = await (client || getPool()).query(
    `UPDATE ${q(table)} SET ${cols.map((c, i) => `${q(c)} = $${i + 3}`).join(', ')}
      WHERE id = $1 AND created_by = $2 AND COALESCE(${q('isDeleted')}, false) = false RETURNING *`,
    params
  );
  return result.rows[0] || null;
}

async function getOwnedRow(table, id, ownerId, { client = null } = {}) {
  const result = await (client || getPool()).query(
    `SELECT * FROM ${q(table)} WHERE id = $1 AND created_by = $2 AND COALESCE(${q('isDeleted')}, false) = false`,
    [String(id), String(ownerId)]
  );
  return result.rows[0] || null;
}

async function getRowById(table, id) {
  const rows = await query(`SELECT * FROM ${q(table)} WHERE id = $1 LIMIT 1`, [String(id)]);
  return rows[0] || null;
}

module.exports = {
  TABLES,
  isConfigured,
  getPool,
  query,
  withTransaction,
  closePool,
  columnsOf,
  forgetColumns,
  coerce,
  upsertRow,
  insertRow,
  updateRow,
  getOwnedRow,
  writableFields,
  DbConflictError,
  PROTECTED_COLUMNS,
  listOwnedRows,
  softDeleteRow,
  getRowById,
  q,
};
