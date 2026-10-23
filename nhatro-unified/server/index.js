const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { createWorker } = require('tesseract.js');
const stateStore = require('./stateStore');
const { registerTableRoutes } = require('./tableRoutes');
const { registerPaymentWorkflowRoutes } = require('./paymentWorkflowRoutes');
const db = require('./db');
const { decryptRow, decryptField, encryptField } = require('./cryptoFields');
const getDbPool = () => db.getPool();
const fetchApi =
  typeof global.fetch === 'function'
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
function loadEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) return;
      const key = trimmed.slice(0, eqIndex).trim();
      if (!key || process.env[key] != null) return;
      let value = trimmed.slice(eqIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/, '').trim();
      }
      process.env[key] = value;
    });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Failed to load env file ${filePath}:`, error.message);
    }
  }
}

[
  path.join(__dirname, '.env'),
  path.join(__dirname, '.env.local'),
  path.join(__dirname, '.env.development'),
  path.join(__dirname, '.env.production'),
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', '.env.local'),
  path.join(__dirname, '..', '.env.development'),
  path.join(__dirname, '..', '.env.production'),
  path.join(__dirname, '..', 'web', '.env'),
  path.join(__dirname, '..', 'web', '.env.local'),
  path.join(__dirname, '..', 'web', '.env.development'),
  path.join(__dirname, '..', 'web', '.env.production'),
].forEach(loadEnvFile);

const app = express();

const AUTH_SECRET = process.env.AUTH_SECRET || 'nhatro-unified-dev-secret';
function firstEnv(...names) {
  for (const name of names) {
    if (!name) continue;
    const value = process.env[name];
    if (value != null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

const HAS_DB = db.isConfigured();

const CLOUDINARY_CLOUD_NAME = firstEnv('CLOUDINARY_CLOUD_NAME');
const CLOUDINARY_API_KEY = firstEnv('CLOUDINARY_API_KEY');
const CLOUDINARY_API_SECRET = firstEnv('CLOUDINARY_API_SECRET');
const HAS_CLOUDINARY_CONFIG = Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);
if (HAS_CLOUDINARY_CONFIG) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  });
}

const FIREBASE_SERVICE_ACCOUNT_JSON = firstEnv('FIREBASE_SERVICE_ACCOUNT_JSON');
let firebaseAdminApp = null;
function getFirebaseAdmin() {
  if (!FIREBASE_SERVICE_ACCOUNT_JSON) return null;
  if (firebaseAdminApp) return firebaseAdminApp;
  const admin = require('firebase-admin');
  const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);
  firebaseAdminApp = admin.apps.length
    ? admin.app()
    : admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  firebaseAdminApp.auth = () => admin.auth(firebaseAdminApp);
  return firebaseAdminApp;
}

const meterPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype || '')) {
      return cb(new Error('Chỉ chấp nhận file ảnh'));
    }
    cb(null, true);
  },
});
const KEEP_ALIVE_URL = firstEnv('RENDER_KEEP_ALIVE_URL', 'APP_URL', 'RENDER_EXTERNAL_URL', 'VITE_API_ORIGIN').replace(/\/+$/, '');
const KEEP_ALIVE_INTERVAL_MS = Number(process.env.RENDER_KEEP_ALIVE_INTERVAL_MS || 13 * 60 * 1000);
const ENABLE_KEEP_ALIVE = String(process.env.RENDER_KEEP_ALIVE_ENABLED || 'true').toLowerCase() !== 'false';
const TUYA_API_ENDPOINT = firstEnv('TUYA_API_ENDPOINT').replace(/\/+$/, '');
const TUYA_ACCESS_ID = firstEnv('TUYA_ACCESS_ID');
const TUYA_ACCESS_SECRET = firstEnv('TUYA_ACCESS_SECRET');
const TUYA_ENERGY_CODES = firstEnv('TUYA_ENERGY_CODES', 'TUYA_ENERGY_CODE')
  .split(',')
  .map((code) => code.trim())
  .filter(Boolean);
const TUYA_DEBUG_CURL = firstEnv('TUYA_DEBUG_CURL').toLowerCase() === 'true';
let tuyaTokenCache = null;

// Dịch vụ/phụ thu (giặt là, nước uống...) sống trong catalog-service — một
// deployment riêng dùng chung với homestay-app. catalog-service chỉ cần một
// "businessId" chung: với nhà trọ, đó là userId của chủ trọ.
const SERVICE_CATALOG_URL = firstEnv('SERVICE_CATALOG_URL') || 'http://localhost:4100';
const CATALOG_ADMIN_KEY = firstEnv('CATALOG_ADMIN_KEY') || 'dev-catalog-admin-key-change-me';
const CATALOG_TIMEOUT_MS = Number(process.env.CATALOG_TIMEOUT_MS || 8000);

const START_TIME = Date.now();

app.get('/', (req, res) => {
  res.send('OK');
});

// Public health check — used by uptime monitors/load balancers. Verifies the
// database is actually reachable (not just that the process is alive), since
// almost every route here depends on it.
app.get('/health', async (req, res) => {
  let database = 'not_configured';
  if (HAS_DB) {
    try {
      await db.query('SELECT 1');
      database = 'ok';
    } catch (error) {
      database = `error: ${error.message}`;
    }
  }
  // catalog-service is a separate deployment; an outage there only marks us
  // "degraded" (HTTP stays 200 if the database itself is fine) since the
  // rest of the app still works without the service catalog.
  let catalog = 'unknown';
  try {
    const r = await fetchApi(`${SERVICE_CATALOG_URL}/health`, { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
    catalog = r.ok ? 'ok' : `error: HTTP ${r.status}`;
  } catch (error) {
    catalog = `error: ${error.message}`;
  }
  const status = database === 'ok' || database === 'not_configured' ? 'ok' : 'degraded';
  res.status(status === 'ok' ? 200 : 503).json({
    status,
    service: 'nhatro-unified-server',
    uptimeSeconds: Math.round((Date.now() - START_TIME) / 1000),
    timestamp: new Date().toISOString(),
    dependencies: {
      database,
      cloudinary: HAS_CLOUDINARY_CONFIG ? 'configured' : 'not_configured',
      tuya: TUYA_API_ENDPOINT && TUYA_ACCESS_ID && TUYA_ACCESS_SECRET ? 'configured' : 'not_configured',
      catalog,
    },
  });
});

function sanitizeStateForPersistence(nextState = {}) {
  // Advance payments are independent transactions and can be allocated across
  // multiple rental months. Do not apply the legacy one-payment-per-invoice rule.
  if (Array.isArray(nextState.paymentAllocations) || Array.isArray(nextState.rentPeriods) || Array.isArray(nextState.deposits)) {
    return {
      ...nextState,
      invoices: Array.isArray(nextState.invoices) ? nextState.invoices : [],
      payments: Array.isArray(nextState.payments) ? nextState.payments : [],
      rentPeriods: Array.isArray(nextState.rentPeriods) ? nextState.rentPeriods : [],
      paymentAllocations: Array.isArray(nextState.paymentAllocations) ? nextState.paymentAllocations : [],
      deposits: Array.isArray(nextState.deposits) ? nextState.deposits : [],
      depositTransactions: Array.isArray(nextState.depositTransactions) ? nextState.depositTransactions : [],
    };
  }
  const invoices = Array.isArray(nextState.invoices) ? nextState.invoices : [];
  const payments = Array.isArray(nextState.payments) ? nextState.payments : [];
  const invoiceById = new Map(
    invoices
      .filter((invoice) => invoice?.id !== null && invoice?.id !== undefined && invoice?.id !== '')
      .map((invoice) => [String(invoice.id), invoice])
  );
  const STATUS_UNPAID = 'Chưa thanh toán';
  const LEGACY_STATUS_UNPAID = 'Chưa thanh toán';
  const isUnpaid = (status = '') => {
    const s = String(status || '').trim();
    return s === STATUS_UNPAID || s === LEGACY_STATUS_UNPAID;
  };
  const paymentsByInvoiceId = new Map();

  payments.forEach((payment) => {
    const invoiceId = payment?.invoiceId;
    if (invoiceId === null || invoiceId === undefined || invoiceId === '') return;
    const invoiceIdKey = String(invoiceId);
    const invoice = invoiceById.get(invoiceIdKey);
    if (!invoice) return;
    if (isUnpaid(invoice.status)) return;
    if (!paymentsByInvoiceId.has(invoiceIdKey)) {
      paymentsByInvoiceId.set(invoiceIdKey, payment);
    }
  });

  return {
    ...nextState,
    invoices,
    payments: Array.from(paymentsByInvoiceId.values()),
  };
}

function ensureTuyaReady() {
  if (!TUYA_API_ENDPOINT || !TUYA_ACCESS_ID || !TUYA_ACCESS_SECRET) {
    throw new Error('Tuya chưa được cấu hình. Thêm TUYA_API_ENDPOINT, TUYA_ACCESS_ID và TUYA_ACCESS_SECRET trên server.');
  }
}

function maskTuyaAccessId(value = '') {
  const id = String(value || '');
  if (!id) return 'missing';
  if (id.length <= 8) return `${id.slice(0, 2)}…${id.slice(-2)}`;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function tuyaLogPath(requestPath = '') {
  return String(requestPath)
    .replace(/(\/devices\/)[^/?]+/i, '$1:deviceId')
    .replace(/([?&](?:access_token|sign|client_id)=)[^&]+/gi, '$1***');
}

function logTuyaConfiguration() {
  console.log(`[tuya] endpoint=${TUYA_API_ENDPOINT || 'missing'} accessId=${maskTuyaAccessId(TUYA_ACCESS_ID)} accessSecret=${TUYA_ACCESS_SECRET ? 'configured' : 'missing'} monthlyUsage=${TUYA_ENERGY_CODES.length ? TUYA_ENERGY_CODES.join(',') : 'default codes'}`);
}

function sha256(value = '') {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmacSha256(value, key) {
  return crypto.createHmac('sha256', key).update(value).digest('hex').toUpperCase();
}

// Tuya includes the complete request path (including its query string) in the
// signature.  Query parameters must be in a stable, alphabetical order; the
// monthly statistics endpoint has several parameters and otherwise returns
// "sign invalid" even when the access token is valid.
function normalizeTuyaRequestPath(requestPath) {
  const url = new URL(requestPath, 'https://tuya.local');
  const entries = Array.from(url.searchParams.entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
    ));
  const query = new URLSearchParams(entries).toString();
  return `${url.pathname}${query ? `?${query}` : ''}`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function logTuyaCurl(method, url, headers) {
  if (!TUYA_DEBUG_CURL) return;
  const headerArgs = Object.entries(headers)
    .map(([name, value]) => `-H ${shellQuote(`${name}: ${value}`)}`)
    .join(' ');
  console.info(`\n[Tuya debug] Copy this cURL to test the exact request (the t/sign/access_token values expire quickly):\n` +
    `curl.exe -X ${method} ${shellQuote(url)} ${headerArgs}\n`);
}

async function tuyaRequest(method, requestPath, accessToken = '') {
  ensureTuyaReady();
  const signedPath = normalizeTuyaRequestPath(requestPath);
  const timestamp = String(Date.now());
  const stringToSign = `${method}\n${sha256('')}\n\n${signedPath}`;
  const signPayload = `${TUYA_ACCESS_ID}${accessToken}${timestamp}${stringToSign}`;
  const headers = {
    client_id: TUYA_ACCESS_ID,
    sign: hmacSha256(signPayload, TUYA_ACCESS_SECRET),
    sign_method: 'HMAC-SHA256',
    t: timestamp,
    ...(accessToken ? { access_token: accessToken } : {}),
  };
  const url = `${TUYA_API_ENDPOINT}${signedPath}`;
  const startedAt = Date.now();
  console.log(`[tuya] request ${method} ${tuyaLogPath(signedPath)} token=${accessToken ? 'yes' : 'no'}`);
  logTuyaCurl(method, url, headers);
  let response;
  try {
    response = await fetchApi(url, { method, headers });
  } catch (error) {
    console.error(`[tuya] network error ${method} ${tuyaLogPath(signedPath)} after ${Date.now() - startedAt}ms: ${error.message}`);
    throw error;
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    console.error(`[tuya] failed ${method} ${tuyaLogPath(signedPath)} status=${response.status} code=${payload?.code ?? 'unknown'} message=${payload?.msg || 'unknown'} duration=${Date.now() - startedAt}ms`);
    throw new Error(payload?.msg || `Tuya API lỗi (${response.status})`);
  }
  console.log(`[tuya] success ${method} ${tuyaLogPath(signedPath)} status=${response.status} duration=${Date.now() - startedAt}ms`);
  return payload.result;
}

async function getTuyaAccessToken() {
  if (tuyaTokenCache?.accessToken && tuyaTokenCache.expiresAt > Date.now() + 30_000) {
    return tuyaTokenCache.accessToken;
  }
  const result = await tuyaRequest('GET', '/v1.0/token?grant_type=1');
  if (!result?.access_token) throw new Error('Không nhận được access token từ Tuya.');
  tuyaTokenCache = {
    accessToken: result.access_token,
    expiresAt: Date.now() + Math.max(60, Number(result.expire_time || 3600) - 60) * 1000,
  };
  return tuyaTokenCache.accessToken;
}

function parseTuyaValues(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function findTuyaScale(specification, code) {
  const candidates = [
    ...(Array.isArray(specification?.status) ? specification.status : []),
    ...(Array.isArray(specification?.status_set) ? specification.status_set : []),
    ...(Array.isArray(specification?.properties) ? specification.properties : []),
  ];
  const match = candidates.find((item) => item?.code === code);
  const values = parseTuyaValues(match?.values || match?.value || match?.property);
  const scale = Number(values?.scale ?? match?.scale);
  return Number.isInteger(scale) && scale >= 0 ? scale : 0;
}

function parseMonthKey(value) {
  if (!/^\d{4}-\d{2}$/.test(String(value || ''))) return null;
  const year = Number(String(value).slice(0, 4));
  const month = Number(String(value).slice(5, 7));
  if (month < 1 || month > 12) return null;
  return { year, month, key: `${year}-${String(month).padStart(2, '0')}`, apiKey: `${year}${String(month).padStart(2, '0')}` };
}

function monthKeysInclusive(from, to) {
  const result = [];
  for (let year = from.year, month = from.month; year < to.year || (year === to.year && month <= to.month);) {
    result.push({ year, month, apiKey: `${year}${String(month).padStart(2, '0')}` });
    month += 1;
    if (month === 13) { month = 1; year += 1; }
  }
  return result;
}

async function getTuyaMonthlyUsage(token, encodedDeviceId, code, targetMonth, currentMonth) {
  const allMonths = monthKeysInclusive(targetMonth, currentMonth);
  const usageByMonth = {};
  const years = [...new Set(allMonths.map((item) => item.year))];

  for (const year of years) {
    const yearMonths = allMonths.filter((item) => item.year === year);
    const startMonth = yearMonths[0].apiKey;
    const endMonth = yearMonths[yearMonths.length - 1].apiKey;
    const path = `/v1.0/devices/${encodedDeviceId}/statistics/months?code=${encodeURIComponent(code)}&start_month=${startMonth}&end_month=${endMonth}`;
    const result = await tuyaRequest('GET', path, token);
    Object.assign(usageByMonth, result?.months || {});
  }

  const targetUsage = Number(usageByMonth[targetMonth.apiKey]);
  if (!Number.isFinite(targetUsage)) {
    throw new Error(`Tuya không có thống kê kWh cho tháng ${targetMonth.key} (datapoint ${code}).`);
  }

  const laterUsage = allMonths
    .filter((item) => item.apiKey > targetMonth.apiKey)
    .reduce((sum, item) => sum + (Number(usageByMonth[item.apiKey]) || 0), 0);
  return { targetUsage, laterUsage };
}

async function getTuyaElectricReading(deviceId, requestedMonth = '', useMonthlyUsage = false) {
  const token = await getTuyaAccessToken();
  const encodedDeviceId = encodeURIComponent(deviceId);
  const status = await tuyaRequest('GET', `/v1.0/iot-03/devices/${encodedDeviceId}/status`, token);
  const statuses = Array.isArray(status) ? status : [];
  const energyCodes = TUYA_ENERGY_CODES.length
    ? TUYA_ENERGY_CODES
    : ['forward_energy_total', 'add_ele', 'total_forward_energy'];
  const value = energyCodes
    .map((code) => ({ code, item: statuses.find((statusItem) => statusItem?.code === code) }))
    .find((entry) => entry.item && Number.isFinite(Number(entry.item.value)));

  if (!value) {
    const availableCodes = statuses.map((item) => item?.code).filter(Boolean).join(', ');
    throw new Error(`Không tìm thấy datapoint điện năng tích lũy. Các mã hiện có: ${availableCodes || 'không có'}`);
  }

  let specification = null;
  try {
    specification = await tuyaRequest('GET', `/v1.0/devices/${encodedDeviceId}/specifications`, token);
  } catch (error) {
    console.warn('Tuya specifications unavailable:', error.message);
  }
  const rawValue = Number(value.item.value);
  const scale = findTuyaScale(specification, value.code);
  const currentTotal = rawValue / (10 ** scale);
  const targetMonth = parseMonthKey(requestedMonth);
  // Monthly statistics require a separate Tuya permission. When disabled, only
  // return the current total and let the landlord enter the start reading.
  if (!useMonthlyUsage || !targetMonth) {
    return {
      code: value.code,
      rawValue,
      scale,
      electricEnd: currentTotal,
      source: 'tuya-current-total',
    };
  }

  const now = new Date();
  const currentMonth = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  if (targetMonth.year > currentMonth.year || (targetMonth.year === currentMonth.year && targetMonth.month > currentMonth.month)) {
    throw new Error('Không thể chốt tháng trong tương lai.');
  }

  const { targetUsage, laterUsage } = await getTuyaMonthlyUsage(token, encodedDeviceId, value.code, targetMonth, currentMonth);
  const electricEnd = currentTotal - laterUsage;
  const electricStart = electricEnd - targetUsage;
  return {
    code: value.code,
    rawValue,
    scale,
    electricStart,
    electricEnd,
    electricUsage: targetUsage,
    source: 'tuya-monthly-statistics',
  };
}

function startKeepAlive() {
  if (!ENABLE_KEEP_ALIVE) {
    console.log('Render keep-alive disabled by env');
    return;
  }
  if (!KEEP_ALIVE_URL) {
    console.log('Render keep-alive skipped: missing RENDER_KEEP_ALIVE_URL/APP_URL/RENDER_EXTERNAL_URL/VITE_API_ORIGIN');
    return;
  }

  const targetUrl = `${KEEP_ALIVE_URL}/`;
  const intervalMs = Math.max(60 * 1000, KEEP_ALIVE_INTERVAL_MS);
  const ping = async () => {
    try {
      const response = await fetchApi(targetUrl, { method: 'GET' });
      console.log(`[keep-alive] ${response.status} ${targetUrl}`);
    } catch (error) {
      console.warn(`[keep-alive] failed ${targetUrl}:`, error.message);
    }
  };

  setTimeout(() => { ping(); }, 10 * 1000);
  setInterval(() => { ping(); }, intervalMs);
  console.log(`Render keep-alive started: every ${Math.round(intervalMs / 60000)} minutes`);
}

function parseOrigins(value = '') {
  return String(value)
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function isAllowedOrigin(origin, allowList) {
  if (!origin) return false;
  const normalized = String(origin).trim().replace(/\/+$/, '');
  if (allowList.includes(normalized)) return true;
  // Vercel assigns every preview/production deployment of this project its
  // own *.vercel.app subdomain (e.g. nhatro-git-<branch>-<team>.vercel.app),
  // which changes on every deploy. Match those instead of hardcoding each
  // one here and needing a redeploy to allow the next.
  if (/^https:\/\/nhatro(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(normalized)) return true;
  return /^https:\/\/[a-z0-9-]+\.up\.railway\.app$/i.test(normalized);
}

app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://nha-tro-gamma.vercel.app',
    'https://nhatro-production.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000',
    ...parseOrigins(process.env.CORS_ORIGIN),
    ...parseOrigins(process.env.VITE_WEB_ORIGIN),
    ...parseOrigins(process.env.WEB_ORIGIN),
  ].filter(Boolean);

  if (isAllowedOrigin(origin, allowedOrigins)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json({ limit: '10mb' }));

function uid() {
  return crypto.randomUUID();
}

function normalizeEmail(value = '') {
  return value.trim().toLowerCase();
}

function normalizePhone(value = '') {
  return value.replace(/\D+/g, '');
}

function validateEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

function validatePhone(value = '') {
  const normalized = normalizePhone(value);
  return /^[0-9]{9,12}$/.test(normalized);
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), String(salt), 100000, 64, 'sha512').toString('hex');
}

function createPasswordRecord(password) {
  const passwordSalt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, passwordSalt);
  return { passwordHash, passwordSalt };
}

function verifyPassword(user, password) {
  if (!user || !password) return false;

  if (user.passwordHash && user.passwordSalt) {
    return hashPassword(password, user.passwordSalt) === user.passwordHash;
  }

  return user.password === password;
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;

  const [body, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  if (signature !== expected) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.userId || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function ensureDbReady() {
  if (!HAS_DB) {
    throw new Error('Database chưa được cấu hình trên server. Cần đặt DATABASE_URL (Neon).');
  }
}

async function findTenantRecordsByPhone(phone) {
  if (!HAS_DB || !phone) return [];
  // phone is encrypted at rest (AES-GCM, random IV per value), so it can't
  // be matched with a SQL filter — fetch and compare decrypted values in
  // memory instead.
  const rows = await db.query(`SELECT * FROM tenants WHERE COALESCE("isDeleted", false) = false`);
  return rows
    .map((row) => decryptRow('tenants', row))
    .filter((row) => normalizePhone(row.phone) === normalizePhone(phone));
}

async function uploadBufferToCloudinary(buffer, folder) {
  if (!HAS_CLOUDINARY_CONFIG) {
    throw new Error('Cloudinary chưa được cấu hình. Thêm CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET trên server.');
  }
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

let meterOcrWorkerPromise = null;
async function getMeterOcrWorker() {
  if (!meterOcrWorkerPromise) {
    meterOcrWorkerPromise = (async () => {
      const worker = await createWorker('eng');
      await worker.setParameters({ tessedit_char_whitelist: '0123456789.,' });
      return worker;
    })();
  }
  return meterOcrWorkerPromise;
}

function parseMeterValueFromOcrText(text = '') {
  const matches = String(text || '').match(/\d[\d.,]*\d|\d/g) || [];
  if (matches.length === 0) return null;
  // Prefer the longest digit run — meter dials usually show the most digits.
  const best = matches.sort((a, b) => b.replace(/[.,]/g, '').length - a.replace(/[.,]/g, '').length)[0];
  const numeric = Number(best.replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

async function runMeterOcr(buffer) {
  const worker = await getMeterOcrWorker();
  const { data } = await worker.recognize(buffer);
  const text = data?.text || '';
  return { ocrRawText: text.trim(), ocrValue: parseMeterValueFromOcrText(text) };
}

async function findOrCreateTenantUser(tenantRecord, phone) {
  const users = await listUsers();
  const existing = users.find((u) => String(u.linkedTenantId || '') === String(tenantRecord.id));
  if (existing) return existing;

  const nextUser = {
    id: uid(),
    name: String(tenantRecord.name || '').trim() || 'Khách thuê',
    email: '',
    phone,
    ...createPasswordRecord(crypto.randomBytes(16).toString('hex')),
    created_at: new Date().toISOString(),
    role: 'tenant',
    isActive: true,
    maxRoomLimit: null,
    landlordId: tenantRecord.created_by,
    created_by: tenantRecord.created_by,
    linkedTenantId: tenantRecord.id,
    linkedRoomId: tenantRecord.roomId || '',
  };

  await createUserRecord(nextUser);
  return nextUser;
}

function hasRoomsConfig() {
  return HAS_DB;
}

function readUserValue(row, variants) {
  for (const key of variants) {
    const value = row?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function normalizeUserActive(value) {
  if (value === false || value === 0) return false;
  if (typeof value === 'string' && ['false', '0', 'inactive', 'disabled'].includes(value.trim().toLowerCase())) return false;
  return true;
}

function mapUserRow(row) {
  const parsedMaxRoom = Number(row?.maxRoomLimit);
  return {
    rowId: row?.id ?? null,
    id: readUserValue(row, ['id']),
    name: readUserValue(row, ['name']),
    email: normalizeEmail(readUserValue(row, ['email'])),
    phone: normalizePhone(decryptField(readUserValue(row, ['phone']))),
    password: '',
    passwordHash: readUserValue(row, ['password_hash']),
    passwordSalt: readUserValue(row, ['password_salt']),
    created_at: readUserValue(row, ['created_at']),
    role: readUserValue(row, ['role']) || 'user',
    isActive: normalizeUserActive(row?.isActive),
    maxRoomLimit: row?.maxRoomLimit !== null && row?.maxRoomLimit !== undefined && Number.isFinite(parsedMaxRoom) ? parsedMaxRoom : null,
    landlordId: readUserValue(row, ['landlordId']),
    linkedTenantId: readUserValue(row, ['linkedTenantId']),
    linkedRoomId: readUserValue(row, ['linkedRoomId']),
  };
}

async function listUsers() {
  ensureDbReady();
  const rows = await db.query('SELECT * FROM users');
  return rows.map(mapUserRow);
}

async function createUserRecord(user) {
  ensureDbReady();
  const normalizedName = String(user.name || '').trim() || user.email || user.phone || 'User';
  await db.upsertRow('users', {
    id: user.id,
    name: normalizedName,
    email: user.email || '',
    phone: encryptField(user.phone),
    password_hash: user.passwordHash,
    password_salt: user.passwordSalt,
    created_at: user.created_at || new Date().toISOString(),
    created_by: user.created_by || user.id,
    updated_by: user.created_by || user.id,
    role: user.role,
    isActive: user.isActive !== false,
    maxRoomLimit: user.maxRoomLimit ?? null,
    // Present only for role='tenant' accounts.
    landlordId: user.landlordId || '',
    linkedTenantId: user.linkedTenantId || '',
    linkedRoomId: user.linkedRoomId || '',
  }, { onConflict: 'nothing' });
}

async function findUserRowId(userId) {
  ensureDbReady();
  if (!userId) return null;
  const row = await db.getRowById('users', userId);
  return row?.id || null;
}

async function updateUserRecord(rowId, updates = {}) {
  ensureDbReady();
  const targetId = rowId || updates.id || updates.userId;
  if (!targetId) {
    throw new Error('Missing user id for user update');
  }

  const sets = [];
  const values = [];
  const add = (column, value) => {
    values.push(value);
    sets.push(`${db.q(column)} = $${values.length}`);
  };
  if (updates.role !== undefined) add('role', updates.role);
  if (updates.isActive !== undefined) add('isActive', Boolean(updates.isActive));
  if (updates.maxRoomLimit !== undefined) add('maxRoomLimit', updates.maxRoomLimit);
  if (sets.length === 0) return;

  add('updated_by', String(updates.updatedBy || 'system'));
  add('updated_at', new Date().toISOString());
  values.push(String(targetId));
  await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
}

async function migrateRoomCreatedBy(fromId, toId) {
  if (!fromId || !toId || sameUserId(fromId, toId) || !hasRoomsConfig()) return 0;

  const result = await getDbPool().query(
    'UPDATE rooms SET created_by = $2, updated_by = $2, updated_at = $3 WHERE created_by = $1',
    [String(fromId), String(toId), new Date().toISOString()]
  );
  if (result.rowCount > 0) {
    console.log(`Migrated ${result.rowCount} room(s) from ${fromId} to ${toId}`);
  }
  return result.rowCount;
}

async function syncUserRoomOwnership(user, payload = {}) {
  if (!user || !payload?.userId || sameUserId(payload.userId, user.id)) return;
  try {
    await migrateRoomCreatedBy(payload.userId, user.id);
  } catch (error) {
    console.warn('syncUserRoomOwnership failed:', error?.message || error);
  }
}

async function fetchAllRooms() {
  if (!hasRoomsConfig()) return [];
  return db.query(`SELECT id, created_by FROM rooms WHERE COALESCE("isDeleted", false) = false`);
}

function buildRoomCountMap(rooms = []) {
  const counts = {};
  for (const row of rooms) {
    const owner = String(row?.created_by || '').trim();
    if (!owner) continue;
    counts[owner] = (counts[owner] || 0) + 1;
  }
  return counts;
}

async function countUserRooms(userId, extraOwnerIds = []) {
  const ownerIds = [...new Set([
    String(userId || '').trim(),
    ...extraOwnerIds.map((id) => String(id || '').trim()),
  ].filter(Boolean))];

  if (ownerIds.length === 0) return 0;
  if (!hasRoomsConfig()) return 0;

  try {
    const rows = await db.query(
      `SELECT count(*)::int AS count FROM rooms WHERE created_by = ANY($1) AND COALESCE("isDeleted", false) = false`,
      [ownerIds]
    );
    return rows[0]?.count || 0;
  } catch (error) {
    console.warn('countUserRooms failed:', error?.message || error);
    return 0;
  }
}

async function reconcileOrphanRooms(users = []) {
  if (!hasRoomsConfig() || users.length === 0) return;

  const rooms = await fetchAllRooms();
  const activeIds = new Set(users.map((u) => String(u.id)));
  const orphanOwners = [...new Set(
    rooms.map((row) => String(row?.created_by || '').trim()).filter((ownerId) => ownerId && !activeIds.has(ownerId))
  )];

  if (orphanOwners.length !== 1) return;

  const orphanId = orphanOwners[0];
  const adminWithoutRooms = users.filter(
    (user) => isAdminRole(user.role) && !rooms.some((row) => sameUserId(row.created_by, user.id))
  );

  if (adminWithoutRooms.length !== 1) return;

  await migrateRoomCreatedBy(orphanId, adminWithoutRooms[0].id);
}

async function buildRoomCountsForUsers(users = [], tokenPayload = null) {
  const counts = {};
  const authUser = tokenPayload ? resolveAuthUser(users, tokenPayload) : null;
  if (authUser) {
    await syncUserRoomOwnership(authUser, tokenPayload || { userId: authUser.id });
  }
  await reconcileOrphanRooms(users);

  if (hasRoomsConfig()) {
    try {
      const rooms = await fetchAllRooms();
      const ownerCounts = buildRoomCountMap(rooms);
      const activeIds = new Set(users.map((u) => String(u.id)));
      const orphanOwners = Object.keys(ownerCounts).filter((ownerId) => !activeIds.has(ownerId));

      for (const user of users) {
        let count = ownerCounts[String(user.id)] || 0;
        // Hiển thị phòng thuộc user id cũ (orphan) cho admin nếu chưa migrate xong
        if (count === 0 && orphanOwners.length === 1 && isAdminRole(user.role)) {
          count = ownerCounts[orphanOwners[0]] || 0;
        }
        counts[String(user.id)] = count;
      }
      return counts;
    } catch (error) {
      console.warn('buildRoomCountsForUsers failed:', error?.message || error);
    }
  }

  for (const user of users) {
    counts[String(user.id)] = await countUserRooms(user.id);
  }
  return counts;
}

function sameUserId(a, b) {
  return String(a) === String(b);
}

function isAdminRole(role) {
  return String(role || '').trim().toLowerCase() === 'admin';
}

function findUserByIdentity(users, identity = {}) {
  const { userId, email, phone } = identity;

  if (userId) {
    const byId = users.find((u) => sameUserId(u.id, userId));
    if (byId) return byId;
  }

  const normalizedEmail = normalizeEmail(email || '');
  if (normalizedEmail) {
    const byEmail = users.find((u) => normalizeEmail(u.email) === normalizedEmail);
    if (byEmail) return byEmail;
  }

  const normalizedPhone = normalizePhone(phone || '');
  if (normalizedPhone) {
    const byPhone = users.find((u) => normalizePhone(u.phone) === normalizedPhone);
    if (byPhone) return byPhone;
  }

  return null;
}

function resolveAuthUser(users, payload = {}) {
  return findUserByIdentity(users, {
    userId: payload.userId,
    email: payload.email,
    phone: payload.phone,
  });
}

function createAuthToken(user) {
  return signToken({
    userId: user.id,
    email: user.email || '',
    phone: user.phone || '',
    role: user.role || 'user',
    landlordId: user.landlordId || '',
    linkedTenantId: user.linkedTenantId || '',
    linkedRoomId: user.linkedRoomId || '',
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
}

async function loadAllUsers() {
  ensureDbReady();
  return listUsers();
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.userId = payload.userId;
  req.authPayload = payload;
  next();
}

// ---- Catalog proxy (dịch vụ/phụ thu từ catalog-service) ----
// Browser never talks to catalog-service directly: writes need this app's
// own auth check, and catalog-service can't see our JWTs — so every call
// goes through here, same reasoning as homestay-server's /api/admin/catalog
// proxy. req.userId doubles as catalog-service's businessId.
async function proxyToCatalog(req, res, path, method) {
  try {
    const body = method === 'DELETE' ? undefined : JSON.stringify({ ...req.body, businessId: req.userId });
    const r = await fetchApi(`${SERVICE_CATALOG_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-api-key': CATALOG_ADMIN_KEY, 'x-actor-id': String(req.userId || 'system') },
      body,
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    });
    if (r.status === 204) return res.status(204).end();
    const responseBody = await r.json().catch(() => ({}));
    res.status(r.status).json(responseBody);
  } catch (error) {
    res.status(502).json({ error: `Không kết nối được tới catalog-service: ${error.message}` });
  }
}

