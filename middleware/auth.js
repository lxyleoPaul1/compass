import db from "../lib/db.js";

const USER_PUBLIC =
  "SELECT id, username, email_or_phone, role, school, major_cat, created_at FROM users WHERE id = ?";

export function attachUser(req, _res, next) {
  if (req.session?.userId) {
    req.user = db.prepare(USER_PUBLIC).get(req.session.userId) || null;
    if (!req.user) req.session.userId = null;
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user?.id) return res.status(401).json({ error: "请先登录" });
  next();
}

export function requireMentorOrOwner(getOwnerId) {
  return (req, res, next) => {
    if (!req.user?.id) return res.status(401).json({ error: "请先登录" });
    const ownerId = typeof getOwnerId === "function" ? getOwnerId(req) : getOwnerId;
    if (req.user.role === "mentor" || req.user.id === ownerId) return next();
    return res.status(403).json({ error: "无权操作" });
  };
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email_or_phone: row.email_or_phone,
    role: row.role,
    school: row.school || "",
    major_cat: row.major_cat || "",
    created_at: row.created_at,
  };
}
