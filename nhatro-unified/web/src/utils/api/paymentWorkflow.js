// Composite, transactional endpoints (server/paymentWorkflowRoutes.js) for
// the Payments.jsx actions that write more than one table in a single user
// action. Same request()/apiUrl() shape as utils/api/tables.js.
import { getStoredToken } from '../auth';

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

export const receiveAdvancePayment = (payload) =>
  request('/api/payments/advance', { method: 'POST', body: JSON.stringify(payload) });

export const receiveDeposit = (payload) =>
  request('/api/deposits/receive', { method: 'POST', body: JSON.stringify(payload) });

export const refundDeposit = (roomId, payload) =>
  request(`/api/deposits/${encodeURIComponent(roomId)}/refund`, { method: 'POST', body: JSON.stringify(payload) });

export const toggleInvoicePaid = (invoiceId) =>
  request(`/api/invoices/${encodeURIComponent(invoiceId)}/toggle-paid`, { method: 'PUT' });

export const createInvoiceFromReading = (payload) =>
  request('/api/invoices/from-reading', { method: 'POST', body: JSON.stringify(payload) });

export const updateInvoiceFromReading = (invoiceId, payload) =>
  request(`/api/invoices/${encodeURIComponent(invoiceId)}/from-reading`, { method: 'PUT', body: JSON.stringify(payload) });
