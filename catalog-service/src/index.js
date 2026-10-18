import express from "express";
import cors from "cors";
import { v4 as uuid } from "uuid";
import { listRows, findOneByBusinessId, createRow, updateRowByBusinessId, deleteRowByBusinessId } from "./nocodb.js";

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

function requireApiKey(req, res, next) {
  if (req.headers["x-api-key"] !== ADMIN_KEY) {
    return res.status(401).json({ error: "Thiếu hoặc sai API key cho thao tác ghi." });
  }
  next();
}

// Strip NocoDB's own system columns (Id, CreatedAt, ...) so responses only
// carry the business fields the frontend/homestay-server already expect.
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

function nocoErrorToHttp(res, err) {
  console.error(err);
  res.status(502).json({ error: `NocoDB: ${err.message}` });
}

app.get("/api/categories", async (req, res) => {
  try {
    const rows = await listRows("categories");
    res.json(rows.map(asCategory));
  } catch (err) {
    nocoErrorToHttp(res, err);
  }
});

app.post("/api/categories", requireApiKey, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  try {
    const row = await createRow("categories", { id: uuid(), name });
    res.status(201).json(asCategory(row));
  } catch (err) {
    nocoErrorToHttp(res, err);
  }
});

app.put("/api/categories/:id", requireApiKey, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  try {
    const row = await updateRowByBusinessId("categories", req.params.id, { name });
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(asCategory(row));
  } catch (err) {
    nocoErrorToHttp(res, err);
  }
});

app.delete("/api/categories/:id", requireApiKey, async (req, res) => {
  try {
    const category = await findOneByBusinessId("categories", req.params.id);
    if (!category) return res.status(404).json({ error: "not found" });
    const itemsInCategory = await listRows("items", { where: `(categoryId,eq,${category.id})`, limit: 1 });
    if (itemsInCategory.length > 0) {
      return res.status(409).json({ error: "Danh mục đang có dịch vụ — hãy chuyển/xoá dịch vụ trong danh mục này trước." });
    }
    await deleteRowByBusinessId("categories", req.params.id);
    res.status(204).end();
  } catch (err) {
    nocoErrorToHttp(res, err);
  }
});

// `kind` tells "service" (ăn uống, giặt là...) apart from "surcharge" (phụ
// thu) items in the same catalog — one backend/admin page for both instead
// of a second near-identical service.
app.get("/api/items", async (req, res) => {
  try {
    const { categoryId, kind } = req.query;
    const clauses = [];
    if (categoryId) clauses.push(`(categoryId,eq,${categoryId})`);
    if (kind) clauses.push(`(kind,eq,${kind})`);
    const where = clauses.length ? clauses.join("~and") : undefined;
    const rows = await listRows("items", { where });
    res.json(rows.map(asItem));
  } catch (err) {
    nocoErrorToHttp(res, err);
  }
});

app.get("/api/items/:id", async (req, res) => {
  try {
    const row = await findOneByBusinessId("items", req.params.id);
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(asItem(row));
  } catch (err) {
    nocoErrorToHttp(res, err);
  }
});

app.post("/api/items", requireApiKey, async (req, res) => {
  const { categoryId, name, unit, price, kind } = req.body;
  if (!name || price == null) {
    return res.status(400).json({ error: "name and price are required" });
  }
  const itemKind = kind === "surcharge" ? "surcharge" : "service";
  if (itemKind === "service" && !categoryId) {
    return res.status(400).json({ error: "categoryId is required for service items" });
  }
  try {
    const row = await createRow("items", {
      id: uuid(),
      categoryId: categoryId || null,
      name,
      unit: unit || "",
      price: Number(price),
      kind: itemKind,
    });
    res.status(201).json(asItem(row));
  } catch (err) {
    nocoErrorToHttp(res, err);
  }
});

app.put("/api/items/:id", requireApiKey, async (req, res) => {
  const patch = {};
  if (req.body.name != null) patch.name = req.body.name;
  if (req.body.unit != null) patch.unit = req.body.unit;
  if (req.body.price != null) patch.price = Number(req.body.price);
  if (req.body.categoryId !== undefined) patch.categoryId = req.body.categoryId;
  if (req.body.kind != null) patch.kind = req.body.kind === "surcharge" ? "surcharge" : "service";
  try {
    const row = await updateRowByBusinessId("items", req.params.id, patch);
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(asItem(row));
  } catch (err) {
    nocoErrorToHttp(res, err);
  }
});

app.delete("/api/items/:id", requireApiKey, async (req, res) => {
  try {
    const ok = await deleteRowByBusinessId("items", req.params.id);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  } catch (err) {
    nocoErrorToHttp(res, err);
  }
});

app.listen(PORT, () => {
  console.log(`[catalog-service] listening on http://localhost:${PORT}`);
  console.log(`[catalog-service] storage = NocoDB (${process.env.NOCODB_URL || "NOT CONFIGURED"})`);
});
