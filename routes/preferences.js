// 用户偏好 API：主题、slogan、字号、减少动效

import { Router } from "express";
import db from "../lib/db.js";
import { requireAuth } from "../middleware/auth.js";
import { sanitizeText } from "../lib/validate.js";

const router = Router();

const THEMES = new Set(["editorial", "nocturne", "daylight", "grove"]);
const FONT_SCALES = new Set(["sm", "md", "lg"]);

const DEFAULTS = {
  theme: "editorial",
  slogan: "",
  font_scale: "md",
  reduce_motion: false,
};

function rowToPrefs(row) {
  if (!row) return { ...DEFAULTS };
  return {
    theme: THEMES.has(row.theme) ? row.theme : DEFAULTS.theme,
    slogan: row.slogan || "",
    font_scale: FONT_SCALES.has(row.font_scale) ? row.font_scale : DEFAULTS.font_scale,
    reduce_motion: Boolean(row.reduce_motion),
    updated_at: row.updated_at,
  };
}

router.get("/", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM user_preferences WHERE user_id = ?").get(req.user.id);
  res.json({ preferences: rowToPrefs(row) });
});

router.post("/", requireAuth, (req, res) => {
  const { theme, slogan, font_scale, reduce_motion } = req.body || {};
  const prev = db.prepare("SELECT * FROM user_preferences WHERE user_id = ?").get(req.user.id);
  const merged = {
    theme: theme && THEMES.has(theme) ? theme : prev?.theme || DEFAULTS.theme,
    slogan: slogan !== undefined ? sanitizeText(slogan, 120) : prev?.slogan || "",
    font_scale: font_scale && FONT_SCALES.has(font_scale) ? font_scale : prev?.font_scale || DEFAULTS.font_scale,
    reduce_motion: reduce_motion !== undefined ? (reduce_motion ? 1 : 0) : prev?.reduce_motion || 0,
  };
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_preferences (user_id, theme, slogan, font_scale, reduce_motion, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       theme = excluded.theme,
       slogan = excluded.slogan,
       font_scale = excluded.font_scale,
       reduce_motion = excluded.reduce_motion,
       updated_at = excluded.updated_at`
  ).run(req.user.id, merged.theme, merged.slogan, merged.font_scale, merged.reduce_motion, now);
  res.json({ preferences: { ...merged, reduce_motion: Boolean(merged.reduce_motion), updated_at: now } });
});

export default router;
