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
} from "./nocodb.js";
import { computeStayRoomCharge } from "./pricing.js";
import { createLockProvider } from "./lockProvider.js";
import { hashPassword, verifyPassword, signToken, requireAuth, requireAdmin } from "./auth.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const SERVICE_CATALOG_URL = process.env.SERVICE_CATALOG_URL || "http://localhost:4100";
// Shared secret with catalog-service — proves a write came from this
// trusted backend (already auth'd + admin-checked), never from the browser
// directly. Keep it out of any frontend bundle/env.
const CATALOG_ADMIN_KEY = process.env.CATALOG_ADMIN_KEY || "dev-catalog-admin-key-change-me";
// Settings is a single-row table — always addressed by this fixed business id.
const SETTINGS_ROW_ID = "settings-1";
const lockProvider = createLockProvider();

// Every route handler below is async (NocoDB is an HTTP call away); this
// wrapper means a thrown/rejected error (NocoDB down, misconfigured table,
// network blip) turns into a 502 instead of crashing the process or hanging
// the request. Explicit res.status(...) calls inside handlers still work
// exactly as before — this only catches what they don't handle themselves.
function asyncRoute(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(err);
      res.status(502).json({ error: `NocoDB: ${err.message}` });
    }
  };
}

// ---- Normalizers ----
// NocoDB returns every column including its own system fields (Id,
// CreatedAt, ...) and may serialize numbers/booleans loosely depending on
// column type — these pin each row back down to the exact shape the rest of
// the app (and the frontend) already expects, with numbers/booleans coerced.

function normUser(u) {
  return { id: u.id, username: u.username, name: u.name, role: u.role };
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
    roomId: s.roomId,
    pricingType: s.pricingType,
    status: s.status,
    checkInAt: s.checkInAt,
    expectedCheckOutAt: s.expectedCheckOutAt || null,
    checkOutAt: s.checkOutAt || null,
    lockCardId: s.lockCardId || null,
  };
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
    const token = signToken(user);
    res.json({ token, user: normUser(user) });
  })
);

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ id: req.user.sub, username: req.user.username, name: req.user.name, role: req.user.role });
});

// Every route below this line requires a logged-in user (admin or nhân
// viên); individual routes add requireAdmin on top where only admin may act.
app.use("/api", requireAuth);

// ---- User management (admin only) ----
// Passwords are one-way hashed (scrypt) — nobody, including admin, can ever
// look up an existing password. Admin can only set a NEW one (create, or
// "đặt lại mật khẩu" on an existing account).

app.get(
  "/api/admin/users",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const rows = await listRows("users");
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
    const row = await createRow("users", { id: uuid(), username, name, role, passwordHash: hashPassword(password) });
    res.status(201).json(normUser(row));
  })
);

app.put(
  "/api/admin/users/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const user = await findOneByBusinessId("users", req.params.id);
    if (!user) return res.status(404).json({ error: "not found" });
    const { name, role, password } = req.body;
    if (role && role !== "admin" && role !== "staff") {
      return res.status(400).json({ error: "role phải là admin hoặc staff" });
    }
    // Don't let the last admin demote themselves (or be demoted) and lock
    // everyone out of admin-only screens.
    if (role && role !== "admin" && user.role === "admin") {
      const admins = await listRows("users", { where: "(role,eq,admin)" });
      const others = admins.filter((u) => u.id !== user.id);
      if (others.length === 0) {
        return res.status(409).json({ error: "Không thể đổi vai trò — đây là admin cuối cùng." });
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
    const user = await findOneByBusinessId("users", req.params.id);
    if (!user) return res.status(404).json({ error: "not found" });
    if (user.id === req.user.sub) {
      return res.status(409).json({ error: "Không thể tự xoá tài khoản đang đăng nhập." });
    }
    if (user.role === "admin") {
      const admins = await listRows("users", { where: "(role,eq,admin)" });
      if (admins.length <= 1) return res.status(409).json({ error: "Không thể xoá — đây là admin cuối cùng." });
    }
    await deleteRowByBusinessId("users", req.params.id);
    res.status(204).end();
  })
);

