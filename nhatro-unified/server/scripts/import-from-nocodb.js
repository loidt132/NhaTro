// One-off: copies every row from the old NocoDB base into Postgres (Neon).
// Rows are copied as-is — tenants' / users' encrypted cccd/phone stay
// encrypted, so keep ENCRYPTION_KEY the same. Needs the OLD settings plus the
// new DATABASE_URL, in server/.env:
//   NOCODB_URL, NOCODB_API_KEY, NOCODB_PROJECT   (base id; or NOCODB_TABLE_<NAME> table ids)
//   DATABASE_URL
// Run `npm run migrate` first, then: npm run import-from-nocodb
// Re-runnable: rows whose id already exists in Postgres are skipped.
// Options: --add-missing  add NocoDB columns Postgres lacks (as TEXT) instead of skipping them
const db = require('../db');

const BASE = (process.env.NOCODB_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.NOCODB_API_KEY || '';
const PROJECT = process.env.NOCODB_PROJECT || '';
const ADD_MISSING = process.argv.includes('--add-missing');

// Parents before children. [postgres table, NocoDB env var for its table id]
const TABLES = [
  ['users', 'NOCODB_TABLE_USERS'],
  ['rooms', 'NOCODB_TABLE_ROOMS'],
  ['tenants', 'NOCODB_TABLE_TENANTS'],
  ['rental_contracts', 'NOCODB_TABLE_RENTAL_CONTRACTS'],
  ['deposits', 'NOCODB_TABLE_DEPOSITS'],
  ['deposit_transactions', 'NOCODB_TABLE_DEPOSIT_TRANSACTIONS'],
  ['deposit_refunds', 'NOCODB_TABLE_DEPOSIT_REFUNDS'],
  ['readings', 'NOCODB_TABLE_READINGS'],
  ['meter_submissions', 'NOCODB_TABLE_METER_SUBMISSIONS'],
  ['invoices', 'NOCODB_TABLE_INVOICES'],
  ['payments', 'NOCODB_TABLE_PAYMENTS'],
  ['rent_periods', 'NOCODB_TABLE_RENT_PERIODS'],
  ['payment_allocations', 'NOCODB_TABLE_PAYMENT_ALLOCATIONS'],
  ['settings', 'NOCODB_TABLE_SETTINGS'],
];

const SYSTEM_KEYS = new Set(['Id', 'ID', 'CreatedAt', 'UpdatedAt', 'ncRecordId', 'createdBy', 'updatedBy']);
const norm = (name) => String(name).toLowerCase().replace(/_/g, '');
const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;

async function api(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'xc-token': TOKEN } });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

let discovered = null;
async function tableId(pgTable, envVar) {
  if (process.env[envVar]) return process.env[envVar];
  if (!discovered) {
    if (!PROJECT) {
      console.log(`  ! ${pgTable}: thiếu ${envVar} (hoặc NOCODB_PROJECT) nên không tìm được bảng`);
      return null;
    }
    const body = await api(`/api/v2/meta/bases/${PROJECT}/tables`);
    discovered = new Map((body.list || []).map((t) => [norm(t.title), t.id]));
  }
  return discovered.get(norm(pgTable)) || null;
}

async function fetchAll(id) {
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const body = await api(`/api/v2/tables/${id}/records?limit=100&offset=${offset}`);
    const list = body.list || [];
    rows.push(...list);
    if (body.pageInfo?.isLastPage ?? list.length < 100) break;
  }
  return rows;
}

async function pgColumns(table) {
  const rows = await db.query(
    "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1",
    [table]
  );
  return new Map(rows.map((r) => [r.column_name, r]));
}

function targetColumn(cols, key) {
  if (cols.has(key)) return key;
  if (key === 'created_at' || key === 'updated_at') return null;
  const want = norm(key);
  for (const name of cols.keys()) {
    if (name !== 'created_at' && name !== 'updated_at' && norm(name) === want) return name;
  }
  return null;
}

function coerce(col, value) {
  if (value === undefined || value === null) return null;
  if (col.data_type === 'boolean') {
    if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.trim().toLowerCase());
    return value === true || value === 1;
  }
  if (value === '' && !['text', 'character varying', 'character'].includes(col.data_type)) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

