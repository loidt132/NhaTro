const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
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

const dataDir = path.join(__dirname, 'data');
const statesDir = path.join(dataDir, 'states');
const usersPath = path.join(dataDir, 'users.json');
const usersTmpPath = path.join(dataDir, 'users.json.tmp');
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

const NOCODB_URL = firstEnv('NOCODB_URL', 'VITE_NOCODB_URL').replace(/\/+$/, '');
const NOCODB_API_KEY = firstEnv('NOCODB_API_KEY', 'VITE_NOCODB_API_KEY');
const NOCODB_TABLE_USERS = firstEnv('NOCODB_TABLE_USERS', 'TABLE_USERS', 'VITE_TABLE_USERS', 'VITE_NOCODB_TABLE_USERS');
const NOCODB_TABLE_ROOMS = firstEnv('NOCODB_TABLE_ROOMS', 'TABLE_ROOMS', 'VITE_TABLE_ROOMS');
const HAS_ANY_NOCO_CONFIG = Boolean(NOCODB_URL || NOCODB_API_KEY || NOCODB_TABLE_USERS);
const HAS_FULL_NOCO_CONFIG = Boolean(NOCODB_URL && NOCODB_API_KEY && NOCODB_TABLE_USERS);
const KEEP_ALIVE_URL = firstEnv('RENDER_KEEP_ALIVE_URL', 'APP_URL', 'RENDER_EXTERNAL_URL', 'VITE_API_ORIGIN').replace(/\/+$/, '');
const KEEP_ALIVE_INTERVAL_MS = Number(process.env.RENDER_KEEP_ALIVE_INTERVAL_MS || 13 * 60 * 1000);
const ENABLE_KEEP_ALIVE = String(process.env.RENDER_KEEP_ALIVE_ENABLED || 'true').toLowerCase() !== 'false';

app.get('/', (req, res) => {
  res.send('OK');
});

function sanitizeStateForPersistence(nextState = {}) {
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
  return /^https:\/\/[a-z0-9-]+\.up\.railway\.app$/i.test(normalized);
}

app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://nha-tro-gamma.vercel.app',
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

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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

