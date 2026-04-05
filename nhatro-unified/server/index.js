const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');

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
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const dataDir = path.join(__dirname, 'data');
const statesDir = path.join(dataDir, 'states');
const usersPath = path.join(dataDir, 'users.json');
const usersTmpPath = path.join(dataDir, 'users.json.tmp');
const AUTH_SECRET = process.env.AUTH_SECRET || 'nhatro-unified-dev-secret';
const NOCODB_URL = (process.env.NOCODB_URL || process.env.VITE_NOCODB_URL || '').replace(/\/+$/, '');
const NOCODB_API_KEY = process.env.NOCODB_API_KEY || process.env.VITE_NOCODB_API_KEY || '';
const NOCODB_TABLE_USERS = process.env.NOCODB_TABLE_USERS || process.env.VITE_TABLE_USERS || process.env.VITE_NOCODB_TABLE_USERS || '';

function uid() {
  return crypto.randomUUID();
}

function normalizeEmail(value = '') {
  return value.trim().toLowerCase();
}

function normalizePhone(value = '') {
  return value.replace(/\D+/g, '');
}

function ensureDataDir() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}

function statePathsForUser(userId) {
  const safeUserId = String(userId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_');
  return {
    statePath: path.join(statesDir, `${safeUserId}.json`),
    stateTmpPath: path.join(statesDir, `${safeUserId}.json.tmp`),
  };
}

function isNocoUsersConfigured() {
  return Boolean(NOCODB_URL && NOCODB_API_KEY && NOCODB_TABLE_USERS);
}

function userHeaders() {
  return {
    'Content-Type': 'application/json',
    'xc-token': NOCODB_API_KEY,
  };
}

function usersTableUrl(suffix = '') {
  return `${NOCODB_URL}/api/v2/tables/${NOCODB_TABLE_USERS}/records${suffix}`;
}

async function nocoFetchUsers(query = '') {
  const response = await fetch(usersTableUrl(query), { headers: userHeaders() });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Noco users request failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  return data.list || [];
}

function compactUserPayload(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    passwordhash: user.passwordHash,
    passwordsalt: user.passwordSalt,
    createdat: user.createdAt,
  };
}

function snakeUserPayload(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    password_hash: user.passwordHash,
    password_salt: user.passwordSalt,
    created_at: user.createdAt,
  };
}

function camelUserPayload(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    passwordHash: user.passwordHash,
    passwordSalt: user.passwordSalt,
    createdAt: user.createdAt,
  };
}

function mergedUserPayload(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    passwordhash: user.passwordHash,
    passwordsalt: user.passwordSalt,
    passwordHash: user.passwordHash,
    passwordSalt: user.passwordSalt,
    password_hash: user.passwordHash,
    password_salt: user.passwordSalt,
    createdat: user.createdAt,
    createdAt: user.createdAt,
    created_at: user.createdAt,
  };
}

async function nocoCreateUser(user) {
  const variants = [
    { name: 'merged', payload: mergedUserPayload(user) },
    { name: 'compact', payload: compactUserPayload(user) },
    { name: 'snake', payload: snakeUserPayload(user) },
    { name: 'camel', payload: camelUserPayload(user) },
  ];

  let lastError = null;
  for (const variant of variants) {
    const response = await fetch(usersTableUrl(), {
      method: 'POST',
      headers: userHeaders(),
      body: JSON.stringify(variant.payload),
    });
    if (response.ok) {
      return response.json();
    }

    const text = await response.text();
    lastError = `Noco create user failed [${variant.name}] fields=${Object.keys(variant.payload).join(',')} status=${response.status} body=${text}`;
    console.error(lastError);
    if (![400, 422].includes(response.status)) {
      break;
    }
  }

  throw new Error(lastError || 'Noco create user failed');
}

function toAppUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || '',
    email: row.email || '',
    phone: row.phone || '',
    passwordHash: row.password_hash || row.passwordHash || row.passwordhash || '',
    passwordSalt: row.password_salt || row.passwordSalt || row.passwordsalt || '',
    createdAt: row.created_at || row.createdAt || row.createdat || '',
  };
}

async function loadUsers() {
  if (isNocoUsersConfigured()) {
    const rows = await nocoFetchUsers('?limit=1000');
    return rows.map(toAppUser).filter(Boolean);
  }

  try {
    const raw = fs.readFileSync(usersPath, 'utf8');
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    return [];
  }
}

async function saveUsers(users) {
  if (isNocoUsersConfigured()) {
    return;
  }

  ensureDataDir();
  const payload = JSON.stringify(users, null, 2);
  fs.writeFileSync(usersTmpPath, payload, 'utf8');
  fs.renameSync(usersTmpPath, usersPath);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
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
    if (!payload?.userId || !payload?.exp) return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email || '',
    phone: user.phone || '',
    createdAt: user.createdAt,
  };
}

