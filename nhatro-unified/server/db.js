// PostgreSQL (Neon) data layer. Table keys used by the app map to real table
// names below; rows are handed back with the same camelCase fields the
// NocoDB-based code used to see. Column names come from information_schema,
// so only real columns are ever interpolated into SQL — unknown keys in a
// payload are dropped and every value is a bound parameter.
const { Pool, types } = require('pg');

// BIGINT / NUMERIC -> number, DATE -> "YYYY-MM-DD", TIMESTAMPTZ -> ISO string.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1184, (v) => new Date(v).toISOString());

const TABLES = {
  users: 'users',
  rooms: 'rooms',
  tenants: 'tenants',
  readings: 'readings',
  invoices: 'invoices',
  payments: 'payments',
  rentPeriods: 'rent_periods',
  paymentAllocations: 'payment_allocations',
  rentalContracts: 'rental_contracts',
  deposits: 'deposits',
  depositTransactions: 'deposit_transactions',
  depositRefunds: 'deposit_refunds',
  settings: 'settings',
  meterSubmissions: 'meter_submissions',
};

let pool = null;
function isConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (pool) return pool;
  if (!isConfigured()) throw new Error('Postgres chưa cấu hình — cần DATABASE_URL trên server.');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3, // serverless: keep per-instance connections low (use Neon's pooled URL)
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 10000,
    statement_timeout: 20000,
  });
  return pool;
}

async function query(text, params = [], client = null) {
  const { rows } = await (client || getPool()).query(text, params);
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

const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;
const TEXT_TYPES = new Set(['text', 'character varying', 'character']);
const BOOKKEEPING = new Set(['created_at', 'updated_at']);
const metaCache = new Map();

async function metaOf(key) {
  if (metaCache.has(key)) return metaCache.get(key);
  const table = TABLES[key];
  if (!table) throw new Error(`Bảng không xác định: ${key}`);
  const rows = await query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1`,
    [table]
  );
  if (!rows.length) throw new Error(`Không tìm thấy bảng "${table}" — chạy npm run migrate.`);
  const meta = { table, types: new Map(rows.map((r) => [r.column_name, r.data_type])) };
  metaCache.set(key, meta);
  return meta;
}

const warned = new Set();
// Keeps only real columns; "" -> NULL for non-text columns (a blank date or
// number input must not fail the INSERT).
function cleanData(meta, key, data) {
  const out = {};
  for (const [field, value] of Object.entries(data || {})) {
    if (value === undefined || BOOKKEEPING.has(field)) continue;
    if (!meta.types.has(field)) {
      const id = `${key}.${field}`;
      if (!warned.has(id)) {
        warned.add(id);
        console.warn(`[db] bỏ qua trường "${field}": bảng "${meta.table}" không có cột này`);
      }
      continue;
    }
    out[field] = value === '' && !TEXT_TYPES.has(meta.types.get(field)) ? null : value;
  }
  return out;
}

// where: object of column -> value (all ANDed). `null` means IS NULL.
function buildWhere(meta, where, params) {
  const parts = [];
  for (const [col, value] of Object.entries(where || {})) {
    if (!meta.types.has(col)) throw new Error(`Cột "${col}" không tồn tại trong bảng "${meta.table}"`);
    if (value === null) {
      parts.push(`${q(col)} IS NULL`);
    } else if (Array.isArray(value)) {
      params.push(value);
      parts.push(`${q(col)} = ANY($${params.length})`);
    } else {
      params.push(value);
      parts.push(`${q(col)} = $${params.length}`);
    }
  }
  return parts.length ? ` WHERE ${parts.join(' AND ')}` : '';
}

// Rows of one table. activeOnly hides soft-deleted rows ("isDeleted" true).
async function listRows(key, { where, activeOnly = false, limit = 100000 } = {}, client = null) {
  const meta = await metaOf(key);
  const params = [];
  let clause = buildWhere(meta, where, params);
  if (activeOnly && meta.types.has('isDeleted')) {
    clause += `${clause ? ' AND' : ' WHERE'} "isDeleted" IS NOT TRUE`;
  }
  params.push(limit);
  return query(`SELECT * FROM ${q(meta.table)}${clause} ORDER BY created_at, id LIMIT $${params.length}`, params, client);
}

async function findOne(key, where, opts = {}) {
  const rows = await listRows(key, { where, ...opts, limit: 1 });
  return rows[0] || null;
}

async function countRows(key, { where, activeOnly = false } = {}) {
  const meta = await metaOf(key);
  const params = [];
  let clause = buildWhere(meta, where, params);
  if (activeOnly && meta.types.has('isDeleted')) {
    clause += `${clause ? ' AND' : ' WHERE'} "isDeleted" IS NOT TRUE`;
  }
  const rows = await query(`SELECT count(*)::int AS n FROM ${q(meta.table)}${clause}`, params);
  return rows[0].n;
}

// INSERT ... ON CONFLICT (id) DO UPDATE. An existing row owned by someone
// else (different created_by) is never overwritten.
async function upsertRow(key, data, client = null) {
  const meta = await metaOf(key);
  const clean = cleanData(meta, key, data);
  if (!clean.id) throw new Error(`Thiếu id khi ghi bảng "${meta.table}"`);
  const cols = Object.keys(clean);
  const updates = cols.filter((c) => c !== 'id' && c !== 'created_by').map((c) => `${q(c)} = EXCLUDED.${q(c)}`);
  updates.push('updated_at = now()');
  const owned = meta.types.has('created_by') ? ` WHERE ${q(meta.table)}.created_by = EXCLUDED.created_by` : '';
  await query(
    `INSERT INTO ${q(meta.table)} (${cols.map(q).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
     ON CONFLICT (id) DO UPDATE SET ${updates.join(', ')}${owned}`,
    cols.map((c) => clean[c]),
    client
  );
}

async function insertRow(key, data) {
  const meta = await metaOf(key);
  const clean = cleanData(meta, key, data);
  const cols = Object.keys(clean);
  const rows = await query(
    `INSERT INTO ${q(meta.table)} (${cols.map(q).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    cols.map((c) => clean[c])
  );
  return rows[0];
}

async function updateRows(key, where, patch) {
  const meta = await metaOf(key);
  const clean = cleanData(meta, key, patch);
  delete clean.id;
  const cols = Object.keys(clean);
  if (!cols.length) return 0;
  const params = cols.map((c) => clean[c]);
  const sets = cols.map((c, i) => `${q(c)} = $${i + 1}`);
  sets.push('updated_at = now()');
  const clause = buildWhere(meta, where, params);
  const rows = await query(`UPDATE ${q(meta.table)} SET ${sets.join(', ')}${clause} RETURNING id`, params);
  return rows.length;
}

async function softDeleteRows(key, where, client = null) {
  const meta = await metaOf(key);
  const params = [];
  const clause = buildWhere(meta, where, params);
  await query(`UPDATE ${q(meta.table)} SET "isDeleted" = TRUE, updated_at = now()${clause}`, params, client);
}

async function ping() {
  await query('SELECT 1');
}

module.exports = {
  TABLES, isConfigured, query, withTransaction, listRows, findOne, countRows,
  upsertRow, insertRow, updateRows, softDeleteRows, ping,
};
