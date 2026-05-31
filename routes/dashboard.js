// 首页总览聚合 API：今日聚焦、进展、下一步建议
import { Router } from "express";
import db from "../lib/db.js";
import { loadCompetitions } from "../lib/store.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

function daysLeft(iso) {
  if (!iso) return 9999;
  return Math.round((new Date(iso) - new Date()) / 86400000);
}

function buildGreeting(profile, prefs) {
  const grade = profile?.grade || "准大一";
  const cat = profile?.cat;
  const goal = profile?.goal?.trim();
  if (goal) return `${grade} · 朝着「${goal.slice(0, 24)}${goal.length > 24 ? "…" : ""}」稳步前进`;
  if (cat && cat !== "综合") return `${grade} · ${cat}方向，帮你筛对口竞赛、排好节奏`;
  return `${grade} · 把上大学拆成看得见的下一步`;
}

function computeNextAction({ hasProfile, taskCount, planTaskCount, roadmapTasks }) {
  if (!hasProfile) {
    return {
      type: "survey",
      title: "先花 3 分钟认识一下你",
      desc: "填完问卷后，竞赛会按你的专业排序，AI 规划也更贴身。",
      cta: "开始问卷",
      hash: "#feed",
      action: "survey",
    };
  }
  if (taskCount === 0 && planTaskCount === 0) {
    return {
      type: "competition",
      title: "从一场对口竞赛开始",
      desc: "在竞赛雷达里挑一个目标，加入计划后一键拆成待办。",
      cta: "去看竞赛",
      hash: "#feed",
      action: "feed",
    };
  }
  if (planTaskCount > 0 && roadmapTasks === 0) {
    return {
      type: "roadmap",
      title: "把规划里程碑变成任务",
      desc: "问卷生成的路线可以「转为任务」，落到日历里更好执行。",
      cta: "查看我的规划",
      hash: "#feed",
      action: "roadmap",
    };
  }
  return {
    type: "daily",
    title: "专注今日待办",
    desc: "从今日聚焦里选一件最重要的事，用番茄钟推进。",
    cta: "打开工作台",
    hash: "#tasks",
    action: "tasks",
  };
}

router.get("/", requireAuth, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const qRow = db.prepare("SELECT payload FROM questionnaire WHERE user_id = ?").get(req.user.id);
  let profile = {};
  try {
    profile = qRow?.payload ? JSON.parse(qRow.payload) : {};
  } catch {
    profile = {};
  }

  const prefRow = db.prepare("SELECT slogan FROM user_preferences WHERE user_id = ?").get(req.user.id);
  const slogan = prefRow?.slogan || "";

  const pomToday =
    db.prepare("SELECT COUNT(*) AS n FROM pomodoro_sessions WHERE user_id = ? AND completed = 1 AND date(started_at) = ?").get(req.user.id, today)?.n || 0;
  const pomWeek =
    db.prepare("SELECT COUNT(*) AS n FROM pomodoro_sessions WHERE user_id = ? AND completed = 1 AND date(started_at) >= ?").get(req.user.id, weekAgo)?.n || 0;
  const tasksDoneToday =
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND status = 'done'
         AND (scheduled_date = ? OR (scheduled_date IS NULL AND due_date = ?))`
      )
      .get(req.user.id, today, today)?.n || 0;
  const tasksDoneWeek =
    db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND status = 'done' AND created_at >= ?").get(req.user.id, weekAgo + "T00:00:00.000Z")?.n || 0;

  const allTasks = db
    .prepare("SELECT * FROM tasks WHERE user_id = ? ORDER BY starred DESC, order_index ASC, id ASC")
    .all(req.user.id);

  const tasksToday = allTasks
    .filter((t) => t.status !== "done" && (t.scheduled_date === today || (!t.scheduled_date && t.due_date === today)))
    .slice(0, 8)
    .map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      source: t.source,
      due_date: t.due_date,
      scheduled_date: t.scheduled_date,
      completed_pomodoros: t.completed_pomodoros,
      related_competition_id: t.related_competition_id,
    }));

  const upcomingTasks = allTasks
    .filter((t) => t.status !== "done" && t.scheduled_date && t.scheduled_date > today)
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
    .slice(0, 5)
    .map((t) => ({ id: t.id, title: t.title, scheduled_date: t.scheduled_date, due_date: t.due_date }));

  const planCompetitions = allTasks.filter((t) => t.source === "competition" && t.status !== "done").length;
  const planTasks = allTasks.filter((t) => t.source === "plan").length;
  const activeTasks = allTasks.filter((t) => t.status !== "done").length;
  const doneTasks = allTasks.filter((t) => t.status === "done").length;
  const milestoneProgress = activeTasks + doneTasks > 0 ? Math.round((doneTasks / (activeTasks + doneTasks)) * 100) : 0;

  const pomoCandidate = allTasks.find((t) => t.status !== "done" && t.scheduled_date === today) || allTasks.find((t) => t.status !== "done");

  const compData = await loadCompetitions();
  const compIds = new Set(allTasks.map((t) => t.related_competition_id).filter(Boolean));
  let urgentCompetitions = (compData.items || [])
    .filter((c) => c.deadline && daysLeft(c.deadline) >= 0 && daysLeft(c.deadline) <= 14)
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
    .slice(0, 6)
    .map((c) => ({
      id: c.id,
      name: c.name,
      deadline: c.deadline,
      daysLeft: daysLeft(c.deadline),
      inPlan: compIds.has(c.id),
      cat: c.cat,
    }));

  // 问卷专业大类加权：对口赛事优先
  if (profile.cat) {
    urgentCompetitions.sort((a, b) => {
      const boost = (c) => (c.cat === profile.cat ? -1 : c.cat === "综合" ? 0 : 1);
      return boost(a) - boost(b) || a.daysLeft - b.daysLeft;
    });
  }

  const hasProfile = Boolean(profile.cat || profile.goal || profile.school);
  const nextAction = computeNextAction({
    hasProfile,
    taskCount: activeTasks,
    planTaskCount: planTasks,
    roadmapTasks: planTasks,
  });

  res.json({
    greeting: buildGreeting(profile, { slogan }),
    slogan,
    profile: { cat: profile.cat || "", grade: profile.grade || "", goal: profile.goal || "", school: profile.school || "" },
    stats: {
      pomodorosToday: pomToday,
      pomodorosWeek: pomWeek,
      tasksDoneToday,
      tasksDoneWeek,
      planCompetitions,
      activeTasks,
      milestoneProgress,
    },
    focus: {
      tasksToday,
      upcomingTasks,
      pomoSuggestion: pomoCandidate ? { id: pomoCandidate.id, title: pomoCandidate.title } : null,
      urgentCompetitions,
    },
    nextAction,
  });
});

export default router;
