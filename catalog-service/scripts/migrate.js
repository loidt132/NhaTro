// Applies schema.sql to DATABASE_URL. Safe to re-run (CREATE ... IF NOT EXISTS).
// Run with: npm run migrate
import { readFileSync } from "node:fs";
import { query } from "../src/db.js";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

// Tables created from unquoted SQL (an old import, the Neon UI, ...) have
// lowercase columns ("homestayid"), so rows come back with undefined camelCase
// fields. Rename them to the names schema.sql uses, in place, keeping data;
// and convert legacy TIMESTAMP columns to TIMESTAMPTZ (values read as UTC).
const camelColumns = new Set(schema.match(/"[a-z]+[A-Z][A-Za-z]*"/g)?.map((s) => s.slice(1, -1)));
const cols = await query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema()`);
const existing = new Set(cols.map((c) => `${c.table_name}.${c.column_name}`));
const byLower = new Map([...camelColumns].map((name) => [name.toLowerCase(), name]));
for (const { table_name, column_name } of cols) {
  const proper = byLower.get(column_name);
  if (proper && proper !== column_name && !existing.has(`${table_name}.${proper}`)) {
    await query(`ALTER TABLE "${table_name}" RENAME COLUMN "${column_name}" TO "${proper}"`);
    console.log(`Đã đổi tên cột ${table_name}.${column_name} -> ${proper}`);
  }
}
for (const { table_name, column_name, data_type } of cols) {
  if (data_type !== "timestamp without time zone") continue;
  await query(`ALTER TABLE "${table_name}" ALTER COLUMN "${column_name}" TYPE TIMESTAMPTZ USING "${column_name}" AT TIME ZONE 'UTC'`);
  console.log(`Đã đổi kiểu ${table_name}.${column_name} -> TIMESTAMPTZ`);
}

// Soft delete: every table gets "isDeleted" before schema.sql runs (its partial unique
// indexes reference the column). The old plain unique indexes are dropped so schema.sql
// can recreate them as "WHERE isDeleted = false".
for (const table of [...schema.matchAll(/CREATE TABLE IF NOT EXISTS ("?\w+"?) \(/g)].map((m) => m[1])) {
  if ((await query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [table]))[0].ok) {
    await query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE`);
  }
}
await query(schema);
console.log("Schema đã được áp dụng.");

