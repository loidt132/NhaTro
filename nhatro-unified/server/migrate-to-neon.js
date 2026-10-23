/* Rebuilds the nhatro-unified database on PostgreSQL (Neon) from NocoDB.
 *
 *   1. reads EVERY row of every NocoDB table into memory (NocoDB is never modified)
 *   2. in ONE transaction: drops the app tables on Neon if they exist, recreates
 *      them from neon-schema.sql, and inserts all rows — if anything fails the
 *      transaction rolls back and Neon is left exactly as it was
 *   3. compares the row counts of both sides
 *
 * Encrypted CCCD / phone values are copied as-is, so keep the same ENCRYPTION_KEY.
 * Only columns defined in neon-schema.sql are copied (matched case-insensitively);
 * extra NocoDB columns — e.g. the duplicate created_by_1 / createdby / modifiedby
 * that NocoDB makes when a table already has its own created_by — are ignored and
 * listed in the log. Rows without id or created_by are skipped and listed too.
 *
 * Needs (server/.env or the environment):
 *   DATABASE_URL                               Neon connection string
 *   NOCODB_URL, NOCODB_API_KEY                 the old NocoDB
 *   NOCODB_TABLE_USERS, NOCODB_TABLE_ROOMS ... the same table ids the server used
 *
 * Run:  npm run migrate-to-neon -- --dry-run   read NocoDB + report, change nothing
 *       npm run migrate-to-neon                drop + recreate + copy + verify
 *       npm run migrate-to-neon -- --schema-only   only drop + recreate empty tables
 *
 * Safety: it refuses to drop Neon tables when NocoDB returned fewer rows than Neon
 * already holds in some table (NocoDB may have lost data and Neon may be the only
 * copy). Snapshot Neon first (a Neon branch is instant), then add --force if the
 * smaller NocoDB is really what you want.
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
const DRY_RUN = args.has('--dry-run');
const SCHEMA_ONLY = args.has('--schema-only');
const FORCE = args.has('--force');

const firstEnv = (...names) => {
  for (const name of names) {
    const value = process.env[name];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
};

const NOCODB_URL = firstEnv('NOCODB_URL', 'VITE_NOCODB_URL').replace(/\/+$/, '');
const NOCODB_API_KEY = firstEnv('NOCODB_API_KEY', 'VITE_NOCODB_API_KEY');

// Postgres table -> env var holding its NocoDB table id.
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
    isActive: !(row.isActive === false || row.isActive === 0 || String(row.isActive).toLowerCase() === 'false'),
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

// Table names and their columns, parsed from neon-schema.sql — the single source
// of truth for what gets created and copied.
function parseSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'neon-schema.sql'), 'utf8');
  const tables = new Map();
  const re = /CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    const columns = new Map(); // lowercase -> real name
    for (const line of m[2].split('\n')) {
      const col = line.trim().match(/^"?([A-Za-z_]\w*)"?\s+\S/);
      if (col && !/^(PRIMARY|UNIQUE|CONSTRAINT|CHECK|FOREIGN)$/i.test(col[1])) columns.set(col[1].toLowerCase(), col[1]);
    }
    tables.set(m[1], columns);
  }
  return { sql, tables };
}

const IGNORED_COLUMNS = new Map(); // table -> Set of source column names that hold data
function noteIgnored(table, key) {
  if (!IGNORED_COLUMNS.has(table)) IGNORED_COLUMNS.set(table, new Set());
  IGNORED_COLUMNS.get(table).add(key);
}

function mapGeneric(table, row, columnByLower) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (NOCO_SYSTEM.has(key)) continue;
    const column = columnByLower.get(key.toLowerCase());
    if (!column) {
      if (value !== null && value !== undefined && value !== '') noteIgnored(table, key);
      continue;
    }
    out[column] = value;
  }
  if (out.created_at === undefined && row.CreatedAt) out.created_at = row.CreatedAt;
  if (out.updated_at === undefined && row.UpdatedAt) out.updated_at = row.UpdatedAt;
  if (out.isDeleted === undefined || out.isDeleted === null) out.isDeleted = false;
  return out;
}

async function insertRow(client, table, row, dataTypes) {
  const cols = [];
  const values = [];
  for (const [key, raw] of Object.entries(row)) {
    const value = db.coerce(dataTypes.get(key), raw);
    if (value === undefined) continue;
    cols.push(key);
    values.push(value);
  }
  const result = await client.query(
    `INSERT INTO ${db.q(table)} (${cols.map(db.q).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (id) DO NOTHING`,
    values
  );
  return result.rowCount;
}

async function existingRowCounts(tableNames) {
  const counts = new Map();
  for (const table of tableNames) {
    try {
      const [{ count }] = await db.query(`SELECT count(*)::int AS count FROM ${db.q(table)}`);
      counts.set(table, count);
    } catch {
      // table does not exist yet
    }
  }
  return counts;
}

async function main() {
  if (!db.isConfigured()) throw new Error('Thiếu DATABASE_URL (chuỗi kết nối Neon).');
  const schema = parseSchema();
  const tableNames = [...schema.tables.keys()];
  const existing = await existingRowCounts(tableNames);

  // ---- 1. read everything from NocoDB first --------------------------------
  const source = []; // { table, rows (usable, mapped), total, invalid }
  if (!SCHEMA_ONLY) {
    if (!NOCODB_URL || !NOCODB_API_KEY) throw new Error('Thiếu NOCODB_URL / NOCODB_API_KEY.');
    for (const [table, ...envNames] of TABLES) {
      const tableId = firstEnv(...envNames);
      if (!tableId) {
        console.log(`- ${table}: bỏ qua (không đặt ${envNames[0]}) — bảng sẽ để trống`);
        continue;
      }
      const raw = await fetchAllRows(tableId);
      const columnByLower = schema.tables.get(table);
      const rows = [];
      let invalid = 0;
      for (const row of raw) {
        const mapped = table === 'users' ? mapUser(row) : mapGeneric(table, row, columnByLower);
        if (!row.id || (table !== 'users' && !mapped.created_by)) {
          invalid += 1;
          console.warn(`  ! ${table}: bỏ qua dòng thiếu ${!row.id ? 'id' : 'created_by'} (NocoDB Id=${row.Id ?? row.ID})`);
          continue;
        }
        rows.push(mapped);
      }
      console.log(`- ${table}: đọc ${raw.length} dòng từ NocoDB (${rows.length} dùng được)`);
      source.push({ table, rows, total: raw.length, invalid });
    }
    for (const [table, names] of IGNORED_COLUMNS) {
      console.log(`  ~ ${table}: bỏ qua cột NocoDB không có trong schema: ${[...names].join(', ')}`);
    }

    // ---- safety: never replace more data with less ------------------------
    // (a table whose NOCODB_TABLE_* id is not set counts as 0 rows)
    const shrinking = tableNames
      .map((table) => ({ table, nocodb: source.find((s) => s.table === table)?.rows.length ?? 0, neon: existing.get(table) || 0 }))
      .filter((s) => s.neon > s.nocodb);
    if (shrinking.length > 0 && !FORCE) {
      console.error('\nDỪNG — NocoDB có ÍT dòng hơn Neon ở các bảng sau, nên xóa Neon sẽ làm mất dữ liệu:');
      for (const s of shrinking) console.error(`  ${s.table}: NocoDB ${s.nocodb} < Neon ${s.neon}`);
      console.error('Nếu NocoDB đã mất dữ liệu thì Neon có thể là bản duy nhất. Tạo branch/snapshot trên Neon trước; nếu vẫn muốn ghi đè, chạy lại với --force.');
      process.exitCode = 1;
      return;
    }
  }

  const existingSummary = [...existing].filter(([, n]) => n > 0).map(([t, n]) => `${t}=${n}`).join(', ');
  if (existing.size > 0) console.log(`\nNeon đang có ${existing.size} bảng${existingSummary ? ` (${existingSummary})` : ''} — sẽ bị xóa và tạo lại.`);

  if (DRY_RUN) {
    console.log('\nDry-run xong — chưa thay đổi gì trên Neon.');
    return;
  }

  // ---- 2. drop + recreate + insert, all or nothing --------------------------
  await db.withTransaction(async (client) => {
    for (const table of [...tableNames].reverse()) await client.query(`DROP TABLE IF EXISTS ${db.q(table)} CASCADE`);
    await client.query(schema.sql);
    console.log('✔ Đã xóa và tạo lại các bảng từ neon-schema.sql');

    for (const item of source) {
      const typeRows = await client.query(
        'SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1',
        [item.table]
      );
      const dataTypes = new Map(typeRows.rows.map((r) => [r.column_name, r.data_type]));
      item.inserted = 0;
      for (const row of item.rows) item.inserted += await insertRow(client, item.table, row, dataTypes);
      item.duplicates = item.rows.length - item.inserted;
      const { rows } = await client.query(`SELECT count(*)::int AS count FROM ${db.q(item.table)}`);
      item.count = rows[0].count;
      if (item.count !== item.inserted) throw new Error(`${item.table}: đếm lại ${item.count} ≠ đã chèn ${item.inserted}`);
    }
  });
  db.forgetColumns('users');

  // ---- 3. report -------------------------------------------------------------
  if (SCHEMA_ONLY) {
    console.log('\nXong (--schema-only): các bảng đã được tạo lại, chưa có dữ liệu.');
    return;
  }
  console.log('\n=== Đối chiếu số dòng ===');
  let problem = false;
  for (const item of source) {
    const ok = item.duplicates === 0;
    if (!ok) problem = true;
    console.log(`${ok ? '✔' : '✘'} ${item.table.padEnd(22)} NocoDB ${String(item.total).padStart(5)} | bỏ qua ${String(item.invalid).padStart(3)} | trùng id ${String(item.duplicates).padStart(3)} | Neon ${String(item.count).padStart(5)}`);
  }
  if (problem) {
    console.error('\nCó bảng bị trùng id trong NocoDB (chỉ giữ dòng đầu tiên) — kiểm tra log phía trên.');
    process.exitCode = 1;
  } else {
    console.log('\nXong. Neon đã khớp NocoDB. NocoDB không bị thay đổi; đặt DATABASE_URL (+ ENCRYPTION_KEY cũ) trên server rồi deploy.');
  }
}

main()
  .catch((error) => {
    console.error('Migrate thất bại (Neon giữ nguyên như trước):', error.message || error);
    process.exitCode = 1;
  })
  .finally(() => db.closePool());
