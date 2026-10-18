// Same NocoDB gotcha as homestay-server's fix-link-columns.js: a column
// named "homestayId" risks being auto-converted into a LinkToAnotherRecord
// relation (or dropped entirely) because it matches the new `homestays`
// table's name. This finds/fixes it on categories and items.
//
// Run with: node --env-file=.env scripts/fix-link-columns.js
import fetch from "node-fetch";

const BASE = (process.env.NOCODB_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.NOCODB_API_KEY || "";

const TARGETS = [
  { tableEnv: "NOCODB_TABLE_CATEGORIES", field: "homestayId" },
  { tableEnv: "NOCODB_TABLE_ITEMS", field: "homestayId" },
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
  console.log("Xong.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
