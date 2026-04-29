const BASE_URL = import.meta.env.VITE_NOCODB_URL?.replace(/\/+$/, '');
const API_TOKEN = import.meta.env.VITE_NOCODB_TOKEN;

// ===== CONFIG =====
const DEFAULT_LIMIT = 1000;
const CREATED_BY_FIELD = 'created_by';

// ===== CORE FETCH =====
async function fetchJson(url, options = {}) {
  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'xc-token': API_TOKEN,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NocoDB ${res.status}: ${text}`);
  }

  return res.status === 204 ? null : res.json();
}

// ===== WHERE BUILDER =====
function buildWhere(userId, where = '', extra = '') {
  const base = userId ? `(${CREATED_BY_FIELD},eq,${userId})` : '';

  let extraWhere = '';
  let otherParams = '';

  if (extra) {
    const cleaned = extra.replace(/^\?/, '').replace(/^&/, '');
    const params = new URLSearchParams(cleaned);

    if (params.has('where')) {
      extraWhere = decodeURIComponent(params.get('where'));
      params.delete('where');
    }

    otherParams = params.toString();
  }

  let combined = base;

  if (where) combined += base ? `~and${where}` : where;
  if (extraWhere) combined += combined ? `~and${extraWhere}` : extraWhere;

  const whereQuery = combined
    ? `where=${encodeURIComponent(combined)}`
    : '';

  return `?${whereQuery}${otherParams ? `&${otherParams}` : ''}`;
}

// ===== CRUD =====

// GET list
export async function getList(tableId, { userId, where, extra, limit = DEFAULT_LIMIT } = {}) {
  const query = buildWhere(userId, where, extra);
  const url = `/api/v2/tables/${tableId}/records${query}${query ? '&' : '?'}limit=${limit}`;
  return fetchJson(url);
}

// GET by id
export async function getById(tableId, id) {
  return fetchJson(`/api/v2/tables/${tableId}/records/${id}`);
}

// CREATE 1
export async function createOne(tableId, data) {
  return fetchJson(`/api/v2/tables/${tableId}/records`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// CREATE MANY
export async function createMany(tableId, records) {
  return fetchJson(`/api/v2/tables/${tableId}/records`, {
    method: 'POST',
    body: JSON.stringify({ records }),
  });
}

// UPDATE 1
export async function updateOne(tableId, id, data) {
  return fetchJson(`/api/v2/tables/${tableId}/records/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// BULK UPDATE
export async function updateMany(tableId, records) {
  return fetchJson(`/api/v2/tables/${tableId}/records`, {
    method: 'PATCH',
    body: JSON.stringify({
      records: records.map(r => ({
        id: r.id, // 👈 bắt buộc lowercase
        ...r,
      })),
    }),
  });
}

// DELETE 1 (hard delete)
export async function deleteOne(tableId, id) {
  return fetchJson(`/api/v2/tables/${tableId}/records/${id}`, {
    method: 'DELETE',
  });
}

// DELETE MANY
export async function deleteMany(tableId, ids) {
  const query = `?ids=${ids.join(',')}`;
  return fetchJson(`/api/v2/tables/${tableId}/records${query}`, {
    method: 'DELETE',
  });
}

// SOFT DELETE (chuẩn bạn đang dùng)
export async function softDelete(tableId, id) {
  return updateOne(tableId, id, { isDeleted: true });
}

// RESTORE
export async function restore(tableId, id) {
  return updateOne(tableId, id, { isDeleted: false });
}