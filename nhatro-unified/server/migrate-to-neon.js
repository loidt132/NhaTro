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
 * listed in the log. Rows without id or created_by are skipped and listed too, and so are
 * rows soft-deleted in NocoDB (isDeleted = true): only isDeleted = false rows are migrated.
 *
 * Cleaning Neon in place, without NocoDB (when NocoDB no longer has the data):
 *   npm run migrate-to-neon -- --cleanup          show what would change
 *   npm run migrate-to-neon -- --cleanup --yes    apply it (DESTRUCTIVE: deletes isDeleted=true rows,
 *                                                 drops the old audit columns — snapshot Neon first)
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
const CLEANUP = args.has('--cleanup');

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

// NocoDB soft delete: isDeleted checkbox (true / 1 / "true"). Only rows where it is false
// or empty are migrated.
function isSoftDeleted(row) {
  const value = row.isDeleted ?? row.isdeleted;
  return value === true || value === 1 || String(value).trim().toLowerCase() === 'true' || value === '1';
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
    created_by: pick(row, 'created_by') ?? row.id,
    updated_by: pick(row, 'modified_by', 'updated_by') ?? pick(row, 'created_by') ?? row.id,
    created_at: pick(row, 'created_at', 'createdAt', 'createdat', 'CreatedAt'),
    updated_at: pick(row, 'updated_at', 'updatedAt', 'UpdatedAt', 'modified_at'),
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
  out.updated_at = out.updated_at ?? out.created_at;
  return out;
}

// Table names and their columns, parsed from neon-schema.sql — the single source
// of truth for what gets created and copied.
function parseSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'neon-schema.sql'), 'utf8');
  const tables = new Map();
  const defs = new Map(); // table -> Map(column -> definition usable in ADD COLUMN)
  const re = /CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    const columns = new Map(); // lowercase -> real name
    const tableDefs = new Map();
    for (const line of m[2].split('\n')) {
      const col = line.trim().match(/^"?([A-Za-z_]\w*)"?\s+\S/);
      if (col && !/^(PRIMARY|UNIQUE|CONSTRAINT|CHECK|FOREIGN)$/i.test(col[1])) {
        columns.set(col[1].toLowerCase(), col[1]);
        // "name" TYPE ... -> without comment, trailing comma, NOT NULL (existing rows may be empty there)
        tableDefs.set(col[1], line.trim().replace(/--.*$/, '').trim().replace(/,$/, '').replace(/\s+NOT NULL/i, '').replace(/\s+PRIMARY KEY/i, ''));
      }
    }
    tables.set(m[1], columns);
    defs.set(m[1], tableDefs);
  }
  return { sql, tables, defs };
}

const IGNORED_COLUMNS = new Map(); // table -> Set of source column names that hold data
function noteIgnored(table, key) {
  if (!IGNORED_COLUMNS.has(table)) IGNORED_COLUMNS.set(table, new Set());
  IGNORED_COLUMNS.get(table).add(key);
}

// NocoDB's own audit names -> the schema's created_at / updated_at / updated_by.
// The app's createdAt/updatedAt win over NocoDB's system columns (they hold the
// real business time); everything else falls back to the next candidate. The old
// schema called the editor column modified_by.
const AUDIT_ALIASES = new Set([
  'created_at', 'createdAt', 'createdat', 'CreatedAt',
  'updated_at', 'updatedAt', 'UpdatedAt', 'modified_at',
  'updated_by', 'modified_by',
]);

function mapGeneric(table, row, columnByLower) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (NOCO_SYSTEM.has(key) || AUDIT_ALIASES.has(key)) continue;
    const column = columnByLower.get(key.toLowerCase());
    if (!column) {
      if (value !== null && value !== undefined && value !== '') noteIgnored(table, key);
      continue;
    }
    out[column] = value;
  }
  out.created_at = pick(row, 'createdAt', 'created_at', 'createdat', 'CreatedAt');
  out.updated_at = pick(row, 'updatedAt', 'updated_at', 'UpdatedAt', 'modified_at') ?? out.created_at;
  out.updated_by = pick(row, 'modified_by', 'updated_by');
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
      const cols = await db.columnsOf(table);
      const live = cols.has('isDeleted') ? ` WHERE COALESCE(${db.q('isDeleted')}, false) = false` : '';
      const [{ count }] = await db.query(`SELECT count(*)::int AS count FROM ${db.q(table)}${live}`);
      counts.set(table, count);
    } catch {
      // table does not exist yet
    }
  }
  return counts;
}

