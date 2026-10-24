import express from "express";
import cors from "cors";
import dayjs from "dayjs";
import fetch from "node-fetch";
import { v4 as uuid } from "uuid";
import {
  listRows,
  findOneByBusinessId,
  findOneWhere,
  createRow,
  updateRowByBusinessId,
  deleteRowByBusinessId,
} from "./db.js";
import { computeStayRoomCharge } from "./pricing.js";
import { createLockProvider } from "./lockProvider.js";
import {
  hashPassword,
  verifyPassword,
  signToken,
  requireAuth,
  requireAdmin,
  requireOwner,
  requireHomestayContext,
} from "./auth.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const SERVICE_CATALOG_URL = process.env.SERVICE_CATALOG_URL || "http://localhost:4100";
// Shared secret with catalog-service — proves a write came from this
// trusted backend (already auth'd + admin-checked), never from the browser
// directly. Keep it out of any frontend bundle/env.
const CATALOG_ADMIN_KEY = process.env.CATALOG_ADMIN_KEY || "dev-catalog-admin-key-change-me";
const lockProvider = createLockProvider();
const START_TIME = Date.now();
// Fail fast instead of hanging until the OS gives up (ETIMEDOUT) when
// catalog-service is slow or unreachable.
const CATALOG_TIMEOUT_MS = 8000;

// ---- Health check ----
// Public, no auth — used by uptime monitors/load balancers. Does a cheap
// database round trip so "ok" actually means the app can serve real requests,
// not just that the Node process is alive.
app.get("/health", async (req, res) => {
  let database = "unknown";
  try {
    await listRows("homestays", { limit: 1 });
    database = "ok";
  } catch (err) {
    database = `error: ${err.message}`;
  }
  // catalog-service is a separate Vercel deployment. It is reported here so
  // monitors see it, but an outage only marks us "degraded" (HTTP stays 200)
  // — the rest of the app still works without the price list.
  let catalog = "unknown";
  try {
    const r = await fetch(`${SERVICE_CATALOG_URL}/health`, { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
    catalog = r.ok ? "ok" : `error: HTTP ${r.status}`;
  } catch (err) {
    catalog = `error: ${err.message}`;
  }
  const coreOk = database === "ok";
  const status = coreOk && catalog === "ok" ? "ok" : "degraded";
  res.status(coreOk ? 200 : 503).json({
    status,
    service: "homestay-server",
    uptimeSeconds: Math.round((Date.now() - START_TIME) / 1000),
    timestamp: new Date().toISOString(),
    dependencies: { database, catalog },
  });
});

// Every route handler below is async (the database is a network call away); this
// wrapper means a thrown/rejected error (database down, misconfigured table,
// network blip) turns into a 502 instead of crashing the process or hanging
// the request. Explicit res.status(...) calls inside handlers still work
// exactly as before — this only catches what they don't handle themselves.
function asyncRoute(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(err.detail || err);
      res.status(502).json({ error: `Database: ${err.message}` });
    }
  };
}

// ---- Multi-tenant helpers ----
// req.homestayId is set by requireHomestayContext: for admin/staff it's
// their own fixed homestay; for owner it's whichever homestay they picked
// via the X-Homestay-Id header. Every route below filters/stamps by it —
// nobody, owner included, ever sees unfiltered cross-homestay data by
// accident, because the same code path runs for every role.

function withTenant(req, where) {
  const clause = `(homestayId,eq,${req.homestayId})`;
  return where ? `${clause}~and${where}` : clause;
}

// Returns the row only if it belongs to the caller's current homestay —
// otherwise null, which routes turn into a 404 (never 403: a guessed id
// from another tenant shouldn't even confirm it exists).
function owned(row, req) {
  return row && row.homestayId === req.homestayId ? row : null;
}

// ---- Normalizers ----
// Rows carry every column (created_at, ...) — these pin each row back down
// to the exact shape the rest of the app (and the frontend) already expects,
// with numbers/booleans coerced.

function normUser(u) {
  return { id: u.id, username: u.username, name: u.name, role: u.role, homestayId: u.homestayId || null };
}
function normHomestay(h) {
  const maxRooms = h.maxRooms === null || h.maxRooms === undefined || h.maxRooms === "" ? null : Number(h.maxRooms);
  return { id: h.id, name: h.name, maxRooms: Number.isFinite(maxRooms) ? maxRooms : null, active: h.active !== false };
}

// Returns null if unset/invalid (meaning "không giới hạn"), otherwise a
// positive integer. Thrown message is surfaced straight to the owner's form.
function parseMaxRooms(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("Số phòng tối đa phải là số nguyên dương, hoặc để trống nếu không giới hạn.");
  }
  return n;
}
function normRoomType(t) {
  return { id: t.id, name: t.name };
}
function normRoom(r) {
  return {
    id: r.id,
    name: r.name,
    roomTypeId: r.roomTypeId,
    lockId: r.lockId || "",
    status: r.status,
    active: !(r.active === false || r.active === 0 || r.active === "false"),
  };
}
function normRatePlan(p) {
  return {
    id: p.id,
    roomTypeId: p.roomTypeId,
    hourlyFirstBlockHours: Number(p.hourlyFirstBlockHours),
    hourlyFirstBlockPrice: Number(p.hourlyFirstBlockPrice),
    hourlyExtraPricePerHour: Number(p.hourlyExtraPricePerHour),
    overnightPrice: Number(p.overnightPrice),
    fullDayPrice: Number(p.fullDayPrice),
    lateCheckoutPricePerHour: Number(p.lateCheckoutPricePerHour),
  };
}
function normStay(s) {
  return {
    id: s.id,
    homestayId: s.homestayId,
    roomId: s.roomId,
    pricingType: s.pricingType,
    status: s.status,
    checkInAt: s.checkInAt,
    expectedCheckOutAt: s.expectedCheckOutAt || null,
    checkOutAt: s.checkOutAt || null,
    lockCardId: s.lockCardId || null,
  };
}
function isMainGuest(g) {
  return g.isMain === true || g.isMain === 1 || g.isMain === "true";
}
function normGuest(g) {
  return {
    id: g.id,
    stayId: g.stayId,
    isMain: g.isMain === true || g.isMain === 1 || g.isMain === "true",
    name: g.name,
    idNumber: g.idNumber || "",
    dob: g.dob || "",
    phone: g.phone || "",
  };
}
function normCharge(c) {
  return {
    id: c.id,
    stayId: c.stayId,
    kind: c.kind,
    itemId: c.itemId,
    name: c.name,
    unitPrice: Number(c.unitPrice),
    qty: Number(c.qty),
    amount: Number(c.amount),
    addedAt: c.addedAt,
  };
}
function normSettings(s) {
  if (!s) return {};
  return {
    bankCode: s.bankCode || "",
    accountNo: s.accountNo || "",
    accountName: s.accountName || "",
    qrNoteTemplate: s.qrNoteTemplate || "",
    ownerName: s.ownerName || "",
    ownerPhone: s.ownerPhone || "",
    ownerAddress: s.ownerAddress || "",
  };
}

