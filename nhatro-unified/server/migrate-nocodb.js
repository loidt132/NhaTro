/* Creates the app tables required for deposits and advance-rent allocations.
 * Run: node migrate-nocodb.js ../web/.env.development
 */
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(process.argv[2] || path.join(__dirname, '../web/.env.development'));
const values = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) values[match[1].trim()] = match[2].trim().split(/\s+#/, 1)[0].trim();
}

const baseUrl = values.VITE_NOCODB_URL;
const baseId = values.VITE_NOCODB_PROJECT;
const token = values.VITE_NOCODB_API_KEY;
if (!baseUrl || !baseId || !token) throw new Error('Thiếu VITE_NOCODB_URL, VITE_NOCODB_PROJECT hoặc VITE_NOCODB_API_KEY.');

const fields = (items) => [
  { title: 'id', uidt: 'SingleLineText' },
  ...items,
  { title: 'createdAt', uidt: 'DateTime' },
  { title: 'updatedAt', uidt: 'DateTime' },
  { title: 'modified_by', uidt: 'SingleLineText' },
  { title: 'created_by', uidt: 'SingleLineText' },
  { title: 'isDeleted', uidt: 'Checkbox' },
];
const text = (title) => ({ title, uidt: 'SingleLineText' });
const amount = (title) => ({ title, uidt: 'Number' });

const tables = [
  { title: 'rental_contracts', env: 'VITE_TABLE_RENTAL_CONTRACTS', columns: fields([text('tenantId'), text('roomId'), { title: 'startDate', uidt: 'Date' }, { title: 'endDate', uidt: 'Date' }, amount('monthlyRent'), text('status')]) },
  { title: 'deposits', env: 'VITE_TABLE_DEPOSITS', columns: fields([text('contractId'), text('roomId'), text('tenantId'), amount('amount'), amount('remainingAmount'), text('status')]) },
  { title: 'deposit_transactions', env: 'VITE_TABLE_DEPOSIT_TRANSACTIONS', columns: fields([text('depositId'), amount('amount'), text('type'), { title: 'note', uidt: 'LongText' }, { title: 'occurredAt', uidt: 'DateTime' }]) },
  { title: 'deposit_refunds', env: 'VITE_TABLE_DEPOSIT_REFUNDS', columns: fields([text('depositId'), amount('amount'), text('method'), { title: 'note', uidt: 'LongText' }, { title: 'refundedAt', uidt: 'DateTime' }]) },
  { title: 'rent_periods', env: 'VITE_TABLE_RENT_PERIODS', columns: fields([text('roomId'), text('tenantId'), text('month'), amount('rent'), text('invoiceId')]) },
  { title: 'payment_allocations', env: 'VITE_TABLE_PAYMENT_ALLOCATIONS', columns: fields([text('paymentId'), text('rentPeriodId'), text('invoiceId'), amount('amount')]) },
];

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', 'xc-token': token, ...(options.headers || {}) } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.msg || data?.message || `NocoDB request failed (${response.status})`);
  return data;
}

(async () => {
  const metaUrl = `${baseUrl.replace(/\/+$/, '')}/api/v2/meta/bases/${encodeURIComponent(baseId)}/tables`;
  const existing = await request(`${metaUrl}?limit=1000`);
  const byTitle = new Map((existing.list || []).map((table) => [table.title, table]));
  const result = [];
  for (const table of tables) {
    let row = byTitle.get(table.title);
    if (!row) {
      row = await request(metaUrl, { method: 'POST', body: JSON.stringify({ title: table.title, table_name: table.title, columns: table.columns }) });
      console.log(`Created ${table.title}`);
    } else {
      console.log(`Exists  ${table.title}`);
    }
    result.push(`${table.env}=${row.id}`);
  }
  console.log('\nAdd these to web/.env.development and the server environment:');
  result.forEach((line) => console.log(line));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
