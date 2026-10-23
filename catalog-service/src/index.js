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
  // The calling backend (homestay-server, nhà trọ's server, ...) forwards the
  // logged-in user's id; it is stamped into created_by / updated_by ("system"
  // when a caller sends none).
  req.actorId = String(req.headers["x-actor-id"] || "").trim().slice(0, 64) || "system";
  next();
}

// This catalog is shared by multiple businesses (homestays, nhà trọ, ...),
// each with its own price list — every read/write is scoped by businessId
// so one business never sees or edits another's catalog. Unlike the
// admin-key check above (proves the *caller* is a trusted backend), this
// check doesn't verify WHO is asking, only WHICH business's data they asked
// for — the caller (homestay-server's or nhà trọ server's proxy) is what
// already validated the user's JWT before ever reaching here.
function requireBusinessId(req, res, next) {
  const businessId = req.query.businessId || req.body?.businessId;
  if (!businessId) return res.status(400).json({ error: "businessId is required" });
  req.businessId = businessId;
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
    businessId: row.businessId,
    categoryId: row.categoryId ?? null,
    categoryName: row.categoryName ?? null,
    name: row.name,
    unit: row.unit || "",
    price: Number(row.price),
    kind: row.kind || "service",
  };
}

function asOrder(row) {
  return {
    id: row.id,
    businessId: row.businessId,
    itemId: row.itemId ?? null,
    itemName: row.itemName,
    unit: row.unit || "",
    price: Number(row.price),
    quantity: Number(row.quantity),
    amount: Number(row.amount),
    roomId: row.roomId ?? null,
    tenantId: row.tenantId ?? null,
    customerName: row.customerName ?? null,
    month: row.month ?? null,
    status: row.status || "pending",
    note: row.note ?? null,
    orderedAt: row.orderedAt,
    completedAt: row.completedAt ?? null,
  };
}

function dbErrorToHttp(res, err) {
  console.error(err);
  res.status(502).json({ error: `Database: ${err.message}` });
}

app.get("/api/categories", requireBusinessId, async (req, res) => {
  try {
    const rows = await db.listCategories(req.businessId);
    res.json(rows.map(asCategory));
  } catch (err) {
    dbErrorToHttp(res, err);
  }
});

app.post("/api/categories", requireApiKey, requireBusinessId, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  try {
    const row = await db.createCategory({ id: uuid(), businessId: req.businessId, name }, req.actorId);
    res.status(201).json(asCategory(row));
  } catch (err) {
    dbErrorToHttp(res, err);
  }
});

app.put("/api/categories/:id", requireApiKey, requireBusinessId, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  try {
    const existing = await db.getCategory(req.params.id);
    if (!existing || existing.businessId !== req.businessId) return res.status(404).json({ error: "not found" });
    const row = await db.updateCategory(req.params.id, name, req.actorId);
    res.json(asCategory(row));
  } catch (err) {
    dbErrorToHttp(res, err);
  }
});

app.delete("/api/categories/:id", requireApiKey, requireBusinessId, async (req, res) => {
  try {
    const category = await db.getCategory(req.params.id);
    if (!category || category.businessId !== req.businessId) return res.status(404).json({ error: "not found" });
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
app.get("/api/items", requireBusinessId, async (req, res) => {
  try {
    const { categoryId, kind } = req.query;
    const rows = await db.listItems(req.businessId, { categoryId, kind });
    res.json(rows.map(asItem));
  } catch (err) {
    dbErrorToHttp(res, err);
  }
});

app.get("/api/items/:id", requireBusinessId, async (req, res) => {
  try {
    const row = await db.getItem(req.params.id);
    if (!row || row.businessId !== req.businessId) return res.status(404).json({ error: "not found" });
    res.json(asItem(row));
  } catch (err) {
    dbErrorToHttp(res, err);
  }
});

app.post("/api/items", requireApiKey, requireBusinessId, async (req, res) => {
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
      businessId: req.businessId,
      categoryId: categoryId || null,
      name,
      unit: unit || "",
      price: Number(price),
      kind: itemKind,
    }, req.actorId);
    res.status(201).json(asItem(row));
  } catch (err) {
    dbErrorToHttp(res, err);
  }
});

