// NocoDB auto-converted columns named "xxxId" (matching another table's
// name) into LinkToAnotherRecord relation fields when this base was
// created — so writing a plain string to e.g. rooms.roomTypeId via the
// records API silently did nothing (relations aren't set that way).
// This one-off script finds each affected column and recreates it as a
// plain SingleLineText field instead, so the app's simple "store the
// business id as a string" model works like the rest of the schema.
//
// Run with: node --env-file=.env scripts/fix-link-columns.js
import fetch from "node-fetch";

const BASE = (process.env.NOCODB_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.NOCODB_API_KEY || "";

const TARGETS = [
  { tableEnv: "NOCODB_TABLE_ROOMS", field: "roomTypeId" },
  { tableEnv: "NOCODB_TABLE_RATE_PLANS", field: "roomTypeId" },
  { tableEnv: "NOCODB_TABLE_STAYS", field: "roomId" },
  { tableEnv: "NOCODB_TABLE_GUESTS", field: "stayId" },
  { tableEnv: "NOCODB_TABLE_SERVICE_CHARGES", field: "stayId" },
  { tableEnv: "NOCODB_TABLE_ROOM_TRANSFERS", field: "stayId" },
  { tableEnv: "NOCODB_TABLE_ROOM_TRANSFERS", field: "fromRoomId" },
  { tableEnv: "NOCODB_TABLE_ROOM_TRANSFERS", field: "toRoomId" },
  { tableEnv: "NOCODB_TABLE_LOCK_EVENTS_LOG", field: "stayId" },
  // Multi-tenant (per-homestay) columns — same "xxxId matches a table name"
  // trap applies to homestayId since the new `homestays` table exists.
  { tableEnv: "NOCODB_TABLE_USERS", field: "homestayId" },
  { tableEnv: "NOCODB_TABLE_ROOM_TYPES", field: "homestayId" },
  { tableEnv: "NOCODB_TABLE_ROOMS", field: "homestayId" },
  { tableEnv: "NOCODB_TABLE_RATE_PLANS", field: "homestayId" },
  { tableEnv: "NOCODB_TABLE_STAYS", field: "homestayId" },
  { tableEnv: "NOCODB_TABLE_SETTINGS", field: "homestayId" },
];

function headers() {
  return { "xc-token": TOKEN, "Content-Type": "application/json" };
}

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, { headers: headers(), ...options });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${options.method || "GET"} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function fixColumn(tableId, field) {
  const meta = await req(`/api/v2/meta/tables/${tableId}`);
  const col = meta.columns.find((c) => c.title === field);
  if (!col) {
    // Same gotcha can make NocoDB drop the column entirely instead of
    // turning it into a Link (seen on ratePlans.roomTypeId last time) —
    // either way, a plain SingleLineText column is what we want, so create
    // it if it's simply missing.
    await req(`/api/v2/meta/tables/${tableId}/columns`, {
      method: "POST",
      body: JSON.stringify({ title: field, column_name: field, uidt: "SingleLineText" }),
    });
    console.log(`  + "${field}" was missing — created as SingleLineText`);
    return;
  }
  if (col.uidt !== "LinkToAnotherRecord") {
    console.log(`  - "${field}" is already ${col.uidt}, leaving as-is`);
    return;
  }
  await req(`/api/v2/meta/columns/${col.id}`, { method: "DELETE" });
  await req(`/api/v2/meta/tables/${tableId}/columns`, {
    method: "POST",
    body: JSON.stringify({ title: field, column_name: field, uidt: "SingleLineText" }),
  });
  console.log(`  + "${field}" converted Link -> SingleLineText`);
}

async function main() {
  for (const t of TARGETS) {
    const tableId = process.env[t.tableEnv];
    if (!tableId) {
      console.log(`! ${t.tableEnv} not set — skipping ${t.field}`);
      continue;
    }
    console.log(`${t.tableEnv} (${tableId}) — ${t.field}`);
    await fixColumn(tableId, t.field);
  }
  console.log("Xong. Chạy lại npm run seed sau khi xoá sạch bảng (data cũ roomTypeId/roomId/stayId=null vẫn còn, nên xoá rows rồi seed lại).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
