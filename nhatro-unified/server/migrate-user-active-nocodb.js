/* Adds the Active checkbox to the existing NocoDB users table.
 * Run: node migrate-user-active-nocodb.js ../web/.env.development
 */
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(process.argv[2] || path.join(__dirname, '../web/.env.development'));
const env = Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\r?\n/).map((line) => line.match(/^([^#=]+)=(.*)$/)).filter(Boolean).map(([, key, value]) => [key.trim(), value.trim()]));
const baseUrl = String(env.VITE_NOCODB_URL || '').replace(/\/+$/, '');
const token = env.VITE_NOCODB_API_KEY;
const tableId = env.VITE_TABLE_USERS;
const baseId = env.VITE_NOCODB_PROJECT;
if (!baseUrl || !token || !tableId || !baseId) throw new Error('Thiếu cấu hình NocoDB users.');

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', 'xc-token': token, ...(options.headers || {}) } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.msg || data?.message || `NocoDB request failed (${response.status})`);
  return data;
}

(async () => {
  const table = await request(`${baseUrl}/api/v2/meta/bases/${encodeURIComponent(baseId)}/tables/${encodeURIComponent(tableId)}`);
  const exists = (table.columns || []).some((column) => ['isActive', 'is_active', 'active'].includes(String(column.title || '')));
  if (exists) return console.log('Exists isActive');
  await request(`${baseUrl}/api/v2/meta/tables/${encodeURIComponent(tableId)}/columns`, { method: 'POST', body: JSON.stringify({ title: 'isActive', uidt: 'Checkbox', cdf: '1' }) });
  console.log('Created isActive');
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
