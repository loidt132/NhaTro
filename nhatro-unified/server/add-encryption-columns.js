/* Non-destructive schema update for field encryption: adds tenants.phone_idx
 * (HMAC blind index) and its index. Safe to re-run. Unlike migrate-to-neon.js
 * this never drops tables.
 *
 * Run: node add-encryption-columns.js   (needs DATABASE_URL in server/.env or the environment)
 * Then: node encrypt-existing-data.js   (fills phone_idx and re-encrypts old values)
 */
const fs = require('fs');
const path = require('path');

try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
} catch {
  // no .env file — rely on the real environment
}

const db = require('./db');

async function main() {
  if (!db.isConfigured()) throw new Error('Thiếu DATABASE_URL.');
  await db.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone_idx TEXT');
  await db.query('CREATE INDEX IF NOT EXISTS idx_tenants_phone_idx ON tenants (phone_idx)');
  console.log('OK: tenants.phone_idx + index đã sẵn sàng.');
}

main()
  .catch((error) => {
    console.error('Thất bại:', error.message || error);
    process.exitCode = 1;
  })
  .finally(() => db.closePool());