async function readFromCatalog(req, res, path, extraParams = {}) {
  try {
    const params = new URLSearchParams({ businessId: req.userId, ...extraParams });
    const r = await fetchApi(`${SERVICE_CATALOG_URL}${path}?${params.toString()}`, { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
    const body = await r.json().catch(() => ({}));
    res.status(r.status).json(body);
  } catch (error) {
    res.status(502).json({ error: `Không kết nối được tới catalog-service: ${error.message}` });
  }
}

app.get('/api/catalog/categories', authMiddleware, (req, res) => readFromCatalog(req, res, '/api/categories'));
app.get('/api/catalog/items', authMiddleware, (req, res) => {
  const extra = {};
  if (req.query.kind) extra.kind = req.query.kind;
  if (req.query.categoryId) extra.categoryId = req.query.categoryId;
  return readFromCatalog(req, res, '/api/items', extra);
});
app.get('/api/catalog/orders', authMiddleware, (req, res) => {
  const extra = {};
  if (req.query.roomId) extra.roomId = req.query.roomId;
  if (req.query.month) extra.month = req.query.month;
  if (req.query.status) extra.status = req.query.status;
  return readFromCatalog(req, res, '/api/orders', extra);
});

app.post('/api/admin/catalog/categories', authMiddleware, (req, res) => proxyToCatalog(req, res, '/api/categories', 'POST'));
app.put('/api/admin/catalog/categories/:id', authMiddleware, (req, res) =>
  proxyToCatalog(req, res, `/api/categories/${req.params.id}?businessId=${encodeURIComponent(req.userId)}`, 'PUT')
);
app.delete('/api/admin/catalog/categories/:id', authMiddleware, (req, res) =>
  proxyToCatalog(req, res, `/api/categories/${req.params.id}?businessId=${encodeURIComponent(req.userId)}`, 'DELETE')
);
app.post('/api/admin/catalog/items', authMiddleware, (req, res) => proxyToCatalog(req, res, '/api/items', 'POST'));
app.put('/api/admin/catalog/items/:id', authMiddleware, (req, res) =>
  proxyToCatalog(req, res, `/api/items/${req.params.id}?businessId=${encodeURIComponent(req.userId)}`, 'PUT')
);
app.delete('/api/admin/catalog/items/:id', authMiddleware, (req, res) =>
  proxyToCatalog(req, res, `/api/items/${req.params.id}?businessId=${encodeURIComponent(req.userId)}`, 'DELETE')
);
app.post('/api/admin/catalog/orders', authMiddleware, (req, res) => proxyToCatalog(req, res, '/api/orders', 'POST'));
app.put('/api/admin/catalog/orders/:id', authMiddleware, (req, res) =>
  proxyToCatalog(req, res, `/api/orders/${req.params.id}?businessId=${encodeURIComponent(req.userId)}`, 'PUT')
);
app.delete('/api/admin/catalog/orders/:id', authMiddleware, (req, res) =>
  proxyToCatalog(req, res, `/api/orders/${req.params.id}?businessId=${encodeURIComponent(req.userId)}`, 'DELETE')
);

app.post('/api/tuya/statuses', authMiddleware, async (req, res) => {
  const rooms = Array.isArray(req.body?.rooms) ? req.body.rooms : [];
  const month = String(req.body?.month || '');
  const useMonthlyUsage = req.body?.useMonthlyUsage === true;
  const seenDeviceIds = new Set();
  const results = [];

  for (const room of rooms) {
    const roomId = String(room?.id || '').trim();
    const deviceId = String(room?.tuyaDeviceId || '').trim();
    if (!roomId || !deviceId) continue;

    if (seenDeviceIds.has(deviceId)) {
      results.push({ roomId, deviceId, error: 'Công tơ này đã được gán cho một phòng khác.' });
      continue;
    }
    seenDeviceIds.add(deviceId);

    try {
      results.push({ roomId, deviceId, ...(await getTuyaElectricReading(deviceId, month, useMonthlyUsage)) });
    } catch (error) {
      results.push({ roomId, deviceId, error: error?.message || 'Không thể lấy chỉ số từ Tuya.' });
    }
  }

  return res.json({ results, capturedAt: new Date().toISOString() });
});

async function adminMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const users = await loadAllUsers();
    const user = resolveAuthUser(users, payload);

    if (!user || !isAdminRole(user.role)) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    await syncUserRoomOwnership(user, payload);

    req.userId = user.id;
    req.authPayload = { ...payload, userId: user.id };
    return next();
  } catch (error) {
    console.error('adminMiddleware error', error);
    return res.status(500).json({ error: 'Error checking admin status' });
  }
}

