import "dotenv/config";
import express from "express";
import cookieSession from "cookie-session";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadCompetitions } from "./lib/store.js";
import { kimiJSON, kimiConfigured } from "./lib/kimi.js";
import "./lib/db.js";
import { attachUser } from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import chatRoutes from "./routes/chat.js";
import questionnaireRoutes from "./routes/questionnaire.js";
import tasksRoutes from "./routes/tasks.js";
import wallRoutes from "./routes/wall.js";
import calendarRoutes from "./routes/calendar.js";
import preferencesRoutes from "./routes/preferences.js";
import dashboardRoutes from "./routes/dashboard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const isProd = process.env.NODE_ENV === "production";

if (!process.env.SESSION_SECRET && isProd) {
  console.warn("警告：生产环境请设置 SESSION_SECRET");
}

app.use(express.json({ limit: "256kb" }));
app.use(
  cookieSession({
    name: "compass_sess",
    keys: [process.env.SESSION_SECRET || "compass-dev-secret-change-me"],
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
  })
);
app.use(attachUser);
app.use(express.static(join(__dirname, "public")));

// ---------- 赛事数据（仍读 JSON）----------
app.get("/api/competitions", async (req, res) => {
  const data = await loadCompetitions();
  const items = data.items || [];
  const cat = req.query.cat;
  const filtered = cat && cat !== "all" ? items.filter((i) => i.cat === cat) : items;
  res.json({ updatedAt: data.updatedAt, count: filtered.length, items: filtered });
});

// ---------- 模块化路由 ----------
app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/questionnaire", questionnaireRoutes);
app.use("/api/tasks", tasksRoutes);
app.use("/api/wall", wallRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/preferences", preferencesRoutes);
app.use("/api/dashboard", dashboardRoutes);

// ---------- 目标拆解（Kimi 代理，无需登录）----------
app.post("/api/decompose", async (req, res) => {
  const { goal = "", profile = "" } = req.body || {};
  if (!goal.trim()) return res.status(400).json({ error: "缺少 goal" });
  if (!kimiConfigured()) return res.status(503).json({ error: "AI 未配置（缺 MOONSHOT_API_KEY）" });

  const messages = [
    {
      role: "system",
      content:
        "你是面向中国准大学生/大一新生的规划助手。把用户的大目标拆成 4-7 个可执行里程碑，" +
        "每个里程碑要具体、可检验，并给出建议时间（用相对学期/月份，如“大一上 9-10 月”）。" +
        "只返回 JSON 数组，每项形如 {\"step\":\"...\",\"when\":\"...\",\"tip\":\"...\"}，不要任何多余文字。",
    },
    { role: "user", content: `目标：${goal}\n我的情况：${profile || "（未填）"}` },
  ];

  try {
    const arr = await kimiJSON(messages, { maxTokens: 8192 });
    res.json({ milestones: Array.isArray(arr) ? arr : arr.milestones || [] });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- 校内赛调研（Kimi 代理）----------
app.post("/api/intramural", async (req, res) => {
  const { competition = "", school = "", noticeText = "" } = req.body || {};
  if (!competition.trim()) return res.status(400).json({ error: "缺少 competition" });
  if (!kimiConfigured()) return res.status(503).json({ error: "AI 未配置（缺 MOONSHOT_API_KEY）" });

  const messages = [
    {
      role: "system",
      content:
        "你帮中国大学生判断一项竞赛的参赛路径。结合给定信息回答：是否通常需要先经过校内选拔/校赛" +
        "才能进入省赛或国赛？校内赛大致在什么时间？给新生 2-3 条务实建议（如先问哪个部门/老师）。" +
        "若信息不足，明确说明“需以本校官方通知为准”，不要编造具体日期。" +
        "只返回 JSON：{\"needsSchoolRound\":\"是/否/通常需要/视学校而定\",\"timing\":\"...\",\"advice\":[\"...\"],\"caveat\":\"...\"}",
    },
    {
      role: "user",
      content:
        `赛事：${competition}\n学校：${school || "（未填）"}\n` +
        `通知原文（如有，请据此判断）：\n${noticeText ? noticeText.slice(0, 4000) : "（未提供）"}`,
    },
  ];

  try {
    const obj = await kimiJSON(messages, { maxTokens: 4096 });
    res.json(obj);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- 问卷规划（游客可用；登录用户建议用 /api/questionnaire）----------
app.post("/api/plan", async (req, res) => {
  const profile = req.body || {};
  if (!kimiConfigured()) return res.status(503).json({ error: "AI 未配置（缺 MOONSHOT_API_KEY）" });

  const messages = [
    {
      role: "system",
      content:
        "你是面向中国准大学生/大一新生的大学规划助手。根据用户的问卷信息，生成轻量可执行的规划：" +
        "若 grade 为「准大一」或「大一」，侧重第一学年；否则可兼顾四年远景。" +
        "输出 4-7 个里程碑，具体、可检验，时间用相对学期/月份（如「大一上 9-10 月」）。" +
        "只返回 JSON 数组，每项 {\"step\":\"...\",\"when\":\"...\",\"tip\":\"...\"}，不要任何多余文字。",
    },
    { role: "user", content: JSON.stringify(profile) },
  ];

  try {
    const arr = await kimiJSON(messages, { maxTokens: 8192 });
    res.json({ milestones: Array.isArray(arr) ? arr : arr.milestones || [] });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get("/api/health", (req, res) =>
  res.json({ ok: true, ai: kimiConfigured(), user: req.user ? req.user.username : null })
);

const PORT = process.env.PORT || 8788;
app.listen(PORT, () => console.log(`新生指北 Compass 运行于 http://localhost:${PORT}`));
