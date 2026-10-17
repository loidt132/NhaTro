import crypto from "crypto";
import jwt from "jsonwebtoken";

// Prototype-grade secret — a real deployment must set JWT_SECRET via env.
const JWT_SECRET = process.env.JWT_SECRET || "homestay-dev-secret-change-me";
const TOKEN_TTL = "12h";

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, role: user.role, name: user.name }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

// Any logged-in user (admin or nhân viên) may call the route.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Chưa đăng nhập." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Phiên đăng nhập hết hạn hoặc không hợp lệ." });
  }
}

// Stacks on top of requireAuth — only role "admin" passes.
export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Chỉ admin mới được phép thực hiện thao tác này." });
  }
  next();
}
