import { Router } from "express";
import db from "../lib/db.js";
import { loadCompetitions } from "../lib/store.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

function monthRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end, y, m, lastDay };
}

/** GET /api/calendar?month=2026-06 — 月视图：竞赛截止、待办、番茄数 */
router.get("/", requireAuth, async (req, res) => {
  const ym = String(req.query.month || new Date().toISOString().slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: "month 格式应为 YYYY-MM" });
  const { start, end } = monthRange(ym);

  const compData = await loadCompetitions();
  const competitions = (compData.items || [])
    .filter((c) => c.deadline && c.deadline >= start && c.deadline <= end)
    .map((c) => ({
      id: c.id,
      name: c.name,
      deadline: c.deadline,
      cat: c.cat,
      level: c.level,
      url: c.url,
    }));

  const tasks = db
    .prepare(
      `SELECT id, title, due_date, scheduled_date, status, starred, source, related_competition_id
       FROM tasks WHERE user_id = ?
       AND (
         (scheduled_date IS NOT NULL AND scheduled_date >= ? AND scheduled_date <= ?)
         OR (scheduled_date IS NULL AND due_date IS NOT NULL AND due_date >= ? AND due_date <= ?)
       )`
    )
    .all(req.user.id, start, end, start, end);

  const poms = db
    .prepare(
      `SELECT date(started_at) AS d, COUNT(*) AS n FROM pomodoro_sessions
       WHERE user_id = ? AND completed = 1 AND date(started_at) >= ? AND date(started_at) <= ?
       GROUP BY date(started_at)`
    )
    .all(req.user.id, start, end);

  const pomByDay = Object.fromEntries(poms.map((p) => [p.d, p.n]));

  res.json({ month: ym, competitions, tasks, pomodorosByDay: pomByDay });
});

/** GET /api/calendar/day?date=2026-06-01 — 当日详情 */
router.get("/day", requireAuth, async (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date 格式无效" });

  const compData = await loadCompetitions();
  const competitions = (compData.items || [])
    .filter((c) => c.deadline === date)
    .map((c) => ({ id: c.id, name: c.name, deadline: c.deadline, cat: c.cat, level: c.level, url: c.url }));

  const tasks = db
    .prepare(
      `SELECT * FROM tasks WHERE user_id = ?
       AND (scheduled_date = ? OR (scheduled_date IS NULL AND due_date = ?))
       ORDER BY starred DESC, order_index ASC, id ASC`
    )
    .all(req.user.id, date, date);

  const pomCount =
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM pomodoro_sessions WHERE user_id = ? AND completed = 1 AND date(started_at) = ?"
      )
      .get(req.user.id, date)?.n || 0;

  res.json({ date, competitions, tasks, pomodoros: pomCount });
});

export default router;
