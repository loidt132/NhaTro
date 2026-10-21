// One-off: copies every row from the old NocoDB base into Postgres, as-is
// (guests' encrypted idNumber/phone stay encrypted — keep ENCRYPTION_KEY the
// same). Needs the OLD settings plus the new DATABASE_URL:
//   NOCODB_URL, NOCODB_API_KEY, NOCODB_PROJECT   (or NOCODB_TABLE_<NAME> ids)
//   DATABASE_URL
// Run `npm run migrate` first, then: npm run import-from-nocodb
// Rows whose id already exists in Postgres are skipped, so it is safe to re-run.
import { insertRaw, query, tableName } from "../src/db.js";

const BASE = (process.env.NOCODB_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.NOCODB_API_KEY || "";
const PROJECT = process.env.NOCODB_PROJECT || "";
if (!BASE || !TOKEN) {
  console.error("Thiếu NOCODB_URL / NOCODB_API_KEY — dừng lại.");
  process.exit(1);
}

// Insert order: parents before children.
const TABLES = [
  ["homestays", "NOCODB_TABLE_HOMESTAYS"],
  ["users", "NOCODB_TABLE_USERS"],
  ["roomTypes", "NOCODB_TABLE_ROOM_TYPES"],
  ["rooms", "NOCODB_TABLE_ROOMS"],
  ["ratePlans", "NOCODB_TABLE_RATE_PLANS"],
  ["stays", "NOCODB_TABLE_STAYS"],
  ["guests", "NOCODB_TABLE_GUESTS"],
  ["serviceCharges", "NOCODB_TABLE_SERVICE_CHARGES"],
  ["roomTransfers", "NOCODB_TABLE_ROOM_TRANSFERS"],
  ["lockEventsLog", "NOCODB_TABLE_LOCK_EVENTS_LOG"],
  ["settings", "NOCODB_TABLE_SETTINGS"],
];

async function api(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { "xc-token": TOKEN } });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

let discovered = null;
async function tableId(title, envVar) {
  if (process.env[envVar]) return process.env[envVar];
  if (!discovered) {
    if (!PROJECT) throw new Error(`Đặt NOCODB_PROJECT hoặc ${envVar}`);
    const body = await api(`/api/v2/meta/bases/${PROJECT}/tables`);
    discovered = Object.fromEntries((body.list || []).map((t) => [t.title, t.id]));
  }
  if (!discovered[title]) throw new Error(`Không thấy bảng "${title}" trong NocoDB`);
  return discovered[title];
}

async function fetchAll(id) {
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const body = await api(`/api/v2/tables/${id}/records?limit=100&offset=${offset}`);
    rows.push(...(body.list || []));
    if (body.pageInfo?.isLastPage ?? (body.list || []).length < 100) break;
  }
  return rows;
}

for (const [title, envVar] of TABLES) {
  const rows = await fetchAll(await tableId(title, envVar));
  let added = 0;
  for (const row of rows) {
    if ((await query(`SELECT 1 FROM "${tableName(title)}" WHERE id = $1`, [row.id])).length) continue;
    const data = { ...row };
    if (data.CreatedAt) data.created_at = data.CreatedAt;
    if (data.UpdatedAt) data.updated_at = data.UpdatedAt;
    await insertRaw(title, data);
    added += 1;
  }
  console.log(`${title}: ${added}/${rows.length} dòng đã chép`);
}
process.exit(0);