// Seeds a brand-new homestay with the same starter rate plans used by the
// first-run seed script, so "+ Thêm homestay" never hands the owner an
// empty, unusable property (no room types / pricing to add rooms against).
async function seedDefaultCatalogForHomestay(homestayId) {
  const standard = await createRow("roomTypes", { id: uuid(), homestayId, name: "Phòng Standard" });
  const deluxe = await createRow("roomTypes", { id: uuid(), homestayId, name: "Phòng Deluxe" });
  await createRow("ratePlans", {
    id: uuid(),
    homestayId,
    roomTypeId: standard.id,
    hourlyFirstBlockHours: 2,
    hourlyFirstBlockPrice: 150000,
    hourlyExtraPricePerHour: 50000,
    overnightPrice: 250000,
    fullDayPrice: 350000,
    lateCheckoutPricePerHour: 50000,
  });
  await createRow("ratePlans", {
    id: uuid(),
    homestayId,
    roomTypeId: deluxe.id,
    hourlyFirstBlockHours: 2,
    hourlyFirstBlockPrice: 220000,
    hourlyExtraPricePerHour: 70000,
    overnightPrice: 350000,
    fullDayPrice: 480000,
    lateCheckoutPricePerHour: 70000,
  });
}

// ---- Auth ----

app.post(
  "/api/auth/login",
  asyncRoute(async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "username and password required" });
    const user = await findOneWhere("users", `(username,eq,${username})`);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "Sai tên đăng nhập hoặc mật khẩu." });
    }
    if (user.role !== "owner" && user.homestayId) {
      const own = await findOneByBusinessId("homestays", user.homestayId);
      if (own && own.active === false) {
        return res.status(403).json({ error: "Homestay này đang tạm ngưng hoạt động. Liên hệ chủ hệ thống." });
      }
    }
    const token = signToken(user);
    let homestayName = null;
    if (user.homestayId) {
      const homestay = await findOneByBusinessId("homestays", user.homestayId);
      homestayName = homestay?.name || null;
    }
    res.json({ token, user: { ...normUser(user), homestayName } });
  })
);

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ id: req.user.sub, username: req.user.username, name: req.user.name, role: req.user.role, homestayId: req.user.homestayId });
});

// ---- Owner-only: manage homestays themselves ----
// Mounted before requireHomestayContext — creating/listing homestays is the
// one thing that isn't scoped to a single homestay.

app.get(
  "/api/owner/homestays",
  requireAuth,
  requireOwner,
  asyncRoute(async (req, res) => {
    const rows = await listRows("homestays");
    res.json(rows.map(normHomestay));
  })
);

app.post(
  "/api/owner/homestays",
  requireAuth,
  requireOwner,
  asyncRoute(async (req, res) => {
    const { name, maxRooms } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });
    let parsedMaxRooms;
    try {
      parsedMaxRooms = parseMaxRooms(maxRooms);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const row = await createRow("homestays", { id: uuid(), name, maxRooms: parsedMaxRooms });
    await seedDefaultCatalogForHomestay(row.id);
    res.status(201).json(normHomestay(row));
  })
);

app.put(
  "/api/owner/homestays/:id",
  requireAuth,
  requireOwner,
  asyncRoute(async (req, res) => {
    const { name, maxRooms, active } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });
    let parsedMaxRooms;
    try {
      parsedMaxRooms = parseMaxRooms(maxRooms);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const patch = { name, maxRooms: parsedMaxRooms };
    if (typeof active === "boolean") patch.active = active;
    const updated = await updateRowByBusinessId("homestays", req.params.id, patch);
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json(normHomestay(updated));
  })
);

// Deleting is only allowed for a homestay with no stay history and no staff
// accounts — otherwise invoices/reports and logins would be orphaned. Its
// rooms, room types, rate plans and settings (all owner-managed setup data)
// are removed together with it.
app.delete(
  "/api/owner/homestays/:id",
  requireAuth,
  requireOwner,
  asyncRoute(async (req, res) => {
    const homestay = await findOneByBusinessId("homestays", req.params.id);
    if (!homestay) return res.status(404).json({ error: "not found" });
    const stays = await listRows("stays", { where: `(homestayId,eq,${homestay.id})`, limit: 1 });
    if (stays.length) {
      return res.status(409).json({ error: "Không thể xoá — homestay này đã có lịch sử lưu trú." });
    }
    const members = await listRows("users", { where: `(homestayId,eq,${homestay.id})`, limit: 1 });
    if (members.length) {
      return res.status(409).json({ error: "Không thể xoá — hãy xoá hết người dùng của homestay này trước." });
    }
    for (const key of ["ratePlans", "rooms", "roomTypes", "settings"]) {
      const rows = await listRows(key, { where: `(homestayId,eq,${homestay.id})` });
      for (const row of rows) await deleteRowByBusinessId(key, row.id);
    }
    await deleteRowByBusinessId("homestays", homestay.id);
    res.status(204).end();
  })
);

// Every route below this line requires a logged-in user AND a resolved
// homestay context (req.homestayId) — see requireHomestayContext in auth.js.
app.use("/api", requireAuth, requireHomestayContext);
// A deactivated homestay is locked for its own admin/staff (tokens issued
// before it was deactivated included); the owner can still open it.
app.use("/api", async (req, res, next) => {
  if (req.isOwnerContext) return next();
  try {
    const own = await findOneByBusinessId("homestays", req.homestayId);
    if (own && own.active === false) {
      return res.status(403).json({ error: "Homestay này đang tạm ngưng hoạt động. Liên hệ chủ hệ thống." });
    }
    next();
  } catch (err) {
    console.error(err.detail || err);
    res.status(502).json({ error: `Database: ${err.message}` });
  }
});

// Current homestay's own info (name + its room cap) — unlike
// /api/owner/homestays (owner-only, lists every homestay), this is scoped to
// whichever homestay req.homestayId resolved to, so admin/staff can read
// their own cap to show "x/y phòng" without needing owner rights.
app.get(
  "/api/homestay",
  asyncRoute(async (req, res) => {
    const homestay = await findOneByBusinessId("homestays", req.homestayId);
    if (!homestay) return res.status(404).json({ error: "not found" });
    res.json(normHomestay(homestay));
  })
);

