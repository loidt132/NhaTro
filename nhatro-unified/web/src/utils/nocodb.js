const BASE = (import.meta.env.VITE_NOCODB_URL || '').replace(/\/+$/, '');
const TOKEN = import.meta.env.VITE_NOCODB_API_KEY || '';

const TABLES = {
  rooms: import.meta.env.VITE_TABLE_ROOMS,
  tenants: import.meta.env.VITE_TABLE_TENANTS,
  readings: import.meta.env.VITE_TABLE_READINGS,
  invoices: import.meta.env.VITE_TABLE_INVOICES,
  payments: import.meta.env.VITE_TABLE_PAYMENTS,
  settings: import.meta.env.VITE_TABLE_SETTINGS,
};

const DATA_TABLE_KEYS = ['rooms', 'tenants', 'readings', 'invoices', 'payments'];
const SYSTEM_COLUMNS = new Set([
  'Id',
  'ID',
  'created_at',
  'updated_at',
  'CreatedAt',
  'UpdatedAt',
  'ncRecordId',
  'createdBy',
  'updatedBy',
]);
const MAX_RETRIES = 4;
const BASE_RETRY_MS = 800;
const WRITE_GAP_MS = 150;

function headers() {
  return {
    'Content-Type': 'application/json',
    'xc-token': TOKEN,
  };
}

function tableUrl(tableKey, suffix = '') {
  const tableId = TABLES[tableKey];
  if (!tableId) throw new Error(`Missing TABLE_ID for ${tableKey}`);
  return `${BASE}/api/v2/tables/${tableId}/records${suffix}`;
}

function getRowId(row) {
  return row?.Id ?? row?.ID ?? row?.id ?? null;
}

function stripSystemColumns(row = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (SYSTEM_COLUMNS.has(key)) continue;
    clean[key] = value;
  }
  return clean;
}

function extractLegacyState(row) {
  const raw = row?.state ?? row?.value ?? row?.data;
  if (!raw) return null;

  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.error('parse legacy NocoDB state error', error);
      return null;
    }
  }

  return raw;
}

function normalizeSettingsRow(row) {
  if (!row) return {};

  const legacyState = extractLegacyState(row);
  if (legacyState?.settings) return legacyState.settings;
  if (legacyState && !Array.isArray(legacyState)) return legacyState;

  return stripSystemColumns(row);
}

function buildSettingsPayload(existingRow, settings = {}, meta = {}) {
  if (existingRow?.state != null) {
    return { state: JSON.stringify({ settings, __meta: meta }) };
  }
  if (existingRow?.value != null) {
    return { value: JSON.stringify({ settings, __meta: meta }) };
  }
  if (existingRow?.data != null) {
    return { data: JSON.stringify({ settings, __meta: meta }) };
  }
  return { ...settings };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelay(res, attempt) {
  const retryAfter = res.headers.get('Retry-After');
  if (retryAfter) {
    const retrySeconds = Number(retryAfter);
    if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
      return retrySeconds * 1000;
    }
  }

  return BASE_RETRY_MS * (attempt + 1);
}

async function fetchJson(url, options = {}) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const res = await fetch(url, { headers: headers(), ...options });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const waitMs = getRetryDelay(res, attempt);
      console.warn('NocoDB rate limited, retrying:', url, waitMs);
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      console.error('NocoDB request failed:', url, res.status, text);
      throw new Error(`NocoDB request failed: ${res.status}`);
    }

    if (res.status === 204) return null;
    return res.json();
  }

  throw new Error('NocoDB request retry exhausted');
}

async function fetchTableRows(tableKey, query = '') {
  const data = await fetchJson(tableUrl(tableKey, query));
  return data?.list || [];
}

