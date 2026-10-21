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

// ---- Naming: camelCase first, snake_case as fallback, otherwise an error ----
// The routes use camelCase table keys ("roomTypes") and field names
// ("homestayId"). The real table/column is the camelCase name if it exists,
// else the snake_case one ("room_types", "homestay_id"); if neither exists a
// clear error is thrown. Rows are always handed back with camelCase fields.

const toSnake = (name) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (name) => name.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
// Bookkeeping columns keep their snake_case names in every schema.
const KEEP_AS_IS = new Set(["created_at", "updated_at"]);

const tableCache = new Map();
export async function tableName(tableKey) {
  if (tableCache.has(tableKey)) return tableCache.get(tableKey);
  const candidates = [...new Set([tableKey, toSnake(tableKey)])];
  const rows = await query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($1)`,
    [candidates]
  );
  const found = candidates.find((name) => rows.some((r) => r.table_name === name));
  if (!found) {
    throw new Error(`Không tìm thấy bảng "${tableKey}" (đã thử: ${candidates.join(", ")}) — chạy npm run migrate.`);
  }
  tableCache.set(tableKey, found);
  return found;
}

const metaCache = new Map();
async function metaOf(tableKey) {
  if (metaCache.has(tableKey)) return metaCache.get(tableKey);
  const table = await tableName(tableKey);
  const rows = await query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1`,
    [table]
  );
  const types = new Map(rows.map((r) => [r.column_name, r.data_type]));
  const colToApp = new Map(rows.map((r) => [r.column_name, KEEP_AS_IS.has(r.column_name) ? r.column_name : toCamel(r.column_name)]));
  const meta = { table, types, colToApp };
  metaCache.set(tableKey, meta);
  return meta;
}

// App field name -> real column name (camelCase first, then snake_case), or null.
function columnFor(meta, field) {
  if (meta.types.has(field)) return field;
  const snake = toSnake(field);
  return meta.types.has(snake) ? snake : null;
}

function columnOrThrow(meta, tableKey, field) {
  const col = columnFor(meta, field);
  if (!col) {
    throw new Error(`Không tìm thấy cột "${field}" (hoặc "${toSnake(field)}") trong bảng "${meta.table}" — chạy npm run migrate.`);
  }
  return col;
}

const TEXT_TYPES = new Set(["text", "character varying", "character"]);
const warnedFields = new Set();

// Maps app fields to real columns; unknown fields (e.g. stray keys in a
// request body) are dropped with a one-time warning rather than failing the
// write. "" -> NULL for non-text columns (a blank date/number input must not
// blow up the INSERT).
function cleanData(meta, tableKey, data) {
  const out = {};
  for (const [field, value] of Object.entries(data || {})) {
    if (value === undefined) continue;
    const col = columnFor(meta, field);
    if (!col) {
      const id = `${tableKey}.${field}`;
      if (!warnedFields.has(id)) {
        warnedFields.add(id);
        console.warn(`[db] bỏ qua trường "${field}": bảng "${meta.table}" không có cột "${field}" hay "${toSnake(field)}"`);
      }
      continue;
    }
    out[col] = value === "" && !TEXT_TYPES.has(meta.types.get(col)) ? null : value;
  }
  return out;
}

// Real row -> app row (camelCase fields), then decrypt.
function toAppRow(tableKey, meta, row) {
  const out = {};
  for (const [col, value] of Object.entries(row)) out[meta.colToApp.get(col) ?? toCamel(col)] = value;
  return decryptRow(tableKey, out);
}

const OPS = { eq: "=", neq: "<>", gt: ">", gte: ">=", ge: ">=", lt: "<", lte: "<=", le: "<=" };

// Parses "(a,eq,1)~and(b,neq,x)" into a WHERE clause + params. Value is
// everything after the second comma, so values may contain commas.
function buildWhere(meta, tableKey, where, params) {
  if (!where) return "";
  const parts = where.split("~and").map((clause) => {
    const m = clause.trim().match(/^\((\w+),(\w+),([\s\S]*)\)$/);
    if (!m) throw new Error(`Bộ lọc không hợp lệ: ${clause}`);
    const [, field, op, value] = m;
    const col = columnOrThrow(meta, tableKey, field);
    if (!OPS[op]) throw new Error(`Toán tử không hỗ trợ: ${op}`);
    if (value === "null") return `${q(col)} IS ${op === "neq" ? "NOT " : ""}NULL`;
    params.push(value);
    return `${q(col)} ${OPS[op]} $${params.length}`;
  });
  return ` WHERE ${parts.join(" AND ")}`;
}

export async function listRows(tableKey, { where, limit = 1000 } = {}) {
  const meta = await metaOf(tableKey);
  const params = [];
  const clause = buildWhere(meta, tableKey, where, params);
  params.push(limit);
  const order = meta.types.has("created_at") ? "created_at, id" : "id";
  const rows = await query(
    `SELECT * FROM ${q(meta.table)}${clause} ORDER BY ${order} LIMIT $${params.length}`,
    params
  );
  return rows.map((row) => toAppRow(tableKey, meta, row));
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
  const meta = await metaOf(tableKey);
  const clean = cleanData(meta, tableKey, data);
  // Don't rely on the column DEFAULT: tables that pre-date schema.sql may have none.
  for (const col of KEEP_AS_IS) {
    if (meta.types.has(col) && clean[col] == null) clean[col] = new Date().toISOString();
  }
  const cols = Object.keys(clean);
  const rows = await query(
    `INSERT INTO ${q(meta.table)} (${cols.map(q).join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
    cols.map((c) => clean[c])
  );
  return toAppRow(tableKey, meta, rows[0]);
}

// Row as the app sees it (decrypted) — createRow encrypts first.
export async function createRow(tableKey, data) {
  return insert(tableKey, encryptRow(tableKey, data));
}

// Used by the NocoDB import script: rows are copied as-is (already encrypted
// where applicable), without re-encrypting.
export const insertRaw = insert;

export async function updateRowByBusinessId(tableKey, id, patch) {
  const meta = await metaOf(tableKey);
  const clean = cleanData(meta, tableKey, encryptRow(tableKey, patch));
  delete clean.id;
  const cols = Object.keys(clean);
  if (!cols.length) return findOneByBusinessId(tableKey, id);
  const sets = cols.map((c, i) => `${q(c)} = $${i + 2}`);
  if (meta.types.has("updated_at")) sets.push("updated_at = now()");
  const rows = await query(
    `UPDATE ${q(meta.table)} SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
    [id, ...cols.map((c) => clean[c])]
  );
  return rows[0] ? toAppRow(tableKey, meta, rows[0]) : null;
}

export async function deleteRowByBusinessId(tableKey, id) {
  const { table } = await metaOf(tableKey);
  const rows = await query(`DELETE FROM ${q(table)} WHERE id = $1 RETURNING id`, [id]);
  return rows.length > 0;
}

export async function deleteRowById(tableKey, row) {
  return deleteRowByBusinessId(tableKey, row.id);
}
