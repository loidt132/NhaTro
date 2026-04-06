const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
 
const app = express();
 
/* ======================================================
* 1️⃣ CORS + PREFLIGHT (BẮT BUỘC ĐẶT Ở TRÊN CÙNG)
* ====================================================== */
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
 
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,PUT,DELETE,OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );
 
  // ✅ CHỐT: preflight không bao giờ 404
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
 
  next();
});
 
/* ======================================================
* 2️⃣ BODY PARSER
* ====================================================== */
app.use(express.json({ limit: '10mb' }));
 
/* ======================================================
* 3️⃣ CONFIG + HELPERS
* ====================================================== */
const dataDir = path.join(__dirname, 'data');
const statesDir = path.join(dataDir, 'states');
const usersPath = path.join(dataDir, 'users.json');
const usersTmpPath = path.join(dataDir, 'users.json.tmp');
 
const AUTH_SECRET =
  process.env.AUTH_SECRET || 'nhatro-unified-dev-secret';
 
function uid() {
  return crypto.randomUUID();
}
 
function normalizeEmail(v = '') {
  return v.trim().toLowerCase();
}
 
function normalizePhone(v = '') {
  return v.replace(/\D+/g, '');
}
 
function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}
 
/* ======================================================
* 4️⃣ AUTH / TOKEN
* ====================================================== */
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(body)
    .digest('base64url');
 
  return `${body}.${signature}`;
}
 
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  if (!token.includes('.')) return null;
 
  const [body, sig] = token.split('.');
  const expected = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(body)
    .digest('base64url');
 
  if (sig !== expected) return null;
 
  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8')
    );
    if (!payload.userId || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
 
/* ======================================================
* 5️⃣ DATA
* ====================================================== */
function loadUsers() {
  try {
    const raw = fs.readFileSync(usersPath, 'utf8');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
 
function saveUsers(users) {
  ensureDataDir();
  fs.writeFileSync(usersTmpPath, JSON.stringify(users, null, 2));
  fs.renameSync(usersTmpPath, usersPath);
}
 
/* ======================================================
* 6️⃣ MIDDLEWARE AUTH
* ====================================================== */
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
 
/* ======================================================
* 7️⃣ ROUTES
* ====================================================== */
 
// LOGIN
app.post('/api/auth/login', (req, res) => {
  const { identifier, password } = req.body || {};
 
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Thiếu thông tin đăng nhập' });
  }
 
  const users = loadUsers();
  const key = normalizeEmail(identifier);
  const user = users.find(
    (u) => u.email === key || u.phone === normalizePhone(identifier)
  );
 
  if (!user || user.password !== password) {
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
 
// ME
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const users = loadUsers();
  const user = users.find((u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
 
  res.json({
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
    },
  });
});
 
/* ======================================================
* 8️⃣ EXPORT FOR VERCEL
* ====================================================== */
const port = process.env.PORT || 4000;
 
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}
 
module.exports = app;
