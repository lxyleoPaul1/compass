// 信源：我爱竞赛网（52jingsai.com）— 补充「报名时间 / 报名入口 / 主办单位」等动态信息。
//
// robots.txt（http://www.52jingsai.com/robots.txt）：未禁止 /bisai/ 列表页；禁止 /api/、/member.php 等。
// 合规：非营利学生聚合、每周约 1 次、条目间 300–1000ms 随机延时、标注来源；结构变更时安全返回 []。

import * as cheerio from "cheerio";
import {
  fetchHTML,
  randDelay,
  extractDeadline,
  extractOrg,
  cleanName,
  guessCategory,
  absUrl,
} from "./lib_fetch.js";

const LIST_URLS = [
  "https://www.52jingsai.com/bisai/xkjn/bangdan/",
  "https://www.52jingsai.com/bisai/",
];

const BASE = "https://www.52jingsai.com/";

/** 52jingsai 文章页固定为站点根路径 /article-xxx-1.html */
function absUrl52(href) {
  if (!href) return "";
  const m = href.match(/(?:^|\/)?(article-\d+-1\.html)$/i);
  if (m) return `${BASE}${m[1]}`;
  if (href.startsWith("http")) {
    const m2 = href.match(/(article-\d+-1\.html)/i);
    if (m2) return `${BASE}${m2[1]}`;
    return href;
  }
  const resolved = absUrl(href, BASE);
  const m3 = resolved.match(/(article-\d+-1\.html)/i);
  return m3 ? `${BASE}${m3[1]}` : resolved;
}

function parseListPage(html, pageUrl) {
  const $ = cheerio.load(html);
  const map = new Map();

  const push = (raw) => {
    const name = cleanName(raw.name);
    if (!name || name.length < 4) return;
    const key = raw.url || name;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, raw);
      return;
    }
    map.set(key, {
      ...prev,
      deadline: prev.deadline || raw.deadline,
      org: prev.org || raw.org,
      name: name.length > prev.name.length ? name : prev.name,
    });
  };

  $("dl.list_bbda").each((_, el) => {
    try {
      const $el = $(el);
      const a = $el.find("dt.xs2_tit a").first();
      const href = a.attr("href") || "";
      if (!href.includes("article-")) return;
      const name = a.text().trim() || a.attr("title") || "";
      const $dd = $el.find("dd.xs2").first().clone();
      $dd.find(".list_info").remove();
      const desc = $dd.text().replace(/\s+/g, " ").trim();
      const text = `${name} ${desc}`;
      push({
        name,
        url: absUrl52(href),
        deadline: extractDeadline(text),
        org: extractOrg(desc),
        cat: guessCategory(name, desc),
        source: "52jingsai",
      });
    } catch (e) {
      console.warn("[52jingsai] dl.list_bbda 解析失败，跳过：", e.message);
    }
  });

  $(".list li, .articles-list li").each((_, el) => {
    try {
      const $el = $(el);
      const a = $el.find('a[href*="article-"]').first();
      const href = a.attr("href") || "";
      if (!href) return;
      const name = a.text().trim() || a.attr("title") || "";
      const imgTitle = $el.find("img").attr("title") || "";
      const text = `${name} ${imgTitle} ${$el.text()}`;
      push({
        name,
        url: absUrl52(href),
        deadline: extractDeadline(text),
        org: extractOrg(text),
        cat: guessCategory(name, text),
        source: "52jingsai",
      });
    } catch (e) {
      console.warn("[52jingsai] .list li 解析失败，跳过：", e.message);
    }
  });

  return [...map.values()];
}

export async function fetch52Jingsai() {
  try {
    const all = [];
    for (const url of LIST_URLS) {
      try {
        console.log(`[52jingsai] 抓取 ${url}`);
        const html = await fetchHTML(url, { referer: BASE, charset: "gbk" });
        const items = parseListPage(html, url);
        console.log(`[52jingsai] ${url} 解析 ${items.length} 条`);
        all.push(...items);
      } catch (e) {
        console.warn(`[52jingsai] 页面失败，跳过 ${url}：`, e.message);
      }
      await randDelay();
    }

    const dedup = new Map();
    for (const it of all) {
      const k = it.url || it.name;
      if (!dedup.has(k)) dedup.set(k, it);
    }
    const out = [...dedup.values()];
    console.log(`[52jingsai] 合计 ${out.length} 条（去重后）`);
    return out;
  } catch (e) {
    console.warn("[52jingsai] 适配器异常，返回空：", e.message);
    return [];
  }
}
