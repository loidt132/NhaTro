import fetch from "node-fetch";

// Thin client over NocoDB's v2 records API — replaces the old JSON-file
// store.js. One NocoDB project/base per repo (this repo's own base, set via
// NOCODB_PROJECT), separate from catalog-service's base.
//
// Table ids are resolved two ways:
//   1. An explicit NOCODB_TABLE_<NAME> env var, if set.
//   2. Otherwise, auto-discovered by table *title* from NOCODB_PROJECT via
//      the meta API — so you only need to copy one project id, not one id
//      per table.

const BASE = (process.env.NOCODB_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.NOCODB_API_KEY || "";
const PROJECT_ID = process.env.NOCODB_PROJECT || "";

const TABLE_TITLES = {
  homestays: "homestays",
  users: "users",
  roomTypes: "roomTypes",
  rooms: "rooms",
  ratePlans: "ratePlans",
  stays: "stays",
  guests: "guests",
  serviceCharges: "serviceCharges",
  roomTransfers: "roomTransfers",
  lockEventsLog: "lockEventsLog",
  settings: "settings",
};

const TABLE_ENV_VARS = {
  homestays: "NOCODB_TABLE_HOMESTAYS",
  users: "NOCODB_TABLE_USERS",
  roomTypes: "NOCODB_TABLE_ROOM_TYPES",
  rooms: "NOCODB_TABLE_ROOMS",
  ratePlans: "NOCODB_TABLE_RATE_PLANS",
  stays: "NOCODB_TABLE_STAYS",
  guests: "NOCODB_TABLE_GUESTS",
  serviceCharges: "NOCODB_TABLE_SERVICE_CHARGES",
  roomTransfers: "NOCODB_TABLE_ROOM_TRANSFERS",
  lockEventsLog: "NOCODB_TABLE_LOCK_EVENTS_LOG",
  settings: "NOCODB_TABLE_SETTINGS",
};

function assertConfigured() {
  if (!BASE || !TOKEN) {
    throw new Error("NocoDB chưa cấu hình — cần NOCODB_URL và NOCODB_API_KEY trong .env");
  }
}

function headers() {
  return { "xc-token": TOKEN, "Content-Type": "application/json" };
}

async function request(path, options = {}) {
  assertConfigured();
  const res = await fetch(`${BASE}${path}`, { headers: headers(), ...options });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`NocoDB ${options.method || "GET"} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
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

export async function findOneWhere(tableKey, where) {
  const rows = await listRows(tableKey, { where, limit: 1 });
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

export async function deleteRowById(tableKey, row) {
  const tableId = await resolveTableId(tableKey);
  const { field, value } = primaryKeyOf(row);
  await request(`/api/v2/tables/${tableId}/records`, {
    method: "DELETE",
    body: JSON.stringify({ [field]: value }),
  });
}
