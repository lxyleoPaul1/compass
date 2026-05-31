import { Router } from "express";
import db from "../lib/db.js";
import { validateTask } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

function rowToTask(r) {
  return {
    id: r.id,
    title: r.title,
    due_date: r.due_date,
    scheduled_date: r.scheduled_date || null,
    scheduled_start: r.scheduled_start || null,
    scheduled_end: r.scheduled_end || null,
    order_index: r.order_index ?? 0,
    starred: Boolean(r.starred),
    source: r.source,
    related_competition_id: r.related_competition_id,
    status: r.status,
    estimated_pomodoros: r.estimated_pomodoros,
    completed_pomodoros: r.completed_pomodoros,
    created_at: r.created_at,
  };
}

router.get("/stats", requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const pomToday =
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM pomodoro_sessions WHERE user_id = ? AND completed = 1 AND date(started_at) = ?"
      )
      .get(req.user.id, today)?.n || 0;
  const pomWeek =
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM pomodoro_sessions WHERE user_id = ? AND completed = 1 AND date(started_at) >= ?"
      )
      .get(req.user.id, weekAgo)?.n || 0;
  const doneToday =
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND status = 'done' AND date(created_at) <= date('now') AND id IN (SELECT id FROM tasks WHERE user_id = ? AND status = 'done')"
      )
      .get(req.user.id, req.user.id)?.n || 0;
  const doneWeek =
    db
      .prepare("SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND status = 'done' AND created_at >= ?")
      .get(req.user.id, weekAgo + "T00:00:00.000Z")?.n || 0;
  const doneTodayFixed =
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND status = 'done'
         AND (scheduled_date = ? OR (scheduled_date IS NULL AND due_date = ?))`
      )
      .get(req.user.id, today, today)?.n || 0;

  // 本周每日番茄趋势
  const trend = db
    .prepare(
      `SELECT date(started_at) AS d, COUNT(*) AS n FROM pomodoro_sessions
       WHERE user_id = ? AND completed = 1 AND date(started_at) >= ?
       GROUP BY date(started_at) ORDER BY d ASC`
    )
    .all(req.user.id, weekAgo);

  res.json({
    pomodorosToday: pomToday,
    pomodorosWeek: pomWeek,
    tasksDoneToday: doneTodayFixed,
    tasksDoneWeek: doneWeek,
    pomTrend: trend,
  });
});

/** 当日待办（清单/时间轴共用数据源） */
router.get("/day", requireAuth, (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date 格式无效" });
  const rows = db
    .prepare(
      `SELECT * FROM tasks WHERE user_id = ?
       AND (scheduled_date = ? OR (scheduled_date IS NULL AND due_date = ?))
       ORDER BY starred DESC, order_index ASC, id ASC`
    )
    .all(req.user.id, date, date);
  res.json({ date, tasks: rows.map(rowToTask) });
});

router.get("/", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      "SELECT * FROM tasks WHERE user_id = ? ORDER BY CASE status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END, due_date IS NULL, due_date ASC, id DESC"
    )
    .all(req.user.id);
  res.json({ tasks: rows.map(rowToTask) });
});

router.post("/", requireAuth, (req, res) => {
  const {
    title,
    due_date,
    scheduled_date,
    scheduled_start,
    scheduled_end,
    source,
    related_competition_id,
    status,
    estimated_pomodoros,
    starred,
    order_index,
  } = req.body || {};
  const err = validateTask({ title, due_date, scheduled_date, scheduled_start, scheduled_end, source, status });
  if (err) return res.status(400).json({ error: err });

  const sd = scheduled_date || due_date || new Date().toISOString().slice(0, 10);
  const maxOrder =
    db
      .prepare("SELECT COALESCE(MAX(order_index), -1) AS m FROM tasks WHERE user_id = ? AND scheduled_date = ?")
      .get(req.user.id, sd)?.m ?? -1;

  const info = db
    .prepare(
      `INSERT INTO tasks (user_id, title, due_date, scheduled_date, scheduled_start, scheduled_end, source, related_competition_id, status, estimated_pomodoros, starred, order_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      String(title).trim(),
      due_date || null,
      sd,
      scheduled_start || null,
      scheduled_end || null,
      source || "custom",
      related_competition_id || null,
      status || "todo",
      estimated_pomodoros != null ? Number(estimated_pomodoros) : null,
      starred ? 1 : 0,
      order_index != null ? Number(order_index) : maxOrder + 1
    );
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json({ task: rowToTask(task) });
});

/** 批量更新排序（清单拖拽） */
router.post("/reorder", requireAuth, (req, res) => {
  const { date, ids } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date 无效" });
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: "ids 无效" });
  const stmt = db.prepare("UPDATE tasks SET order_index = ? WHERE id = ? AND user_id = ? AND scheduled_date = ?");
  ids.forEach((id, idx) => stmt.run(idx, Number(id), req.user.id, date));
  res.json({ ok: true });
});

router.patch("/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?").get(id, req.user.id);
  if (!existing) return res.status(404).json({ error: "任务不存在" });

  const body = req.body || {};
  const merged = {
    title: body.title ?? existing.title,
    due_date: body.due_date !== undefined ? body.due_date || null : existing.due_date,
    scheduled_date: body.scheduled_date !== undefined ? body.scheduled_date || null : existing.scheduled_date,
    scheduled_start: body.scheduled_start !== undefined ? body.scheduled_start || null : existing.scheduled_start,
    scheduled_end: body.scheduled_end !== undefined ? body.scheduled_end || null : existing.scheduled_end,
    source: body.source ?? existing.source,
    status: body.status ?? existing.status,
    estimated_pomodoros:
      body.estimated_pomodoros !== undefined ? body.estimated_pomodoros : existing.estimated_pomodoros,
    starred: body.starred !== undefined ? (body.starred ? 1 : 0) : existing.starred,
    order_index: body.order_index !== undefined ? body.order_index : existing.order_index,
  };

  const err = validateTask(merged);
  if (err) return res.status(400).json({ error: err });

  db.prepare(
    `UPDATE tasks SET title = ?, due_date = ?, scheduled_date = ?, scheduled_start = ?, scheduled_end = ?,
     source = ?, status = ?, estimated_pomodoros = ?, starred = ?, order_index = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    String(merged.title).trim(),
    merged.due_date,
    merged.scheduled_date,
    merged.scheduled_start,
    merged.scheduled_end,
    merged.source,
    merged.status,
    merged.estimated_pomodoros,
    merged.starred,
    merged.order_index,
    id,
    req.user.id
  );
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  res.json({ task: rowToTask(task) });
});

router.delete("/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?").run(id, req.user.id);
  if (!info.changes) return res.status(404).json({ error: "任务不存在" });
  res.json({ ok: true });
});

router.post("/:id/pomodoro", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { duration_sec = 1500, completed = true } = req.body || {};
  const dur = Math.min(Math.max(Number(duration_sec) || 1500, 60), 7200);
  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?").get(id, req.user.id);
  if (!task) return res.status(404).json({ error: "任务不存在" });

  const startedAt = new Date().toISOString();
  db.prepare(
    "INSERT INTO pomodoro_sessions (user_id, task_id, started_at, duration_sec, completed) VALUES (?, ?, ?, ?, ?)"
  ).run(req.user.id, id, startedAt, dur, completed ? 1 : 0);

  if (completed) {
    db.prepare("UPDATE tasks SET completed_pomodoros = completed_pomodoros + 1 WHERE id = ?").run(id);
  }
  const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  res.json({ task: rowToTask(updated), completed: Boolean(completed) });
});

export default router;
