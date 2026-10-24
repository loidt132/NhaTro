import { loadAuth } from "./auth.js";

const HOMESTAY_API = import.meta.env.VITE_HOMESTAY_API || "http://localhost:4000";

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

// Room types rarely change, so they're fetched once per homestay and reused
// (the add/edit-room modal opens often). Any room-type edit clears the cache.
let roomTypesCache = null; // { homestayId, promise }
function getRoomTypesCached() {
  if (roomTypesCache && roomTypesCache.homestayId === currentHomestayId) return roomTypesCache.promise;
  const promise = request(HOMESTAY_API, "/api/room-types");
  const entry = { homestayId: currentHomestayId, promise };
  roomTypesCache = entry;
  promise.catch(() => {
    if (roomTypesCache === entry) roomTypesCache = null;
  });
  return promise;
}
function clearRoomTypesCache(result) {
  roomTypesCache = null;
  return result;
}

// Homestay info and settings almost never change, so each is fetched once per
// homestay and reused across screens. Saving settings / editing a homestay
// (or logging in again) clears the cache; `fresh` forces a re-fetch.
const perHomestayCache = { homestay: null, settings: null }; // { homestayId, promise }
function cachedPerHomestay(key, path, fresh) {
  const hit = perHomestayCache[key];
  if (!fresh && hit && hit.homestayId === currentHomestayId) return hit.promise;
  const promise = request(HOMESTAY_API, path);
  const entry = { homestayId: currentHomestayId, promise };
  perHomestayCache[key] = entry;
  promise.catch(() => {
    if (perHomestayCache[key] === entry) perHomestayCache[key] = null;
  });
  return promise;
}
function clearHomestayCaches(result) {
  perHomestayCache.homestay = null;
  perHomestayCache.settings = null;
  return result;
}

