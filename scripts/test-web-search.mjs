/**
 * 本地冒烟：顾问联网搜索 + 诚实兜底
 * 用法：node scripts/test-web-search.mjs
 * 需 .env 配置 MOONSHOT_API_KEY，且服务已在 8788 运行
 */
import "dotenv/config";

const BASE = process.env.TEST_BASE || "http://localhost:8788";
const jar = new Map();

function parseSetCookie(header) {
  if (!header) return;
  const parts = header.split(";")[0];
  const i = parts.indexOf("=");
  if (i > 0) jar.set(parts.slice(0, i).trim(), parts.slice(i + 1).trim());
}

async function req(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (jar.size) headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.getSetCookie?.() || [];
  for (const c of set) parseSetCookie(c);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  return { status: res.status, data };
}

async function ensureUser() {
  const login = await req("/api/auth/login", {
    method: "POST",
    body: { login: "searchtest", password: "Test123456!" },
  });
  if (login.status === 200) return login.data.user;
  const reg = await req("/api/auth/register", {
    method: "POST",
    body: {
      username: "searchtest",
      email_or_phone: "searchtest@example.com",
      password: "Test123456!",
    },
  });
  if (reg.status !== 200) throw new Error(`register failed: ${JSON.stringify(reg.data)}`);
  return reg.data.user;
}

async function ask(question, newSession = true) {
  const r = await req("/api/chat", {
    method: "POST",
    body: { messages: [{ role: "user", content: question }], new_session: newSession },
  });
  return r;
}

async function main() {
  const user = await ensureUser();
  console.log("logged in:", user.username);

  console.log("\n--- 事实类问题（应 enable search，可能触发 $web_search）---");
  const factual = await ask("2025年全国大学生数学建模竞赛什么时候报名？请给最新信息。");
  console.log("status:", factual.status);
  console.log("search_enabled:", factual.data.search_enabled);
  console.log("web_search_used:", factual.data.web_search_used);
  console.log("web_search_calls:", factual.data.web_search_calls);
  console.log("citations:", factual.data.citations?.length || 0, factual.data.citations?.slice(0, 2));
  console.log("disclaimer:", factual.data.disclaimer);
  console.log("reply preview:", String(factual.data.reply || factual.data.error).slice(0, 200));

  console.log("\n--- 纯建议类（不应 enable search，应诚实兜底）---");
  const advice = await ask("大一新生如何平衡学业和竞赛？给方法论建议。", true);
  console.log("status:", advice.status);
  console.log("search_enabled:", advice.data.search_enabled);
  console.log("web_search_used:", advice.data.web_search_used);
  console.log("citations:", advice.data.citations?.length || 0);
  console.log("disclaimer:", advice.data.disclaimer);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
