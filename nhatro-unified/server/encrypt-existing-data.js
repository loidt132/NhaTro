/* One-off: encrypts cccd/phone for rows that are still plaintext in Postgres
 * (tenants.cccd, tenants.phone, users.phone). stateStore.js / index.js already
 * encrypt on write and decrypt on read (see cryptoFields.js) — this just
 * re-saves old plaintext rows once instead of waiting for their next update.
 * Already-encrypted values are left alone, so it is safe to re-run.
 *
 * Run: node encrypt-existing-data.js   (needs DATABASE_URL and ENCRYPTION_KEY in server/.env or the environment)
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
const { encryptField, isEncryptionConfigured } = require('./cryptoFields');

const TARGETS = [
  ['tenants', ['cccd', 'phone']],
  ['users', ['phone']],
];

async function main() {
  if (!db.isConfigured()) throw new Error('Thiếu DATABASE_URL.');
  if (!isEncryptionConfigured()) throw new Error('ENCRYPTION_KEY chưa được cấu hình — dừng lại.');
  for (const [table, fields] of TARGETS) {
    const rows = await db.query(`SELECT id, ${fields.map(db.q).join(', ')} FROM ${db.q(table)}`);
    let changed = 0;
    for (const row of rows) {
      const updates = fields.filter((f) => row[f] && !String(row[f]).startsWith('enc:v1:'));
      if (updates.length === 0) continue;
      const sets = updates.map((f, i) => `${db.q(f)} = $${i + 1}`);
      const values = updates.map((f) => encryptField(row[f]));
      sets.push(`updated_by = $${values.length + 1}`, `updated_at = $${values.length + 2}`);
      values.push('script:encrypt-existing-data', new Date().toISOString(), row.id);
      await db.query(`UPDATE ${db.q(table)} SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
      changed += 1;
    }
    console.log(`${table}: mã hóa ${changed}/${rows.length} dòng`);
  }
}

main()
  .catch((error) => {
    console.error('Thất bại:', error.message || error);
    process.exitCode = 1;
  })
  .finally(() => db.closePool());