// Per-table REST CRUD for rooms/tenants/readings/invoices/payments/
// rentPeriods/paymentAllocations/deposits/depositTransactions. Additive to
// /api/state below — the web app migrates to these one table at a time.
registerTableRoutes(app, { authMiddleware, adminMiddleware });
registerPaymentWorkflowRoutes(app, { authMiddleware, fetchApi, SERVICE_CATALOG_URL, CATALOG_TIMEOUT_MS });

app.post('/api/auth/register', async (req, res) => {
  const { email = '', phone = '', password = '', name = '' } = req.body || {};
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);
  const hasEmail = Boolean(normalizedEmail);
  const hasPhone = Boolean(normalizedPhone);

  if (!hasEmail && !hasPhone) {
    return res.status(400).json({ error: 'Cần nhập email hoặc số điện thoại' });
  }
  if (!password) {
    return res.status(400).json({ error: 'Thiếu thông tin đăng ký' });
  }
  if (hasEmail && !validateEmail(normalizedEmail)) {
    return res.status(400).json({ error: 'Email không hợp lệ' });
  }
  if (hasPhone && !validatePhone(normalizedPhone)) {
    return res.status(400).json({ error: 'Số điện thoại không hợp lệ' });
  }

  try {
    ensureDbReady();
    const users = await listUsers();
    const duplicated = users.find(
      (user) =>
        (normalizedEmail && user.email === normalizedEmail) ||
        (normalizedPhone && user.phone === normalizedPhone)
    );

    if (duplicated) {
      return res.status(409).json({ error: 'Tài khoản đã tồn tại.' });
    }

    const nextUser = {
      id: uid(),
      name: String(name || '').trim(),
      email: normalizedEmail,
      phone: normalizedPhone,
      ...createPasswordRecord(password),
      created_at: new Date().toISOString(),
      role: 'user',
      isActive: true,
      maxRoomLimit: 20,
    };

    await createUserRecord(nextUser);

    const token = createAuthToken(nextUser);

    return res.json({
      token,
      user: {
        id: nextUser.id,
        email: nextUser.email,
        phone: nextUser.phone,
        role: nextUser.role,
        maxRoomLimit: nextUser.maxRoomLimit,
      },
    });
  } catch (error) {
    console.error('register error', error);
    return res.status(500).json({ error: 'Thiếu thông tin đăng ký' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { identifier, password } = req.body || {};

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Thiếu thông tin đăng nhập' });
  }

  try {
    const users = await loadAllUsers();
    const normalizedIdentifier = normalizeEmail(identifier);
    const normalizedIdentifierPhone = normalizePhone(identifier);
    const user = users.find(
      (entry) => entry.email === normalizedIdentifier || entry.phone === normalizedIdentifierPhone
    );
    console.log('Login attempt for identifier:', identifier, 'normalized email:', normalizedIdentifier, 'normalized phone:', normalizedIdentifierPhone);
    if (!user || !verifyPassword(user, password)) {
      return res.status(401).json({ error: 'Sai thông tin đăng nhập' });
    }
    if (user.isActive === false) {
      return res.status(403).json({ error: 'Tài khoản hiện đang ngừng hoạt động' });
    }
console.log('User authenticated:', { id: user.id, email: user.email, phone: user.phone, role: user.role, maxRoomLimit: user.maxRoomLimit });
    const token = createAuthToken(user);

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role || 'user',
        maxRoomLimit: user.maxRoomLimit,
      },
    });
  } catch (error) {
    console.error('login error', error);
    return res.status(500).json({ error: 'Đăng nhập thất bại' });
  }
});