async function createRow(tableKey, payload) {
  await fetchJson(tableUrl(tableKey), {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  await sleep(WRITE_GAP_MS);
}

async function updateRow(tableKey, rowId, payload) {
  await fetchJson(tableUrl(tableKey, `/${rowId}`), {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  await sleep(WRITE_GAP_MS);
}

async function deleteRow(tableKey, rowId) {
  await fetchJson(tableUrl(tableKey, `/${rowId}`), {
    method: 'DELETE',
  });
  await sleep(WRITE_GAP_MS);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isSamePayload(a, b) {
  return stableStringify(a) === stableStringify(b);
}

async function syncCollectionTable(tableKey, records = []) {
  const existingRows = await fetchTableRows(tableKey, '?limit=1000');
  const existingByAppId = new Map();

  existingRows.forEach((row) => {
    const clean = stripSystemColumns(row);
    if (clean?.id) existingByAppId.set(clean.id, { rowId: getRowId(row), data: clean });
  });

  const nextIds = new Set();
  for (const record of records) {
    if (!record?.id) continue;
    nextIds.add(record.id);

    const existing = existingByAppId.get(record.id);
    if (!existing) {
      await createRow(tableKey, record);
      continue;
    }

    if (!isSamePayload(existing.data, record)) {
      await updateRow(tableKey, existing.rowId, record);
    }
  }

  for (const row of existingRows) {
    const clean = stripSystemColumns(row);
    if (!clean?.id) continue;
    if (!nextIds.has(clean.id)) {
      await deleteRow(tableKey, getRowId(row));
    }
  }
}

async function saveSettingsRow(settings = {}, meta = {}) {
  const rows = await fetchTableRows('settings', '?limit=1000');
  const row = rows[0];
  const payload = buildSettingsPayload(row, settings, meta);
  const currentSettings = row ? normalizeSettingsRow(row) : null;
  const isLegacyRow = Boolean(row?.state != null || row?.value != null || row?.data != null);

  if (!row) {
    await createRow('settings', payload);
    return;
  }

  if (!isSamePayload(currentSettings, settings) || isLegacyRow) {
    await updateRow('settings', getRowId(row), payload);
  }

  for (const extraRow of rows.slice(1)) {
    await deleteRow('settings', getRowId(extraRow));
  }
}

export function isNocoConfigured() {
  return Boolean(BASE && TOKEN);
}

export async function loadStateFromNoco() {
  if (!isNocoConfigured()) return null;

  try {
    const settingsRows = await fetchTableRows('settings', '?limit=1000');
    const legacyState = settingsRows.map(extractLegacyState).find(Boolean);
    if (legacyState?.rooms && legacyState?.tenants && legacyState?.payments) {
      return legacyState;
    }

    const tableData = {};
    for (const key of DATA_TABLE_KEYS) {
      tableData[key] = await fetchTableRows(key, '?limit=1000');
      await sleep(WRITE_GAP_MS);
    }

    const settings = normalizeSettingsRow(settingsRows[0]);
    const meta = settings.__meta || legacyState?.__meta || { lastModified: new Date().toISOString() };
    const cleanSettings = { ...settings };
    delete cleanSettings.__meta;

    return {
      rooms: tableData.rooms.map(stripSystemColumns),
      tenants: tableData.tenants.map(stripSystemColumns),
      readings: tableData.readings.map(stripSystemColumns),
      invoices: tableData.invoices.map(stripSystemColumns),
      payments: tableData.payments.map(stripSystemColumns),
      settings: cleanSettings,
      __meta: meta,
    };
  } catch (error) {
    console.error('loadStateFromNoco error', error);
    return null;
  }
}

export async function saveStateToNoco(state) {
  if (!isNocoConfigured()) return false;

  try {
    for (const key of DATA_TABLE_KEYS) {
      await syncCollectionTable(key, state[key] || []);
    }
    await saveSettingsRow(state.settings || {}, state.__meta || {});
    return true;
  } catch (error) {
    console.error('saveStateToNoco error', error);
    return false;
  }
}

export const api = {
  getRooms: () => fetchTableRows('rooms', '?limit=1000'),
  getTenants: () => fetchTableRows('tenants', '?limit=1000'),
  getReadings: () => fetchTableRows('readings', '?limit=1000'),
  getInvoices: () => fetchTableRows('invoices', '?limit=1000'),
  getPayments: () => fetchTableRows('payments', '?limit=1000'),
  getSettings: () => fetchTableRows('settings', '?limit=1000'),
};
