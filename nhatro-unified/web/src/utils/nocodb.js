import { getAuthSession } from './auth';

const BASE = (import.meta.env.VITE_NOCODB_URL || '').replace(/\/+$/, '');
const TOKEN = import.meta.env.VITE_NOCODB_API_KEY || '';
const CREATED_BY_FIELD = 'created_by';
const MODIFIED_BY_FIELD = 'modified_by';

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
  'createdBy',
  'updatedBy',
  'ncRecordId',
  CREATED_BY_FIELD,
  MODIFIED_BY_FIELD,
]);
const MAX_RETRIES = 4;
const BASE_RETRY_MS = 800;
const WRITE_GAP_MS = 150;
const WARNED_MISSING_TABLES = new Set();

function headers() {
  return {
    'Content-Type': 'application/json',
    'xc-token': TOKEN,
  };
}

function tableUrl(tableKey, suffix = '') {
  const tableId = TABLES[tableKey];
  if (!tableId) throw new Error(`Missing TABLE_ID for ${tableKey}`);
  return `${BASE}/api/v2/tables/${encodeURIComponent(tableId)}/records${suffix}`;
}

function hasTableConfig(tableKey) {
  return Boolean(TABLES[tableKey]);
}

function warnMissingTable(tableKey) {
  if (WARNED_MISSING_TABLES.has(tableKey)) return;
  WARNED_MISSING_TABLES.add(tableKey);
  console.warn(`NocoDB table is not configured: ${tableKey}`);
}

function currentUserId() {
  return getAuthSession().userId || '';
}

function buildOwnedQuery(userId, extra = '') {
  const owned = `where=${encodeURIComponent(`(${CREATED_BY_FIELD},eq,${userId})`)}`;
  const suffix = extra ? `&${extra.replace(/^\?/, '').replace(/^&/, '')}` : '';
  return `?${owned}${suffix ? suffix : ''}`;
}

function getRowId(row) {
  const candidate = row?.Id ?? row?.ID ?? null;
  if (candidate === null || candidate === undefined || candidate === '') return null;
  return candidate;
}

function stripSystemColumns(row = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (SYSTEM_COLUMNS.has(key)) continue;
    clean[key] = value;
  }
  return clean;
}

function sanitizeWritablePayload(payload = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (SYSTEM_COLUMNS.has(key)) continue;
    if (key === 'status') {
      if (value === 'Còn nợ') clean[key] = 'Chưa thanh toán';
      else clean[key] = value;
      continue;
    }
    clean[key] = value;
  }
  return clean;
}

function sanitizeUpdatePayload(payload = {}) {
  const clean = sanitizeWritablePayload(payload);
  delete clean.id;
  return clean;
}

function withOwnership(record, userId, isUpdate = false) {
  return {
    ...sanitizeWritablePayload(record),
    ...(isUpdate ? {} : { [CREATED_BY_FIELD]: userId }),
    [MODIFIED_BY_FIELD]: userId,
  };
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

function buildSettingsPayload(existingRow, settings = {}, meta = {}, userId) {
  const baseId = existingRow?.id || `settings:${userId}`;
  if (existingRow?.state != null) {
    return withOwnership({ id: baseId, state: JSON.stringify({ settings, __meta: meta }) }, userId, Boolean(existingRow));
  }
  if (existingRow?.value != null) {
    return withOwnership({ id: baseId, value: JSON.stringify({ settings, __meta: meta }) }, userId, Boolean(existingRow));
  }
  if (existingRow?.data != null) {
    return withOwnership({ id: baseId, data: JSON.stringify({ settings, __meta: meta }) }, userId, Boolean(existingRow));
  }
  return withOwnership({ id: baseId, ...settings }, userId, Boolean(existingRow));
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

async function fetchJsonWithStatus(url, options = {}) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const res = await fetch(url, { headers: headers(), ...options });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const waitMs = getRetryDelay(res, attempt);
      console.warn('NocoDB rate limited, retrying:', url, waitMs);
      await sleep(waitMs);
      continue;
    }

    const contentType = res.headers.get('content-type') || '';
    const data = res.status === 204
      ? null
      : contentType.includes('application/json')
        ? await res.json()
        : await res.text();

    return { ok: res.ok, status: res.status, data };
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
  if (rowId === null || rowId === undefined || rowId === '') {
    throw new Error(`Missing NocoDB row Id for ${tableKey}. Enable the system "Id" column in the API response before updating existing rows.`);
  }

  const fields = sanitizeUpdatePayload(payload);
  const bulkPayload = Array.isArray(payload)
    ? payload.map((item) => ({ ...sanitizeUpdatePayload(item), Id: rowId }))
    : [{ ...fields, Id: rowId }];

  const bulk = await fetchJsonWithStatus(tableUrl(tableKey), {
    method: 'PATCH',
    body: JSON.stringify(bulkPayload),
  });
  if (!bulk.ok) {
    console.error('NocoDB bulk update failed:', tableUrl(tableKey), bulk.status, bulk.data);
    throw new Error(`NocoDB request failed: ${bulk.status}`);
  }

  await sleep(WRITE_GAP_MS);
}

