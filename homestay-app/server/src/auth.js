import crypto from "crypto";
import jwt from "jsonwebtoken";
import { actorStore } from "./actor.js";

// Prototype-grade secret — a real deployment must set JWT_SECRET via env.
const JWT_SECRET = process.env.JWT_SECRET || "homestay-dev-secret-change-me";
const TOKEN_TTL = "12h";

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  // A user row without a usable "salt:hash" (missing column, bad import) must
  // fail the login cleanly, not crash the request.
  if (typeof stored !== "string" || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, name: user.name, homestayId: user.homestayId || null },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

// Any logged-in user (owner, admin, or nhân viên) may call the route.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Chưa đăng nhập." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    // Everything after this middleware (routes, db writes) knows who is acting.
    actorStore.run(String(req.user.sub || "system"), next);
  } catch {
    res.status(401).json({ error: "Phiên đăng nhập hết hạn hoặc không hợp lệ." });
  }
}

// Stacks on top of requireAuth — "admin" or "owner" passes (owner can do
// anything an admin can, for any homestay).
export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin" && req.user?.role !== "owner") {
    return res.status(403).json({ error: "Chỉ admin mới được phép thực hiện thao tác này." });
  }
  next();
}

// Only the top-level "owner" role — manages homestays themselves and can
// act across all of them. Stacks on top of requireAuth.
export function requireOwner(req, res, next) {
  if (req.user?.role !== "owner") {
    return res.status(403).json({ error: "Chỉ chủ hệ thống (owner) mới được phép thực hiện thao tác này." });
  }
  next();
}

// Pins every homestay-scoped route to exactly one homestay's data.
// admin/staff are permanently scoped to the homestay in their own JWT; an
// owner has none, so they must say which homestay they're currently
// working in via the X-Homestay-Id header (set by the frontend's homestay
// switcher) — never trusted from a body/query field a non-owner could spoof.
export function requireHomestayContext(req, res, next) {
  if (req.user.role === "owner") {
    const headerHomestayId = req.headers["x-homestay-id"];
    if (!headerHomestayId) {
      return res.status(400).json({ error: "Thiếu X-Homestay-Id — chọn 1 homestay để thao tác." });
    }
    req.homestayId = headerHomestayId;
    req.isOwnerContext = true;
  } else {
    req.homestayId = req.user.homestayId;
    req.isOwnerContext = false;
  }
  next();
}