// ---- --cleanup: fix the existing Neon tables in place (no NocoDB needed) -----------------
// Old tables carry the audit data under other names (createdAt, updatedAt, createdat,
// modified_by, created_by_1, ...). Fold each into created_at / created_by / updated_at /
// updated_by, drop the old column, add whatever schema columns are missing, and delete
// the rows that are soft-deleted (isDeleted = true).
const AUDIT_ALIASES_PG = {
  created_at: ['createdAt', 'createdat', 'CreatedAt'],
  created_by: ['createdBy', 'createdby', 'CreatedBy'],
  updated_at: ['updatedAt', 'updatedat', 'UpdatedAt', 'modifiedAt', 'modifiedat', 'modified_at'],
  updated_by: ['updatedBy', 'updatedby', 'UpdatedBy', 'modifiedBy', 'modifiedby', 'modified_by'],
};

async function trySql(client, sql, label) {
  await client.query('SAVEPOINT cleanup_step');
  try {
    await client.query(sql);
    await client.query('RELEASE SAVEPOINT cleanup_step');
    return true;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT cleanup_step');
    console.warn(`  ! bỏ qua ${label}: ${error.message}`);
    return false;
  }
}

async function cleanupInPlace() {
  const execute = args.has('--yes');
  const schema = parseSchema();
  const cols = await db.query(
    'SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema()'
  );
  const byTable = new Map();
  for (const c of cols) {
    if (!byTable.has(c.table_name)) byTable.set(c.table_name, new Map());
    byTable.get(c.table_name).set(c.column_name, c.data_type);
  }

  const plan = [];
  for (const [table, schemaCols] of schema.tables) {
    const have = byTable.get(table);
    if (!have) {
      plan.push({ table, create: true, add: [], fold: [], dups: [], extra: [], deleted: 0 });
      continue;
    }
    const known = new Set(schemaCols.values());
    const item = { table, create: false, add: [], fold: [], dups: [], extra: [], deleted: 0 };
    for (const [lower, name] of schemaCols) {
      if (name !== 'id' && !have.has(name)) item.add.push({ name, def: schema.defs.get(table).get(name) });
    }
    for (const column of have.keys()) {
      if (known.has(column)) continue;
      const canonical = Object.keys(AUDIT_ALIASES_PG).find((key) => AUDIT_ALIASES_PG[key].includes(column));
      const dup = column.match(/^(.+)_(\d+)$/);
      if (canonical) item.fold.push({ from: column, to: canonical });
      else if (dup && (have.has(dup[1]) || known.has(dup[1]))) item.dups.push({ from: column, to: dup[1] });
      else item.extra.push(column);
    }
    if (have.has('isDeleted')) {
      const [{ count }] = await db.query(`SELECT count(*)::int AS count FROM ${db.q(table)} WHERE ${db.q('isDeleted')} = true`);
      item.deleted = count;
    }
    plan.push(item);
  }

  console.log(execute ? '=== Dọn Neon (đang áp dụng) ===' : '=== Kế hoạch dọn Neon (chưa thay đổi gì) ===');
  for (const item of plan) {
    const lines = [];
    if (item.create) lines.push('tạo bảng mới (chưa có)');
    if (item.add.length) lines.push(`thêm cột: ${item.add.map((a) => a.name).join(', ')}`);
    if (item.fold.length) lines.push(`gộp rồi xóa cột: ${item.fold.map((f) => `${f.from}→${f.to}`).join(', ')}`);
    if (item.dups.length) lines.push(`xóa cột trùng: ${item.dups.map((f) => `${f.from}→${f.to}`).join(', ')}`);
    if (item.deleted) lines.push(`xóa ${item.deleted} dòng isDeleted=true`);
    if (item.extra.length) lines.push(`(giữ nguyên cột ngoài schema: ${item.extra.join(', ')})`);
    if (lines.length) console.log(`- ${item.table}: ${lines.join(' | ')}`);
  }
  if (!execute) {
    console.log('\nThêm --yes để áp dụng. Việc này xóa các dòng đã xóa và các cột cũ — tạo branch/snapshot Neon trước.');
    return;
  }

  await db.withTransaction(async (client) => {
    for (const item of plan) {
      if (item.create) continue;
      const t = db.q(item.table);
      for (const a of item.add) await client.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS ${a.def}`);
      for (const f of item.fold) {
        const from = db.q(f.from);
        const to = db.q(f.to);
        // earliest created_at, latest updated_at; the *_by columns only fill gaps.
        const sql = f.to === 'created_at'
          ? `UPDATE ${t} SET ${to} = LEAST(${to}, ${from}) WHERE ${from} IS NOT NULL`
          : f.to === 'updated_at'
            ? `UPDATE ${t} SET ${to} = GREATEST(${to}, ${from}) WHERE ${from} IS NOT NULL`
            : `UPDATE ${t} SET ${to} = ${from} WHERE ${to} IS NULL AND ${from} IS NOT NULL`;
        await trySql(client, sql, `${item.table}.${f.from} → ${f.to}`);
        await client.query(`ALTER TABLE ${t} DROP COLUMN ${from}`);
      }
      for (const d of item.dups) {
        await trySql(client, `UPDATE ${t} SET ${db.q(d.to)} = ${db.q(d.from)} WHERE ${db.q(d.to)} IS NULL AND ${db.q(d.from)} IS NOT NULL`, `${item.table}.${d.from} → ${d.to}`);
        await client.query(`ALTER TABLE ${t} DROP COLUMN ${db.q(d.from)}`);
      }
      if (item.deleted) await client.query(`DELETE FROM ${t} WHERE ${db.q('isDeleted')} = true`);
    }
    await client.query(schema.sql); // creates missing tables and indexes
    // Last editor unknown -> the creator; users have no created_by from the old schema.
    await client.query(`UPDATE users SET created_by = id WHERE created_by IS NULL`);
    await client.query(`UPDATE users SET updated_by = created_by WHERE updated_by IS NULL`);
    for (const [table] of schema.tables) {
      if (table === 'users') continue;
      await client.query(`UPDATE ${db.q(table)} SET updated_by = created_by WHERE updated_by IS NULL`);
    }
  });
  db.forgetColumns('users');

  const left = await db.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()
      AND (column_name ~ '^(createdAt|updatedAt|createdat|updatedat|createdby|updatedby|modifiedby|modified_by|modified_at)$' OR column_name ~ '_[0-9]+$')`
  );
  console.log(left.length ? `\nVẫn còn cột cũ: ${left.map((c) => `${c.table_name}.${c.column_name}`).join(', ')}` : '\n✔ Đã dọn xong: không còn cột createdAt/updatedAt/…_1, không còn dòng isDeleted=true.');
}

async function main() {
  if (!db.isConfigured()) throw new Error('Thiếu DATABASE_URL (chuỗi kết nối Neon).');
  if (CLEANUP) {
    await cleanupInPlace();
    return;
  }
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
      let deleted = 0;
      for (const row of raw) {
        if (isSoftDeleted(row)) {
          deleted += 1;
          continue;
        }
        const mapped = table === 'users' ? mapUser(row) : mapGeneric(table, row, columnByLower);
        if (!row.id || (table !== 'users' && !mapped.created_by)) {
          invalid += 1;
          console.warn(`  ! ${table}: bỏ qua dòng thiếu ${!row.id ? 'id' : 'created_by'} (NocoDB Id=${row.Id ?? row.ID})`);
          continue;
        }
        rows.push(mapped);
      }
      console.log(`- ${table}: đọc ${raw.length} dòng từ NocoDB (${rows.length} dùng được, ${deleted} đã xóa bị bỏ qua)`);
      source.push({ table, rows, total: raw.length, invalid, deleted });
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
    console.log(`${ok ? '✔' : '✘'} ${item.table.padEnd(22)} NocoDB ${String(item.total).padStart(5)} | đã xóa ${String(item.deleted).padStart(4)} | bỏ qua ${String(item.invalid).padStart(3)} | trùng id ${String(item.duplicates).padStart(3)} | Neon ${String(item.count).padStart(5)}`);
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
