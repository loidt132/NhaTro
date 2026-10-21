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

await query(schema);
console.log("Schema đã được áp dụng.");

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