export const authApi = {
  login: (username, password) =>
    request(HOMESTAY_API, "/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }).then(clearHomestayCaches),
};

// Owner-only: manage the homestays (tenants) themselves. Doesn't need the
// X-Homestay-Id header — these routes act above any single homestay.
export const ownerApi = {
  listHomestays: () => request(HOMESTAY_API, "/api/owner/homestays"),
  addHomestay: (name, maxRooms) =>
    request(HOMESTAY_API, "/api/owner/homestays", { method: "POST", body: JSON.stringify({ name, maxRooms }) }).then(clearHomestayCaches),
  renameHomestay: (id, name, maxRooms, active) =>
    request(HOMESTAY_API, `/api/owner/homestays/${id}`, { method: "PUT", body: JSON.stringify({ name, maxRooms, active }) }).then(clearHomestayCaches),
  removeHomestay: (id) => request(HOMESTAY_API, `/api/owner/homestays/${id}`, { method: "DELETE" }).then(clearHomestayCaches),
};

export const homestayApi = {
  getCurrentHomestay: () => cachedPerHomestay("homestay", "/api/homestay"),
  // Name shown in the header and on invoices: the owner name from Settings if
  // configured, else the name the system owner gave the homestay.
  getDisplayName: async () => {
    const [homestay, settings] = await Promise.all([
      cachedPerHomestay("homestay", "/api/homestay"),
      cachedPerHomestay("settings", "/api/settings").catch(() => ({})),
    ]);
    return String(settings?.ownerName || "").trim() || homestay?.name || "";
  },
  getRooms: () => request(HOMESTAY_API, "/api/rooms"),
  getRoomTypes: getRoomTypesCached,
  addRoomType: (name) =>
    request(HOMESTAY_API, "/api/room-types", { method: "POST", body: JSON.stringify({ name }) }).then(clearRoomTypesCache),
  renameRoomType: (id, name) =>
    request(HOMESTAY_API, `/api/room-types/${id}`, { method: "PUT", body: JSON.stringify({ name }) }).then(clearRoomTypesCache),
  deleteRoomType: (id) =>
    request(HOMESTAY_API, `/api/room-types/${id}`, { method: "DELETE" }).then(clearRoomTypesCache),
  getRatePlans: () => request(HOMESTAY_API, "/api/rate-plans"),
  updateRatePlan: (id, body) =>
    request(HOMESTAY_API, `/api/rate-plans/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  getStayHistory: (roomId, status, from, to) => {
    const params = new URLSearchParams();
    if (roomId) params.set("roomId", roomId);
    if (status) params.set("status", status);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return request(HOMESTAY_API, `/api/stay-history?${params.toString()}`);
  },
  getStay: (id) => request(HOMESTAY_API, `/api/stays/${id}`),
  checkIn: (body) => request(HOMESTAY_API, "/api/stays", { method: "POST", body: JSON.stringify(body) }),
  addGuest: (stayId, body) =>
    request(HOMESTAY_API, `/api/stays/${stayId}/guests`, { method: "POST", body: JSON.stringify(body) }),
  removeGuest: (stayId, guestId) =>
    request(HOMESTAY_API, `/api/stays/${stayId}/guests/${guestId}`, { method: "DELETE" }),
  cancelStay: (stayId) => request(HOMESTAY_API, `/api/stays/${stayId}/cancel`, { method: "POST" }),
  addService: (stayId, body) =>
    request(HOMESTAY_API, `/api/stays/${stayId}/services`, { method: "POST", body: JSON.stringify(body) }),
  addSurcharge: (stayId, body) =>
    request(HOMESTAY_API, `/api/stays/${stayId}/surcharges`, { method: "POST", body: JSON.stringify(body) }),
  removeCharge: (stayId, chargeId) =>
    request(HOMESTAY_API, `/api/stays/${stayId}/charges/${chargeId}`, { method: "DELETE" }),
  getTransferOptions: (stayId) => request(HOMESTAY_API, `/api/stays/${stayId}/transfer-options`),
  getPricingOptions: (stayId) => request(HOMESTAY_API, `/api/stays/${stayId}/pricing-options`),
  setPricingType: (stayId, pricingType) =>
    request(HOMESTAY_API, `/api/stays/${stayId}/pricing-type`, { method: "PUT", body: JSON.stringify({ pricingType }) }),
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
  getGuestReport: (date) => request(HOMESTAY_API, `/api/guest-report?date=${date || ""}`),
  guestReportUrl: (date) => `${HOMESTAY_API}/api/guest-report?date=${date}&format=csv`,
  getSettings: ({ fresh = false } = {}) => cachedPerHomestay("settings", "/api/settings", fresh),
  updateSettings: (body) =>
    request(HOMESTAY_API, "/api/settings", { method: "PUT", body: JSON.stringify(body) }).then(clearHomestayCaches),
  getRevenueReport: (from, to) =>
    request(HOMESTAY_API, `/api/reports/revenue?from=${from || ""}&to=${to || ""}`),
  getOccupancyReport: (from, to) =>
    request(HOMESTAY_API, `/api/reports/occupancy?from=${from || ""}&to=${to || ""}`),
};

// One catalog backend for both dịch vụ (kind: "service") and phụ thu
// (kind: "surcharge") items — pass kind to filter, omit it to get everything.
// Every call, read or write, goes through homestay-server's own /api/catalog
// and /api/admin/catalog proxies instead of hitting catalog-service directly
// from the browser — same as every other data store in this app, and the
// one place a catalog-service error (rate limit, downtime) gets translated
// into something presentable before it reaches the UI.
// Đơn dịch vụ (khách đang ở hoặc vãng lai). Mỗi đơn có thể nhiều dịch vụ.
export const orderApi = {
  list: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    return request(HOMESTAY_API, `/api/service-orders?${qs.toString()}`);
  },
  create: (body) => request(HOMESTAY_API, "/api/service-orders", { method: "POST", body: JSON.stringify(body) }),
  update: (groupId, body) =>
    request(HOMESTAY_API, `/api/service-orders/${groupId}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (groupId) => request(HOMESTAY_API, `/api/service-orders/${groupId}`, { method: "DELETE" }),
};

export const catalogApi = {
  getCategories: () => request(HOMESTAY_API, "/api/catalog/categories"),
  addCategory: (name) => request(HOMESTAY_API, "/api/admin/catalog/categories", { method: "POST", body: JSON.stringify({ name }) }),
  updateCategory: (id, name) =>
    request(HOMESTAY_API, `/api/admin/catalog/categories/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),
  deleteCategory: (id) => request(HOMESTAY_API, `/api/admin/catalog/categories/${id}`, { method: "DELETE" }),
  getItems: (kind) => request(HOMESTAY_API, `/api/catalog/items${kind ? `?kind=${kind}` : ""}`),
  addItem: (body) => request(HOMESTAY_API, "/api/admin/catalog/items", { method: "POST", body: JSON.stringify(body) }),
  updateItem: (id, body) => request(HOMESTAY_API, `/api/admin/catalog/items/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteItem: (id) => request(HOMESTAY_API, `/api/admin/catalog/items/${id}`, { method: "DELETE" }),
};

export const userAdminApi = {
  list: () => request(HOMESTAY_API, "/api/admin/users"),
  create: (body) => request(HOMESTAY_API, "/api/admin/users", { method: "POST", body: JSON.stringify(body) }),
  update: (id, body) => request(HOMESTAY_API, `/api/admin/users/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (id) => request(HOMESTAY_API, `/api/admin/users/${id}`, { method: "DELETE" }),
};

export function formatVnd(amount) {
  return (amount || 0).toLocaleString("vi-VN") + "đ";
}
