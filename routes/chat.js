import { Router } from "express";
import { randomUUID } from "node:crypto";
import db from "../lib/db.js";
import { loadCompetitions } from "../lib/store.js";
import { buildCitations } from "../lib/citations.js";
import { rateLimit, peekRateLimit } from "../lib/rateLimit.js";
import { validateChatMessages, sanitizeText } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { kimiChatWithSearch, kimiChat, kimiConfigured, webSearchEnabled } from "../lib/kimi.js";

const router = Router();

const SEARCH_HOURLY_MAX = Number(process.env.MOONSHOT_SEARCH_HOURLY_MAX || 10);

const CHAT_SYSTEM = `你是 Compass 规划顾问，面向中国准大学生/大一新生的学业与竞赛规划顾问。语气务实、有温度，不啰嗦。

【策略：先诊断、再开方】
1. 信息不足时，优先提出 1~3 个最关键追问（编号列出），不要空泛长篇。
2. 信息足够时，给结构化建议：优先级（高/中/低）+ 具体行动 + 建议时间窗口。
3. 已知问卷 profile 里的信息直接利用，勿重复追问。
4. 严禁编造：具体分数线、政策条文、报名日期。不确定的一律写「请以本校/主办方官方通知为准」。
5. 禁止在正文中自行编造 URL 或引用来源；来源由系统单独展示。
6. 未填问卷且问题很泛时，温和引导填问卷（约 3 分钟）。

【联网搜索 $web_search — 按需调用，控制费用】
- 仅当问题涉及会变化或需事实依据的内容时再调用 $web_search，例如：最新政策/通知、具体竞赛报名时间、行业数据、某校某项目现状等。
- 纯方法论、心态、时间规划、个人选择类建议（如「如何平衡学业和竞赛」）不要调用搜索。
- 竞赛类问题若系统已有榜单信息，优先基于已知信息回答，必要时再搜索补充。

【回答格式】
- 追问：简短说明 + 编号问题
- 建议：①②③ 或「高优先级：」结构
- 结尾可问：「要不要把这些拆成计划里的具体任务？」`;

/** 启发式：是否挂载 $web_search 工具（最终是否调用由模型决定） */
function shouldEnableWebSearch(text) {
  const t = String(text || "").trim();
  const adviceIntent =
    /^(如何|怎么|怎样|要不要|值不值)|方法论|心态|动力|习惯|时间管理|平衡|规划建议|给.{0,6}建议/.test(t);
  const factualIntent =
    /政策|规定|文件|通知|报名|截止|日期|具体时间|分数线|招生|202[4-9]年|今年|最新|现状|数据|多少人|什么时候|能否报|教育部|官网|专业目录|保研|留学|比赛时间|报名时间/.test(
      t
    );
  const compFactual =
    /(竞赛|比赛|赛事|大赛).*(报名|截止|时间|最新|202[4-9])|(报名|截止|时间|最新|202[4-9]).*(竞赛|比赛|赛事|大赛)/.test(
      t
    );
  if (adviceIntent && !factualIntent && !compFactual) return false;
  if (factualIntent || compFactual) return true;
  return false;
}

