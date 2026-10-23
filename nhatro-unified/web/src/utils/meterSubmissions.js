import { getStoredToken } from './auth';

function apiBase() {
  return (import.meta.env.VITE_API_ORIGIN || '').replace(/\/+$/, '');
}

async function request(path, options = {}) {
  const res = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getStoredToken()}`,
      ...(options.headers || {}),
    },
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : null;

  if (!res.ok) {
    throw new Error(data?.error || 'Không thể kết nối tới server.');
  }

  return data;
}

// Meter-submission review queue (tenant uploads a photo, landlord confirms
// or rejects it) — proxied through the backend; the browser never
// talks to the database.
export async function listMeterSubmissions(status = '') {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const data = await request(`/api/meter-submissions${query}`);
  return data?.submissions || [];
}

export async function createMeterSubmission(payload) {
  const data = await request('/api/meter-submissions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return data?.id;
}

export async function reviewMeterSubmission(id, action, finalValue) {
  await request(`/api/meter-submissions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ action, finalValue }),
  });
}

// Tenant's own landlord's room list (to show which room they're linked to) —
// also proxied through the backend.
export async function fetchOwnedRooms(ownerUserId) {
  const data = await request(`/api/rooms?ownerUserId=${encodeURIComponent(ownerUserId)}`);
  return data?.rooms || [];
}
