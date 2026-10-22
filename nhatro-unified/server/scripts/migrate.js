// Applies schema.sql to DATABASE_URL (Neon). Safe to re-run (IF NOT EXISTS).
// Run with: npm run migrate
const { readFileSync } = require('node:fs');
const path = require('node:path');
const db = require('../db');

async function main() {
  const schema = readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await db.query(schema);
  const rows = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($1) ORDER BY 1",
    [Object.values(db.TABLES)]
  );
  console.log(`Schema đã được áp dụng. ${rows.length}/${Object.keys(db.TABLES).length} bảng: ${rows.map((r) => r.table_name).join(', ')}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Migrate thất bại:', error.message);
    process.exit(1);
  });
