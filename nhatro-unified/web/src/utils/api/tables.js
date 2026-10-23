// Per-table REST client for the 9 tables that used to only sync in bulk
// through /api/state (utils/state.js). Mirrors the request()/toQuery() shape
// already used by utils/catalog.js for the service-catalog proxy.
import { getStoredToken } from '../auth';
import { getAdminViewUserId } from '../state';

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

// stateStore collection key -> URL segment (kebab-case for multi-word keys),
// matching server/tableRoutes.js.
const ROUTE_SEGMENTS = {
  rooms: 'rooms',
  tenants: 'tenants',
  readings: 'readings',
  invoices: 'invoices',
  payments: 'payments',
  rentPeriods: 'rent-periods',
  paymentAllocations: 'payment-allocations',
  deposits: 'deposits',
  depositTransactions: 'deposit-transactions',
};

// Callers already apply a mutation's result to their own local state (no
// need to re-fetch their own table). The one cross-page consumer is the
// header's room counter (App.jsx), which is always mounted — so only room
// mutations announce themselves, on this dedicated, narrow event. Anything
// broader (e.g. re-dispatching the bulk-sync 'boarding_state_updated' event
// for every table) just causes every mounted page to re-fetch everything on
// every unrelated write; don't do that.
function notifyRoomsChanged() {
  if (typeof window !== 'undefined' && window.dispatchEvent) {
    try { window.dispatchEvent(new Event('rooms_table_changed')); } catch (e) { /* ignore */ }
  }
}

function makeTableApi(key) {
  const segment = ROUTE_SEGMENTS[key];
  const notify = key === 'rooms' ? notifyRoomsChanged : () => {};
  return {
    async list() {
      const adminViewUserId = getAdminViewUserId();
      const path = adminViewUserId
        ? `/api/admin/users/${encodeURIComponent(adminViewUserId)}/${segment}`
        : `/api/${segment}`;
      const data = await request(path);
      return data?.list || [];
    },
    async create(payload) {
      const data = await request(`/api/${segment}`, { method: 'POST', body: JSON.stringify(payload) });
      notify();
      return data?.item || null;
    },
    async update(id, payload) {
      const data = await request(`/api/${segment}/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
      notify();
      return data?.item || null;
    },
    async remove(id) {
      await request(`/api/${segment}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      notify();
      return true;
    },
  };
}

export const roomsApi = makeTableApi('rooms');
export const tenantsApi = makeTableApi('tenants');
export const readingsApi = makeTableApi('readings');
export const invoicesApi = makeTableApi('invoices');
export const paymentsApi = makeTableApi('payments');
export const rentPeriodsApi = makeTableApi('rentPeriods');
export const paymentAllocationsApi = makeTableApi('paymentAllocations');
export const depositsApi = makeTableApi('deposits');
export const depositTransactionsApi = makeTableApi('depositTransactions');
