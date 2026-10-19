/* One-off: encrypts phone for every existing row in the "users" NocoDB
 * table. index.js already encrypts on write (createNocoUserRecord) and
 * decrypts on read (mapNocoUser) going forward — this just re-saves every
 * row once so accounts created before that change get encrypted too.
 *
 * Run: node migrate-encrypt-users-phone.js [path/to/.env]  (defaults to ./.env)
 */
const fs = require('fs');
const path = require('path');
const { encryptField, decryptField, isEncryptionConfigured } = require('./cryptoFields');

const envPath = path.resolve(process.argv[2] || path.join(__dirname, '.env'));
fs.readFileSync(envPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.match(/^([^#=]+)=(.*)$/))
  .filter(Boolean)
  .forEach(([, key, value]) => {
    if (process.env[key.trim()] == null) process.env[key.trim()] = value.trim();
  });

if (!isEncryptionConfigured()) {
  console.error('ENCRYPTION_KEY chưa được cấu hình — dừng lại.');
  process.exit(1);
}

const baseUrl = String(process.env.NOCODB_URL || '').replace(/\/+$/, '');
const token = process.env.NOCODB_API_KEY;
const tableId = process.env.NOCODB_TABLE_USERS;
if (!baseUrl || !token || !tableId) throw new Error('Thiếu cấu hình NocoDB users.');

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'xc-token': token, ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.msg || data?.message || `NocoDB request failed (${response.status})`);
  return data;
}

(async () => {
  const data = await request(`${baseUrl}/api/v2/tables/${encodeURIComponent(tableId)}/records?limit=1000`);
  const rows = data?.list || [];
  console.log(`Tìm thấy ${rows.length} user row(s).`);

  let updated = 0;
  for (const row of rows) {
    if (!row.phone) continue; // nothing to encrypt
    const plainPhone = decryptField(row.phone);
    await request(`${baseUrl}/api/v2/tables/${encodeURIComponent(tableId)}/records`, {
      method: 'PATCH',
      body: JSON.stringify({ Id: row.Id, phone: encryptField(plainPhone) }),
    });
    updated += 1;
  }

  console.log(`Đã mã hoá lại phone cho ${updated} user row(s).`);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