async function importTable(pgTable, envVar) {
  const id = await tableId(pgTable, envVar);
  if (!id) {
    console.log(`- ${pgTable}: không thấy bảng trong NocoDB, bỏ qua`);
    return { table: pgTable, nocodb: null, pg: null };
  }
  const source = await fetchAll(id);
  const cols = await pgColumns(pgTable);

  // Columns NocoDB has that Postgres lacks.
  const seen = new Set(source.flatMap((r) => Object.keys(r)));
  const unmapped = [...seen].filter((k) => !SYSTEM_KEYS.has(k) && !targetColumn(cols, k) && source.some((r) => r[k] != null && r[k] !== ''));
  const ignorable = pgTable === 'users' ? new Set(['created_by', 'modified_by', 'createdat', 'isdeleted', 'title']) : new Set(['title']);
  const missing = unmapped.filter((k) => !ignorable.has(norm(k)) && !(pgTable === 'users' && ['created_by', 'modified_by'].includes(k)));
  if (missing.length) {
    if (ADD_MISSING) {
      for (const k of missing) {
        await db.query(`ALTER TABLE ${q(pgTable)} ADD COLUMN IF NOT EXISTS ${q(k)} TEXT`);
        console.log(`  + ${pgTable}: thêm cột TEXT "${k}"`);
      }
      const refreshed = await pgColumns(pgTable);
      refreshed.forEach((v, k) => cols.set(k, v));
    } else {
      console.log(`  ! ${pgTable}: bỏ qua cột chỉ có trong NocoDB: ${missing.join(', ')} (chạy lại với --add-missing để giữ)`);
    }
  }

  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of source) {
    const values = {};
    for (const [key, raw] of Object.entries(row)) {
      if (SYSTEM_KEYS.has(key)) continue;
      const col = targetColumn(cols, key);
      if (!col) continue;
      const v = coerce(cols.get(col), raw);
      if (v !== null) values[col] = v;
    }
    // users: legacy variants of the signup timestamp.
    if (pgTable === 'users' && values.created_at == null) {
      const legacy = row.createdAt ?? row.createdat;
      if (legacy) values.created_at = legacy;
    }
    if (pgTable === 'users' && !values.name) values.name = values.email || 'User';
    if (pgTable === 'users' && values.email === '') delete values.email;
    if (cols.has('modified_by') && !values.modified_by && values.created_by) values.modified_by = values.created_by;

    if (!values.id || (cols.has('created_by') && !values.created_by)) {
      failed += 1;
      console.log(`  ! ${pgTable}: bỏ qua dòng thiếu id/created_by: ${JSON.stringify(row).slice(0, 160)}`);
      continue;
    }
    const names = Object.keys(values);
    try {
      const res = await db.query(
        `INSERT INTO ${q(pgTable)} (${names.map(q).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (id) DO NOTHING RETURNING id`,
        names.map((n) => values[n])
      );
      if (res.length) inserted += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      console.log(`  ! ${pgTable} id=${values.id}: ${error.message}`);
    }
  }
  const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM ${q(pgTable)}`);
  console.log(`- ${pgTable}: NocoDB ${source.length} dòng -> thêm ${inserted}, đã có ${skipped}, lỗi ${failed} (Postgres hiện ${n})`);
  return { table: pgTable, nocodb: source.length, pg: n, failed };
}

async function main() {
  if (!BASE || !TOKEN) throw new Error('Thiếu NOCODB_URL / NOCODB_API_KEY');
  if (!db.isConfigured()) throw new Error('Thiếu DATABASE_URL');
  const results = [];
  for (const [table, envVar] of TABLES) results.push(await importTable(table, envVar));
  const bad = results.filter((r) => r.nocodb != null && (r.failed > 0 || r.pg < r.nocodb));
  console.log(bad.length ? `\nCó ${bad.length} bảng chưa khớp số dòng: ${bad.map((r) => r.table).join(', ')}` : '\nSố dòng khớp ở mọi bảng.');
  process.exit(bad.length ? 1 : 0);
}

main().catch((error) => {
  console.error('Import thất bại:', error.message);
  process.exit(1);
});
