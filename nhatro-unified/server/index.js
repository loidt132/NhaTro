const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const app = express();

const dataDir = path.join(__dirname, 'data');
const statesDir = path.join(dataDir, 'states');
const usersPath = path.join(dataDir, 'users.json');
const usersTmpPath = path.join(dataDir, 'users.json.tmp');
const AUTH_SECRET = process.env.AUTH_SECRET || 'nhatro-unified-dev-secret';

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

app.post('/api/auth/register', (req, res) => {
  const { email = '', phone = '', password = '', name = '' } = req.body || {};
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);

  if ((!normalizedEmail && !normalizedPhone) || !password) {
    return res.status(400).json({ error: 'Thiếu thông tin đăng ký' });
  }

  const users = loadUsers();
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

  users.push(nextUser);
  saveUsers(users);

  const token = signToken({
    userId: nextUser.id,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });

  res.json({
    token,
    user: {
      id: nextUser.id,
      email: nextUser.email,
      phone: nextUser.phone,
    },
  });
});

app.post('/api/auth/login', (req, res) => {
  const { identifier, password } = req.body || {};

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Thiếu thông tin đăng nhập' });
  }

  const users = loadUsers();
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

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
    },
  });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const users = loadUsers();
  const user = users.find((entry) => entry.id === req.userId);

  if (!user) {
    return res.status(404).json({ error: 'Not found' });
  }

  res.json({
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
    },
  });
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

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

module.exports = app;