async function deleteRow(tableKey, rowId) {
  await fetchJson(tableUrl(tableKey, `?ids=${rowId}`), {
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

async function syncCollectionTable(tableKey, records = [], userId) {
  const existingRows = await fetchTableRows(tableKey, buildOwnedQuery(userId, 'limit=1000'));
  const existingByAppId = new Map();

  existingRows.forEach((row) => {
    const clean = stripSystemColumns(row);
    if (clean?.id) {
      existingByAppId.set(clean.id, {
        rowId: getRowId(row),
        data: clean,
      });
    }
  });

  const nextIds = new Set();
  for (const record of records) {
    if (!record?.id) continue;
    nextIds.add(record.id);

    const existing = existingByAppId.get(record.id);
    const ownedRecord = withOwnership(record, userId, Boolean(existing));
    if (!existing) {
      await createRow(tableKey, ownedRecord);
      continue;
    }

    if (!isSamePayload(existing.data, record)) {
      await updateRow(tableKey, existing.rowId, ownedRecord);
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

async function saveSettingsRow(settings = {}, meta = {}, userId) {
  const rows = await fetchTableRows('settings', buildOwnedQuery(userId, 'limit=1000'));
  const row = rows[0];
  const payload = buildSettingsPayload(row, settings, meta, userId);
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

export async function loadStateFromNoco(options = {}) {
  const { tables = null } = options;
  if (!isNocoConfigured()) return null;

  const userId = currentUserId();
  if (!userId) return null;

  try {
    const wantedTables = tables && tables.length ? tables : [...DATA_TABLE_KEYS, 'settings'];
    let settingsRows = [];
    if (wantedTables.includes('settings')) {
      if (hasTableConfig('settings')) {
        try {
          settingsRows = await fetchTableRows('settings', buildOwnedQuery(userId, 'limit=1000'));
        } catch (error) {
          console.error('load settings from NocoDB failed', error);
        }
      } else {
        warnMissingTable('settings');
      }
    }
    const legacyState = settingsRows.map(extractLegacyState).find(Boolean);
    if (legacyState?.rooms && legacyState?.tenants && legacyState?.payments) {
      if (!tables || tables.length === 0) return legacyState;
      const partial = {};
      tables.forEach((table) => {
        partial[table] = legacyState[table];
      });
      partial.__meta = legacyState.__meta;
      return partial;
    }

    const tableData = {};
    for (const key of DATA_TABLE_KEYS.filter((table) => wantedTables.includes(table))) {
      if (!hasTableConfig(key)) {
        warnMissingTable(key);
        tableData[key] = [];
        continue;
      }
      try {
        tableData[key] = await fetchTableRows(key, buildOwnedQuery(userId, 'limit=1000'));
      } catch (error) {
        console.error(`load ${key} from NocoDB failed`, error);
        tableData[key] = [];
      }
      await sleep(WRITE_GAP_MS);
    }

    const settings = normalizeSettingsRow(settingsRows[0]);
    const meta = settings.__meta || legacyState?.__meta || { lastModified: new Date().toISOString() };
    const cleanSettings = { ...settings };
    delete cleanSettings.__meta;

    const result = { __meta: meta };
    for (const table of wantedTables) {
      if (table === 'settings') {
        result.settings = cleanSettings;
        continue;
      }
      result[table] = (tableData[table] || []).map(stripSystemColumns);
    }
    return result;
  } catch (error) {
    console.error('loadStateFromNoco error', error);
    return null;
  }
}

export async function saveStateToNoco(state) {
  if (!isNocoConfigured()) return false;

  const userId = currentUserId();
  if (!userId) return false;

  try {
    for (const key of DATA_TABLE_KEYS) {
      if (!hasTableConfig(key)) {
        warnMissingTable(key);
        continue;
      }
      await syncCollectionTable(key, state[key] || [], userId);
    }
    if (hasTableConfig('settings')) {
      await saveSettingsRow(state.settings || {}, state.__meta || {}, userId);
    } else {
      warnMissingTable('settings');
    }
    return true;
  } catch (error) {
    console.error('saveStateToNoco error', error);
    return false;
  }
}

export const api = {
  getRooms: () => hasTableConfig('rooms') ? fetchTableRows('rooms', buildOwnedQuery(currentUserId(), 'limit=1000')) : Promise.resolve([]),
  getTenants: () => hasTableConfig('tenants') ? fetchTableRows('tenants', buildOwnedQuery(currentUserId(), 'limit=1000')) : Promise.resolve([]),
  getReadings: () => hasTableConfig('readings') ? fetchTableRows('readings', buildOwnedQuery(currentUserId(), 'limit=1000')) : Promise.resolve([]),
  getInvoices: () => hasTableConfig('invoices') ? fetchTableRows('invoices', buildOwnedQuery(currentUserId(), 'limit=1000')) : Promise.resolve([]),
  getPayments: () => hasTableConfig('payments') ? fetchTableRows('payments', buildOwnedQuery(currentUserId(), 'limit=1000')) : Promise.resolve([]),
  getSettings: () => hasTableConfig('settings') ? fetchTableRows('settings', buildOwnedQuery(currentUserId(), 'limit=1000')) : Promise.resolve([]),
};

export function getNocoConfigStatus() {
  const missing = Object.entries(TABLES)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  return {
    baseConfigured: Boolean(BASE),
    tokenConfigured: Boolean(TOKEN),
    missingTables: missing,
    ready: Boolean(BASE && TOKEN),
  };
}
