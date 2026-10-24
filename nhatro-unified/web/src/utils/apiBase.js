/** Ghép `VITE_API_ORIGIN` (nếu có) vào path `/api/...`; trống = cùng origin. */
export function apiUrl(path) {
  const base = (import.meta.env.VITE_API_ORIGIN || '').replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}
