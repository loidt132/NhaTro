// Dịch vụ/phụ thu (giặt là, nước uống...) — proxied qua server của chính app
// này tới catalog-service (xem nhatro-unified/server/index.js). Browser
// không bao giờ gọi thẳng catalog-service.
import { getStoredToken } from './auth';

function resolveApiBase() {
  return (import.meta.env.VITE_API_ORIGIN || '').replace(/\/+$/, '');
}

function apiUrl(path) {
  const base = resolveApiBase();
  const p = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

async function request(path, options = {}) {
  const token = getStoredToken();
  const res = await fetch(apiUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (res.status === 204) return null;
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : null;

  if (!res.ok) {
    throw new Error(data?.error || 'Yêu cầu thất bại');
  }

  return data;
}

function toQuery(params = {}) {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') usp.set(key, value);
  });
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

export const listCategories = () => request('/api/catalog/categories');
export const createCategory = (payload) => request('/api/admin/catalog/categories', { method: 'POST', body: JSON.stringify(payload) });
export const updateCategory = (id, payload) => request(`/api/admin/catalog/categories/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
export const deleteCategory = (id) => request(`/api/admin/catalog/categories/${id}`, { method: 'DELETE' });

export const listItems = (params) => request(`/api/catalog/items${toQuery(params)}`);
export const createItem = (payload) => request('/api/admin/catalog/items', { method: 'POST', body: JSON.stringify(payload) });
export const updateItem = (id, payload) => request(`/api/admin/catalog/items/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
export const deleteItem = (id) => request(`/api/admin/catalog/items/${id}`, { method: 'DELETE' });

export const listOrders = (params) => request(`/api/catalog/orders${toQuery(params)}`);
export const createOrder = (payload) => request('/api/admin/catalog/orders', { method: 'POST', body: JSON.stringify(payload) });
export const updateOrder = (id, payload) => request(`/api/admin/catalog/orders/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
export const deleteOrder = (id) => request(`/api/admin/catalog/orders/${id}`, { method: 'DELETE' });
