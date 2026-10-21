// Applies schema.sql to DATABASE_URL. Safe to re-run (CREATE ... IF NOT EXISTS).
// Run with: npm run migrate
import { readFileSync } from "node:fs";
import { query } from "../src/db.js";

const sql = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
await query(sql);
console.log("Schema đã được áp dụng.");
process.exit(0);
