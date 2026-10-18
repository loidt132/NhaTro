import { loadAuth } from "./auth.js";

const HOMESTAY_API = import.meta.env.VITE_HOMESTAY_API || "http://localhost:4000";
const CATALOG_API = import.meta.env.VITE_CATALOG_API || "http://localhost:4100";

// Set by App.jsx so any 401 from any call (session expired, token revoked)
// bounces the whole app back to the login screen in one place.
let unauthorizedHandler = null;
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

// Which homestay every request acts on. admin/staff never call this — their
// JWT already pins one homestay server-side — only the owner's homestay
// switcher (HomestayContext) sets it, since owner has no fixed homestay.
let currentHomestayId = null;
export function setCurrentHomestayId(id) {
  currentHomestayId = id;
}

async function request(base, path, options) {
  const auth = loadAuth();
  const res = await fetch(`${base}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(auth?.token ? { Authorization: `Bearer ${auth.token}` } : {}),
      ...(currentHomestayId ? { "X-Homestay-Id": currentHomestayId } : {}),
    },
    ...options,
  });
  if (!res.ok) {
    if (res.status === 401 && unauthorizedHandler) unauthorizedHandler();
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const authApi = {
  login: (username, password) =>
    request(HOMESTAY_API, "/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
};

// Owner-only: manage the homestays (tenants) themselves. Doesn't need the
// X-Homestay-Id header — these routes act above any single homestay.
export const ownerApi = {
  listHomestays: () => request(HOMESTAY_API, "/api/owner/homestays"),
  addHomestay: (name) => request(HOMESTAY_API, "/api/owner/homestays", { method: "POST", body: JSON.stringify({ name }) }),
  renameHomestay: (id, name) =>
    request(HOMESTAY_API, `/api/owner/homestays/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),
};

export const homestayApi = {
  getRooms: () => request(HOMESTAY_API, "/api/rooms"),
  getRoomTypes: () => request(HOMESTAY_API, "/api/room-types"),
  getRatePlans: () => request(HOMESTAY_API, "/api/rate-plans"),
  updateRatePlan: (id, body) =>
    request(HOMESTAY_API, `/api/rate-plans/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  getStay: (id) => request(HOMESTAY_API, `/api/stays/${id}`),
  checkIn: (body) => request(HOMESTAY_API, "/api/stays", { method: "POST", body: JSON.stringify(body) }),
  addGuest: (stayId, body) =>
    request(HOMESTAY_API, `/api/stays/${stayId}/guests`, { method: "POST", body: JSON.stringify(body) }),
  addService: (stayId, body) =>
    request(HOMESTAY_API, `/api/stays/${stayId}/services`, { method: "POST", body: JSON.stringify(body) }),
  addSurcharge: (stayId, body) =>
    request(HOMESTAY_API, `/api/stays/${stayId}/surcharges`, { method: "POST", body: JSON.stringify(body) }),
  removeCharge: (stayId, chargeId) =>
    request(HOMESTAY_API, `/api/stays/${stayId}/charges/${chargeId}`, { method: "DELETE" }),
  transferRoom: (stayId, body) =>
    request(HOMESTAY_API, `/api/stays/${stayId}/transfer`, { method: "POST", body: JSON.stringify(body) }),
  simulateSwipe: (stayId, body) =>
    request(HOMESTAY_API, `/api/stays/${stayId}/simulate-swipe`, { method: "POST", body: JSON.stringify(body) }),
  checkout: (stayId) => request(HOMESTAY_API, `/api/stays/${stayId}/checkout`, { method: "POST" }),
  setRoomStatus: (roomId, status) =>
    request(HOMESTAY_API, `/api/rooms/${roomId}`, { method: "PUT", body: JSON.stringify({ status }) }),
  addRoom: (body) => request(HOMESTAY_API, "/api/rooms", { method: "POST", body: JSON.stringify(body) }),
  updateRoom: (roomId, body) =>
    request(HOMESTAY_API, `/api/rooms/${roomId}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteRoom: (roomId) => request(HOMESTAY_API, `/api/rooms/${roomId}`, { method: "DELETE" }),
  guestReportUrl: (date) => `${HOMESTAY_API}/api/guest-report?date=${date}&format=csv`,
  getSettings: () => request(HOMESTAY_API, "/api/settings"),
  updateSettings: (body) => request(HOMESTAY_API, "/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  getRevenueReport: (from, to) =>
    request(HOMESTAY_API, `/api/reports/revenue?from=${from || ""}&to=${to || ""}`),
  getOccupancyReport: (from, to) =>
    request(HOMESTAY_API, `/api/reports/occupancy?from=${from || ""}&to=${to || ""}`),
};

// One catalog backend for both dịch vụ (kind: "service") and phụ thu
// (kind: "surcharge") items — pass kind to filter, omit it to get everything.
// Reads go straight to catalog-service (public, no secret) but still need
// ?homestayId= so one homestay never sees another's price list. Writes go
// through homestay-server's /api/admin/catalog/* proxy instead of hitting
// catalog-service directly — that proxy is what checks the caller is a
// logged-in admin and attaches the service-to-service API key (plus
// homestayId from the validated JWT/header), which the browser is never
// given directly.
export const catalogApi = {
  getCategories: () => request(CATALOG_API, `/api/categories?homestayId=${currentHomestayIdForCatalog()}`),
  addCategory: (name) => request(HOMESTAY_API, "/api/admin/catalog/categories", { method: "POST", body: JSON.stringify({ name }) }),
  updateCategory: (id, name) =>
    request(HOMESTAY_API, `/api/admin/catalog/categories/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),
  deleteCategory: (id) => request(HOMESTAY_API, `/api/admin/catalog/categories/${id}`, { method: "DELETE" }),
  getItems: (kind) =>
    request(CATALOG_API, `/api/items?homestayId=${currentHomestayIdForCatalog()}${kind ? `&kind=${kind}` : ""}`),
  addItem: (body) => request(HOMESTAY_API, "/api/admin/catalog/items", { method: "POST", body: JSON.stringify(body) }),
  updateItem: (id, body) => request(HOMESTAY_API, `/api/admin/catalog/items/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteItem: (id) => request(HOMESTAY_API, `/api/admin/catalog/items/${id}`, { method: "DELETE" }),
};

// catalog-service isn't behind the X-Homestay-Id-aware proxy for reads (it's
// called directly from the browser), so its own calls resolve the homestay
// id from the same module-level value directly instead of a header.
function currentHomestayIdForCatalog() {
  return currentHomestayId || "";
}

export const userAdminApi = {
  list: () => request(HOMESTAY_API, "/api/admin/users"),
  create: (body) => request(HOMESTAY_API, "/api/admin/users", { method: "POST", body: JSON.stringify(body) }),
  update: (id, body) => request(HOMESTAY_API, `/api/admin/users/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (id) => request(HOMESTAY_API, `/api/admin/users/${id}`, { method: "DELETE" }),
};

export function formatVnd(amount) {
  return (amount || 0).toLocaleString("vi-VN") + "đ";
}