function loadProfile(userId) {
  const row = db.prepare("SELECT payload FROM questionnaire WHERE user_id = ?").get(userId);
  if (!row) return null;
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

function profileSummary(profile, user) {
  const parts = [];
  if (user?.school) parts.push(`学校：${user.school}`);
  if (user?.major_cat) parts.push(`注册专业大类：${user.major_cat}`);
  if (profile?.grade) parts.push(`年级：${profile.grade}`);
  if (profile?.cat) parts.push(`问卷专业大类：${profile.cat}`);
  if (profile?.goal) parts.push(`一句话目标：${profile.goal}`);
  if (profile?.interests?.length) parts.push(`兴趣：${profile.interests.join("、")}`);
  if (profile?.school) parts.push(`目标/就读院校：${profile.school}`);
  return parts.length ? `\n【已知用户信息 — 勿重复追问】\n${parts.join("\n")}` : "\n【用户尚未填写问卷 — 若问题宽泛，可引导填问卷】";
}

function buildSystemPrompt(profile, user, searchAllowed) {
  let extra = "";
  if (searchAllowed && webSearchEnabled()) {
    extra = "\n【本次已启用联网搜索工具】涉及事实性问题时请调用 $web_search；纯建议类勿调用。";
  } else {
    extra = "\n【本次未启用联网搜索】请基于已知信息与通用经验作答，勿编造具体政策/日期/链接。";
  }
  return CHAT_SYSTEM + profileSummary(profile, user) + extra;
}

function trimMessages(messages) {
  return messages.slice(-24).map((m) => ({
    role: m.role,
    content: String(m.content).trim().slice(0, 4000),
  }));
}

function parseRow(row) {
  let citations = [];
  try {
    citations = row.citations ? JSON.parse(row.citations) : [];
  } catch {
    citations = [];
  }
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    session_id: row.session_id || null,
    citations,
    disclaimer: row.disclaimer || null,
    created_at: row.created_at,
  };
}

function logWebSearch(userId, sessionId, searchCalls, queryHint) {
  if (!searchCalls) return;
  try {
    db.prepare(
      `INSERT INTO web_search_logs (user_id, session_id, search_calls, query_hint, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(userId, sessionId, searchCalls, sanitizeText(queryHint, 200), new Date().toISOString());
  } catch (e) {
    console.warn("[chat] web_search_logs:", e.message);
  }
}

router.get("/", requireAuth, (req, res) => {
  const sessionId = req.query.session_id ? String(req.query.session_id).slice(0, 64) : null;
  let rows;
  if (sessionId) {
    rows = db
      .prepare(
        `SELECT id, role, content, session_id, citations, disclaimer, created_at
         FROM chat_messages WHERE user_id = ? AND session_id = ? AND role IN ('user','assistant')
         ORDER BY id ASC LIMIT 100`
      )
      .all(req.user.id, sessionId);
  } else {
    const latest = db
      .prepare(
        `SELECT session_id FROM chat_messages WHERE user_id = ? AND session_id IS NOT NULL ORDER BY id DESC LIMIT 1`
      )
      .get(req.user.id);
    if (latest?.session_id) {
      rows = db
        .prepare(
          `SELECT id, role, content, session_id, citations, disclaimer, created_at
           FROM chat_messages WHERE user_id = ? AND session_id = ? AND role IN ('user','assistant')
           ORDER BY id ASC LIMIT 100`
        )
        .all(req.user.id, latest.session_id);
    } else {
      rows = db
        .prepare(
          `SELECT id, role, content, session_id, citations, disclaimer, created_at
           FROM chat_messages WHERE user_id = ? AND role IN ('user','assistant') ORDER BY id ASC LIMIT 100`
        )
        .all(req.user.id);
    }
  }
  res.json({
    messages: rows.map(parseRow),
    session_id: rows.length ? rows[rows.length - 1].session_id : null,
    web_search_available: webSearchEnabled(),
  });
});

router.get("/history", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT cm.session_id,
              MIN(cm.created_at) AS started_at,
              MAX(cm.created_at) AS updated_at,
              (SELECT question_text FROM user_questions uq
               WHERE uq.user_id = cm.user_id AND uq.session_id = cm.session_id
               ORDER BY uq.id ASC LIMIT 1) AS first_question,
              COUNT(*) AS message_count
       FROM chat_messages cm
       WHERE cm.user_id = ? AND cm.session_id IS NOT NULL AND cm.role IN ('user','assistant')
       GROUP BY cm.session_id
       ORDER BY updated_at DESC
       LIMIT 30`
    )
    .all(req.user.id);
  res.json({ sessions: rows });
});

