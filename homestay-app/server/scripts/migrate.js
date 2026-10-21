// Applies schema.sql to DATABASE_URL. Safe to re-run (CREATE ... IF NOT EXISTS).
// Run with: npm run migrate
import { readFileSync } from "node:fs";
import { query } from "../src/db.js";

await query(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
console.log("Schema đã được áp dụng.");
process.exit(0);