// ---- User management (admin/owner) ----
// Passwords are one-way hashed (scrypt) — nobody, including admin, can ever
// look up an existing password. Admin can only set a NEW one (create, or
// "đặt lại mật khẩu" on an existing account). Scoped to req.homestayId like
// everything else, so an admin only ever sees/edits their own homestay's
// staff — and for an owner, "their own homestay" is whichever one they
// currently have selected.

app.get(
  "/api/admin/users",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const rows = await listRows("users", { where: withTenant(req) });
    res.json(rows.map(normUser));
  })
);

app.post(
  "/api/admin/users",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { username, password, name, role } = req.body;
    if (!username || !password || !name) {
      return res.status(400).json({ error: "username, password, name là bắt buộc" });
    }
    if (role !== "admin" && role !== "staff") {
      return res.status(400).json({ error: "role phải là admin hoặc staff" });
    }
    const existing = await findOneWhere("users", `(username,eq,${username})`);
    if (existing) return res.status(409).json({ error: "Tên đăng nhập đã tồn tại" });
    const row = await createRow("users", {
      id: uuid(),
      homestayId: req.homestayId,
      username,
      name,
      role,
      passwordHash: hashPassword(password),
    });
    res.status(201).json(normUser(row));
  })
);

app.put(
  "/api/admin/users/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const user = owned(await findOneByBusinessId("users", req.params.id), req);
    if (!user) return res.status(404).json({ error: "not found" });
    const { name, role, password } = req.body;
    if (role && role !== "admin" && role !== "staff") {
      return res.status(400).json({ error: "role phải là admin hoặc staff" });
    }
    // Don't let the last admin *of this homestay* demote themselves (or be
    // demoted) and lock everyone out of admin-only screens for it.
    if (role && role !== "admin" && user.role === "admin") {
      const admins = await listRows("users", { where: withTenant(req, "(role,eq,admin)") });
      const others = admins.filter((u) => u.id !== user.id);
      if (others.length === 0) {
        return res.status(409).json({ error: "Không thể đổi vai trò — đây là admin cuối cùng của homestay này." });
      }
    }
    const patch = {};
    if (name) patch.name = name;
    if (role) patch.role = role;
    if (password) patch.passwordHash = hashPassword(password);
    const updated = await updateRowByBusinessId("users", req.params.id, patch);
    res.json(normUser(updated));
  })
);

app.delete(
  "/api/admin/users/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const user = owned(await findOneByBusinessId("users", req.params.id), req);
    if (!user) return res.status(404).json({ error: "not found" });
    if (user.id === req.user.sub) {
      return res.status(409).json({ error: "Không thể tự xoá tài khoản đang đăng nhập." });
    }
    if (user.role === "admin") {
      const admins = await listRows("users", { where: withTenant(req, "(role,eq,admin)") });
      if (admins.length <= 1) return res.status(409).json({ error: "Không thể xoá — đây là admin cuối cùng của homestay này." });
    }
    await deleteRowByBusinessId("users", req.params.id);
    res.status(204).end();
  })
);

async function ratePlanForRoomId(roomId, req) {
  const room = owned(await findOneByBusinessId("rooms", roomId), req);
  if (!room) throw new Error(`Room not found in this homestay: ${roomId}`);
  const ratePlan = await findOneWhere("ratePlans", withTenant(req, `(roomTypeId,eq,${room.roomTypeId})`));
  if (!ratePlan) throw new Error(`No rate plan for room type: ${room.roomTypeId}`);
  return { room: normRoom(room), ratePlan: normRatePlan(ratePlan) };
}

const PRICING_TYPES = ["hourly", "overnight", "fullday"];

async function buildStayView(stay, req) {
  const [guestsRaw, chargesRaw, transfersRaw] = await Promise.all([
    listRows("guests", { where: `(stayId,eq,${stay.id})` }),
    listRows("serviceCharges", { where: `(stayId,eq,${stay.id})` }),
    listRows("roomTransfers", { where: `(stayId,eq,${stay.id})` }),
  ]);

  // Pure audit trail of room moves — never used to re-price the stay. See
  // computeStayRoomCharge for why billing stays on one continuous duration.
  const transfers = await Promise.all(
    transfersRaw.map(async (t) => {
      const [fromRoom, toRoom] = await Promise.all([
        findOneByBusinessId("rooms", t.fromRoomId),
        findOneByBusinessId("rooms", t.toRoomId),
      ]);
      return {
        id: t.id,
        stayId: t.stayId,
        fromRoomId: t.fromRoomId,
        toRoomId: t.toRoomId,
        reason: t.reason || "",
        transferredAt: t.transferredAt || t.created_at || null,
        fromRoomName: fromRoom?.name || t.fromRoomId,
        toRoomName: toRoom?.name || t.toRoomId,
      };
    })
  );

  const endAt = stay.checkOutAt || dayjs().toISOString();
  const { room, ratePlan } = await ratePlanForRoomId(stay.roomId, req);
  const roomLines = computeStayRoomCharge(stay, ratePlan, endAt);

  const guests = guestsRaw.map(normGuest);
  const serviceCharges = chargesRaw.map(normCharge);
  const serviceLines = serviceCharges.map((c) => ({
    id: c.id,
    label: `${c.name} x${c.qty}`,
    amount: c.amount,
    kind: c.kind,
  }));

  const roomTotal = roomLines.reduce((s, l) => s + l.amount, 0);
  const serviceTotal = serviceLines.reduce((s, l) => s + l.amount, 0);

  return {
    ...stay,
    guests,
    serviceCharges,
    transfers,
    currentRoomName: room.name,
    breakdown: {
      roomLines,
      serviceLines,
      roomTotal,
      serviceTotal,
      total: roomTotal + serviceTotal,
    },
  };
}

// ---- Rooms / room types / rate plans ----

app.get(
  "/api/room-types",
  asyncRoute(async (req, res) => {
    const rows = await listRows("roomTypes", { where: withTenant(req) });
    res.json(rows.map(normRoomType));
  })
);

