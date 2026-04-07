const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const fetch = require('node-fetch');
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
const NOCODB_URL = (process.env.NOCODB_URL || process.env.VITE_NOCODB_URL || '').replace(/\/+$/, '');
const NOCODB_API_KEY = process.env.NOCODB_API_KEY || process.env.VITE_NOCODB_API_KEY || '';
const NOCODB_TABLE_USERS = process.env.NOCODB_TABLE_USERS || process.env.VITE_TABLE_USERS || process.env.VITE_NOCODB_TABLE_USERS || '';

app.get('/', (req, res) => {
  res.send('OK');
});

app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://nha-tro-gamma.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000',
    process.env.CORS_ORIGIN,
    process.env.VITE_WEB_ORIGIN,
    process.env.WEB_ORIGIN,
  ].filter(Boolean);

  if (origin && allowedOrigins.includes(origin)) {
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
  return Boolean(NOCODB_URL);
}

function ensureNocoAuthReady() {
  if (!shouldUseNocoAuth()) return;
  if (!NOCODB_API_KEY || !NOCODB_TABLE_USERS) {
    throw new Error('Missing NocoDB auth config: NOCODB_API_KEY or NOCODB_TABLE_USERS');
  }
}

function nocoHeaders() {
  return {
    'Content-Type': 'application/json',
    'xc-token': NOCODB_API_KEY,
  };
}

function nocoUsersUrl(suffix = '') {
  return `${NOCODB_URL}/api/v2/tables/${NOCODB_TABLE_USERS}/records${suffix}`;
}

async function nocoFetchJson(url, options = {}) {
  const response = await fetch(url, {
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
  return {
    rowId: row?.Id ?? row?.ID ?? null,
    id: readUserValue(row, ['id']),
    name: readUserValue(row, ['name']),
    email: normalizeEmail(readUserValue(row, ['email'])),
    phone: normalizePhone(readUserValue(row, ['phone'])),
    passwordHash: readUserValue(row, ['password_hash', 'passwordHash', 'passwordhash']),
    passwordSalt: readUserValue(row, ['password_salt', 'passwordSalt', 'passwordsalt']),
    createdAt: readUserValue(row, ['created_at', 'createdAt', 'createdat']),
  };
}

async function listNocoUsers() {
  ensureNocoAuthReady();
  const data = await nocoFetchJson(nocoUsersUrl('?limit=1000'));
  return (data?.list || []).map(mapNocoUser);
}

async function createNocoUserRecord(user) {
  ensureNocoAuthReady();
  const payloads = [
    {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      password_hash: user.passwordHash,
      password_salt: user.passwordSalt,
      created_at: user.createdAt,
    },
    {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      passwordHash: user.passwordHash,
      passwordSalt: user.passwordSalt,
      createdAt: user.createdAt,
    },
    {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      passwordhash: user.passwordHash,
      passwordsalt: user.passwordSalt,
      createdat: user.createdAt,
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

function statePathsForUser(userId) {
  const safeUserId = String(userId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_');
  return {
    statePath: path.join(statesDir, `${safeUserId}.json`),
    stateTmpPath: path.join(statesDir, `${safeUserId}.json.tmp`),
  };
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.userId = payload.userId;
  next();
}

app.post('/api/auth/register', async (req, res) => {
  const { email = '', phone = '', password = '', name = '' } = req.body || {};
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);

  if ((!normalizedEmail && !normalizedPhone) || !password) {
    return res.status(400).json({ error: 'Thiếu thông tin đăng ký' });
  }

  try {
    const users = shouldUseNocoAuth() ? await listNocoUsers() : loadUsers();
    const duplicated = users.find(
      (user) =>
        (normalizedEmail && user.email === normalizedEmail) ||
        (normalizedPhone && user.phone === normalizedPhone)
    );

    if (duplicated) {
      return res.status(409).json({ error: 'Tài khoản đã tồn tại' });
    }

    const nextUser = {
      id: uid(),
      name: String(name || '').trim(),
      email: normalizedEmail,
      phone: normalizedPhone,
      ...createPasswordRecord(password),
      createdAt: new Date().toISOString(),
    };

    if (shouldUseNocoAuth()) {
      await createNocoUserRecord(nextUser);
    } else {
      users.push(nextUser);
      saveUsers(users);
    }

    const token = signToken({
      userId: nextUser.id,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({
      token,
      user: {
        id: nextUser.id,
        email: nextUser.email,
        phone: nextUser.phone,
      },
    });
  } catch (error) {
    console.error('register error', error);
    return res.status(500).json({ error: 'Đăng ký thất bại' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { identifier, password } = req.body || {};

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Thiếu thông tin đăng nhập' });
  }

  try {
    const users = shouldUseNocoAuth() ? await listNocoUsers() : loadUsers();
    const normalizedIdentifier = normalizeEmail(identifier);
    const normalizedIdentifierPhone = normalizePhone(identifier);
    const user = users.find(
      (entry) => entry.email === normalizedIdentifier || entry.phone === normalizedIdentifierPhone
    );

    if (!user || !verifyPassword(user, password)) {
      return res.status(401).json({ error: 'Sai thông tin đăng nhập' });
    }

    const token = signToken({
      userId: user.id,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
      },
    });
  } catch (error) {
    console.error('login error', error);
    return res.status(500).json({ error: 'Đăng nhập thất bại' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const users = shouldUseNocoAuth() ? await listNocoUsers() : loadUsers();
    const user = users.find((entry) => entry.id === req.userId);

    if (!user) {
      return res.status(404).json({ error: 'Not found' });
    }

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
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
    return res.json({ state });
  } catch {
    return res.json({ state: {} });
  }
});

app.post('/api/state', authMiddleware, (req, res) => {
  const nextState = req.body?.state;
  if (!nextState || typeof nextState !== 'object') {
    return res.status(400).json({ error: 'Thiếu dữ liệu state' });
  }

  ensureDir(statesDir);
  const { statePath, stateTmpPath } = statePathsForUser(req.userId);
  fs.writeFileSync(stateTmpPath, JSON.stringify(nextState, null, 2));
  fs.renameSync(stateTmpPath, statePath);

  return res.json({ state: nextState });
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
  console.log(`Auth storage: ${shouldUseNocoAuth() ? 'NocoDB' : 'users.json'}`);
});

module.exports = app;