async function ratePlanForRoomId(roomId) {
  const room = await findOneByBusinessId("rooms", roomId);
  if (!room) throw new Error(`Room not found: ${roomId}`);
  const ratePlan = await findOneWhere("ratePlans", `(roomTypeId,eq,${room.roomTypeId})`);
  if (!ratePlan) throw new Error(`No rate plan for room type: ${room.roomTypeId}`);
  return { room: normRoom(room), ratePlan: normRatePlan(ratePlan) };
}

async function buildStayView(stay) {
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
        transferredAt: t.transferredAt,
        fromRoomName: fromRoom?.name || t.fromRoomId,
        toRoomName: toRoom?.name || t.toRoomId,
      };
    })
  );

  const endAt = stay.checkOutAt || dayjs().toISOString();
  const { room, ratePlan } = await ratePlanForRoomId(stay.roomId);
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
    const rows = await listRows("roomTypes");
    res.json(rows.map(normRoomType));
  })
);

app.get(
  "/api/rooms",
  asyncRoute(async (req, res) => {
    const [rooms, activeStays] = await Promise.all([
      listRows("rooms"),
      listRows("stays", { where: "(status,eq,active)" }),
    ]);
    const activeByRoom = new Map(activeStays.map((s) => [s.roomId, s.id]));
    res.json(rooms.map((r) => ({ ...normRoom(r), activeStayId: activeByRoom.get(r.id) || null })));
  })
);

app.post(
  "/api/rooms",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { name, roomTypeId, lockId } = req.body;
    if (!name || !roomTypeId) return res.status(400).json({ error: "name and roomTypeId are required" });
    const roomType = await findOneByBusinessId("roomTypes", roomTypeId);
    if (!roomType) return res.status(400).json({ error: "unknown roomTypeId" });
    const row = await createRow("rooms", {
      id: uuid(),
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
    if (isConfigChange && req.user.role !== "admin") {
      return res.status(403).json({ error: "Chỉ admin mới được sửa thông tin phòng." });
    }
    const patch = {};
    if (status) patch.status = status;
    if (name) patch.name = name;
    if (roomTypeId) patch.roomTypeId = roomTypeId;
    if (lockId != null) patch.lockId = lockId;
    if (active != null) patch.active = Boolean(active);
    const updated = await updateRowByBusinessId("rooms", req.params.id, patch);
    if (!updated) return res.status(404).json({ error: "not found" });
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
    const room = await findOneByBusinessId("rooms", req.params.id);
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
    const rows = await listRows("ratePlans");
    res.json(rows.map(normRatePlan));
  })
);

app.put(
  "/api/rate-plans/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const updated = await updateRowByBusinessId("ratePlans", req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json(normRatePlan(updated));
  })
);

// ---- Catalog admin proxy ----
// Dịch vụ/phụ thu live in the separate catalog-service (its own repo, its
// own port) so nhà trọ can share it too. Writes to it need to be gated by
// *this* app's admin check, but catalog-service can't see our JWTs — so the
// browser never talks to catalog-service for writes; it calls these proxy
// routes (admin-only), which forward the request with a shared API key
// catalog-service trusts. Reads (GET items/categories) stay public and
// go straight from the browser to catalog-service — no secret involved.

