import pg from "pg";
import { encryptRow, decryptRow } from "./cryptoFields.js";

// PostgreSQL data layer (Neon / Supabase / any). Exposes the same small API
// the routes in index.js always used (listRows / findOneByBusinessId / ...),
// including the `(field,op,value)~and(...)` filter strings, so the route code
// did not have to change when storage moved off NocoDB.
//
// Table keys are the real table names (see schema.sql). Column names come
// from information_schema, so only real columns are ever interpolated into
// SQL — keys in request bodies that aren't columns are dropped, and every
// value is a bound parameter.

// BIGINT -> number, DATE -> "YYYY-MM-DD" string, TIMESTAMPTZ -> ISO string,
// so rows look like the JSON NocoDB used to return.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString());

let pool = null;
function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Postgres chưa cấu hình — cần DATABASE_URL trong .env");
  }
  pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 10000,
    statement_timeout: 10000,
  });
  return pool;
}

export async function query(text, params = []) {
  const { rows } = await getPool().query(text, params);
  return rows;
}

const q = (ident) => `"${ident.replace(/"/g, '""')}"`;

// Table keys used by the routes -> real table names, where they differ.
const TABLE_NAMES = { roomTypes: "room_types" };
export const tableName = (tableKey) => TABLE_NAMES[tableKey] || tableKey;

const columnCache = new Map();
async function columnsOf(tableKey) {
  if (columnCache.has(tableKey)) return columnCache.get(tableKey);
  const rows = await query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1`,
    [tableName(tableKey)]
  );
  if (!rows.length) throw new Error(`Không tìm thấy bảng "${tableKey}" — chạy npm run migrate.`);
  const map = new Map(rows.map((r) => [r.column_name, r.data_type]));
  columnCache.set(tableKey, map);
  return map;
}

const TEXT_TYPES = new Set(["text", "character varying", "character"]);

// Keeps only real columns; "" -> NULL for non-text columns (a blank date or
// number input must not blow up the INSERT).
function cleanData(columns, data) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (!columns.has(key) || value === undefined) continue;
    out[key] = value === "" && !TEXT_TYPES.has(columns.get(key)) ? null : value;
  }
  return out;
}

const OPS = { eq: "=", neq: "<>", gt: ">", gte: ">=", ge: ">=", lt: "<", lte: "<=", le: "<=" };

// Parses "(a,eq,1)~and(b,neq,x)" into a WHERE clause + params. Value is
// everything after the second comma, so values may contain commas.
function buildWhere(columns, where, params) {
  if (!where) return "";
  const parts = where.split("~and").map((clause) => {
    const m = clause.trim().match(/^\((\w+),(\w+),([\s\S]*)\)$/);
    if (!m) throw new Error(`Bộ lọc không hợp lệ: ${clause}`);
    const [, field, op, value] = m;
    if (!columns.has(field)) throw new Error(`Cột không tồn tại: ${field}`);
    if (!OPS[op]) throw new Error(`Toán tử không hỗ trợ: ${op}`);
    if (value === "null") return `${q(field)} IS ${op === "neq" ? "NOT " : ""}NULL`;
    params.push(value);
    return `${q(field)} ${OPS[op]} $${params.length}`;
  });
  return ` WHERE ${parts.join(" AND ")}`;
}

export async function listRows(tableKey, { where, limit = 1000 } = {}) {
  const columns = await columnsOf(tableKey);
  const params = [];
  const clause = buildWhere(columns, where, params);
  params.push(limit);
  const rows = await query(
    `SELECT * FROM ${q(tableName(tableKey))}${clause} ORDER BY created_at, id LIMIT $${params.length}`,
    params
  );
  return rows.map((row) => decryptRow(tableKey, row));
}

export async function findOneByBusinessId(tableKey, id) {
  const rows = await listRows(tableKey, { where: `(id,eq,${id})`, limit: 1 });
  return rows[0] || null;
}

export async function findOneWhere(tableKey, where) {
  const rows = await listRows(tableKey, { where, limit: 1 });
  return rows[0] || null;
}

async function insert(tableKey, data) {
  const columns = await columnsOf(tableKey);
  const clean = cleanData(columns, data);
  const keys = Object.keys(clean);
  const rows = await query(
    `INSERT INTO ${q(tableName(tableKey))} (${keys.map(q).join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
    keys.map((k) => clean[k])
  );
  return rows[0];
}

export async function createRow(tableKey, data) {
  const row = await insert(tableKey, encryptRow(tableKey, data));
  return decryptRow(tableKey, row);
}

// Used by the NocoDB import script: rows are copied as-is (already encrypted
// where applicable), without re-encrypting.
export const insertRaw = insert;

export async function updateRowByBusinessId(tableKey, id, patch) {
  const columns = await columnsOf(tableKey);
  const clean = cleanData(columns, encryptRow(tableKey, patch));
  delete clean.id;
  const keys = Object.keys(clean);
  if (!keys.length) return findOneByBusinessId(tableKey, id);
  const sets = keys.map((k, i) => `${q(k)} = $${i + 2}`);
  if (columns.has("updated_at")) sets.push("updated_at = now()");
  const rows = await query(
    `UPDATE ${q(tableName(tableKey))} SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
    [id, ...keys.map((k) => clean[k])]
  );
  return rows[0] ? decryptRow(tableKey, rows[0]) : null;
}

export async function deleteRowByBusinessId(tableKey, id) {
  const rows = await query(`DELETE FROM ${q(tableName(tableKey))} WHERE id = $1 RETURNING id`, [id]);
  return rows.length > 0;
}

export async function deleteRowById(tableKey, row) {
  return deleteRowByBusinessId(tableKey, row.id);
}