// Creates the room type plus a blank rate plan for it in one call, so it
// shows up on the Bảng giá page immediately — a room type with no rate plan
// would have nowhere to set its price, and no room could be assigned to it
// (RoomModal looks up pricing via roomTypeId).
app.post(
  "/api/room-types",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
    const roomType = await createRow("roomTypes", { id: uuid(), homestayId: req.homestayId, name: name.trim() });
    await createRow("ratePlans", {
      id: uuid(),
      homestayId: req.homestayId,
      roomTypeId: roomType.id,
      hourlyFirstBlockHours: 0,
      hourlyFirstBlockPrice: 0,
      hourlyExtraPricePerHour: 0,
      overnightPrice: 0,
      fullDayPrice: 0,
      lateCheckoutPricePerHour: 0,
    });
    res.status(201).json(normRoomType(roomType));
  })
);

app.put(
  "/api/room-types/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
    const roomType = owned(await findOneByBusinessId("roomTypes", req.params.id), req);
    if (!roomType) return res.status(404).json({ error: "not found" });
    const updated = await updateRowByBusinessId("roomTypes", req.params.id, { name: name.trim() });
    res.json(normRoomType(updated));
  })
);

// A room type with any room assigned to it (even an inactive one) would
// leave that room pointing at a dangling roomTypeId, so block the delete
// and point at reassigning those rooms first — mirrors the room delete
// guard just below for stay history.
app.delete(
  "/api/room-types/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const roomType = owned(await findOneByBusinessId("roomTypes", req.params.id), req);
    if (!roomType) return res.status(404).json({ error: "not found" });

    const roomsOfType = await listRows("rooms", { where: `(roomTypeId,eq,${roomType.id})`, limit: 1 });
    if (roomsOfType.length) {
      return res.status(409).json({
        error: "Loại phòng này đang có phòng sử dụng — hãy đổi loại phòng cho các phòng đó trước khi xoá.",
      });
    }

    const plans = await listRows("ratePlans", { where: `(roomTypeId,eq,${roomType.id})` });
    for (const plan of plans) {
      await deleteRowByBusinessId("ratePlans", plan.id);
    }
    await deleteRowByBusinessId("roomTypes", roomType.id);
    res.status(204).end();
  })
);

app.get(
  "/api/rooms",
  asyncRoute(async (req, res) => {
    const [rooms, activeStays, roomTypes] = await Promise.all([
      listRows("rooms", { where: withTenant(req) }),
      listRows("stays", { where: withTenant(req, "(status,eq,active)") }),
      listRows("roomTypes", { where: withTenant(req) }),
    ]);
    const activeByRoom = new Map(activeStays.map((s) => [s.roomId, s.id]));
    const typeNameById = new Map(roomTypes.map((t) => [t.id, t.name]));
    res.json(
      rooms.map((r) => ({
        ...normRoom(r),
        roomTypeName: typeNameById.get(r.roomTypeId) || "",
        activeStayId: activeByRoom.get(r.id) || null,
      }))
    );
  })
);

app.post(
  "/api/rooms",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { name, roomTypeId, lockId } = req.body;
    if (!name || !roomTypeId) return res.status(400).json({ error: "name and roomTypeId are required" });
    const roomType = owned(await findOneByBusinessId("roomTypes", roomTypeId), req);
    if (!roomType) return res.status(400).json({ error: "unknown roomTypeId" });

    const homestay = await findOneByBusinessId("homestays", req.homestayId);
    const maxRooms = normHomestay(homestay || {}).maxRooms;
    if (maxRooms !== null) {
      const existingRooms = await listRows("rooms", { where: withTenant(req), limit: maxRooms + 1 });
      if (existingRooms.length >= maxRooms) {
        return res.status(409).json({
          error: `Homestay này chỉ được quản lý tối đa ${maxRooms} phòng. Hãy tăng giới hạn trong Quản lý Homestay nếu cần thêm.`,
        });
      }
    }

    const row = await createRow("rooms", {
      id: uuid(),
      homestayId: req.homestayId,
      name,
      roomTypeId,
      lockId: lockId || "",
      status: "empty",
      active: true,
    });
    res.status(201).json(normRoom(row));
  })
);

app.put(
  "/api/rooms/:id",
  asyncRoute(async (req, res) => {
    const { status, name, roomTypeId, lockId, active } = req.body;
    // "Dọn xong" (status only) is routine front-desk work any staff does.
    // Renaming, reassigning type, rekeying the lock, or deactivating a room
    // is configuration — admin only.
    const isConfigChange = name != null || roomTypeId != null || lockId != null || active != null;
    if (isConfigChange && req.user.role !== "admin" && req.user.role !== "owner") {
      return res.status(403).json({ error: "Chỉ admin mới được sửa thông tin phòng." });
    }
    const room = owned(await findOneByBusinessId("rooms", req.params.id), req);
    if (!room) return res.status(404).json({ error: "not found" });
    const patch = {};
    if (status) patch.status = status;
    if (name) patch.name = name;
    if (roomTypeId) patch.roomTypeId = roomTypeId;
    if (lockId != null) patch.lockId = lockId;
    if (active != null) patch.active = Boolean(active);
    const updated = await updateRowByBusinessId("rooms", req.params.id, patch);
    res.json(normRoom(updated));
  })
);

// A room with any stay history (even just one old booking) carries revenue
// and an audit trail — deleting it would silently break reports and guest
// records that reference it by id, so block the delete and point at
// deactivating (active: false) instead.
app.delete(
  "/api/rooms/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const room = owned(await findOneByBusinessId("rooms", req.params.id), req);
    if (!room) return res.status(404).json({ error: "not found" });

    const [stayHistory, transfersFrom, transfersTo] = await Promise.all([
      listRows("stays", { where: `(roomId,eq,${room.id})`, limit: 1 }),
      listRows("roomTransfers", { where: `(fromRoomId,eq,${room.id})`, limit: 1 }),
      listRows("roomTransfers", { where: `(toRoomId,eq,${room.id})`, limit: 1 }),
    ]);
    if (stayHistory.length || transfersFrom.length || transfersTo.length) {
      return res.status(409).json({
        error: "Phòng này đã có lịch sử lưu trú/doanh thu nên không thể xoá — hãy ngừng sử dụng (active: false) thay vì xoá.",
      });
    }
    if (room.status === "occupied") {
      return res.status(409).json({ error: "Không thể xoá phòng đang có khách." });
    }

    await deleteRowByBusinessId("rooms", room.id);
    res.status(204).end();
  })
);

app.get(
  "/api/rate-plans",
  asyncRoute(async (req, res) => {
    const rows = await listRows("ratePlans", { where: withTenant(req) });
    res.json(rows.map(normRatePlan));
  })
);

