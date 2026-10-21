// Applies schema.sql to DATABASE_URL. Safe to re-run (CREATE ... IF NOT EXISTS).
// Run with: npm run migrate
import { readFileSync } from "node:fs";
import { query } from "../src/db.js";

await query(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
console.log("Schema đã được áp dụng.");

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
