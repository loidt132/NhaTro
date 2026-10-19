/* Creates the meter_submissions table (tenant meter-photo review queue).
 * Run: node migrate-meter-submissions.js ../web/.env.development
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

const text = (title) => ({ title, uidt: 'SingleLineText' });
const longText = (title) => ({ title, uidt: 'LongText' });
const decimal = (title) => ({ title, uidt: 'Decimal' });
const dateTime = (title) => ({ title, uidt: 'DateTime' });

const columns = [
  { title: 'id', uidt: 'SingleLineText' },
  text('roomId'),
  text('month'),
  text('meterType'),
  text('photoUrl'),
  longText('ocrRawText'),
  decimal('ocrValue'),
  decimal('finalValue'),
  text('status'),
  text('submittedByRole'),
  text('submittedByUserId'),
  text('submittedByName'),
  text('reviewedByUserId'),
  dateTime('reviewedAt'),
  dateTime('createdAt'),
  dateTime('updatedAt'),
  text('modified_by'),
  text('created_by'),
  { title: 'isDeleted', uidt: 'Checkbox' },
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

  let row = byTitle.get('meter_submissions');
  if (!row) {
    row = await request(metaUrl, { method: 'POST', body: JSON.stringify({ title: 'meter_submissions', table_name: 'meter_submissions', columns }) });
    console.log('Created meter_submissions');
  } else {
    console.log('Exists  meter_submissions');
  }

  console.log('\nAdd this to the server environment (backend only — the browser never calls this table directly):');
  console.log(`NOCODB_TABLE_METER_SUBMISSIONS=${row.id}`);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
