// 输入校验与长度限制

const USERNAME_RE = /^[\w\u4e00-\u9fa5-]{2,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^1[3-9]\d{9}$/;

export function isEmailOrPhone(v) {
  const s = String(v || "").trim();
  return EMAIL_RE.test(s) || PHONE_RE.test(s);
}

export function validateRegister({ username, email_or_phone, password, school, major_cat }) {
  const u = String(username || "").trim();
  const e = String(email_or_phone || "").trim();
  const p = String(password || "");
  if (!USERNAME_RE.test(u)) return "用户名需 2–32 位，仅字母数字中文下划线";
  if (!isEmailOrPhone(e)) return "请填写有效邮箱或手机号";
  if (p.length < 8) return "密码至少 8 位";
  if (p.length > 128) return "密码过长";
  if (school && school.length > 80) return "学校名称过长";
  if (major_cat && major_cat.length > 20) return "专业大类无效";
  return null;
}

export function validateLogin({ login, password }) {
  const l = String(login || "").trim();
  const p = String(password || "");
  if (!l || !p) return "请填写账号和密码";
  if (p.length > 128) return "密码过长";
  return null;
}

export function validateQuestionnaire(payload) {
  if (!payload || typeof payload !== "object") return "问卷数据无效";
  const cat = payload.cat;
  const allowed = ["综合", "经管", "理工", "人文", "媒传"];
  if (cat && !allowed.includes(cat)) return "专业大类无效";
  if (payload.school && String(payload.school).length > 80) return "院校名称过长";
  if (payload.goal && String(payload.goal).length > 500) return "目标描述过长";
  if (Array.isArray(payload.interests) && payload.interests.length > 20) return "兴趣标签过多";
  return null;
}

export function validateChatMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) return "消息不能为空";
  if (messages.length > 40) return "历史消息过多";
  for (const m of messages.slice(-20)) {
    if (!m || !["user", "assistant"].includes(m.role)) return "消息格式无效";
    const c = String(m.content || "").trim();
    if (!c || c.length > 4000) return "单条消息过长或为空";
  }
  return null;
}

export function validateWallPost({ type, title, body, related_competition, team_size, skills }) {
  const allowed = ["team", "help", "share"];
  if (!allowed.includes(type)) return "帖子类型无效";
  const t = String(title || "").trim();
  const b = String(body || "").trim();
  if (t.length < 2 || t.length > 80) return "标题需 2–80 字";
  if (b.length < 4 || b.length > 2000) return "正文需 4–2000 字";
  if (related_competition && String(related_competition).length > 120) return "关联赛事名称过长";
  if (team_size != null && team_size !== "") {
    const n = Number(team_size);
    if (!Number.isInteger(n) || n < 1 || n > 20) return "所需人数需为 1–20";
  }
  if (skills && String(skills).length > 200) return "技能描述过长";
  return null;
}

export function validateTask({ title, due_date, scheduled_date, scheduled_start, scheduled_end, source, status }) {
  const t = String(title || "").trim();
  if (t.length < 1 || t.length > 200) return "任务标题需 1–200 字";
  if (source && !["competition", "plan", "custom", "advisor"].includes(source)) return "任务来源无效";
  if (status && !["todo", "doing", "done"].includes(status)) return "任务状态无效";
  for (const d of [due_date, scheduled_date]) {
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return "日期格式无效";
  }
  for (const tm of [scheduled_start, scheduled_end]) {
    if (tm && !/^\d{2}:\d{2}$/.test(tm)) return "时间格式应为 HH:MM";
  }
  return null;
}

export function sanitizeText(s, max = 2000) {
  return String(s || "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .trim()
    .slice(0, max);
}