// Tenant login: verify a Firebase Phone Auth ID token, match the phone number
// against an existing `tenants` record created by some landlord, and issue
// this app's own JWT for a (auto-created) role='tenant' user.
app.post('/api/auth/tenant/verify-phone', async (req, res) => {
  const { idToken } = req.body || {};
  if (!idToken) {
    return res.status(400).json({ error: 'Thiếu idToken' });
  }
  if (!HAS_DB) {
    return res.status(501).json({ error: 'Đăng nhập khách thuê chưa được cấu hình trên server.' });
  }

  const firebaseAdmin = getFirebaseAdmin();
  if (!firebaseAdmin) {
    return res.status(501).json({ error: 'Firebase Phone Auth chưa được cấu hình trên server (thiếu FIREBASE_SERVICE_ACCOUNT_JSON).' });
  }

  try {
    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
    const phone = normalizePhone(decoded.phone_number || '');
    if (!phone) {
      return res.status(400).json({ error: 'Không xác thực được số điện thoại từ Firebase.' });
    }

    const tenantRecords = await findTenantRecordsByPhone(phone);
    if (tenantRecords.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy hồ sơ khách thuê với số điện thoại này. Vui lòng liên hệ chủ trọ để được thêm vào hệ thống trước.' });
    }

    const tenantRecord = tenantRecords[0];
    const tenantUser = await findOrCreateTenantUser(tenantRecord, phone);
    const token = createAuthToken(tenantUser);

    return res.json({
      token,
      user: {
        id: tenantUser.id,
        name: tenantUser.name,
        phone: tenantUser.phone,
        role: 'tenant',
        landlordId: tenantUser.landlordId || '',
        linkedTenantId: tenantUser.linkedTenantId || '',
        linkedRoomId: tenantUser.linkedRoomId || '',
      },
    });
  } catch (error) {
    console.error('tenant verify-phone error', error);
    return res.status(401).json({ error: 'Xác thực OTP thất bại hoặc đã hết hạn.' });
  }
});