app.put(
  "/api/rate-plans/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const plan = owned(await findOneByBusinessId("ratePlans", req.params.id), req);
    if (!plan) return res.status(404).json({ error: "not found" });
    const updated = await updateRowByBusinessId("ratePlans", req.params.id, req.body);
    res.json(normRatePlan(updated));
  })
);

// ---- Catalog admin proxy ----
// Dịch vụ/phụ thu live in the separate catalog-service (its own repo, its
// own port) so nhà trọ can share it too. Writes to it need to be gated by
// *this* app's admin check, but catalog-service can't see our JWTs — so the
// browser never talks to catalog-service for writes; it calls these proxy
// routes (admin-only), which forward the request with a shared API key
// catalog-service trusts plus this request's homestayId, so catalog-service
// can keep each homestay's price list separate too. Reads (GET
// items/categories) stay public and go straight from the browser to
// catalog-service with ?homestayId= — no secret involved there.

async function proxyToCatalog(req, res, path, method) {
  try {
    const body = method === "DELETE" ? undefined : JSON.stringify({ ...req.body, businessId: req.homestayId });
    const r = await fetch(`${SERVICE_CATALOG_URL}${path}`, {
      method,
      // x-actor-id lets catalog-service stamp created_by / updated_by with the real user.
      headers: { "Content-Type": "application/json", "x-api-key": CATALOG_ADMIN_KEY, "x-actor-id": String(req.user?.sub || "system") },
      body,
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    });
    if (r.ok) forgetCatalogItems(req.homestayId);
    if (r.status === 204) return res.status(204).end();
    const responseBody = await r.json().catch(() => ({}));
    res.status(r.status).json(responseBody);
  } catch (err) {
    res.status(502).json({ error: `could not reach catalog-service: ${err.message}` });
  }
}

