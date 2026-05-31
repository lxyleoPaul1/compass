// Kimi 对话 + 内置联网搜索（builtin_function.$web_search）
// Key 仅服务端读取；出处只来自搜索结构化结果 + 知识库，不信任正文链接

const BASE = process.env.MOONSHOT_BASE_URL || "https://api.moonshot.cn/v1";
const MODEL = process.env.MOONSHOT_MODEL || "moonshot-v1-32k";
const KEY = process.env.MOONSHOT_API_KEY;
const TIMEOUT_MS = Number(process.env.MOONSHOT_TIMEOUT_MS || 120000);
const MAX_TOOL_ROUNDS = Number(process.env.MOONSHOT_SEARCH_MAX_ROUNDS || 3);

/** 设为 0 关闭联网工具声明（仍可用普通对话 + 知识库出处） */
const WEB_SEARCH_ENABLED = process.env.MOONSHOT_WEB_SEARCH !== "0";

/** Moonshot 内置搜索工具 — 每次 chat/completions 请求都必须完整携带 */
const WEB_SEARCH_TOOL = {
  type: "builtin_function",
  function: { name: "$web_search" },
};

export function kimiConfigured() {
  return Boolean(KEY && KEY.startsWith("sk-"));
}

export function webSearchEnabled() {
  return WEB_SEARCH_ENABLED && kimiConfigured();
}

function defaultTemperature() {
  return /k2/i.test(MODEL) ? 1 : 0.3;
}

function buildRequestBody(messages, { temperature, maxTokens = 4096, tools, toolChoice = "auto" } = {}) {
  const body = {
    model: MODEL,
    messages,
    temperature: temperature ?? defaultTemperature(),
    max_tokens: maxTokens,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = toolChoice;
  }
  if (/k2/i.test(MODEL) && tools?.some((t) => t.function?.name === "$web_search")) {
    body.thinking = { type: "disabled" };
  }
  return body;
}

async function chatCompletion(body) {
  if (!kimiConfigured()) throw new Error("MOONSHOT_API_KEY 未配置");
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Kimi 调用失败 ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json();
}

export async function kimiChat(messages, opts = {}) {
  const data = await chatCompletion(buildRequestBody(messages, opts));
  return data?.choices?.[0]?.message?.content ?? "";
}

/** 从 Kimi 返回结构中递归提取 { title, url }（仅结构化字段） */
export function extractSearchSourcesFromPayload(payload) {
  const out = [];
  const seen = new Set();

  const add = (title, url) => {
    if (!url || typeof url !== "string") return;
    const u = url.trim().replace(/[.,;:!?)]+$/, "");
    if (!/^https?:\/\//i.test(u) || seen.has(u)) return;
    seen.add(u);
    out.push({ title: String(title || u).slice(0, 160), url: u, source: "web_search" });
  };

  const walk = (node, depth = 0) => {
    if (node == null || depth > 12) return;
    if (typeof node === "string") {
      if (node.startsWith("{") || node.startsWith("[")) {
        try {
          walk(JSON.parse(node), depth + 1);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((x) => walk(x, depth + 1));
      return;
    }
    if (typeof node !== "object") return;

    const url = node.url || node.link || node.href || node.source_url || node.web_url;
    const title = node.title || node.name || node.site_name || node.source;
    if (url && typeof url === "string") add(title, url);

    for (const key of [
      "search_result",
      "search_results",
      "results",
      "items",
      "pages",
      "sources",
      "refs",
      "references",
      "citations",
    ]) {
      if (node[key]) walk(node[key], depth + 1);
    }
  };

  walk(payload);
  return out;
}

/**
 * 带 $web_search 工具循环（官方：echo arguments → Kimi 搜索 → 直至 stop）
 */
export async function kimiChatWithSearch(messages, opts = {}) {
  const enableSearch = opts.enableSearch !== false && webSearchEnabled();

  if (!enableSearch) {
    const data = await chatCompletion(buildRequestBody(messages, opts));
    return {
      content: data?.choices?.[0]?.message?.content ?? "",
      webSearchUsed: false,
      searchCallCount: 0,
      searchSources: [],
      toolMessages: [],
      usage: data?.usage || null,
    };
  }

  const tools = [WEB_SEARCH_TOOL];
  const msgs = [...messages];
  const toolMessages = [];
  const rawChoices = [];
  let searchCallCount = 0;
  let finishReason = null;
  let iterations = 0;

  while ((finishReason === null || finishReason === "tool_calls") && iterations < MAX_TOOL_ROUNDS) {
    iterations++;
    const data = await chatCompletion(buildRequestBody(msgs, { ...opts, tools, toolChoice: "auto" }));
    const choice = data?.choices?.[0];
    if (!choice) throw new Error("Kimi 返回为空");
    rawChoices.push(choice);
    finishReason = choice.finish_reason;

    if (finishReason === "tool_calls" && choice.message?.tool_calls?.length) {
      msgs.push(choice.message);
      for (const tc of choice.message.tool_calls) {
        const name = tc.function?.name || "";
        const argsRaw = tc.function?.arguments || "{}";
        if (name === "$web_search") searchCallCount++;

        msgs.push({
          role: "tool",
          tool_call_id: tc.id,
          name,
          content: argsRaw,
        });
        toolMessages.push({ name, content: argsRaw, tool_call_id: tc.id });
      }
    } else if (finishReason === "stop" || finishReason === "length") {
      let searchSources = [];
      for (const tm of toolMessages) {
        if (tm.name === "$web_search") {
          try {
            searchSources = searchSources.concat(extractSearchSourcesFromPayload(JSON.parse(tm.content)));
          } catch {
            searchSources = searchSources.concat(extractSearchSourcesFromPayload(tm.content));
          }
        }
      }
      for (const ch of rawChoices) {
        searchSources = searchSources.concat(extractSearchSourcesFromPayload(ch.message));
      }
      const seen = new Set();
      searchSources = searchSources.filter((s) => {
        if (seen.has(s.url)) return false;
        seen.add(s.url);
        return true;
      });

      return {
        content: choice.message?.content ?? "",
        webSearchUsed: searchCallCount > 0,
        searchCallCount,
        searchSources,
        toolMessages,
        usage: data?.usage || null,
      };
    } else {
      throw new Error(`Kimi 异常 finish_reason: ${finishReason}`);
    }
  }

  throw new Error(`联网搜索超过最大轮次（${MAX_TOOL_ROUNDS}）`);
}

export async function kimiJSON(messages, opts) {
  const raw = await kimiChat(messages, opts);
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const s = cleaned.search(/[\[{]/);
    const e = Math.max(cleaned.lastIndexOf("]"), cleaned.lastIndexOf("}"));
    if (s !== -1 && e !== -1) return JSON.parse(cleaned.slice(s, e + 1));
    throw new Error("模型未返回合法 JSON");
  }
}
