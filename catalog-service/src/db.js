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

export const listCategories = (homestayId) =>
  query(`SELECT * FROM categories WHERE "homestayId" = $1 ORDER BY created_at, id`, [homestayId]);

export async function getCategory(id) {
  return (await query(`SELECT * FROM categories WHERE id = $1`, [id]))[0] || null;
}

export async function createCategory({ id, homestayId, name }) {
  return (await query(
    `INSERT INTO categories (id, "homestayId", name) VALUES ($1,$2,$3) RETURNING *`,
    [id, homestayId, name]
  ))[0];
}

export async function updateCategory(id, name) {
  return (await query(
    `UPDATE categories SET name = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, name]
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

export function listItems(homestayId, { categoryId, kind } = {}) {
  const params = [homestayId];
  let sql = `${ITEM_SELECT} WHERE i."homestayId" = $1`;
  if (categoryId) { params.push(categoryId); sql += ` AND i."categoryId" = $${params.length}`; }
  if (kind) { params.push(kind); sql += ` AND i.kind = $${params.length}`; }
  return query(`${sql} ORDER BY i.created_at, i.id`, params);
}

export async function getItem(id) {
  return (await query(`${ITEM_SELECT} WHERE i.id = $1`, [id]))[0] || null;
}

export async function createItem({ id, homestayId, categoryId, name, unit, price, kind }) {
  await query(
    `INSERT INTO items (id, "homestayId", "categoryId", name, unit, price, kind)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, homestayId, categoryId, name, unit, price, kind]
  );
  return getItem(id);
}

const ITEM_PATCH_COLUMNS = { name: "name", unit: "unit", price: "price", categoryId: '"categoryId"', kind: "kind" };

export async function updateItem(id, patch) {
  const sets = [];
  const params = [id];
  for (const [key, col] of Object.entries(ITEM_PATCH_COLUMNS)) {
    if (patch[key] === undefined) continue;
    params.push(patch[key]);
    sets.push(`${col} = $${params.length}`);
  }
  if (!sets.length) return getItem(id);
  await query(`UPDATE items SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
  return getItem(id);
}

export async function deleteItem(id) {
  await query(`DELETE FROM items WHERE id = $1`, [id]);
}