async function proxyToCatalog(req, res, path, method) {
  try {
    const r = await fetch(`${SERVICE_CATALOG_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-api-key": CATALOG_ADMIN_KEY },
      body: method === "DELETE" ? undefined : JSON.stringify(req.body),
    });
    if (r.status === 204) return res.status(204).end();
    const body = await r.json().catch(() => ({}));
    res.status(r.status).json(body);
  } catch (err) {
    res.status(502).json({ error: `could not reach catalog-service: ${err.message}` });
  }
}

app.post("/api/admin/catalog/categories", requireAdmin, (req, res) => proxyToCatalog(req, res, "/api/categories", "POST"));
app.put("/api/admin/catalog/categories/:id", requireAdmin, (req, res) =>
  proxyToCatalog(req, res, `/api/categories/${req.params.id}`, "PUT")
);
app.delete("/api/admin/catalog/categories/:id", requireAdmin, (req, res) =>
  proxyToCatalog(req, res, `/api/categories/${req.params.id}`, "DELETE")
);
app.post("/api/admin/catalog/items", requireAdmin, (req, res) => proxyToCatalog(req, res, "/api/items", "POST"));
app.put("/api/admin/catalog/items/:id", requireAdmin, (req, res) =>
  proxyToCatalog(req, res, `/api/items/${req.params.id}`, "PUT")
);
app.delete("/api/admin/catalog/items/:id", requireAdmin, (req, res) =>
  proxyToCatalog(req, res, `/api/items/${req.params.id}`, "DELETE")
);

// ---- Stays (check-in / detail / services / surcharges / transfer / checkout) ----

app.get(
  "/api/stays",
  asyncRoute(async (req, res) => {
    const rows = await listRows("stays", req.query.status ? { where: `(status,eq,${req.query.status})` } : {});
    const views = await Promise.all(rows.map((s) => buildStayView(normStay(s))));
    res.json(views);
  })
);

app.get(
  "/api/stays/:id",
  asyncRoute(async (req, res) => {
    const stay = await findOneByBusinessId("stays", req.params.id);
    if (!stay) return res.status(404).json({ error: "not found" });
    res.json(await buildStayView(normStay(stay)));
  })
);

app.post(
  "/api/stays",
  asyncRoute(async (req, res) => {
    const { roomId, pricingType, expectedCheckOutAt, mainGuest } = req.body;
    if (!roomId || !pricingType || !mainGuest?.name) {
      return res.status(400).json({ error: "roomId, pricingType, mainGuest.name are required" });
    }
    const room = await findOneByBusinessId("rooms", roomId);
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
      dob: mainGuest.dob || null, // NocoDB rejects "" for a DATE column
      phone: mainGuest.phone || "",
    });

    await updateRowByBusinessId("rooms", roomId, { status: "occupied" });

    res.status(201).json(await buildStayView(normStay(stayRow)));
  })
);

app.post(
  "/api/stays/:id/guests",
  asyncRoute(async (req, res) => {
    const stay = await findOneByBusinessId("stays", req.params.id);
    if (!stay) return res.status(404).json({ error: "not found" });
    const { name, idNumber, dob, phone } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const row = await createRow("guests", {
      id: uuid(),
      stayId: stay.id,
      isMain: false,
      name,
      idNumber: idNumber || "",
      dob: dob || null, // NocoDB rejects "" for a DATE column
      phone: phone || "",
    });
    res.status(201).json(normGuest(row));
  })
);

app.post(
  "/api/stays/:id/services",
  asyncRoute(async (req, res) => {
    const stay = await findOneByBusinessId("stays", req.params.id);
    if (!stay) return res.status(404).json({ error: "not found" });
    const { itemId, qty } = req.body;
    if (!itemId || !qty) return res.status(400).json({ error: "itemId and qty required" });

    let item;
    try {
      const r = await fetch(`${SERVICE_CATALOG_URL}/api/items/${itemId}`);
      if (!r.ok) throw new Error(`status ${r.status}`);
      item = await r.json();
    } catch (err) {
      return res.status(502).json({ error: `could not reach service-catalog: ${err.message}` });
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
    const stay = await findOneByBusinessId("stays", req.params.id);
    if (!stay) return res.status(404).json({ error: "not found" });
    const { surchargeRuleId, qty } = req.body;
    if (!surchargeRuleId) return res.status(400).json({ error: "surchargeRuleId required" });

    // Surcharges live in the same service-catalog as regular dịch vụ items,
    // just tagged kind: "surcharge" — one catalog backend instead of two.
    let item;
    try {
      const r = await fetch(`${SERVICE_CATALOG_URL}/api/items/${surchargeRuleId}`);
      if (!r.ok) throw new Error(`status ${r.status}`);
      item = await r.json();
    } catch (err) {
      return res.status(502).json({ error: `could not reach service-catalog: ${err.message}` });
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
    const stay = await findOneByBusinessId("stays", req.params.id);
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
    const stay = await findOneByBusinessId("stays", req.params.id);
    if (!stay) return res.status(404).json({ error: "not found" });
    if (stay.status !== "active") return res.status(409).json({ error: "stay is not active" });
    const { toRoomId, reason } = req.body;
    const toRoom = await findOneByBusinessId("rooms", toRoomId);
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

    res.status(201).json(await buildStayView(normStay(updatedStay)));
  })
);

app.post(
  "/api/stays/:id/simulate-swipe",
  asyncRoute(async (req, res) => {
    const stay = await findOneByBusinessId("stays", req.params.id);
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

app.post(
  "/api/stays/:id/checkout",
  asyncRoute(async (req, res) => {
    const stay = await findOneByBusinessId("stays", req.params.id);
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

    res.json(await buildStayView(normStay(updatedStay)));
  })
);

// ---- Guest report export (manual, for police lưu trú registration) ----

app.get(
  "/api/guest-report",
  asyncRoute(async (req, res) => {
    const { date } = req.query; // YYYY-MM-DD
    const allStays = await listRows("stays");
    const stays = date ? allStays.filter((s) => dayjs(s.checkInAt).format("YYYY-MM-DD") === date) : allStays;
    const rooms = await listRows("rooms");
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
// Single-row table, always addressed by the fixed id SETTINGS_ROW_ID.

app.get(
  "/api/settings",
  asyncRoute(async (req, res) => {
    const row = await findOneByBusinessId("settings", SETTINGS_ROW_ID);
    res.json(normSettings(row));
  })
);

app.put(
  "/api/settings",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const existing = await findOneByBusinessId("settings", SETTINGS_ROW_ID);
    const row = existing
      ? await updateRowByBusinessId("settings", SETTINGS_ROW_ID, req.body)
      : await createRow("settings", { id: SETTINGS_ROW_ID, ...req.body });
    res.json(normSettings(row));
  })
);

// ---- Reports ----

app.get(
  "/api/reports/revenue",
  asyncRoute(async (req, res) => {
    const { from, to } = req.query; // YYYY-MM-DD, inclusive
    const completed = await listRows("stays", { where: "(status,eq,checked_out)" });

    const byDay = {};
    for (const stayRow of completed) {
      const stay = normStay(stayRow);
      const day = dayjs(stay.checkOutAt).format("YYYY-MM-DD");
      if (from && day < from) continue;
      if (to && day > to) continue;
      const view = await buildStayView(stay);
      if (!byDay[day]) {
        byDay[day] = { date: day, roomRevenue: 0, serviceRevenue: 0, total: 0, stayCount: 0 };
      }
      byDay[day].roomRevenue += view.breakdown.roomTotal;
      byDay[day].serviceRevenue += view.breakdown.serviceTotal;
      byDay[day].total += view.breakdown.total;
      byDay[day].stayCount += 1;
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

    res.json({ rows, grandTotal });
  })
);

app.get(
  "/api/reports/occupancy",
  asyncRoute(async (req, res) => {
    const { from, to } = req.query; // YYYY-MM-DD, filters by checkInAt
    const rooms = await listRows("rooms");
    const totalRooms = rooms.length;
    const currentOccupied = rooms.filter((r) => r.status === "occupied").length;
    const currentCleaning = rooms.filter((r) => r.status === "cleaning").length;
    const currentEmpty = totalRooms - currentOccupied - currentCleaning;
    const roomById = new Map(rooms.map((r) => [r.id, r]));

    const allStays = await listRows("stays");
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
        const mainGuest = guests.find((g) => g.isMain === true || g.isMain === 1 || g.isMain === "true");
        const endAt = s.checkOutAt || dayjs().toISOString();
        const durationHours = Math.round(dayjs(endAt).diff(dayjs(s.checkInAt), "minute") / 6) / 10;
        return {
          stayId: s.id,
          roomName: roomById.get(s.roomId)?.name || "",
          guestName: mainGuest?.name || "",
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
  console.log(`[homestay-server] storage = NocoDB (${process.env.NOCODB_URL || "NOT CONFIGURED"})`);
});
