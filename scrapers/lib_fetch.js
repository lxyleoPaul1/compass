// 通用抓取工具：HTTP 请求、延时、日期提取、分类匹配。各信源适配器复用。

import iconv from "iconv-lite";

export const UA =
  "Mozilla/5.0 (compatible; FreshmanCompass/0.1; non-commercial student aggregator)";

const DEFAULT_TIMEOUT = 20000;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const randDelay = (min = 300, max = 1000) => sleep(min + Math.random() * (max - min));

/** 解码 HTML：自动识别 utf-8 / gbk */
export function decodeBody(buf, contentType = "") {
  const ct = contentType || "";
  const charset = /charset=([\w-]+)/i.exec(ct)?.[1]?.toLowerCase() || "";
  if (charset === "utf-8" || charset === "utf8") return buf.toString("utf8");
  if (charset.includes("gb")) return iconv.decode(buf, "gbk");
  // 无 charset 时尝试 utf-8，失败再 gbk
  const u = buf.toString("utf8");
  if (u.includes("�") && u.match(/[\u4e00-\u9fff]/g)?.length < 5) return iconv.decode(buf, "gbk");
  return u;
}

/**
 * 统一 HTTP 抓取：自定义 UA、超时、失败重试 1 次。
 * @returns {Promise<string>} HTML 文本
 */
export async function fetchHTML(url, { referer, timeout = DEFAULT_TIMEOUT, charset = "auto" } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "zh-CN,zh;q=0.9",
          ...(referer ? { Referer: referer } : {}),
        },
        signal: AbortSignal.timeout(timeout),
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (charset === "utf8") return buf.toString("utf8");
      if (charset === "gbk") return iconv.decode(buf, "gbk");
      return decodeBody(buf, res.headers.get("content-type") || "");
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await sleep(800);
    }
  }
  throw lastErr;
}

/** 从中文文本提取报名截止日期 → ISO yyyy-mm-dd，解析失败返回 null */
export function extractDeadline(text = "") {
  const t = String(text).replace(/\s+/g, " ");
  // 赛氪等：报名时间：04.02 00:00 ～ 06.03 00:00（取区间结束日）
  const saikrEnd = t.match(/报名时间[：:][^～~]*[～~至]\s*(\d{1,2})\.(\d{1,2})/);
  if (saikrEnd) {
    const mo = saikrEnd[1];
    const d = saikrEnd[2];
    return isoDate(inferYear(Number(mo), Number(d)), mo, d);
  }
  const patterns = [
    /报名(?:截止)?(?:时间)[：: ]*?(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/,
    /截止[：: ]*?(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/,
    /(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})\s*?(?:截止|前)/,
    /(20\d{2})-(\d{2})-(\d{2})/,
    /(?:截止|报名).*?(20\d{2})年(\d{1,2})月(\d{1,2})日/,
    /(?:截止|报名).*?(\d{1,2})月(\d{1,2})日/,
    /【(\d{1,2})月(\d{1,2})日截止】/,
    /【(\d{1,2})月(\d{1,2})日.*?截止】/,
    /(\d{1,2})月(\d{1,2})日(?:前|截止)/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    if (m[1] && String(m[1]).length === 4) {
      const y = m[1];
      const mo = m[2];
      const d = m[3];
      return isoDate(y, mo, d);
    }
    const mo = m[1];
    const d = m[2];
    const y = inferYear(Number(mo), Number(d));
    return isoDate(y, mo, d);
  }
  return null;
}

function isoDate(y, mo, d) {
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function inferYear(month, day) {
  const now = new Date();
  const y = now.getFullYear();
  const candidate = new Date(y, month - 1, day);
  // 若日期已过去 60 天以上，可能是下一年赛季
  if (candidate < now && now - candidate > 60 * 86400000) return y + 1;
  return y;
}

/** 从文本提取主办单位 */
export function extractOrg(text = "") {
  const m = String(text).match(/主办单位[：:]\s*([^|｜\n\r]+)/);
  return m ? m[1].trim().slice(0, 120) : "";
}

/** 清洗赛事标题 */
export function cleanName(raw = "") {
  return String(raw)
    .replace(/^【[^】]{0,40}】/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 五大类关键词匹配（匹配不到 → 综合）
const CAT_RULES = [
  {
    cat: "理工",
    kw: ["数学", "建模", "电子", "软件", "计算机", "算法", "机器人", "集成电路", "机械", "结构", "土木", "蓝桥", "编程", "信息", "物理", "化学", "工科"],
  },
  {
    cat: "经管",
    kw: ["市场调查", "会计", "审计", "金融", "商业", "经管", "贸易", "会展", "旅游", "营销", "正大杯", "创业计划", "工商", "经济"],
  },
  {
    cat: "人文",
    kw: ["英语", "外语", "演讲", "辩论", "师范", "法学", "历史", "哲学", "文学", "日语", "翻译", "NECCS", "国才杯"],
  },
  {
    cat: "媒传",
    kw: ["广告", "设计", "艺术", "传媒", "视觉", "动画", "数媒", "影像", "摄影", "新闻", "主持"],
  },
  {
    cat: "综合",
    kw: ["互联网+", "挑战杯", "创新创业", "创业大赛", "综合"],
  },
];

export function guessCategory(name = "", extra = "") {
  const text = `${name} ${extra}`;
  let best = { cat: "综合", score: 0 };
  for (const { cat, kw } of CAT_RULES) {
    let score = 0;
    for (const k of kw) if (text.includes(k)) score++;
    if (score > best.score) best = { cat, score };
  }
  return best.cat;
}

/** 聚合站域名（优先级低于官方） */
const AGG_DOMAINS = [/52jingsai\.com/i, /saikr\.com/i, /jingsai8\.com/i, /mianbaoduo\.com/i];

export function isAggregatorUrl(url = "") {
  return AGG_DOMAINS.some((re) => re.test(url));
}

/** 合并 URL：官方域名优先于聚合站 */
export function pickUrl(prevUrl = "", nextUrl = "") {
  if (!prevUrl) return nextUrl;
  if (!nextUrl) return prevUrl;
  const aAgg = isAggregatorUrl(prevUrl);
  const bAgg = isAggregatorUrl(nextUrl);
  if (aAgg && !bAgg) return nextUrl;
  if (!aAgg && bAgg) return prevUrl;
  return nextUrl;
}

export function absUrl(href, base) {
  if (!href) return "";
  try {
    if (href.startsWith("http")) return href;
    return new URL(href, base).href;
  } catch {
    return href;
  }
}