// Shared meter-photo OCR endpoint used by both landlord and tenant sessions.
// Uploads the photo to Cloudinary and reads the digits off it with Tesseract;
// it never writes to the database itself — the caller decides where the reading goes.
app.post('/api/meter/ocr-upload', authMiddleware, meterPhotoUpload.single('photo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Thiếu file ảnh (field "photo").' });
  }

  try {
    const folder = `nhatro/meter-readings/${req.userId}`;
    const [uploadResult, ocrResult] = await Promise.all([
      uploadBufferToCloudinary(req.file.buffer, folder),
      runMeterOcr(req.file.buffer),
    ]);

    return res.json({
      photoUrl: uploadResult.secure_url,
      ocrRawText: ocrResult.ocrRawText,
      ocrValue: ocrResult.ocrValue,
    });
  } catch (error) {
    console.error('meter ocr-upload error', error);
    return res.status(500).json({ error: error.message || 'Không thể xử lý ảnh công tơ.' });
  }
});

function mapMeterSubmission(row) {
  return {
    id: row?.id || '',
    roomId: row?.roomId || '',
    month: row?.month || '',
    meterType: row?.meterType || '',
    photoUrl: row?.photoUrl || '',
    ocrRawText: row?.ocrRawText || '',
    ocrValue: row?.ocrValue ?? null,
    finalValue: row?.finalValue ?? null,
    status: row?.status || 'pending',
    submittedByRole: row?.submittedByRole || '',
    submittedByUserId: row?.submittedByUserId || '',
    submittedByName: row?.submittedByName || '',
    reviewedByUserId: row?.reviewedByUserId || '',
    reviewedAt: row?.reviewedAt || null,
    created_at: row?.created_at || '',
    updated_at: row?.updated_at || '',
  };
}

