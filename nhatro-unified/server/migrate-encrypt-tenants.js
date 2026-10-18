/* One-off: encrypts cccd/phone for every existing row in the "tenants"
 * NocoDB table. stateStore.js already encrypts on write and decrypts on
 * read going forward (see cryptoFields.js) — this just re-saves every row
 * once so rows written before that change get encrypted too, instead of
 * waiting on their next organic update.
 *
 * Run: node migrate-encrypt-tenants.js [path/to/.env]  (defaults to ./.env)
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
const tableId = process.env.NOCODB_TABLE_TENANTS;
if (!baseUrl || !token || !tableId) throw new Error('Thiếu cấu hình NocoDB tenants.');

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'xc-token': token, ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.msg || data?.message || `NocoDB request failed (${response.status})`);
  return data;
}

async function fetchAllRows() {
  const rows = [];
  let page = 0;
  const pageSize = 1000;
  for (;;) {
    const data = await request(`${baseUrl}/api/v2/tables/${encodeURIComponent(tableId)}/records?limit=${pageSize}&offset=${page * pageSize}`);
    const list = data?.list || [];
    rows.push(...list);
    if (list.length < pageSize) break;
    page += 1;
  }
  return rows;
}

(async () => {
  const rows = await fetchAllRows();
  console.log(`Tìm thấy ${rows.length} tenant row(s).`);

  let updated = 0;
  for (const row of rows) {
    const plainCccd = decryptField(row.cccd || '');
    const plainPhone = decryptField(row.phone || '');
    const patch = {
      Id: row.Id,
      cccd: encryptField(plainCccd),
      phone: encryptField(plainPhone),
    };
    await request(`${baseUrl}/api/v2/tables/${encodeURIComponent(tableId)}/records`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    updated += 1;
  }

  console.log(`Đã mã hoá lại cccd/phone cho ${updated} tenant row(s).`);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
