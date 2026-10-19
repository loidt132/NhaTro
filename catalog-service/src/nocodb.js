import fetch from "node-fetch";

// Thin client over NocoDB's v2 records API — replaces the old JSON-file
// store.js. One NocoDB project/base per repo (this repo's own base, set via
// NOCODB_PROJECT), separate from homestay-server's base.
//
// Table ids are resolved two ways:
//   1. An explicit NOCODB_TABLE_<NAME> env var, if set.
//   2. Otherwise, auto-discovered by table *title* from NOCODB_PROJECT via
//      the meta API — so you only need to copy one project id, not one id
//      per table.

const BASE = (process.env.NOCODB_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.NOCODB_API_KEY || "";
const PROJECT_ID = process.env.NOCODB_PROJECT || "";

const TABLE_TITLES = { categories: "categories", items: "items" };
const TABLE_ENV_VARS = { categories: "NOCODB_TABLE_CATEGORIES", items: "NOCODB_TABLE_ITEMS" };

function assertConfigured() {
  if (!BASE || !TOKEN) {
    throw new Error("NocoDB chưa cấu hình — cần NOCODB_URL và NOCODB_API_KEY trong .env");
  }
}

function headers() {
  return { "xc-token": TOKEN, "Content-Type": "application/json" };
}

// NocoDB's cloud plan rate-limits aggressively — retry 429s with backoff
// instead of failing the whole request. See homestay-server/src/nocodb.js
// for the matching fix (same NocoDB project, same limit).
const MAX_RETRIES = 4;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, options = {}) {
  assertConfigured();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, { headers: headers(), ...options });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 300 * 2 ** attempt;
      await sleep(delay);
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // See homestay-server/src/nocodb.js for why 429s get a friendly
      // message instead of NocoDB's raw rate-limit body.
      if (res.status === 429) {
        const err = new Error("Hệ thống dữ liệu đang bận, vui lòng thử lại sau vài giây.");
        err.code = "NOCODB_RATE_LIMIT";
        err.detail = `NocoDB ${options.method || "GET"} ${path} failed: 429 ${text.slice(0, 300)}`;
        throw err;
      }
      throw new Error(`NocoDB ${options.method || "GET"} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }
}

let discoveredTables = null;
async function discoverTables() {
  if (discoveredTables) return discoveredTables;
  if (!PROJECT_ID) {
    discoveredTables = {};
    return discoveredTables;
  }
  const body = await request(`/api/v2/meta/bases/${PROJECT_ID}/tables`);
  const map = {};
  for (const t of body.list || []) map[t.title] = t.id;
  discoveredTables = map;
  return map;
}

const tableIdCache = {};
async function resolveTableId(tableKey) {
  if (tableIdCache[tableKey]) return tableIdCache[tableKey];
  const envVar = TABLE_ENV_VARS[tableKey];
  const fromEnv = envVar && process.env[envVar];
  if (fromEnv) {
    tableIdCache[tableKey] = fromEnv;
    return fromEnv;
  }
  const discovered = await discoverTables();
  const id = discovered[TABLE_TITLES[tableKey]];
  if (!id) {
    throw new Error(
      `NocoDB: không tìm thấy bảng "${TABLE_TITLES[tableKey]}". Đặt ${envVar} thủ công, hoặc kiểm tra NOCODB_PROJECT và tên bảng trong NocoDB.`
    );
  }
  tableIdCache[tableKey] = id;
  return id;
}

// NocoDB's own row identifier for PATCH/DELETE — usually "Id" (its default
// auto PK column), but fall back to our own "id" business column in case a
// particular table was created without NocoDB adding one.
function primaryKeyOf(row) {
  if (row.Id !== undefined && row.Id !== null) return { field: "Id", value: row.Id };
  if (row.id !== undefined && row.id !== null) return { field: "id", value: row.id };
  throw new Error("NocoDB row has no recognizable primary key (Id/id)");
}

export async function listRows(tableKey, { where, limit = 1000, sort } = {}) {
  const tableId = await resolveTableId(tableKey);
  const params = new URLSearchParams({ limit: String(limit) });
  if (where) params.set("where", where);
  if (sort) params.set("sort", sort);
  const body = await request(`/api/v2/tables/${tableId}/records?${params.toString()}`);
  return body.list || [];
}

export async function findOneByBusinessId(tableKey, id) {
  const rows = await listRows(tableKey, { where: `(id,eq,${id})`, limit: 1 });
  return rows[0] || null;
}

export async function createRow(tableKey, data) {
  const tableId = await resolveTableId(tableKey);
  const body = await request(`/api/v2/tables/${tableId}/records`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  // NocoDB's create response is just { Id } — not the full row — so merge
  // back what we sent rather than firing a second GET for every insert.
  const created = Array.isArray(body) ? body[0] : body;
  return { ...data, ...created };
}

export async function updateRowByBusinessId(tableKey, id, patch) {
  const existing = await findOneByBusinessId(tableKey, id);
  if (!existing) return null;
  const tableId = await resolveTableId(tableKey);
  const { field, value } = primaryKeyOf(existing);
  await request(`/api/v2/tables/${tableId}/records`, {
    method: "PATCH",
    body: JSON.stringify({ [field]: value, ...patch }),
  });
  return { ...existing, ...patch };
}

export async function deleteRowByBusinessId(tableKey, id) {
  const existing = await findOneByBusinessId(tableKey, id);
  if (!existing) return false;
  const tableId = await resolveTableId(tableKey);
  const { field, value } = primaryKeyOf(existing);
  await request(`/api/v2/tables/${tableId}/records`, {
    method: "DELETE",
    body: JSON.stringify({ [field]: value }),
  });
  return true;
}
