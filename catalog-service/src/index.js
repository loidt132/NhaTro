import express from "express";
import cors from "cors";
import { v4 as uuid } from "uuid";
import * as db from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4100;
// Writes require this key so random callers can't edit the shared price
// list; reads stay public since any app (nhà trọ, homestay, ...) consuming
// this catalog needs to list/display items without a secret. Each
// consuming app is expected to gate its OWN admin UI (login/roles) before
// ever sending a write here with this key — see homestay-server's
// /api/admin/catalog/* proxy for how that's done.
const ADMIN_KEY = process.env.CATALOG_ADMIN_KEY || "dev-catalog-admin-key-change-me";
const START_TIME = Date.now();

// Public, no auth — used by uptime monitors/load balancers. Does a cheap
// database round trip so "ok" actually means the app can serve real requests,
// not just that the Node process is alive.
app.get("/health", async (req, res) => {
  let database = "unknown";
  try {
    await db.ping();
    database = "ok";
  } catch (err) {
    database = `error: ${err.message}`;
  }
  const status = database === "ok" ? "ok" : "degraded";
  res.status(status === "ok" ? 200 : 503).json({
    status,
    service: "catalog-service",
    uptimeSeconds: Math.round((Date.now() - START_TIME) / 1000),
    timestamp: new Date().toISOString(),
    dependencies: { database },
  });
});

function requireApiKey(req, res, next) {
  if (req.headers["x-api-key"] !== ADMIN_KEY) {
    return res.status(401).json({ error: "Thiếu hoặc sai API key cho thao tác ghi." });
  }
  next();
}

// This catalog is shared by multiple homestays (and, later, nhà trọ), each
// with its own price list — every read/write is scoped by homestayId so
// one homestay never sees or edits another's catalog. Unlike the admin-key
// check above (proves the *caller* is a trusted backend), this check
// doesn't verify WHO is asking, only WHICH homestay's data they asked
// for — the caller (homestay-server's proxy) is what already validated the
// user's JWT before ever reaching here.
function requireHomestayId(req, res, next) {
  const homestayId = req.query.homestayId || req.body?.homestayId;
  if (!homestayId) return res.status(400).json({ error: "homestayId is required" });
  req.homestayId = homestayId;
  next();
}

// Strip DB-only columns (timestamps, ...) so responses only carry the
// business fields the frontend/homestay-server already expect.
function asCategory(row) {
  return { id: row.id, name: row.name };
}

function asItem(row) {
  return {
    id: row.id,
    categoryId: row.categoryId ?? null,
    name: row.name,
    unit: row.unit || "",
    price: Number(row.price),
    kind: row.kind || "service",
  };
}

function dbErrorToHttp(res, err) {
  console.error(err);
  res.status(502).json({ error: `Database: ${err.message}` });
}

app.get("/api/categories", requireHomestayId, async (req, res) => {
  try {
    const rows = await db.listCategories(req.homestayId);
    res.json(rows.map(asCategory));
  } catch (err) {
    dbErrorToHttp(res, err);
  }
});

app.post("/api/categories", requireApiKey, requireHomestayId, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  try {
    const row = await db.createCategory({ id: uuid(), homestayId: req.homestayId, name });
    res.status(201).json(asCategory(row));
  } catch (err) {
    dbErrorToHttp(res, err);
  }
});

app.put("/api/categories/:id", requireApiKey, requireHomestayId, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  try {
    const existing = await db.getCategory(req.params.id);
    if (!existing || existing.homestayId !== req.homestayId) return res.status(404).json({ error: "not found" });
    const row = await db.updateCategory(req.params.id, name);
    res.json(asCategory(row));
  } catch (err) {
    dbErrorToHttp(res, err);
  }
});

app.delete("/api/categories/:id", requireApiKey, requireHomestayId, async (req, res) => {
  try {
    const category = await db.getCategory(req.params.id);
    if (!category || category.homestayId !== req.homestayId) return res.status(404).json({ error: "not found" });
    if ((await db.countItemsInCategory(category.id)) > 0) {
      return res.status(409).json({ error: "Danh mục đang có dịch vụ — hãy chuyển/xoá dịch vụ trong danh mục này trước." });
    }
    await db.deleteCategory(req.params.id);
    res.status(204).end();
  } catch (err) {
    dbErrorToHttp(res, err);
  }
});

// `kind` tells "service" (ăn uống, giặt là...) apart from "surcharge" (phụ
// thu) items in the same catalog — one backend/admin page for both instead
// of a second near-identical service.
app.get("/api/items", requireHomestayId, async (req, res) => {
  try {
    const { categoryId, kind } = req.query;
    const rows = await db.listItems(req.homestayId, { categoryId, kind });
    res.json(rows.map(asItem));
  } catch (err) {
    dbErrorToHttp(res, err);
  }
});

app.get("/api/items/:id", requireHomestayId, async (req, res) => {
  try {
    const row = await db.getItem(req.params.id);
    if (!row || row.homestayId !== req.homestayId) return res.status(404).json({ error: "not found" });
    res.json(asItem(row));
  } catch (err) {
    dbErrorToHttp(res, err);
  }
});

app.post("/api/items", requireApiKey, requireHomestayId, async (req, res) => {
  const { categoryId, name, unit, price, kind } = req.body;
  if (!name || price == null) {
    return res.status(400).json({ error: "name and price are required" });
  }
  const itemKind = kind === "surcharge" ? "surcharge" : "service";
  if (itemKind === "service" && !categoryId) {
    return res.status(400).json({ error: "categoryId is required for service items" });
  }
  try {
    const row = await db.createItem({
      id: uuid(),
      homestayId: req.homestayId,
      categoryId: categoryId || null,
      name,
      unit: unit || "",
      price: Number(price),
      kind: itemKind,
    });
    res.status(201).json(asItem(row));
  } catch (err) {
    dbErrorToHttp(res, err);
  }
});

app.put("/api/items/:id", requireApiKey, requireHomestayId, async (req, res) => {
  const patch = {};
  if (req.body.name != null) patch.name = req.body.name;
  if (req.body.unit != null) patch.unit = req.body.unit;
  if (req.body.price != null) patch.price = Number(req.body.price);
  if (req.body.categoryId !== undefined) patch.categoryId = req.body.categoryId;
  if (req.body.kind != null) patch.kind = req.body.kind === "surcharge" ? "surcharge" : "service";
  try {
    const existing = await db.getItem(req.params.id);
    if (!existing || existing.homestayId !== req.homestayId) return res.status(404).json({ error: "not found" });
    const row = await db.updateItem(req.params.id, patch);
    res.json(asItem(row));
  } catch (err) {
    dbErrorToHttp(res, err);
  }
});

app.delete("/api/items/:id", requireApiKey, requireHomestayId, async (req, res) => {
  try {
    const existing = await db.getItem(req.params.id);
    if (!existing || existing.homestayId !== req.homestayId) return res.status(404).json({ error: "not found" });
    await db.deleteItem(req.params.id);
    res.status(204).end();
  } catch (err) {
    dbErrorToHttp(res, err);
  }
});

// Vercel imports this module as a serverless function (see api/[...all].js)
// instead of running it as a long-lived process — don't bind a port there.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[catalog-service] listening on http://localhost:${PORT}`);
    console.log(`[catalog-service] storage = Postgres (${process.env.DATABASE_URL ? "configured" : "NOT CONFIGURED"})`);
  });
}

export default app;
