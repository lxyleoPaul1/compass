// 信源：赛氪网 / 大学生竞赛网（saikr.com）— 补充报名时间、活动入口。
//
// robots.txt（https://www.saikr.com/robots.txt）：仅 Disallow: /u/，/activity 可抓取。
// 说明：/contests 为 JS 壳（~4KB），不可用；本适配器使用 SSR 列表页 /activity。
// 合规：非营利学生聚合、低频、300–1000ms 延时、标注来源。

import * as cheerio from "cheerio";
import {
  fetchHTML,
  randDelay,
  extractDeadline,
  cleanName,
  guessCategory,
  absUrl,
} from "./lib_fetch.js";

const LIST_URL = "https://www.saikr.com/activity";
const BASE = "https://www.saikr.com/";

function parseActivityPage(html) {
  const $ = cheerio.load(html);
  const out = [];

  $("ul.list > li.item").each((_, el) => {
    try {
      const $el = $(el);
      const a = $el.find("h3.tit a.link, h3.tit a").first();
      const href = a.attr("href") || $el.find('a[href*="/act/"]').first().attr("href") || "";
      const name = cleanName(a.text().trim() || a.attr("title") || $el.find("img").attr("alt") || "");
      if (!name || name.length < 4) return;

      const timeLines = $el
        .find("p.active-time.active-plan")
        .map((__, p) => $(p).text().replace(/\s+/g, " ").trim())
        .get()
        .join(" ");
      const regLine = timeLines.match(/报名时间[：:][^活动]+/)?.[0] || timeLines;

      out.push({
        name,
        url: absUrl(href, BASE),
        deadline: extractDeadline(regLine || timeLines),
        org: null,
        cat: guessCategory(name),
        level: "List",
        source: "saikr",
      });
    } catch (e) {
      console.warn("[saikr] 单条 li.item 解析失败，跳过：", e.message);
    }
  });

  return out;
}

export async function fetchSaikr() {
  try {
    console.log(`[saikr] 抓取 ${LIST_URL}`);
    const html = await fetchHTML(LIST_URL, { referer: BASE });
    const items = parseActivityPage(html);
    console.log(`[saikr] 解析 ${items.length} 条`);
    return items;
  } catch (e) {
    console.warn("[saikr] 适配器异常，返回空：", e.message);
    return [];
  } finally {
    await randDelay();
  }
}