// CREATE TABLE IF NOT EXISTS leaves an existing table as it is, so give every
// table of schema.sql the four audit columns (created_by, updated_by, created_at,
// updated_at). Old rows keep NULL created_by/updated_by — nobody can say who made them.
const schemaTables = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS ("?\w+"?) \(/g)].map((m) => m[1]);
for (const table of schemaTables) {
  for (const [column, type] of [["created_by", "VARCHAR(64)"], ["updated_by", "VARCHAR(64)"], ["created_at", "TIMESTAMPTZ"], ["updated_at", "TIMESTAMPTZ"]]) {
    await query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`);
  }
}
console.log(`Đã kiểm tra 4 cột audit trên ${schemaTables.length} bảng.`);

// Old / imported tables carry the audit columns under other spellings: createdat,
// createdAt, createdby, updatedat, updatedAt, updatedby, modified_at, modified_by, ...
// Fold each into the canonical column (created_at, created_by, updated_at, updated_by —
// only where the canonical value is still NULL) and drop the extra column.
const AUDIT_ALIASES = {
  created_at: ["createdat", "createdAt", "CreatedAt"],
  created_by: ["createdby", "createdBy", "CreatedBy"],
  updated_at: ["updatedat", "updatedAt", "UpdatedAt", "modifiedat", "modifiedAt", "modified_at"],
  updated_by: ["updatedby", "updatedBy", "UpdatedBy", "modifiedby", "modifiedBy", "modified_by"],
};
const auditCols = await query(
  `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()`
);
const auditPresent = new Set(auditCols.map((c) => `${c.table_name}.${c.column_name}`));
for (const { table_name, column_name } of auditCols) {
  const canonical = Object.keys(AUDIT_ALIASES).find((key) => AUDIT_ALIASES[key].includes(column_name));
  if (!canonical || !auditPresent.has(`${table_name}.${canonical}`)) continue;
  try {
    await query(
      `UPDATE "${table_name}" SET "${canonical}" = "${column_name}" WHERE "${canonical}" IS NULL AND "${column_name}" IS NOT NULL`
    );
  } catch (err) {
    console.warn(`Không chép được ${table_name}.${column_name} -> ${canonical}: ${err.message}`);
  }
  await query(`ALTER TABLE "${table_name}" DROP COLUMN "${column_name}"`);
  console.log(`Đã xóa cột ${table_name}.${column_name} (gộp vào ${canonical})`);
}

// Drop duplicate columns that NocoDB / UI imports leave behind when a column of that
// name already existed: "created_by_1", "created_at_2", ... A column "X_<n>" is removed
// only when the plain column "X" exists in the same table and schema.sql does not define
// "X_<n>" itself. If X is NULL where X_<n> has a value of the same type, the value is
// copied into X first, so no data is lost.
const wanted = new Set([...schema.matchAll(/^\s+"?(\w+)"?\s+[A-Z]/gm)].map((m) => m[1]));
const allCols = await query(
  `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema()`
);
const colType = new Map(allCols.map((c) => [`${c.table_name}.${c.column_name}`, c.data_type]));
for (const { table_name, column_name } of allCols) {
  const m = column_name.match(/^(.+)_(\d+)$/);
  if (!m || wanted.has(column_name)) continue;
  const base = m[1];
  if (!colType.has(`${table_name}.${base}`)) continue;
  if (colType.get(`${table_name}.${base}`) === colType.get(`${table_name}.${column_name}`)) {
    await query(`UPDATE "${table_name}" SET "${base}" = "${column_name}" WHERE "${base}" IS NULL AND "${column_name}" IS NOT NULL`);
  }
  await query(`ALTER TABLE "${table_name}" DROP COLUMN "${column_name}"`);
  console.log(`Đã xóa cột trùng ${table_name}.${column_name} (giữ ${base})`);
}

// CREATE TABLE IF NOT EXISTS never touches a table that already existed, so one
// created without DEFAULT now() would keep writing NULL created_at/updated_at.
// Force the default on every such column and backfill the NULLs.
for (const { table_name, column_name } of await query(
  `SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND column_name IN ('created_at', 'updated_at')`
)) {
  await query(`ALTER TABLE "${table_name}" ALTER COLUMN "${column_name}" SET DEFAULT now()`);
  const filled = await query(
    `UPDATE "${table_name}" SET "${column_name}" = now() WHERE "${column_name}" IS NULL RETURNING 1`
  );
  if (filled.length) console.log(`Đã điền ${filled.length} giá trị NULL ở ${table_name}.${column_name}`);
}

// CREATE TABLE IF NOT EXISTS leaves a table that already existed untouched.
// If it was created some other way (Neon UI, an old import), "id" can be an
// auto-increment/integer column — the app writes string ids, so inserts fail
// with "cannot insert a non-DEFAULT value into column id".
const bad = await query(
  `SELECT table_name, data_type, is_identity
     FROM information_schema.columns
    WHERE table_schema = current_schema() AND column_name = 'id'
      AND (is_identity = 'YES' OR data_type NOT IN ('character varying', 'text'))`
);
if (bad.length) {
  console.error("\nCảnh báo: cột id sai kiểu ở các bảng sau (cần VARCHAR, không phải identity/số):");
  for (const r of bad) console.error(`  - ${r.table_name}: ${r.data_type}${r.is_identity === "YES" ? " (identity)" : ""}`);
  console.error(
    "Nếu bảng còn trống: DROP TABLE các bảng trên rồi chạy lại npm run migrate.\n" +
      "Nếu đã có dữ liệu: ALTER TABLE <bảng> ALTER COLUMN id DROP IDENTITY IF EXISTS; " +
      "ALTER TABLE <bảng> ALTER COLUMN id TYPE VARCHAR(64) USING id::text;"
  );
  process.exit(1);
}
process.exit(0);