router.post("/", requireAuth, async (req, res) => {
  if (!kimiConfigured()) return res.status(503).json({ error: "AI 未配置（缺 MOONSHOT_API_KEY）" });

  const rl = rateLimit(`chat:${req.user.id}`, { windowMs: 3600000, max: 30 });
  if (!rl.ok) return res.status(429).json({ error: `请求过于频繁，请 ${rl.retryAfter} 秒后再试` });

  const { messages = [], session_id: clientSessionId, new_session } = req.body || {};
  const err = validateChatMessages(messages);
  if (err) return res.status(400).json({ error: err });

  const trimmed = trimMessages(messages);
  const last = trimmed[trimmed.length - 1];
  if (!last || last.role !== "user") return res.status(400).json({ error: "请发送用户消息" });

  const sessionId =
    new_session || !clientSessionId ? randomUUID() : String(clientSessionId).slice(0, 64);
  const profile = loadProfile(req.user.id);
  let searchAllowed = shouldEnableWebSearch(last.content) && webSearchEnabled();

  if (searchAllowed) {
    const searchRl = peekRateLimit(`chat:search:${req.user.id}`, {
      windowMs: 3600000,
      max: SEARCH_HOURLY_MAX,
    });
    if (!searchRl.ok) searchAllowed = false;
  }

  const kimiMessages = [
    { role: "system", content: buildSystemPrompt(profile, req.user, searchAllowed) },
    ...trimmed,
  ];

  try {
    const compData = await loadCompetitions();
    let reply,
      webSearchUsed,
      searchCallCount,
      searchSources;

    try {
      const result = await kimiChatWithSearch(kimiMessages, {
        maxTokens: 4096,
        enableSearch: searchAllowed,
      });
      reply = result.content;
      webSearchUsed = result.webSearchUsed;
      searchCallCount = result.searchCallCount;
      searchSources = result.searchSources;
    } catch (searchErr) {
      console.warn("[chat] kimi search error, fallback plain chat:", searchErr.message);
      reply = await kimiChat(kimiMessages, { maxTokens: 4096 });
      webSearchUsed = false;
      searchCallCount = 0;
      searchSources = [];
    }

    if (searchCallCount > 0) {
      rateLimit(
        `chat:search:${req.user.id}`,
        { windowMs: 3600000, max: SEARCH_HOURLY_MAX },
        searchCallCount
      );
      logWebSearch(req.user.id, sessionId, searchCallCount, last.content.slice(0, 200));
      console.info(
        `[chat] user=${req.user.id} web_search calls=${searchCallCount} sources=${searchSources?.length || 0}`
      );
    }

    const { citations, disclaimer } = buildCitations({
      userText: last.content,
      assistantText: reply,
      competitions: compData.items || [],
      searchSources,
      webSearchUsed,
      searchEnabled: searchAllowed,
    });

    const now = new Date().toISOString();
    const citationsJson = JSON.stringify(citations);

    db.prepare(
      "INSERT INTO chat_messages (user_id, role, content, session_id, created_at) VALUES (?, 'user', ?, ?, ?)"
    ).run(req.user.id, last.content, sessionId, now);

    db.prepare(
      "INSERT INTO user_questions (user_id, session_id, question_text, related_context, created_at) VALUES (?, ?, ?, 'advisor', ?)"
    ).run(req.user.id, sessionId, sanitizeText(last.content, 2000), now);

    const aInfo = db
      .prepare(
        `INSERT INTO chat_messages (user_id, role, content, session_id, citations, disclaimer, created_at)
         VALUES (?, 'assistant', ?, ?, ?, ?, ?)`
      )
      .run(req.user.id, reply, sessionId, citationsJson, disclaimer, now);

    res.json({
      reply,
      citations,
      disclaimer,
      session_id: sessionId,
      message_id: aInfo.lastInsertRowid,
      web_search_used: webSearchUsed,
      web_search_calls: searchCallCount,
      search_enabled: searchAllowed,
      created_at: now,
    });
  } catch (e) {
    res.status(502).json({ error: e.message || "AI 服务暂时不可用，请稍后再试" });
  }
});

export default router;
