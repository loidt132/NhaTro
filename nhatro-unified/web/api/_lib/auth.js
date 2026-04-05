import crypto from 'node:crypto';

const AUTH_SECRET = process.env.AUTH_SECRET || 'nhatro-unified-dev-secret';
const NOCODB_URL = (process.env.NOCODB_URL || process.env.VITE_NOCODB_URL || '').replace(/\/+$/, '');
const NOCODB_API_KEY = process.env.NOCODB_API_KEY || process.env.VITE_NOCODB_API_KEY || '';
const NOCODB_TABLE_USERS = process.env.NOCODB_TABLE_USERS || process.env.VITE_TABLE_USERS || process.env.VITE_NOCODB_TABLE_USERS || '';

export function isConfigured() {
  return Boolean(NOCODB_URL && NOCODB_API_KEY && NOCODB_TABLE_USERS);
}

function usersTableUrl(query = '') {
  return `${NOCODB_URL}/api/v2/tables/${NOCODB_TABLE_USERS}/records${query}`;
}

function userHeaders() {
  return {
    'Content-Type': 'application/json',
    'xc-token': NOCODB_API_KEY,
  };
}

export function normalizeEmail(value = '') {
  return value.trim().toLowerCase();
}

export function normalizePhone(value = '') {
  return value.replace(/\D+/g, '');
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

export function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  if (signature !== expected) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.userId || !payload?.exp) return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function publicUser(user) {
  return {
    id: user.id,
    name: user.name || '',
    email: user.email || '',
    phone: user.phone || '',
    createdAt: user.createdAt || '',
  };
}

export async function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export function json(res, status, payload) {
  res.status(status).json(payload);
}

function toAppUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || '',
    email: row.email || '',
    phone: row.phone || '',
    passwordHash: row.passwordhash || row.passwordHash || row.password_hash || '',
    passwordSalt: row.passwordsalt || row.passwordSalt || row.password_salt || '',
    createdAt: row.createdat || row.createdAt || row.created_at || '',
  };
}

export async function loadUsers() {
  const response = await fetch(usersTableUrl('?limit=1000'), { headers: userHeaders() });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Noco users request failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  return (data.list || []).map(toAppUser).filter(Boolean);
}

export async function createUser(user) {
  const payload = {
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

  const response = await fetch(usersTableUrl(), {
    method: 'POST',
    headers: userHeaders(),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Noco create user failed: ${response.status} ${text}`);
  }
  return response.json();
}

export function findUserByIdentifier(users, identifier) {
  const email = normalizeEmail(identifier);
  const phone = normalizePhone(identifier);
  return users.find((user) => {
    if (email && user.email === email) return true;
    if (phone && user.phone === phone) return true;
    return false;
  });
}
