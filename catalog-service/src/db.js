import pg from "pg";

// Postgres client (Neon / Supabase / any). One small pool per serverless
// instance; DATABASE_URL should be the *pooled* connection string on Vercel.
let pool = null;
function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Postgres chưa cấu hình — cần DATABASE_URL trong .env");
  }
  pool = new pg.Pool({
    connectionString,
    max: 3,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 10000,
    statement_timeout: 8000,
  });
  return pool;
}

export async function query(text, params = []) {
  const { rows } = await getPool().query(text, params);
  return rows;
}

export async function ping() {
  await query("SELECT 1");
}

export const listCategories = (businessId) =>
  query(`SELECT * FROM categories WHERE "businessId" = $1 ORDER BY created_at, id`, [businessId]);

export async function getCategory(id) {
  return (await query(`SELECT * FROM categories WHERE id = $1`, [id]))[0] || null;
}

// Audit columns are always passed explicitly: created_by/created_at and
// updated_by/updated_at on insert, updated_by/updated_at on update (created_*
// never change). `actor` is the user id the calling app forwards ("system" if none).
const nowIso = () => new Date().toISOString();

export async function createCategory({ id, businessId, name }, actor = "system") {
  const now = nowIso();
  return (await query(
    `INSERT INTO categories (id, "businessId", name, created_by, updated_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$4,$5,$5) RETURNING *`,
    [id, businessId, name, actor, now]
  ))[0];
}

export async function updateCategory(id, name, actor = "system") {
  return (await query(
    `UPDATE categories SET name = $2, updated_by = $3, updated_at = $4 WHERE id = $1 RETURNING *`,
    [id, name, actor, nowIso()]
  ))[0] || null;
}

export async function deleteCategory(id) {
  await query(`DELETE FROM categories WHERE id = $1`, [id]);
}

export async function countItemsInCategory(categoryId) {
  const rows = await query(`SELECT count(*)::int AS n FROM items WHERE "categoryId" = $1`, [categoryId]);
  return rows[0].n;
}

// Items come back with their category's name joined in ("categoryName"), so
// callers don't need a second request to /api/categories. Surcharges have no
// category, hence LEFT JOIN and a NULL name.
const ITEM_SELECT = `SELECT i.*, c.name AS "categoryName"
  FROM items i LEFT JOIN categories c ON c.id = i."categoryId"`;

export function listItems(businessId, { categoryId, kind } = {}) {
  const params = [businessId];
  let sql = `${ITEM_SELECT} WHERE i."businessId" = $1`;
  if (categoryId) { params.push(categoryId); sql += ` AND i."categoryId" = $${params.length}`; }
  if (kind) { params.push(kind); sql += ` AND i.kind = $${params.length}`; }
  return query(`${sql} ORDER BY i.created_at, i.id`, params);
}

export async function getItem(id) {
  return (await query(`${ITEM_SELECT} WHERE i.id = $1`, [id]))[0] || null;
}

export async function createItem({ id, businessId, categoryId, name, unit, price, kind }, actor = "system") {
  const now = nowIso();
  await query(
    `INSERT INTO items (id, "businessId", "categoryId", name, unit, price, kind, created_by, updated_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$9)`,
    [id, businessId, categoryId, name, unit, price, kind, actor, now]
  );
  return getItem(id);
}

const ITEM_PATCH_COLUMNS = { name: "name", unit: "unit", price: "price", categoryId: '"categoryId"', kind: "kind" };

export async function updateItem(id, patch, actor = "system") {
  const sets = [];
  const params = [id];
  for (const [key, col] of Object.entries(ITEM_PATCH_COLUMNS)) {
    if (patch[key] === undefined) continue;
    params.push(patch[key]);
    sets.push(`${col} = $${params.length}`);
  }
  if (!sets.length) return getItem(id);
  params.push(actor, nowIso());
  sets.push(`updated_by = $${params.length - 1}`, `updated_at = $${params.length}`);
  await query(`UPDATE items SET ${sets.join(", ")} WHERE id = $1`, params);
  return getItem(id);
}

export async function deleteItem(id) {
  await query(`DELETE FROM items WHERE id = $1`, [id]);
}

export function listOrders(businessId, { roomId, month, status } = {}) {
  const params = [businessId];
  let sql = `SELECT * FROM orders WHERE "businessId" = $1`;
  if (roomId) { params.push(roomId); sql += ` AND "roomId" = $${params.length}`; }
  if (month) { params.push(month); sql += ` AND "month" = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  return query(`${sql} ORDER BY created_at, id`, params);
}

export async function getOrder(id) {
  return (await query(`SELECT * FROM orders WHERE id = $1`, [id]))[0] || null;
}

export async function createOrder({ id, businessId, itemId, itemName, unit, price, quantity, amount, roomId, tenantId, customerName, month, status, note }, actor = "system") {
  const now = nowIso();
  await query(
    `INSERT INTO orders (id, "businessId", "itemId", "itemName", unit, price, quantity, amount, "roomId", "tenantId", "customerName", "month", status, note, "orderedAt", created_by, updated_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16,$15,$15)`,
    [id, businessId, itemId || null, itemName, unit || "", price, quantity, amount, roomId || null, tenantId || null, customerName || null, month || null, status || "pending", note || null, now, actor]
  );
  return getOrder(id);
}

const ORDER_PATCH_COLUMNS = {
  itemName: '"itemName"', unit: "unit", price: "price", quantity: "quantity", amount: "amount",
  roomId: '"roomId"', tenantId: '"tenantId"', customerName: '"customerName"', month: '"month"', status: "status", note: "note",
};

export async function updateOrder(id, patch, actor = "system") {
  const sets = [];
  const params = [id];
  for (const [key, col] of Object.entries(ORDER_PATCH_COLUMNS)) {
    if (patch[key] === undefined) continue;
    params.push(patch[key]);
    sets.push(`${col} = $${params.length}`);
  }
  // Trạng thái chuyển sang "done" thì mốc completedAt được chốt ở đây — không
  // để caller tự gửi completedAt, tránh mỗi FE tính giờ khác nhau.
  if (patch.status === "done") {
    sets.push(`"completedAt" = now()`);
  } else if (patch.status !== undefined) {
    sets.push(`"completedAt" = NULL`);
  }
  if (!sets.length) return getOrder(id);
  params.push(actor, nowIso());
  sets.push(`updated_by = $${params.length - 1}`, `updated_at = $${params.length}`);
  await query(`UPDATE orders SET ${sets.join(", ")} WHERE id = $1`, params);
  return getOrder(id);
}

export async function deleteOrder(id) {
  await query(`DELETE FROM orders WHERE id = $1`, [id]);
}