// Reads (GET categories/items) go through this app's backend too, not
// straight from the browser to catalog-service — same reasoning as every
// other database-backed read in this app: the browser never talks to a data
// store directly, and a catalog-service error (rate limit, downtime) gets
// one consistent place to be made presentable before it reaches the UI.
app.get(
  "/api/catalog/categories",
  asyncRoute(async (req, res) => {
    const r = await fetch(`${SERVICE_CATALOG_URL}/api/categories?businessId=${req.homestayId}`, { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
    const body = await r.json().catch(() => ({}));
    res.status(r.status).json(body);
  })
);
app.get(
  "/api/catalog/items",
  asyncRoute(async (req, res) => {
    const params = new URLSearchParams({ businessId: req.homestayId });
    if (req.query.kind) params.set("kind", req.query.kind);
    if (req.query.categoryId) params.set("categoryId", req.query.categoryId);
    const r = await fetch(`${SERVICE_CATALOG_URL}/api/items?${params.toString()}`, { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
    const body = await r.json().catch(() => ({}));
    if (r.ok) rememberCatalogItems(req.homestayId, body);
    res.status(r.status).json(body);
  })
);

app.post("/api/admin/catalog/categories", requireAdmin, (req, res) => proxyToCatalog(req, res, "/api/categories", "POST"));
app.put("/api/admin/catalog/categories/:id", requireAdmin, (req, res) =>
  proxyToCatalog(req, res, `/api/categories/${req.params.id}?businessId=${req.homestayId}`, "PUT")
);
app.delete("/api/admin/catalog/categories/:id", requireAdmin, (req, res) =>
  proxyToCatalog(req, res, `/api/categories/${req.params.id}?businessId=${req.homestayId}`, "DELETE")
);
app.post("/api/admin/catalog/items", requireAdmin, (req, res) => proxyToCatalog(req, res, "/api/items", "POST"));
app.put("/api/admin/catalog/items/:id", requireAdmin, (req, res) =>
  proxyToCatalog(req, res, `/api/items/${req.params.id}?businessId=${req.homestayId}`, "PUT")
);
app.delete("/api/admin/catalog/items/:id", requireAdmin, (req, res) =>
  proxyToCatalog(req, res, `/api/items/${req.params.id}?businessId=${req.homestayId}`, "DELETE")
);

// ---- Stays (check-in / detail / services / surcharges / transfer / checkout) ----

app.get(
  "/api/stays",
  asyncRoute(async (req, res) => {
    const rows = await listRows("stays", { where: withTenant(req, req.query.status ? `(status,eq,${req.query.status})` : undefined) });
    const views = await Promise.all(rows.map((s) => buildStayView(normStay(s), req)));
    res.json(views);
  })
);

app.get(
  "/api/stays/:id",
  asyncRoute(async (req, res) => {
    const stay = owned(await findOneByBusinessId("stays", req.params.id), req);
    if (!stay) return res.status(404).json({ error: "not found" });
    const [view, events] = await Promise.all([
      buildStayView(normStay(stay), req),
      listRows("lockEventsLog", { where: `(stayId,eq,${stay.id})` }),
    ]);
    view.swipedIn = events.some((e) => e.type === "checkin-swipe");
    view.swipedOut = events.some((e) => e.type === "checkout-swipe");
    res.json(view);
  })
);

// Stays by status (default checked-out), newest first, optionally for one room — backs the
// "Lịch sử" page so an invoice/QR can be re-issued later.
app.get(
  "/api/stay-history",
  asyncRoute(async (req, res) => {
    const status = ["active", "cancelled"].includes(req.query.status) ? req.query.status : "checked_out";
    const where = withTenant(req, `(status,eq,${status})`);
    const [rows, rooms] = await Promise.all([listRows("stays", { where }), listRows("rooms", { where: withTenant(req) })]);
    const roomById = new Map(rooms.map((r) => [r.id, r]));
    const picked = rows
      .filter((s) => !req.query.roomId || s.roomId === req.query.roomId)
      .sort((a, b) => dayjs(b.checkOutAt || b.checkInAt).diff(dayjs(a.checkOutAt || a.checkInAt)))
      .slice(0, 100);
    const out = await Promise.all(
      picked.map(async (s) => {
        const view = await buildStayView(normStay(s), req);
        const main = view.guests.find((g) => g.isMain) || view.guests[0];
        return {
          stayId: s.id,
          roomId: s.roomId,
          roomName: roomById.get(s.roomId)?.name || "",
          guestName: main?.name || "",
          guestNames: view.guests.map((g) => g.name).filter(Boolean),
          pricingType: s.pricingType,
          checkInAt: s.checkInAt,
          checkOutAt: s.checkOutAt,
          status,
          total: view.breakdown.total,
        };
      })
    );
    res.json(out);
  })
);

app.post(
  "/api/stays",
  asyncRoute(async (req, res) => {
    const { roomId, pricingType, expectedCheckOutAt, mainGuest } = req.body;
    if (!roomId || !pricingType || !mainGuest?.name) {
      return res.status(400).json({ error: "roomId, pricingType, mainGuest.name are required" });
    }
    const room = owned(await findOneByBusinessId("rooms", roomId), req);
    if (!room) return res.status(404).json({ error: "room not found" });
    if (room.status !== "empty") return res.status(409).json({ error: "room is not empty" });

    const checkInAt = dayjs().toISOString();
    let lockCardId = null;
    try {
      const card = await lockProvider.issueCard({
        lockId: room.lockId,
        validFrom: checkInAt,
        validTo: expectedCheckOutAt || dayjs(checkInAt).add(1, "day").toISOString(),
      });
      lockCardId = card.cardId;
    } catch (err) {
      return res.status(502).json({ error: `lockProvider.issueCard failed: ${err.message}` });
    }

    const stayRow = await createRow("stays", {
      id: uuid(),
      homestayId: req.homestayId,
      roomId,
      pricingType, // "hourly" | "overnight" | "fullday"
      status: "active",
      checkInAt,
      expectedCheckOutAt: expectedCheckOutAt || null,
      checkOutAt: null,
      lockCardId,
    });

    await createRow("guests", {
      id: uuid(),
      stayId: stayRow.id,
      isMain: true,
      name: mainGuest.name,
      idNumber: mainGuest.idNumber || "",
      dob: mainGuest.dob || null, // "" is not a valid DATE
      phone: mainGuest.phone || "",
    });

    await updateRowByBusinessId("rooms", roomId, { status: "occupied" });

    res.status(201).json(await buildStayView(normStay(stayRow), req));
  })
);

app.post(
  "/api/stays/:id/guests",
  asyncRoute(async (req, res) => {
    const stay = owned(await findOneByBusinessId("stays", req.params.id), req);
    if (!stay) return res.status(404).json({ error: "not found" });
    const { name, idNumber, dob, phone } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const row = await createRow("guests", {
      id: uuid(),
      stayId: stay.id,
      isMain: false,
      name,
      idNumber: idNumber || "",
      dob: dob || null, // "" is not a valid DATE
      phone: phone || "",
    });
    res.status(201).json(normGuest(row));
  })
);

// Looks up one catalog item for adding a dịch vụ/phụ thu to a stay. The
// catalog-service is a separate deployment and occasionally times out or
// rate-limits, which used to fail the whole "add" — so retry transient
// failures (network error, 429, 5xx) once before giving up.
// Items the stay-detail page already loaded through /api/catalog/items are
// remembered here (per homestay), so adding one to a stay doesn't need a second
// round-trip to catalog-service. Entries expire quickly and are dropped
// whenever an admin edits the catalog, so a price change is never stale.
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const catalogItemCache = new Map();

function rememberCatalogItems(homestayId, items) {
  if (!Array.isArray(items)) return;
  const at = Date.now();
  for (const item of items) {
    if (item?.id) catalogItemCache.set(`${homestayId}:${item.id}`, { item, at });
  }
}

function forgetCatalogItems(homestayId) {
  for (const key of catalogItemCache.keys()) {
    if (key.startsWith(`${homestayId}:`)) catalogItemCache.delete(key);
  }
}

async function fetchCatalogItem(itemId, homestayId) {
  const cached = catalogItemCache.get(`${homestayId}:${itemId}`);
  if (cached && Date.now() - cached.at < CATALOG_CACHE_TTL_MS) return cached.item;
  const url = `${SERVICE_CATALOG_URL}/api/items/${encodeURIComponent(itemId)}?businessId=${encodeURIComponent(homestayId)}`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return await r.json();
      if (r.status === 404) {
        // Only catalog-service's own {error:"not found"} means the item is
        // really gone. Any other 404 (cold start, wrong route, platform page)
        // is transient/misconfiguration — retry instead of blaming the item.
        const body = await r.json().catch(() => null);
        if (body?.error === "not found") {
          const err = new Error("Không tìm thấy mục này trong danh mục dịch vụ");
          err.status = 404;
          throw err;
        }
        console.warn(`[catalog] ${url} -> 404 without catalog body, retrying`);
      }
      lastErr = new Error(`status ${r.status}`);
    } catch (err) {
      if (err.status === 404) throw err;
      lastErr = err;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
  }
  throw lastErr;
}

app.post(
  "/api/stays/:id/services",
  asyncRoute(async (req, res) => {
    const stay = owned(await findOneByBusinessId("stays", req.params.id), req);
    if (!stay) return res.status(404).json({ error: "not found" });
    const { itemId, qty } = req.body;
    if (!itemId || !qty) return res.status(400).json({ error: "itemId and qty required" });

    let item;
    try {
      item = await fetchCatalogItem(itemId, req.homestayId);
    } catch (err) {
      console.error("[catalog] add service failed:", err);
      if (err.status === 404) return res.status(404).json({ error: err.message });
      return res.status(502).json({ error: "Danh mục dịch vụ đang phản hồi chậm, vui lòng thử lại sau vài giây." });
    }

    const row = await createRow("serviceCharges", {
      id: uuid(),
      stayId: stay.id,
      kind: "service",
      itemId: item.id,
      name: item.name,
      unitPrice: item.price,
      qty: Number(qty),
      amount: item.price * Number(qty),
      addedAt: dayjs().toISOString(),
    });
    res.status(201).json(normCharge(row));
  })
);

app.post(
  "/api/stays/:id/surcharges",
  asyncRoute(async (req, res) => {
    const stay = owned(await findOneByBusinessId("stays", req.params.id), req);
    if (!stay) return res.status(404).json({ error: "not found" });
    const { surchargeRuleId, qty } = req.body;
    if (!surchargeRuleId) return res.status(400).json({ error: "surchargeRuleId required" });

    // Surcharges live in the same service-catalog as regular dịch vụ items,
    // just tagged kind: "surcharge" — one catalog backend instead of two.
    let item;
    try {
      item = await fetchCatalogItem(surchargeRuleId, req.homestayId);
    } catch (err) {
      console.error("[catalog] add surcharge failed:", err);
      if (err.status === 404) return res.status(404).json({ error: err.message });
      return res.status(502).json({ error: "Danh mục dịch vụ đang phản hồi chậm, vui lòng thử lại sau vài giây." });
    }

    const quantity = Number(qty) || 1;
    const row = await createRow("serviceCharges", {
      id: uuid(),
      stayId: stay.id,
      kind: "surcharge",
      itemId: item.id,
      name: item.name,
      unitPrice: item.price,
      qty: quantity,
      amount: item.price * quantity,
      addedAt: dayjs().toISOString(),
    });
    res.status(201).json(normCharge(row));
  })
);

// Lets a lệ tân remove a dịch vụ/phụ thu line added by mistake, or because
// the guest changed their mind — only while the stay is still active, so a
// finalized/checked-out invoice can never be edited after the fact.
app.delete(
  "/api/stays/:id/charges/:chargeId",
  asyncRoute(async (req, res) => {
    const stay = owned(await findOneByBusinessId("stays", req.params.id), req);
    if (!stay) return res.status(404).json({ error: "not found" });
    if (stay.status !== "active") {
      return res.status(409).json({ error: "Lượt lưu trú đã trả phòng, không thể sửa hoá đơn." });
    }
    const charge = await findOneByBusinessId("serviceCharges", req.params.chargeId);
    if (!charge || charge.stayId !== stay.id) return res.status(404).json({ error: "charge not found" });
    await deleteRowByBusinessId("serviceCharges", charge.id);
    res.status(204).end();
  })
);

app.post(
  "/api/stays/:id/transfer",
  asyncRoute(async (req, res) => {
    const stay = owned(await findOneByBusinessId("stays", req.params.id), req);
    if (!stay) return res.status(404).json({ error: "not found" });
    if (stay.status !== "active") return res.status(409).json({ error: "stay is not active" });
    const { toRoomId, reason } = req.body;
    const toRoom = owned(await findOneByBusinessId("rooms", toRoomId), req);
    if (!toRoom) return res.status(404).json({ error: "target room not found" });
    if (toRoom.status !== "empty") return res.status(409).json({ error: "target room is not empty" });

    await createRow("roomTransfers", {
      id: uuid(),
      stayId: stay.id,
      fromRoomId: stay.roomId,
      toRoomId,
      reason: reason || "",
      transferredAt: dayjs().toISOString(),
    });
    await updateRowByBusinessId("rooms", stay.roomId, { status: "cleaning" });
    await updateRowByBusinessId("rooms", toRoomId, { status: "occupied" });
    const updatedStay = await updateRowByBusinessId("stays", stay.id, { roomId: toRoomId });

    res.status(201).json(await buildStayView(normStay(updatedStay), req));
  })
);

// Switch the rental type (hourly / overnight / fullday) of an active stay.
// Billing is always recomputed from the original check-in, so the provisional
// total updates right away; nothing else on the stay changes.
app.put(
  "/api/stays/:id/pricing-type",
  asyncRoute(async (req, res) => {
    const stay = owned(await findOneByBusinessId("stays", req.params.id), req);
    if (!stay) return res.status(404).json({ error: "not found" });
    if (stay.status !== "active") return res.status(409).json({ error: "stay is not active" });
    const { pricingType } = req.body;
    if (!PRICING_TYPES.includes(pricingType)) {
      return res.status(400).json({ error: "pricingType phải là hourly, overnight hoặc fullday" });
    }
    const updatedStay = await updateRowByBusinessId("stays", stay.id, { pricingType });
    res.json(await buildStayView(normStay(updatedStay), req));
  })
);

app.post(
  "/api/stays/:id/simulate-swipe",
  asyncRoute(async (req, res) => {
    const stay = owned(await findOneByBusinessId("stays", req.params.id), req);
    if (!stay) return res.status(404).json({ error: "not found" });
    const row = await createRow("lockEventsLog", {
      id: uuid(),
      stayId: stay.id,
      lockCardId: stay.lockCardId,
      type: req.body.type || "swipe",
      at: dayjs().toISOString(),
    });
    res.status(201).json(row);
  })
);

// Removes a companion guest; the main guest can't be removed.
app.delete(
  "/api/stays/:id/guests/:guestId",
  asyncRoute(async (req, res) => {
    const stay = owned(await findOneByBusinessId("stays", req.params.id), req);
    if (!stay) return res.status(404).json({ error: "not found" });
    if (stay.status !== "active") return res.status(409).json({ error: "stay is not active" });
    const guest = await findOneByBusinessId("guests", req.params.guestId);
    if (!guest || guest.stayId !== stay.id) return res.status(404).json({ error: "guest not found" });
    if (normGuest(guest).isMain) return res.status(409).json({ error: "Không thể xoá khách chính." });
    await deleteRowByBusinessId("guests", guest.id);
    res.status(204).end();
  })
);

// Cancels a stay that was started by mistake: no invoice, no revenue, the
// room goes straight back to empty (nobody used it, so no cleaning needed).
app.post(
  "/api/stays/:id/cancel",
  asyncRoute(async (req, res) => {
    const stay = owned(await findOneByBusinessId("stays", req.params.id), req);
    if (!stay) return res.status(404).json({ error: "not found" });
    if (stay.status !== "active") return res.status(409).json({ error: "stay is not active" });

    const updatedStay = await updateRowByBusinessId("stays", stay.id, {
      checkOutAt: dayjs().toISOString(),
      status: "cancelled",
    });
    const room = await updateRowByBusinessId("rooms", stay.roomId, { status: "empty" });
    try {
      await lockProvider.revokeCard({ lockId: room.lockId, cardId: stay.lockCardId });
    } catch (err) {
      console.warn(`lockProvider.revokeCard failed: ${err.message}`);
    }
    res.json(await buildStayView(normStay(updatedStay), req));
  })
);

app.post(
  "/api/stays/:id/checkout",
  asyncRoute(async (req, res) => {
    const stay = owned(await findOneByBusinessId("stays", req.params.id), req);
    if (!stay) return res.status(404).json({ error: "not found" });
    if (stay.status !== "active") return res.status(409).json({ error: "stay is not active" });

    const checkOutAt = dayjs().toISOString();
    const updatedStay = await updateRowByBusinessId("stays", stay.id, { checkOutAt, status: "checked_out" });
    const room = await updateRowByBusinessId("rooms", stay.roomId, { status: "cleaning" });

    try {
      await lockProvider.revokeCard({ lockId: room.lockId, cardId: stay.lockCardId });
    } catch (err) {
      console.warn(`lockProvider.revokeCard failed: ${err.message}`);
    }

    res.json(await buildStayView(normStay(updatedStay), req));
  })
);

// ---- Guest report export (manual, for police lưu trú registration) ----

app.get(
  "/api/guest-report",
  asyncRoute(async (req, res) => {
    const { date } = req.query; // YYYY-MM-DD
    const allStays = (await listRows("stays", { where: withTenant(req) })).filter((s) => s.status !== "cancelled");
    const stays = date ? allStays.filter((s) => dayjs(s.checkInAt).format("YYYY-MM-DD") === date) : allStays;
    const rooms = await listRows("rooms", { where: withTenant(req) });
    const roomById = new Map(rooms.map((r) => [r.id, r]));

    const rows = [];
    for (const stay of stays) {
      const guests = await listRows("guests", { where: `(stayId,eq,${stay.id})` });
      const room = roomById.get(stay.roomId);
      for (const g of guests) {
        rows.push({
          room: room?.name || "",
          name: g.name,
          idNumber: g.idNumber || "",
          dob: g.dob || "",
          phone: g.phone || "",
          checkInAt: stay.checkInAt,
          checkOutAt: stay.checkOutAt || "",
        });
      }
    }

    if (req.query.format === "csv") {
      const header = "Phong,HoTen,CCCD,NgaySinh,DienThoai,NhanPhong,TraPhong";
      const csvRows = rows.map((r) =>
        [r.room, r.name, r.idNumber, r.dob, r.phone, r.checkInAt, r.checkOutAt]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
      );
      res.header("Content-Type", "text/csv; charset=utf-8");
      res.header("Content-Disposition", `attachment; filename="guest-report-${date || "all"}.csv"`);
      return res.send([header, ...csvRows].join("\n"));
    }

    res.json(rows);
  })
);

// ---- Settings (payment / owner info, same shape as the nhà trọ app) ----
// One row per homestay, looked up/created by homestayId.

app.get(
  "/api/settings",
  asyncRoute(async (req, res) => {
    const row = await findOneWhere("settings", withTenant(req));
    res.json(normSettings(row));
  })
);

app.put(
  "/api/settings",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const existing = await findOneWhere("settings", withTenant(req));
    const row = existing
      ? await updateRowByBusinessId("settings", existing.id, req.body)
      : await createRow("settings", { id: uuid(), homestayId: req.homestayId, ...req.body });
    res.json(normSettings(row));
  })
);

// ---- Reports ----

app.get(
  "/api/reports/revenue",
  asyncRoute(async (req, res) => {
    const { from, to } = req.query; // YYYY-MM-DD, inclusive
    const completed = await listRows("stays", { where: withTenant(req, "(status,eq,checked_out)") });

    const byDay = {};
    const byService = {};
    for (const stayRow of completed) {
      const stay = normStay(stayRow);
      const day = dayjs(stay.checkOutAt).format("YYYY-MM-DD");
      if (from && day < from) continue;
      if (to && day > to) continue;
      const view = await buildStayView(stay, req);
      if (!byDay[day]) {
        byDay[day] = { date: day, roomRevenue: 0, serviceRevenue: 0, total: 0, stayCount: 0 };
      }
      byDay[day].roomRevenue += view.breakdown.roomTotal;
      byDay[day].serviceRevenue += view.breakdown.serviceTotal;
      byDay[day].total += view.breakdown.total;
      byDay[day].stayCount += 1;

      for (const charge of view.serviceCharges) {
        const key = `${charge.kind}:${charge.name}`;
        if (!byService[key]) {
          byService[key] = { name: charge.name, kind: charge.kind, qty: 0, amount: 0, orderCount: 0 };
        }
        byService[key].qty += charge.qty;
        byService[key].amount += charge.amount;
        byService[key].orderCount += 1;
      }
    }

    const rows = Object.values(byDay).sort((a, b) => (a.date < b.date ? -1 : 1));
    const grandTotal = rows.reduce(
      (acc, r) => ({
        roomRevenue: acc.roomRevenue + r.roomRevenue,
        serviceRevenue: acc.serviceRevenue + r.serviceRevenue,
        total: acc.total + r.total,
        stayCount: acc.stayCount + r.stayCount,
      }),
      { roomRevenue: 0, serviceRevenue: 0, total: 0, stayCount: 0 }
    );
    const serviceBreakdown = Object.values(byService).sort((a, b) => b.amount - a.amount);

    res.json({ rows, grandTotal, serviceBreakdown });
  })
);

app.get(
  "/api/reports/occupancy",
  asyncRoute(async (req, res) => {
    const { from, to } = req.query; // YYYY-MM-DD, filters by checkInAt
    const rooms = await listRows("rooms", { where: withTenant(req) });
    const totalRooms = rooms.length;
    const currentOccupied = rooms.filter((r) => r.status === "occupied").length;
    const currentCleaning = rooms.filter((r) => r.status === "cleaning").length;
    const currentEmpty = totalRooms - currentOccupied - currentCleaning;
    const roomById = new Map(rooms.map((r) => [r.id, r]));

    const allStays = (await listRows("stays", { where: withTenant(req) })).filter((s) => s.status !== "cancelled");
    const filtered = allStays
      .filter((s) => {
        const day = dayjs(s.checkInAt).format("YYYY-MM-DD");
        if (from && day < from) return false;
        if (to && day > to) return false;
        return true;
      })
      .sort((a, b) => dayjs(b.checkInAt).diff(dayjs(a.checkInAt)));

    const stays = await Promise.all(
      filtered.map(async (s) => {
        const guests = await listRows("guests", { where: `(stayId,eq,${s.id})` });
        const mainGuest = guests.find(isMainGuest);
        const endAt = s.checkOutAt || dayjs().toISOString();
        const durationHours = Math.round(dayjs(endAt).diff(dayjs(s.checkInAt), "minute") / 6) / 10;
        return {
          stayId: s.id,
          roomName: roomById.get(s.roomId)?.name || "",
          guestName: mainGuest?.name || "",
          guestNames: [...guests].sort((a, b) => Number(isMainGuest(b)) - Number(isMainGuest(a))).map((g) => g.name).filter(Boolean),
          guestCount: guests.length,
          pricingType: s.pricingType,
          status: s.status,
          checkInAt: s.checkInAt,
          checkOutAt: s.checkOutAt || null,
          durationHours,
        };
      })
    );

    res.json({
      totalRooms,
      currentOccupied,
      currentCleaning,
      currentEmpty,
      occupancyRate: totalRooms ? Math.round((currentOccupied / totalRooms) * 1000) / 10 : 0,
      stays,
    });
  })
);

app.listen(PORT, () => {
  console.log(`[homestay-server] listening on http://localhost:${PORT}`);
  console.log(`[homestay-server] lockProvider = ${lockProvider.constructor.name}`);
  console.log(`[homestay-server] storage = Postgres (${process.env.DATABASE_URL ? "configured" : "NOT CONFIGURED"})`);
});