// Meter-submission review queue: a tenant uploads a meter photo (pending),
// the landlord confirms (becomes the official reading, handled client-side)
// or rejects it. Every row's created_by is the landlord's own id, never the
// tenant's, so ownership here is resolved from the auth token's landlordId
// (tenant) or userId (landlord), not from req.userId alone.
app.get('/api/meter-submissions', authMiddleware, async (req, res) => {
  if (!HAS_DB) {
    return res.status(503).json({ error: 'Database chưa được cấu hình trên server.' });
  }

  const isTenant = req.authPayload?.role === 'tenant';
  const landlordId = isTenant ? req.authPayload?.landlordId : req.userId;
  if (!landlordId) {
    return res.status(400).json({ error: 'Thiếu landlordId cho tài khoản này.' });
  }

  const statusFilter = String(req.query?.status || '').trim();
  const whereParts = ['created_by = $1', 'COALESCE("isDeleted", false) = false'];
  const params = [String(landlordId)];
  if (isTenant) {
    params.push(String(req.userId));
    whereParts.push(`"submittedByUserId" = $${params.length}`);
  }
  if (statusFilter) {
    params.push(statusFilter);
    whereParts.push(`status = $${params.length}`);
  }

  try {
    const rows = await db.query(`SELECT * FROM meter_submissions WHERE ${whereParts.join(' AND ')} LIMIT 1000`, params);
    return res.json({ submissions: rows.map(mapMeterSubmission) });
  } catch (error) {
    console.error('list meter-submissions error', error);
    return res.status(500).json({ error: 'Không tải được danh sách ảnh công tơ.' });
  }
});

