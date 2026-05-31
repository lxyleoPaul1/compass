import { Router } from "express";
import bcrypt from "bcryptjs";
import db from "../lib/db.js";
import { validateRegister, validateLogin } from "../lib/validate.js";
import { attachUser, publicUser } from "../middleware/auth.js";

const router = Router();

router.use(attachUser);

router.get("/me", (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

router.post("/register", (req, res) => {
  const { username, email_or_phone, password, school, major_cat } = req.body || {};
  const err = validateRegister({ username, email_or_phone, password, school, major_cat });
  if (err) return res.status(400).json({ error: err });

  const u = String(username).trim();
  const e = String(email_or_phone).trim();
  const hash = bcrypt.hashSync(password, 10);

  try {
    const info = db
      .prepare(
        "INSERT INTO users (username, email_or_phone, password_hash, school, major_cat) VALUES (?, ?, ?, ?, ?)"
      )
      .run(u, e, hash, school?.trim() || null, major_cat?.trim() || null);
    req.session.userId = info.lastInsertRowid;
    const user = db
      .prepare("SELECT id, username, email_or_phone, role, school, major_cat, created_at FROM users WHERE id = ?")
      .get(info.lastInsertRowid);
    res.json({ user: publicUser(user) });
  } catch (e2) {
    if (String(e2.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "用户名或邮箱/手机号已被注册" });
    }
    throw e2;
  }
});

router.post("/login", (req, res) => {
  const { login, password } = req.body || {};
  const err = validateLogin({ login, password });
  if (err) return res.status(400).json({ error: err });

  const l = String(login).trim();
  const row = db
    .prepare("SELECT id, username, email_or_phone, password_hash, role, school, major_cat, created_at FROM users WHERE username = ? COLLATE NOCASE OR email_or_phone = ?")
    .get(l, l);

  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: "用户名或密码错误" });
  }

  req.session.userId = row.id;
  // TODO: 可选——登录后将 localStorage 中的问卷/计划/任务合并到数据库（需前端 POST /api/sync-guest）
  res.json({ user: publicUser(row) });
});

router.post("/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

export default router;
