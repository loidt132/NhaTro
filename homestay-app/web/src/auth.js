const KEY = "homestay_auth_v1";

export function loadAuth() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveAuth(auth) {
  try {
    localStorage.setItem(KEY, JSON.stringify(auth));
  } catch {
    // ignore storage errors (private mode, quota, ...)
  }
}

export function clearAuth() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
