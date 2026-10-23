// PostgreSQL (Neon) data layer — replaces the NocoDB REST calls the server used
// to make. Table and column names come from neon-schema.sql; only columns that
// really exist are ever interpolated into SQL (request-body keys that are not
// columns are dropped with a warning) and every value is a bound parameter.
const { Pool, types } = require('pg');

// NUMERIC/BIGINT -> number, DATE -> "YYYY-MM-DD", TIMESTAMPTZ -> ISO string,
// so rows look like the JSON NocoDB used to return.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1184, (v) => new Date(v).toISOString());

// stateStore collection key -> real table name.
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
// over another user's record by reusing its id. `created_by` is never changed
// by an update. Pass `client` to run inside a transaction.
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

  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const hasUpdatedAt = columns.has('updated_at');
  const updatable = cols.filter((c) => c !== 'id' && c !== 'created_by');
  let conflict;
  if (onConflict === 'nothing') {
    conflict = 'ON CONFLICT (id) DO NOTHING';
  } else {
    const sets = updatable.map((c) => `${q(c)} = EXCLUDED.${q(c)}`);
    if (hasUpdatedAt && !cols.includes('updated_at')) sets.push('updated_at = now()');
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

async function softDeleteRow(table, id, userId, { client = null } = {}) {
  const runner = client || getPool();
  await runner.query(
    `UPDATE ${q(table)} SET ${q('isDeleted')} = true, modified_by = $3, updated_at = now() WHERE id = $1 AND created_by = $2`,
    [String(id), String(userId), String(userId)]
  );
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
  listOwnedRows,
  softDeleteRow,
  getRowById,
  q,
};