app.post('/api/meter-submissions', authMiddleware, async (req, res) => {
  if (!HAS_DB) {
    return res.status(503).json({ error: 'Database chưa được cấu hình trên server.' });
  }
  if (req.authPayload?.role !== 'tenant') {
    return res.status(403).json({ error: 'Chỉ tài khoản người thuê mới được gửi ảnh công tơ.' });
  }

  const landlordId = req.authPayload?.landlordId;
  if (!landlordId) {
    return res.status(400).json({ error: 'Tài khoản chưa được liên kết với chủ nhà.' });
  }

  const roomId = String(req.body?.roomId || '').trim();
  const month = String(req.body?.month || '').trim();
  const meterType = String(req.body?.meterType || '').trim();
  const photoUrl = String(req.body?.photoUrl || '').trim();
  if (!roomId || !month || !meterType || !photoUrl) {
    return res.status(400).json({ error: 'Thiếu roomId, month, meterType hoặc photoUrl.' });
  }

  try {
    // Just a display label on the review card — not used for ownership or
    // auth, so it's fine to take it from the client (falling back to the
    // phone already in the token) instead of paying for a full users-table
    // fetch on every submission.
    const submittedByName = String(req.body?.submittedByName || '').trim() || req.authPayload?.phone || '';
    const nowIso = new Date().toISOString();
    const record = {
      id: uid(),
      roomId,
      month,
      meterType,
      photoUrl,
      ocrRawText: String(req.body?.ocrRawText || ''),
      ocrValue: req.body?.ocrValue ?? null,
      finalValue: null,
      status: 'pending',
      submittedByRole: 'tenant',
      submittedByUserId: req.userId,
      submittedByName,
      created_at: nowIso,
      updated_at: nowIso,
      created_by: landlordId,
      updated_by: landlordId,
      isDeleted: false,
    };
    await db.upsertRow('meter_submissions', record, { onConflict: 'nothing' });
    return res.json({ id: record.id });
  } catch (error) {
    console.error('create meter-submission error', error);
    return res.status(500).json({ error: 'Không thể lưu ảnh công tơ.' });
  }
});

app.patch('/api/meter-submissions/:id', authMiddleware, async (req, res) => {
  if (!HAS_DB) {
    return res.status(503).json({ error: 'Database chưa được cấu hình trên server.' });
  }
  if (req.authPayload?.role === 'tenant') {
    return res.status(403).json({ error: 'Chỉ chủ nhà mới được duyệt ảnh công tơ.' });
  }

  const action = req.body?.action === 'reject' ? 'reject' : req.body?.action === 'confirm' ? 'confirm' : '';
  if (!action) {
    return res.status(400).json({ error: 'action phải là "confirm" hoặc "reject".' });
  }
  if (action === 'confirm' && !Number.isFinite(Number(req.body?.finalValue))) {
    return res.status(400).json({ error: 'Thiếu finalValue hợp lệ để xác nhận.' });
  }

  const appId = String(req.params.id || '').trim();

  try {
    const rows = await db.query(
      'SELECT id FROM meter_submissions WHERE id = $1 AND created_by = $2 AND COALESCE("isDeleted", false) = false LIMIT 1',
      [appId, String(req.userId)]
    );
    const row = rows[0];
    if (!row) {
      return res.status(404).json({ error: 'Không tìm thấy dòng dữ liệu để cập nhật.' });
    }

    const nowIso = new Date().toISOString();
    const patch = action === 'confirm'
      ? { status: 'confirmed', finalValue: Number(req.body.finalValue), reviewedByUserId: req.userId, reviewedAt: nowIso, updated_at: nowIso }
      : { status: 'rejected', reviewedByUserId: req.userId, reviewedAt: nowIso, updated_at: nowIso };

    await db.upsertRow('meter_submissions', { id: row.id, created_by: String(req.userId), updated_by: String(req.userId), ...patch });
    return res.json({ ok: true });
  } catch (error) {
    console.error('update meter-submission error', error);
    return res.status(500).json({ error: 'Không thể cập nhật ảnh công tơ.' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const users = await loadAllUsers();
    const user = resolveAuthUser(users, req.authPayload || { userId: req.userId });

    if (!user) {
      return res.status(404).json({ error: 'Not found' });
    }

    await syncUserRoomOwnership(user, req.authPayload || { userId: req.userId });

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role || 'user',
        maxRoomLimit: user.maxRoomLimit,
        landlordId: user.landlordId || '',
        linkedTenantId: user.linkedTenantId || '',
        linkedRoomId: user.linkedRoomId || '',
      },
    });
  } catch (error) {
    console.error('me error', error);
    return res.status(500).json({ error: 'Không thể tải thông tin người dùng' });
  }
});

function parseTablesParam(raw) {
  if (!raw) return null;
  const list = String(raw).split(',').map((t) => t.trim()).filter(Boolean);
  return list.length ? list : null;
}

app.get('/api/state', authMiddleware, async (req, res) => {
  if (!stateStore.isConfigured()) {
    return res.json({ state: {} });
  }
  try {
    const tables = parseTablesParam(req.query?.tables);
    const state = await stateStore.loadStateForUser(req.userId, tables);
    return res.json({ state: sanitizeStateForPersistence(state) });
  } catch (error) {
    console.error('state get error', error);
    return res.json({ state: {} });
  }
});

