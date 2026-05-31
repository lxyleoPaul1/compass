import { Router } from "express";
import db from "../lib/db.js";
import { rateLimit } from "../lib/rateLimit.js";
import { validateWallPost, sanitizeText } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

const TYPE_LABEL = { team: "组队招募", help: "求助答疑", share: "经验分享" };

function mapPost(r, userId) {
  return {
    id: r.id,
    type: r.type,
    typeLabel: TYPE_LABEL[r.type] || r.type,
    title: r.title,
    body: r.body,
    related_competition: r.related_competition,
    team_size: r.team_size,
    skills: r.skills || null,
    created_at: r.created_at,
    author: r.username,
    isMentor: r.user_role === "mentor",
    upvotes: r.upvotes || 0,
    bumped: Boolean(r.bumped),
  };
}

router.get("/", (req, res) => {
  const type = req.query.type;
  const q = String(req.query.q || "").trim().slice(0, 80);
  const sort = req.query.sort === "hot" ? "hot" : "latest";
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 15));
  const offset = (page - 1) * limit;
  const userId = req.user?.id;

  let where = "1=1";
  const params = [];
  if (type && ["team", "help", "share"].includes(type)) {
    where += " AND w.type = ?";
    params.push(type);
  }
  if (q) {
    where += " AND (w.title LIKE ? OR w.body LIKE ? OR w.related_competition LIKE ?)";
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const competition = String(req.query.competition || "").trim().slice(0, 120);
  if (competition) {
    where += " AND w.related_competition LIKE ?";
    params.push(`%${competition}%`);
  }

  const order = sort === "hot" ? "upvotes DESC, w.created_at DESC" : "w.created_at DESC";

  const sql = `
    SELECT w.id, w.type, w.title, w.body, w.related_competition, w.team_size, w.skills, w.created_at,
           u.username, u.role AS user_role,
           (SELECT COUNT(*) FROM wall_upvotes uu WHERE uu.post_id = w.id) AS upvotes
           ${userId ? ", (SELECT 1 FROM wall_upvotes uu2 WHERE uu2.post_id = w.id AND uu2.user_id = ?) AS bumped" : ", 0 AS bumped"}
    FROM wall_posts w JOIN users u ON u.id = w.user_id
    WHERE ${where}
    ORDER BY ${order}
    LIMIT ? OFFSET ?`;

  const queryParams = userId ? [userId, ...params, limit, offset] : [...params, limit, offset];
  const rows = db.prepare(sql).all(...queryParams);

  const countRow = db
    .prepare(`SELECT COUNT(*) AS n FROM wall_posts w WHERE ${where}`)
    .get(...params);

  res.json({
    page,
    limit,
    total: countRow?.n || 0,
    hasMore: offset + rows.length < (countRow?.n || 0),
    posts: rows.map((r) => mapPost(r, userId)),
  });
});

router.post("/", requireAuth, (req, res) => {
  const rl = rateLimit(`wall:${req.user.id}`, { windowMs: 300000, max: 3 });
  if (!rl.ok) return res.status(429).json({ error: `发帖过于频繁，请 ${rl.retryAfter} 秒后再试` });

  const { type, title, body, related_competition, team_size, skills } = req.body || {};
  const err = validateWallPost({ type, title, body, related_competition, team_size, skills });
  if (err) return res.status(400).json({ error: err });

  const info = db
    .prepare(
      "INSERT INTO wall_posts (user_id, type, title, body, related_competition, team_size, skills) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      req.user.id,
      type,
      sanitizeText(title, 80),
      sanitizeText(body, 2000),
      related_competition ? sanitizeText(related_competition, 120) : null,
      team_size != null && team_size !== "" ? Number(team_size) : null,
      skills ? sanitizeText(skills, 200) : null
    );

  const row = db
    .prepare(
      `SELECT w.*, u.username, u.role AS user_role, 0 AS upvotes, 0 AS bumped
       FROM wall_posts w JOIN users u ON u.id = w.user_id WHERE w.id = ?`
    )
    .get(info.lastInsertRowid);

  res.status(201).json({ post: mapPost(row, req.user.id) });
});

/** 一键顶/加入（toggle，每用户每帖一次） */
router.post("/:id/bump", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const post = db.prepare("SELECT id FROM wall_posts WHERE id = ?").get(id);
  if (!post) return res.status(404).json({ error: "帖子不存在" });

  const existing = db.prepare("SELECT 1 FROM wall_upvotes WHERE post_id = ? AND user_id = ?").get(id, req.user.id);
  if (existing) {
    db.prepare("DELETE FROM wall_upvotes WHERE post_id = ? AND user_id = ?").run(id, req.user.id);
  } else {
    db.prepare("INSERT INTO wall_upvotes (post_id, user_id) VALUES (?, ?)").run(id, req.user.id);
  }
  const upvotes = db.prepare("SELECT COUNT(*) AS n FROM wall_upvotes WHERE post_id = ?").get(id)?.n || 0;
  const bumped = db.prepare("SELECT 1 FROM wall_upvotes WHERE post_id = ? AND user_id = ?").get(id, req.user.id);
  res.json({ upvotes, bumped: Boolean(bumped) });
});

router.delete("/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const post = db.prepare("SELECT user_id FROM wall_posts WHERE id = ?").get(id);
  if (!post) return res.status(404).json({ error: "帖子不存在" });
  if (post.user_id !== req.user.id && req.user.role !== "mentor") {
    return res.status(403).json({ error: "无权删除" });
  }
  db.prepare("DELETE FROM wall_posts WHERE id = ?").run(id);
  res.json({ ok: true });
});

export default router;
