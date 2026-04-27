const TOKEN_KEY = 'nhatro_auth_token';

function resolveApiBase() {
  return (import.meta.env.VITE_API_ORIGIN || '').replace(/\/+$/, '');
}

function apiUrl(path) {
  const base = resolveApiBase();
  const p = path.startsWith('/') ? path : `/${path}`;
  const url= base ? `${base}${p}` : p;
  console.log(`Resolved API URL: ${url} (base: ${base || 'none'}, path: ${path})`);
  return url;
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, options = {}) {
  const res = await fetch(apiUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : null;

  if (!res.ok) {
    throw new Error(data?.error || 'Yêu cầu thất bại');
  }

  return data;
}

export function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch (error) {
    return '';
  }
}

function decodeTokenPayload(token) {
  if (!token || !token.includes('.')) return null;
  const [body] = token.split('.');

  try {
    const normalized = body.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
  } catch (error) {
    return null;
  }
}

export function getAuthSession() {
  const token = getStoredToken();
  const payload = decodeTokenPayload(token);
  return {
    token,
    userId: payload?.userId || '',
    expiresAt: payload?.exp || 0,
  };
}

export function setStoredToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (error) {
    // ignore storage failures
  }
}

export async function registerAccount(payload) {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function loginAccount(payload) {
  return request('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
}

export async function fetchCurrentUser(token) {
  return request('/api/auth/me', {
    headers: authHeaders(token),
  });
}

export function clearAuth() {
  setStoredToken('');
}