app.post('/api/state', authMiddleware, async (req, res) => {
  const nextState = req.body?.state;
  if (!nextState || typeof nextState !== 'object') {
    return res.status(400).json({ error: 'Thiếu dữ liệu state' });
  }
  if (!stateStore.isConfigured()) {
    return res.status(501).json({ error: 'Database chưa được cấu hình trên server.' });
  }

  const tables = Array.isArray(req.body?.tables) && req.body.tables.length ? req.body.tables : null;
  const sanitizedState = sanitizeStateForPersistence(nextState);
  let currentUser;

  try {
    const users = await listUsers();
    currentUser = users.find((u) => sameUserId(u.id, req.userId));
  } catch (error) {
    console.error('state validation user lookup error', error);
  }

  const currentLimit = currentUser?.maxRoomLimit;
  if (currentLimit !== null && currentLimit !== undefined && currentLimit > 0 && (!tables || tables.includes('rooms'))) {
    const roomCount = Array.isArray(sanitizedState.rooms)
      ? sanitizedState.rooms.filter((room) => room?.isDeleted !== true).length
      : 0;
    if (roomCount > currentLimit) {
      return res.status(400).json({ error: `Không thể lưu trạng thái. Giới hạn ${currentLimit} phòng đã bị vượt quá.` });
    }
  }

  try {
    await stateStore.saveStateForUser(req.userId, sanitizedState, tables);
  } catch (error) {
    console.error('state save error', error);
    return res.status(500).json({ error: error?.message || 'Không thể lưu dữ liệu vào database' });
  }

  return res.json({ state: sanitizedState });
});

// Tenant's own landlord's room list — needed to show the tenant which room
// they're linked to (TenantMeterUpload.jsx). Scoped like /api/tenants/records:
// self, your own landlord (tenant role), or an admin impersonating someone else.
function resolveRoomsOwnerId(req) {
  const requested = String(req.query?.ownerUserId || '').trim();
  if (!requested || requested === req.userId) return req.userId;
  if (requested === String(req.authPayload?.landlordId || '')) return requested;
  return isAdminRole(req.authPayload?.role) ? requested : req.userId;
}

app.get('/api/rooms/records', authMiddleware, async (req, res) => {
  if (!hasRoomsConfig()) {
    return res.status(503).json({ error: 'Database chưa được cấu hình trên server.' });
  }
  const ownerId = resolveRoomsOwnerId(req);

  try {
    const rows = await db.listOwnedRows('rooms', ownerId);
    return res.json({ list: rows });
  } catch (error) {
    console.error('rooms proxy GET error', error);
    return res.status(500).json({ error: 'Không tải được danh sách phòng.' });
  }
});

// Lets Settings.jsx show whether the database is reachable and migrated,
// without exposing the connection string to the browser.
app.get('/api/config/status', authMiddleware, async (req, res) => {
  const requiredTables = Object.values(db.TABLES);
  let databaseReachable = false;
  let missingTables = requiredTables;
  if (HAS_DB) {
    try {
      const rows = await db.query(
        'SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()'
      );
      const present = new Set(rows.map((r) => r.table_name));
      databaseReachable = true;
      missingTables = requiredTables.filter((name) => !present.has(name));
    } catch (error) {
      console.warn('config/status failed:', error?.message || error);
    }
  }

  return res.json({
    databaseConfigured: HAS_DB,
    databaseReachable,
    missingTables,
    ready: databaseReachable && missingTables.length === 0,
  });
});

// ===== Admin User Management API =====

// Get all users (admin only)
app.get('/api/admin/users', adminMiddleware, async (req, res) => {
  try {
    const users = await loadAllUsers();
    const roomCounts = await buildRoomCountsForUsers(users, req.authPayload);
    const userList = users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role || 'user',
      isActive: user.isActive !== false,
      maxRoomLimit: user.maxRoomLimit,
      created_at: user.created_at,
      roomCount: roomCounts[String(user.id)] || 0,
    }));
    return res.json({ users: userList });
  } catch (error) {
    console.error('admin/users get error', error);
    return res.status(500).json({ error: 'Lỗi lấy danh sách người dùng' });
  }
});

// Update user role and room limit (admin only)
app.put('/api/admin/users/:userId', adminMiddleware, async (req, res) => {
  const { userId } = req.params;
  const { role, maxRoomLimit, isActive } = req.body || {};

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  if (role && !['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const users = await loadAllUsers();
    const userIndex = users.findIndex((u) => sameUserId(u.id, userId));

    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent admin from removing their own admin status
    if (sameUserId(userId, req.userId) && role === 'user') {
      return res.status(400).json({ error: 'Cannot remove your own admin status' });
    }
    if (sameUserId(userId, req.userId) && isActive === false) {
      return res.status(400).json({ error: 'Không thể ngừng hoạt động tài khoản admin hiện tại' });
    }

    const updatedUser = { ...users[userIndex] };
    if (role) updatedUser.role = role;
    if (isActive !== undefined) updatedUser.isActive = isActive !== false;
    if (maxRoomLimit !== undefined) {
      if (maxRoomLimit === null) {
        updatedUser.maxRoomLimit = null;
      } else {
        const parsedLimit = Number(maxRoomLimit);
        if (!Number.isFinite(parsedLimit) || parsedLimit < 0) {
          return res.status(400).json({ error: 'Giá trị giới hạn phòng không hợp lệ' });
        }
        updatedUser.maxRoomLimit = parsedLimit === 0 ? null : parsedLimit;
      }
    }

    users[userIndex] = updatedUser;

    const rowId = updatedUser.rowId || (await findUserRowId(updatedUser.id));
    if (!rowId) {
      return res.status(500).json({ error: 'Không tìm thấy bản ghi người dùng' });
    }
    await updateUserRecord(rowId, {
      role: updatedUser.role,
      isActive: updatedUser.isActive !== false,
      maxRoomLimit: updatedUser.maxRoomLimit ?? null,
      updatedBy: req.userId,
    });

    return res.json({
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        role: updatedUser.role,
        isActive: updatedUser.isActive !== false,
        maxRoomLimit: updatedUser.maxRoomLimit,
      },
    });
  } catch (error) {
    console.error('admin/users put error', error);
    return res.status(500).json({ error: 'Lỗi cập nhật người dùng' });
  }
});

// Get user's room count (admin only)
app.get('/api/admin/users/:userId/rooms', adminMiddleware, async (req, res) => {
  try {
    const roomCount = await countUserRooms(req.params.userId);
    return res.json({ roomCount });
  } catch (error) {
    console.error('admin/users rooms error', error);
    return res.json({ roomCount: 0 });
  }
});

// Read-only state preview for an account selected by an administrator.
app.get('/api/admin/users/:userId/state', adminMiddleware, async (req, res) => {
  try {
    const tables = parseTablesParam(req.query?.tables);
    const state = await stateStore.loadStateForUser(req.params.userId, tables);
    return res.json({ state: sanitizeStateForPersistence(state) });
  } catch (error) {
    console.error('admin/users state get error', error);
    return res.status(500).json({ error: 'Không thể tải dữ liệu tài khoản' });
  }
});

const port = process.env.PORT || 4000;

if (require.main === module) {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on ${port}`);
    if (!HAS_DB) {
      console.warn('Database is not configured — this server has no working storage. Set DATABASE_URL (Neon) and run npm run migrate-to-neon.');
    }
    logTuyaConfiguration();
    startKeepAlive();
  });
}

module.exports = app;
