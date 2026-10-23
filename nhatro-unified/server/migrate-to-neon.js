/* One-off: moves the nhatro-unified data from NocoDB to PostgreSQL (Neon).
 *
 *   1. creates the tables from neon-schema.sql (idempotent)
 *   2. copies every row of every NocoDB table as-is — encrypted CCCD / phone
 *      values stay encrypted, so keep ENCRYPTION_KEY the same
 *   3. compares the row counts of both sides
 *
 * Needs (server/.env or the environment):
 *   DATABASE_URL                               Neon connection string
 *   NOCODB_URL, NOCODB_API_KEY                 the old NocoDB
 *   NOCODB_TABLE_USERS, NOCODB_TABLE_ROOMS ... the same table ids the server used
 *
 * Run:  npm run migrate-to-neon                (schema + copy + verify)
 *       npm run migrate-to-neon -- --schema-only
 *       npm run migrate-to-neon -- --dry-run   (read NocoDB, write nothing, report)
 * Rows whose id already exists in Postgres are skipped, so it is safe to re-run.
 * Nothing is ever deleted from NocoDB.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadEnvFile(filePath) {
  try {
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // no .env file — rely on the real environment
  }
}
loadEnvFile(path.join(__dirname, '.env'));

const db = require('./db');

const args = new Set(process.argv.slice(2));
const SCHEMA_ONLY = args.has('--schema-only');
const DRY_RUN = args.has('--dry-run');

const firstEnv = (...names) => {
  for (const name of names) {
    const value = process.env[name];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
};

const NOCODB_URL = firstEnv('NOCODB_URL', 'VITE_NOCODB_URL').replace(/\/+$/, '');
const NOCODB_API_KEY = firstEnv('NOCODB_API_KEY', 'VITE_NOCODB_API_KEY');

// Postgres table -> env var holding its NocoDB table id. Parents first.
const TABLES = [
  ['users', 'NOCODB_TABLE_USERS', 'VITE_TABLE_USERS'],
  ['rooms', 'NOCODB_TABLE_ROOMS', 'VITE_TABLE_ROOMS'],
  ['tenants', 'NOCODB_TABLE_TENANTS', 'VITE_TABLE_TENANTS'],
  ['rental_contracts', 'NOCODB_TABLE_RENTAL_CONTRACTS', 'VITE_TABLE_RENTAL_CONTRACTS'],
  ['readings', 'NOCODB_TABLE_READINGS', 'VITE_TABLE_READINGS'],
  ['invoices', 'NOCODB_TABLE_INVOICES', 'VITE_TABLE_INVOICES'],
  ['payments', 'NOCODB_TABLE_PAYMENTS', 'VITE_TABLE_PAYMENTS'],
  ['rent_periods', 'NOCODB_TABLE_RENT_PERIODS', 'VITE_TABLE_RENT_PERIODS'],
  ['payment_allocations', 'NOCODB_TABLE_PAYMENT_ALLOCATIONS', 'VITE_TABLE_PAYMENT_ALLOCATIONS'],
  ['deposits', 'NOCODB_TABLE_DEPOSITS', 'VITE_TABLE_DEPOSITS'],
  ['deposit_transactions', 'NOCODB_TABLE_DEPOSIT_TRANSACTIONS', 'VITE_TABLE_DEPOSIT_TRANSACTIONS'],
  ['deposit_refunds', 'NOCODB_TABLE_DEPOSIT_REFUNDS', 'VITE_TABLE_DEPOSIT_REFUNDS'],
  ['settings', 'NOCODB_TABLE_SETTINGS', 'VITE_TABLE_SETTINGS'],
  ['meter_submissions', 'NOCODB_TABLE_METER_SUBMISSIONS', 'VITE_TABLE_METER_SUBMISSIONS'],
];

// NocoDB's own bookkeeping columns, never copied as data.
const NOCO_SYSTEM = new Set(['Id', 'ID', 'CreatedAt', 'UpdatedAt', 'ncRecordId', 'ncRecordHash', 'createdBy', 'updatedBy']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function noco(pathname) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch(`${NOCODB_URL}${pathname}`, { headers: { 'xc-token': NOCODB_API_KEY } });
    if (res.status === 429 && attempt < 4) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`NocoDB ${pathname} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
  throw new Error(`NocoDB ${pathname}: hết lượt thử`);
}

async function fetchAllRows(tableId) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await noco(`/api/v2/tables/${encodeURIComponent(tableId)}/records?limit=1000&offset=${offset}`);
    const list = page?.list || [];
    rows.push(...list);
    if (page?.pageInfo?.isLastPage !== false || list.length === 0) break;
  }
  return rows;
}

const PG_TYPE_BY_UIDT = {
  Number: 'NUMERIC', Decimal: 'NUMERIC', Currency: 'NUMERIC', Percent: 'NUMERIC', Rating: 'NUMERIC',
  Checkbox: 'BOOLEAN', DateTime: 'TIMESTAMPTZ', Date: 'DATE',
};

// Add Postgres columns for NocoDB columns the schema does not know about, so
// nothing the old tables stored is lost. Returns Map(lowercase name -> real name).
async function reconcileColumns(table, tableId, { allowAdd }) {
  let columns = await db.columnsOf(table);
  const byLower = () => new Map([...columns.keys()].map((name) => [name.toLowerCase(), name]));
  if (!allowAdd) return byLower();
  const meta = await noco(`/api/v2/meta/tables/${encodeURIComponent(tableId)}`);
  for (const column of meta?.columns || []) {
    const title = column.column_name || column.title;
    if (!title || NOCO_SYSTEM.has(title) || NOCO_SYSTEM.has(column.title) || column.pk || byLower().has(title.toLowerCase())) continue;
    const type = PG_TYPE_BY_UIDT[column.uidt] || 'TEXT';
    console.log(`  + cột mới ${table}."${title}" ${type}`);
    if (!DRY_RUN) {
      await db.query(`ALTER TABLE ${db.q(table)} ADD COLUMN IF NOT EXISTS ${db.q(title)} ${type}`);
      db.forgetColumns(table);
    }
  }
  columns = DRY_RUN ? columns : await db.columnsOf(table);
  return byLower();
}

function pick(row, ...names) {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), String(salt), 100000, 64, 'sha512').toString('hex');
}

// NocoDB users tables came in several column-name flavours (see
// createNocoUserRecord in the old server code) — normalise to the schema.
function mapUser(row) {
  const out = {
    id: row.id,
    name: pick(row, 'name'),
    email: pick(row, 'email') ?? '',
    phone: pick(row, 'phone'),
    role: pick(row, 'role') || 'user',
    isActive: row.isActive === false || row.isActive === 0 || String(row.isActive).toLowerCase() === 'false' ? false : true,
    maxRoomLimit: pick(row, 'maxRoomLimit', 'max_room_limit', 'maxroomlimit') ?? null,
    landlordId: pick(row, 'landlordId', 'landlord_id'),
    linkedTenantId: pick(row, 'linkedTenantId', 'linked_tenant_id'),
    linkedRoomId: pick(row, 'linkedRoomId', 'linked_room_id'),
    created_at: pick(row, 'created_at', 'createdAt', 'createdat', 'CreatedAt'),
  };
  let hash = pick(row, 'password_hash', 'passwordHash', 'passwordhash');
  let salt = pick(row, 'password_salt', 'passwordSalt', 'passwordsalt');
  if (!hash || !salt) {
    const legacy = pick(row, 'password', 'pass');
    if (legacy) {
      // The old server also accepted a plaintext password column; store a hash instead.
      salt = crypto.randomBytes(16).toString('hex');
      hash = hashPassword(legacy, salt);
    }
  }
  out.password_hash = hash;
  out.password_salt = salt;
  return out;
}

function mapGeneric(row, columnByLower) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (NOCO_SYSTEM.has(key)) continue;
    const column = columnByLower.get(key.toLowerCase());
    if (!column) continue;
    out[column] = value;
  }
  if (out.created_at === undefined && row.CreatedAt) out.created_at = row.CreatedAt;
  if (out.updated_at === undefined && row.UpdatedAt) out.updated_at = row.UpdatedAt;
  if (out.isDeleted === undefined || out.isDeleted === null) out.isDeleted = false;
  return out;
}

async function applySchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'neon-schema.sql'), 'utf8');
  await db.query(sql);
  db.forgetColumns('users');
  console.log('✔ Đã tạo / kiểm tra bảng từ neon-schema.sql');
}

async function main() {
  if (!db.isConfigured()) throw new Error('Thiếu DATABASE_URL (chuỗi kết nối Neon).');
  if (!DRY_RUN) await applySchema();
  else console.log('(dry-run) không ghi gì vào Postgres');
  if (SCHEMA_ONLY) return;

  if (!NOCODB_URL || !NOCODB_API_KEY) throw new Error('Thiếu NOCODB_URL / NOCODB_API_KEY.');
  if (DRY_RUN) {
    try {
      await db.columnsOf('users');
    } catch {
      console.log('(dry-run) Postgres chưa có bảng — chạy không --dry-run trước để tạo schema; chỉ đếm NocoDB.');
    }
  }

  const report = [];
  for (const [table, ...envNames] of TABLES) {
    const tableId = firstEnv(...envNames);
    if (!tableId) {
      console.log(`- ${table}: bỏ qua (không đặt ${envNames[0]})`);
      report.push({ table, skipped: true });
      continue;
    }

    const rows = await fetchAllRows(tableId);
    console.log(`- ${table}: ${rows.length} dòng trong NocoDB`);
    const result = { table, source: rows.length, inserted: 0, existed: 0, invalid: 0 };

    let columnByLower = null;
    if (!DRY_RUN) columnByLower = await reconcileColumns(table, tableId, { allowAdd: table !== 'users' });

    for (const row of rows) {
      const mapped = table === 'users' ? mapUser(row) : DRY_RUN ? {} : mapGeneric(row, columnByLower);
      const hasOwner = table === 'users' || (DRY_RUN ? row.created_by : mapped.created_by);
      if (!row.id || !hasOwner) {
        result.invalid += 1;
        console.warn(`  ! bỏ qua dòng thiếu ${!row.id ? 'id' : 'created_by'} (NocoDB Id=${row.Id ?? row.ID})`);
        continue;
      }
      if (DRY_RUN) continue;
      const written = await db.upsertRow(table, mapped, { onConflict: 'nothing' });
      if (written > 0) result.inserted += 1;
      else result.existed += 1;
    }
    report.push(result);
  }

  if (DRY_RUN) {
    console.log('\nDry-run xong — chưa ghi gì.');
    return;
  }

  console.log('\n=== Đối chiếu số dòng ===');
  let mismatch = false;
  for (const item of report) {
    if (item.skipped) continue;
    const [{ count }] = await db.query(`SELECT count(*)::int AS count FROM ${db.q(item.table)}`);
    const expected = item.source - item.invalid;
    const ok = count >= expected;
    if (!ok) mismatch = true;
    console.log(`${ok ? '✔' : '✘'} ${item.table.padEnd(22)} NocoDB ${String(item.source).padStart(5)} | thêm mới ${String(item.inserted).padStart(5)} | đã có ${String(item.existed).padStart(5)} | bỏ qua ${item.invalid} | Postgres ${count}`);
  }
  if (mismatch) {
    console.error('\nSố dòng Postgres ít hơn NocoDB ở một số bảng — kiểm tra log phía trên trước khi chuyển app sang Neon.');
    process.exitCode = 1;
  } else {
    console.log('\nXong. Đặt DATABASE_URL (+ ENCRYPTION_KEY cũ) trên server rồi deploy; NocoDB vẫn nguyên vẹn để rollback.');
  }
}

main()
  .catch((error) => {
    console.error('Migrate thất bại:', error.message || error);
    process.exitCode = 1;
  })
  .finally(() => db.closePool());
