const NOCODB_URL = import.meta.env.VITE_NOCODB_URL || '';
const NOCODB_PROJECT = import.meta.env.VITE_NOCODB_PROJECT || '';
const NOCODB_API_KEY = import.meta.env.VITE_NOCODB_API_KEY || '';
const TABLE_NAME = 'app_state';

function nocodbHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (NOCODB_API_KEY) headers['xc-token'] = NOCODB_API_KEY;
  return headers;
}

export function isNocoConfigured() {
  return Boolean(NOCODB_URL && NOCODB_PROJECT);
}

async function fetchNoco(path, opts = {}) {
  const base = NOCODB_URL.replace(/\/+$/, '');
  const fullUrl = `${base}/api/v1/db/data/v1/${NOCODB_PROJECT}/${path}`;
  const r = await fetch(fullUrl, { ...opts, headers: { ...nocodbHeaders(), ...(opts.headers||{}) } });
  if (!r.ok) throw new Error('nocodb-fetch-fail');
  return r.json();
}

export async function getNocoAppStateRow() {
  if (!isNocoConfigured()) return null;
  const result = await fetchNoco(`${TABLE_NAME}?limit=1`);
  if (!result || !Array.isArray(result.data) || result.data.length === 0) return null;
  return result.data[0];
}

export async function loadStateFromNoco() {
  if (!isNocoConfigured()) return null;
  const row = await getNocoAppStateRow();
  if (!row || !row.state) return null;
  try {
    return JSON.parse(row.state);
  } catch (e) {
    return null;
  }
}

export async function saveStateToNoco(state) {
  if (!isNocoConfigured()) return null;
  const row = await getNocoAppStateRow();
  const payload = { state: JSON.stringify(state) };
  if (row && row.id != null) {
    await fetchNoco(`${TABLE_NAME}/${row.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  } else {
    await fetchNoco(`${TABLE_NAME}`, { method: 'POST', body: JSON.stringify(payload) });
  }
  return true;
}