function loadUsers() {
  try {
    const raw = fs.readFileSync(usersPath, 'utf8');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveUsers(users) {
  ensureDir(dataDir);
  fs.writeFileSync(usersTmpPath, JSON.stringify(users, null, 2));
  fs.renameSync(usersTmpPath, usersPath);
}

function shouldUseNocoAuth() {
  return HAS_FULL_NOCO_CONFIG;
}

function ensureNocoAuthReady() {
  if (!shouldUseNocoAuth()) return;
}

function nocoHeaders() {
  return {
    'Content-Type': 'application/json',
    'xc-token': NOCODB_API_KEY,
  };
}

function nocoUsersUrl(suffix = '') {
  return `${NOCODB_URL}/api/v2/tables/${encodeURIComponent(NOCODB_TABLE_USERS)}/records${suffix}`;
}

function nocoRoomsUrl(suffix = '') {
  return `${NOCODB_URL}/api/v2/tables/${encodeURIComponent(NOCODB_TABLE_ROOMS)}/records${suffix}`;
}

function hasNocoRoomsConfig() {
  return Boolean(NOCODB_URL && NOCODB_API_KEY && NOCODB_TABLE_ROOMS);
}

function isActiveNocoRow(row) {
  if (!row) return false;
  const deleted = row.isDeleted;
  if (deleted === true || deleted === 1) return false;
  if (typeof deleted === 'string' && deleted.trim().toLowerCase() === 'true') return false;
  return true;
}

function nocoActiveRoomsWhere(extraWhere = '') {
  const activeFilter = '(isDeleted,neq,true)';
  if (!extraWhere) return encodeURIComponent(activeFilter);
  return encodeURIComponent(`(${extraWhere})~and${activeFilter}`);
}

function countActiveRooms(rows = []) {
  return rows.filter(isActiveNocoRow).length;
}

async function nocoFetchJson(url, options = {}) {
  const response = await fetchApi(url, {
    headers: {
      ...nocoHeaders(),
      ...(options.headers || {}),
    },
    ...options,
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = response.status === 204
    ? null
    : contentType.includes('application/json')
      ? await response.json()
      : await response.text();

  if (!response.ok) {
    throw new Error(typeof payload === 'string' ? payload : `NocoDB request failed: ${response.status}`);
  }

  return payload;
}

function readUserValue(row, variants) {
  for (const key of variants) {
    const value = row?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function mapNocoUser(row) {
  const maxRoomValue = readUserValue(row, ['maxRoomLimit', 'max_room_limit', 'maxroomlimit']);
  const parsedMaxRoom = Number(maxRoomValue);
  return {
    rowId: row?.Id ?? row?.ID ?? null,
    id: readUserValue(row, ['id']),
    name: readUserValue(row, ['name']),
    email: normalizeEmail(readUserValue(row, ['email'])),
    phone: normalizePhone(readUserValue(row, ['phone'])),
    password: readUserValue(row, ['password', 'pass']),
    passwordHash: readUserValue(row, ['password_hash', 'passwordHash', 'passwordhash']),
    passwordSalt: readUserValue(row, ['password_salt', 'passwordSalt', 'passwordsalt']),
    createdAt: readUserValue(row, ['created_at', 'createdAt', 'createdat']),
    role: readUserValue(row, ['role']) || 'user',
    maxRoomLimit: Number.isFinite(parsedMaxRoom) ? parsedMaxRoom : null,
  };
}

async function listNocoUsers() {
  ensureNocoAuthReady();
  const data = await nocoFetchJson(nocoUsersUrl('?limit=1000'));
  return (data?.list || []).map(mapNocoUser);
}

async function createNocoUserRecord(user) {
  ensureNocoAuthReady();
  const normalizedName = String(user.name || '').trim() || user.email || user.phone || 'User';
  const payloads = [
    {
      id: user.id,
      name: normalizedName,
      email: user.email,
      phone: user.phone,
      password_hash: user.passwordHash,
      password_salt: user.passwordSalt,
      created_at: user.createdAt,
      role: user.role,
      maxRoomLimit: user.maxRoomLimit,
    },
    {
      id: user.id,
      name: normalizedName,
      email: user.email,
      phone: user.phone,
      passwordHash: user.passwordHash,
      passwordSalt: user.passwordSalt,
      createdAt: user.createdAt,
      role: user.role,
      maxRoomLimit: user.maxRoomLimit,
    },
    {
      id: user.id,
      name: normalizedName,
      email: user.email,
      phone: user.phone,
      passwordhash: user.passwordHash,
      passwordsalt: user.passwordSalt,
      createdat: user.createdAt,
      role: user.role,
      maxRoomLimit: user.maxRoomLimit,
    },
    {
      id: user.id,
      name: normalizedName,
      email: user.email,
      phone: user.phone,
      password: user.password || user.passwordHash,
      created_at: user.createdAt,
      role: user.role,
      maxRoomLimit: user.maxRoomLimit,
    },
    {
      id: user.id,
      name: normalizedName,
      email: user.email,
      phone: user.phone,
      pass: user.password || user.passwordHash,
      created_at: user.createdAt,
      role: user.role,
      maxRoomLimit: user.maxRoomLimit,
    },
    {
      id: user.id,
      name: normalizedName,
      email: user.email,
      phone: user.phone,
      created_by: user.id,
      modified_by: user.id,
      password_hash: user.passwordHash,
      password_salt: user.passwordSalt,
      created_at: user.createdAt,
      role: user.role,
      maxRoomLimit: user.maxRoomLimit,
    },
  ];

  let lastError = null;
  for (const payload of payloads) {
    try {
      await nocoFetchJson(nocoUsersUrl(), {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Failed to create NocoDB user');
}

async function findNocoUserRowId(userId) {
  ensureNocoAuthReady();
  if (!userId) return null;

  const data = await nocoFetchJson(nocoUsersUrl('?limit=1000'));
  const record = (data?.list || []).find((row) => {
    const idValue = readUserValue(row, ['id']);
    return String(idValue) === String(userId);
  });
  return record?.Id || record?.ID || null;
}

async function updateNocoUserRecord(rowId, updates = {}) {
  ensureNocoAuthReady();
  let targetRowId = rowId;

  if (!targetRowId) {
    targetRowId = await findNocoUserRowId(updates.id || updates.userId);
  }

  if (!targetRowId) {
    throw new Error('Missing NocoDB rowId for user update');
  }

  const payload = { Id: targetRowId };
  if (updates.role !== undefined) payload.role = updates.role;
  if (updates.maxRoomLimit !== undefined) payload.maxRoomLimit = updates.maxRoomLimit;

  if (Object.keys(payload).length <= 1) {
    return;
  }

  // NocoDB v2: bulk PATCH on /records (no /records/{id} path)
  return await nocoFetchJson(nocoUsersUrl(), {
    method: 'PATCH',
    body: JSON.stringify([payload]),
  });
}

async function migrateRoomCreatedBy(fromId, toId) {
  if (!fromId || !toId || sameUserId(fromId, toId) || !hasNocoRoomsConfig()) return 0;

  const where = encodeURIComponent(`(created_by,eq,${String(fromId)})`);
  const data = await nocoFetchJson(nocoRoomsUrl(`?where=${where}&limit=1000`));
  const rows = data?.list || [];
  if (rows.length === 0) return 0;

  const payloads = rows
    .map((row) => ({
      Id: row?.Id ?? row?.ID ?? null,
      created_by: String(toId),
    }))
    .filter((row) => row.Id);

  if (payloads.length === 0) return 0;

  await nocoFetchJson(nocoRoomsUrl(), {
    method: 'PATCH',
    body: JSON.stringify(payloads),
  });

  console.log(`Migrated ${payloads.length} room(s) from ${fromId} to ${toId}`);
  return payloads.length;
}

async function syncUserRoomOwnership(user, payload = {}) {
  if (!user || !payload?.userId || sameUserId(payload.userId, user.id)) return;
  try {
    await migrateRoomCreatedBy(payload.userId, user.id);
  } catch (error) {
    console.warn('syncUserRoomOwnership failed:', error?.message || error);
  }
}

async function fetchAllNocoRooms() {
  if (!hasNocoRoomsConfig()) return [];
  try {
    const data = await nocoFetchJson(nocoRoomsUrl(`?where=${nocoActiveRoomsWhere()}&limit=1000`));
    return (data?.list || []).filter(isActiveNocoRow);
  } catch (error) {
    console.warn('fetchAllNocoRooms filtered query failed, falling back:', error?.message || error);
    const data = await nocoFetchJson(nocoRoomsUrl('?limit=1000'));
    return (data?.list || []).filter(isActiveNocoRow);
  }
}

function buildRoomCountMap(rooms = []) {
  const counts = {};
  for (const row of rooms) {
    if (!isActiveNocoRow(row)) continue;
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

  for (const ownerId of ownerIds) {
    const { statePath } = statePathsForUser(ownerId);
    try {
      const raw = fs.readFileSync(statePath, 'utf8');
      const state = raw ? JSON.parse(raw) : {};
      const localCount = Array.isArray(state.rooms)
        ? state.rooms.filter((room) => room?.isDeleted !== true).length
        : 0;
      if (localCount > 0) return localCount;
    } catch {
      // fall through to NocoDB
    }
  }

  if (!hasNocoRoomsConfig()) return 0;

  try {
    const ownerFilter = ownerIds.length === 1
      ? `(created_by,eq,${ownerIds[0]})`
      : ownerIds.map((id) => `(created_by,eq,${id})`).join('~or');
    let rows = [];
    try {
      const data = await nocoFetchJson(nocoRoomsUrl(`?where=${nocoActiveRoomsWhere(ownerFilter)}&limit=1000`));
      rows = data?.list || [];
    } catch (error) {
      const data = await nocoFetchJson(nocoRoomsUrl('?limit=1000'));
      const ownerSet = new Set(ownerIds);
      rows = (data?.list || []).filter((row) => ownerSet.has(String(row?.created_by || '')));
    }
    return countActiveRooms(rows);
  } catch (error) {
    console.warn('countUserRooms NocoDB failed:', error?.message || error);
    return 0;
  }
}

async function reconcileOrphanRooms(users = []) {
  if (!hasNocoRoomsConfig() || users.length === 0) return;

  const rooms = await fetchAllNocoRooms();
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

  if (hasNocoRoomsConfig()) {
    try {
      const rooms = await fetchAllNocoRooms();
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

function statePathsForUser(userId) {
  const safeUserId = String(userId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_');
  return {
    statePath: path.join(statesDir, `${safeUserId}.json`),
    stateTmpPath: path.join(statesDir, `${safeUserId}.json.tmp`),
  };
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
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
}

async function loadAllUsers() {
  if (!shouldUseNocoAuth()) return loadUsers();
  try {
    return await listNocoUsers();
  } catch (error) {
    console.warn('listNocoUsers failed:', error?.message || error);
    const localUsers = loadUsers();
    if (localUsers.length > 0) return localUsers;
    throw error;
  }
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
    const users = shouldUseNocoAuth() ? await listNocoUsers() : loadUsers();
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
      password: String(password),
      ...createPasswordRecord(password),
      createdAt: new Date().toISOString(),
      role: 'user',
      maxRoomLimit: 20,
    };

    if (shouldUseNocoAuth()) {
      await createNocoUserRecord(nextUser);
    } else {
      users.push(nextUser);
      saveUsers(users);
    }

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
        email: user.email,
        phone: user.phone,
        role: user.role || 'user',
        maxRoomLimit: user.maxRoomLimit,
      },
    });
  } catch (error) {
    console.error('me error', error);
    return res.status(500).json({ error: 'Không thể tải thông tin người dùng' });
  }
});

app.get('/api/state', authMiddleware, (req, res) => {
  const { statePath } = statePathsForUser(req.userId);

  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const state = raw ? JSON.parse(raw) : {};
    return res.json({ state: sanitizeStateForPersistence(state) });
  } catch {
    return res.json({ state: {} });
  }
});

app.post('/api/state', authMiddleware, async (req, res) => {
  const nextState = req.body?.state;
  if (!nextState || typeof nextState !== 'object') {
    return res.status(400).json({ error: 'Thiếu dữ liệu state' });
  }

  const sanitizedState = sanitizeStateForPersistence(nextState);
  let currentUser;

  try {
    const users = shouldUseNocoAuth() ? await listNocoUsers() : loadUsers();
    currentUser = users.find((u) => sameUserId(u.id, req.userId));
  } catch (error) {
    console.error('state validation user lookup error', error);
  }

  const currentLimit = currentUser?.maxRoomLimit;
  if (currentLimit !== null && currentLimit !== undefined && currentLimit > 0) {
    const roomCount = Array.isArray(sanitizedState.rooms)
      ? sanitizedState.rooms.filter((room) => room?.isDeleted !== true).length
      : 0;
    if (roomCount > currentLimit) {
      return res.status(400).json({ error: `Không thể lưu trạng thái. Giới hạn ${currentLimit} phòng đã bị vượt quá.` });
    }
  }

  ensureDir(statesDir);
  const { statePath, stateTmpPath } = statePathsForUser(req.userId);
  fs.writeFileSync(stateTmpPath, JSON.stringify(sanitizedState, null, 2));
  fs.renameSync(stateTmpPath, statePath);

  return res.json({ state: sanitizedState });
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
      maxRoomLimit: user.maxRoomLimit,
      createdAt: user.createdAt,
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
  const { role, maxRoomLimit } = req.body || {};

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

    const updatedUser = { ...users[userIndex] };
    if (role) updatedUser.role = role;
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

    if (shouldUseNocoAuth()) {
      const rowId = updatedUser.rowId || (await findNocoUserRowId(updatedUser.id));
      if (!rowId) {
        return res.status(500).json({ error: 'Không tìm thấy bản ghi người dùng trên NocoDB' });
      }
      await updateNocoUserRecord(rowId, {
        role: updatedUser.role,
        maxRoomLimit: updatedUser.maxRoomLimit ?? null,
      });
    } else {
      saveUsers(users);
    }

    return res.json({
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        role: updatedUser.role,
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

const port = process.env.PORT || 4000;

/*if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Auth storage: ${shouldUseNocoAuth() ? 'NocoDB' : 'users.json'}`);
  });
}*/
 

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on ${port}`);
  if (HAS_ANY_NOCO_CONFIG && !HAS_FULL_NOCO_CONFIG) {
    console.warn('NocoDB auth config is partial. Falling back to users.json auth.');
  }
  console.log(`Auth storage: ${shouldUseNocoAuth() ? 'NocoDB' : 'users.json'}`);
  console.log(`Room count source: ${hasNocoRoomsConfig() ? 'NocoDB' : 'local state files only'}`);
  if (shouldUseNocoAuth() && !hasNocoRoomsConfig()) {
    console.warn('Missing NOCODB_TABLE_ROOMS / VITE_TABLE_ROOMS — user room counts will stay 0.');
  }
  startKeepAlive();
});

module.exports = app;

