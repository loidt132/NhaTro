/* One-off / maintenance: brings every protected column to the current
 * encryption format and key, and fills the phone search index.
 *   - plaintext values            -> enc:v2 (current key)
 *   - enc:v1 values (no key id)   -> enc:v2
 *   - enc:v2 under an older key   -> enc:v2 under ENCRYPTION_KEY (key rotation)
 *   - tenants.phone_idx           -> recomputed (HMAC blind index)
 * Columns come from cryptoFields.js (ENCRYPTED_FIELDS): tenants.cccd/phone,
 * users.phone, settings.accountNo/landlordPhone/landlordAddress.
 * Safe to re-run: values already on the current key are left alone.
 *
 * Key rotation: set ENCRYPTION_KEY=<new key>, ENCRYPTION_KEY_PREVIOUS=<old key>,
 * run this script, then remove ENCRYPTION_KEY_PREVIOUS once it reports 0 changes.
 *
 * Run: node add-encryption-columns.js   (once, adds tenants.phone_idx)
 *      node encrypt-existing-data.js [--dry-run]
 * Needs DATABASE_URL and ENCRYPTION_KEY in server/.env or the environment.
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
const {
  ENCRYPTED_FIELDS,
  BLIND_INDEXES,
  isEncryptionConfigured,
  encryptField,
  decryptField,
  needsReencrypt,
  contextFor,
  blindIndex,
} = require('./cryptoFields');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  if (!db.isConfigured()) throw new Error('Thiếu DATABASE_URL.');
  if (!isEncryptionConfigured()) throw new Error('ENCRYPTION_KEY chưa được cấu hình — dừng lại.');

  for (const key of Object.keys(ENCRYPTED_FIELDS)) {
    const table = db.TABLES[key];
    const columns = await db.columnsOf(table);
    const fields = ENCRYPTED_FIELDS[key].filter((f) => columns.has(f));
    const allIndexes = Object.entries(BLIND_INDEXES[key] || {});
    const indexes = allIndexes.filter(([, col]) => columns.has(col));
    if (indexes.length < allIndexes.length) {
      console.warn(`${table}: thiếu cột chỉ mục — chạy node add-encryption-columns.js trước.`);
    }
    const selected = ['id', ...fields, ...indexes.map(([, col]) => col)];
    const rows = await db.query(`SELECT ${selected.map(db.q).join(', ')} FROM ${db.q(table)}`);
    let changed = 0;
    for (const row of rows) {
      const updates = {};
      for (const field of fields) {
        const stored = row[field];
        if (!stored) continue;
        const ctx = contextFor(key, field, row);
        const plain = decryptField(stored, ctx);
        if (needsReencrypt(stored)) updates[field] = encryptField(plain, ctx);
        const indexEntry = indexes.find(([f]) => f === field);
        if (indexEntry) {
          const wanted = blindIndex(plain);
          if (row[indexEntry[1]] !== wanted) updates[indexEntry[1]] = wanted;
        }
      }
      const cols = Object.keys(updates);
      if (cols.length === 0) continue;
      changed += 1;
      if (DRY_RUN) continue;
      const sets = cols.map((c, i) => `${db.q(c)} = $${i + 1}`);
      const values = cols.map((c) => updates[c]);
      sets.push(`updated_by = $${values.length + 1}`, `updated_at = $${values.length + 2}`);
      values.push('script:encrypt-existing-data', new Date().toISOString(), row.id);
      await db.query(`UPDATE ${db.q(table)} SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    }
    console.log(`${table}: ${DRY_RUN ? 'sẽ cập nhật' : 'đã cập nhật'} ${changed}/${rows.length} dòng`);
  }
}

main()
  .catch((error) => {
    console.error('Thất bại:', error.message || error);
    process.exitCode = 1;
  })
  .finally(() => db.closePool());