function findUserByIdentifier(users, identifier) {
  const email = normalizeEmail(identifier);
  const phone = normalizePhone(identifier);
  return users.find((user) => {
    if (email && user.email === email) return true;
    if (phone && user.phone === phone) return true;
    return false;
  });
}

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const users = await loadUsers();
    const user = users.find((item) => item.id === payload.userId);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(500).json({ error: 'Auth lookup failed' });
  }
}

function loadAppState(userId) {
  const { statePath } = statePathsForUser(userId);
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    return null;
  }
}

function saveAppState(userId, state) {
  ensureDataDir();
  fs.mkdirSync(statesDir, { recursive: true });
  const { statePath, stateTmpPath } = statePathsForUser(userId);
  const now = new Date().toISOString();
  const payload = JSON.stringify(state, null, 2);
  fs.writeFileSync(stateTmpPath, payload, 'utf8');
  fs.renameSync(stateTmpPath, statePath);
  return { updatedAt: now };
}

app.get('/api/state', authMiddleware, (req, res) => {
  const value = loadAppState(req.user.id);
  if (!value) {
    return res.status(404).json({ error: 'No state found' });
  }
  res.json({ state: value });
});

app.post('/api/state', authMiddleware, (req, res) => {
  const { state } = req.body;
  if (!state || typeof state !== 'object') {
    return res.status(400).json({ error: 'Invalid state payload' });
  }
  const result = saveAppState(req.user.id, state);
  res.json({ ok: true, ...result });
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, phone, password } = req.body || {};
  const cleanName = (name || '').trim();
  const cleanEmail = normalizeEmail(email);
  const cleanPhone = normalizePhone(phone);
  const cleanPassword = typeof password === 'string' ? password : '';

  if (!cleanName) {
    return res.status(400).json({ error: 'Tên không được để trống' });
  }
  if (!cleanEmail && !cleanPhone) {
    return res.status(400).json({ error: 'Nhập email hoặc số điện thoại' });
  }
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Email không hợp lệ' });
  }
  if (cleanPhone && cleanPhone.length < 9) {
    return res.status(400).json({ error: 'Số điện thoại không hợp lệ' });
  }
  if (cleanPassword.length < 6) {
    return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự' });
  }

  try {
    const users = await loadUsers();
    if (cleanEmail && users.some((user) => user.email === cleanEmail)) {
      return res.status(409).json({ error: 'Email đã được sử dụng' });
    }
    if (cleanPhone && users.some((user) => user.phone === cleanPhone)) {
      return res.status(409).json({ error: 'Số điện thoại đã được sử dụng' });
    }

    const passwordData = hashPassword(cleanPassword);
    const user = {
      id: uid(),
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      passwordHash: passwordData.hash,
      passwordSalt: passwordData.salt,
      createdAt: new Date().toISOString(),
    };

    if (isNocoUsersConfigured()) {
      await nocoCreateUser(user);
    } else {
      users.push(user);
      await saveUsers(users);
    }

    const token = signToken({ userId: user.id, exp: Date.now() + (7 * 24 * 60 * 60 * 1000) });
    res.status(201).json({ token, user: publicUser(user) });
  } catch (error) {
    res.status(500).json({ error: 'Không thể tạo tài khoản' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { identifier, password } = req.body || {};
  const cleanIdentifier = (identifier || '').trim();
  const cleanPassword = typeof password === 'string' ? password : '';

  if (!cleanIdentifier || !cleanPassword) {
    return res.status(400).json({ error: 'Nhập email hoặc số điện thoại và mật khẩu' });
  }

  try {
    const users = await loadUsers();
    const user = findUserByIdentifier(users, cleanIdentifier);
    if (!user || !verifyPassword(cleanPassword, user.passwordSalt, user.passwordHash)) {
      return res.status(401).json({ error: 'Thông tin đăng nhập không đúng' });
    }

    const token = signToken({ userId: user.id, exp: Date.now() + (7 * 24 * 60 * 60 * 1000) });
    res.json({ token, user: publicUser(user) });
  } catch (error) {
    res.status(500).json({ error: 'Không thể đăng nhập' });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Nhatro unified server running on http://localhost:${port}`);
  console.log(`State dir: ${statesDir}`);
  console.log(`Auth user storage: ${isNocoUsersConfigured() ? `NocoDB table ${NOCODB_TABLE_USERS}` : `JSON file ${usersPath}`}`);
});