app.put("/api/items/:id", requireApiKey, requireBusinessId, async (req, res) => {
  const patch = {};
  if (req.body.name != null) patch.name = req.body.name;
  if (req.body.unit != null) patch.unit = req.body.unit;
  if (req.body.price != null) patch.price = Number(req.body.price);
  if (req.body.categoryId !== undefined) patch.categoryId = req.body.categoryId;
  if (req.body.kind != null) patch.kind = req.body.kind === "surcharge" ? "surcharge" : "service";
  try {
    const existing = await db.getItem(req.params.id);
    if (!existing || existing.businessId !== req.businessId) return res.status(404).json({ error: "not found" });
    const row = await db.updateItem(req.params.id, patch, req.actorId);
    res.json(asItem(row));
  } catch (err) {
    dbErrorToHttp(res, err);
  }
});

app.delete("/api/items/:id", requireApiKey, requireBusinessId, async (req, res) => {
  try {
    const existing = await db.getItem(req.params.id);
    if (!existing || existing.businessId !== req.businessId) return res.status(404).json({ error: "not found" });
    await db.deleteItem(req.params.id);
    res.status(204).end();
  } catch (err) {
    dbErrorToHttp(res, err);
  }
});

const ORDER_STATUSES = new Set(["pending", "in_progress", "done", "cancelled"]);

app.get("/api/orders", requireBusinessId, async (req, res) => {
  try {
    const { roomId, month, status } = req.query;
    const rows = await db.listOrders(req.businessId, { roomId, month, status });
    res.json(rows.map(asOrder));
  } catch (err) {
    dbErrorToHttp(res, err);
  }
});

app.post("/api/orders", requireApiKey, requireBusinessId, async (req, res) => {
  const { itemId, itemName, unit, price, quantity, roomId, tenantId, customerName, month, note } = req.body;
  if (!itemName || price == null) {
    return res.status(400).json({ error: "itemName and price are required" });
  }
  const qty = quantity == null ? 1 : Number(quantity);
  try {
    const row = await db.createOrder({
      id: uuid(),
      businessId: req.businessId,
      itemId: itemId || null,
      itemName,
      unit: unit || "",
      price: Number(price),
      quantity: qty,
      amount: Math.round(Number(price) * qty),
      roomId: roomId || null,
      tenantId: tenantId || null,
      customerName: customerName || null,
      month: month || null,
      status: "pending",
      note: note || null,
    }, req.actorId);
    res.status(201).json(asOrder(row));
  } catch (err) {
    dbErrorToHttp(res, err);
  }
});

app.put("/api/orders/:id", requireApiKey, requireBusinessId, async (req, res) => {
  const patch = {};
  if (req.body.itemName != null) patch.itemName = req.body.itemName;
  if (req.body.unit != null) patch.unit = req.body.unit;
  if (req.body.roomId !== undefined) patch.roomId = req.body.roomId;
  if (req.body.tenantId !== undefined) patch.tenantId = req.body.tenantId;
  if (req.body.customerName !== undefined) patch.customerName = req.body.customerName;
  if (req.body.month !== undefined) patch.month = req.body.month;
  if (req.body.note !== undefined) patch.note = req.body.note;
  if (req.body.status != null) {
    if (!ORDER_STATUSES.has(req.body.status)) return res.status(400).json({ error: "invalid status" });
    patch.status = req.body.status;
  }
  // price/quantity đổi thì amount phải tính lại cùng lúc, không để lệch nhau.
  if (req.body.price != null || req.body.quantity != null) {
    try {
      const existing = await db.getOrder(req.params.id);
      if (!existing || existing.businessId !== req.businessId) return res.status(404).json({ error: "not found" });
      const nextPrice = req.body.price != null ? Number(req.body.price) : Number(existing.price);
      const nextQty = req.body.quantity != null ? Number(req.body.quantity) : Number(existing.quantity);
      patch.price = nextPrice;
      patch.quantity = nextQty;
      patch.amount = Math.round(nextPrice * nextQty);
    } catch (err) {
      return dbErrorToHttp(res, err);
    }
  }
  try {
    const existing = await db.getOrder(req.params.id);
    if (!existing || existing.businessId !== req.businessId) return res.status(404).json({ error: "not found" });
    const row = await db.updateOrder(req.params.id, patch, req.actorId);
    res.json(asOrder(row));
  } catch (err) {
    dbErrorToHttp(res, err);
  }
});

app.delete("/api/orders/:id", requireApiKey, requireBusinessId, async (req, res) => {
  try {
    const existing = await db.getOrder(req.params.id);
    if (!existing || existing.businessId !== req.businessId) return res.status(404).json({ error: "not found" });
    await db.deleteOrder(req.params.id);
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
