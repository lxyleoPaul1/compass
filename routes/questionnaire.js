import { Router } from "express";
import db from "../lib/db.js";
import { validateQuestionnaire } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { kimiJSON, kimiConfigured } from "../lib/kimi.js";

const router = Router();

router.get("/", requireAuth, (req, res) => {
  const row = db.prepare("SELECT payload, updated_at FROM questionnaire WHERE user_id = ?").get(req.user.id);
  if (!row) return res.json({ payload: null, updated_at: null });
  try {
    res.json({ payload: JSON.parse(row.payload), updated_at: row.updated_at });
  } catch {
    res.json({ payload: null, updated_at: row.updated_at });
  }
});

router.post("/", requireAuth, async (req, res) => {
  const payload = req.body?.payload ?? req.body;
  const err = validateQuestionnaire(payload);
  if (err) return res.status(400).json({ error: err });

  const now = new Date().toISOString();
  const json = JSON.stringify(payload);
  db.prepare(
    `INSERT INTO questionnaire (user_id, payload, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
  ).run(req.user.id, json, now);

  if (payload.cat) {
    db.prepare("UPDATE users SET major_cat = ?, school = COALESCE(?, school) WHERE id = ?").run(
      payload.cat,
      payload.school?.trim() || null,
      req.user.id
    );
  }

  let milestones = [];
  if (kimiConfigured()) {
    try {
      const messages = [
        {
          role: "system",
          content:
            "你是面向中国准大学生/大一新生的大学规划助手。根据用户的问卷信息，生成轻量可执行的规划：" +
            "若 grade 为「准大一」或「大一」，侧重第一学年；否则可兼顾四年远景。" +
            "输出 4-7 个里程碑，具体、可检验，时间用相对学期/月份（如「大一上 9-10 月」）。" +
            "只返回 JSON 数组，每项 {\"step\":\"...\",\"when\":\"...\",\"tip\":\"...\"}，不要任何多余文字。",
        },
        { role: "user", content: JSON.stringify(payload) },
      ];
      const arr = await kimiJSON(messages, { maxTokens: 8192 });
      milestones = Array.isArray(arr) ? arr : arr.milestones || [];
    } catch (e) {
      return res.status(502).json({ error: "问卷已保存，但 AI 规划生成失败：" + e.message, payload, updated_at: now });
    }
  }

  res.json({ payload, updated_at: now, milestones });
});

export default router;
