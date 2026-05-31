// 信源：北京大学教务部「竞赛」通知栏目（高校教务处示例适配器）。
//
// 目标页：https://dean.pku.edu.cn/web/notice.php?type=29
// robots.txt：未单独限制 notice 列表；官方校内通知，低频抓取、标注来源。
// 说明：列表页仅有发布日期，报名截止需进详情页；本适配器 deadline 多为 null，供标题/链接交叉印证。

import * as cheerio from "cheerio";
import {
  fetchHTML,
  randDelay,
  cleanName,
  guessCategory,
  absUrl,
  extractDeadline,
} from "./lib_fetch.js";

const LIST_URL = "https://dean.pku.edu.cn/web/notice.php?type=29";
const BASE = "https://dean.pku.edu.cn/web/";

function parseNoticeList(html) {
  const $ = cheerio.load(html);
  const out = [];

  $(".notice_item .notice_box").each((_, el) => {
    try {
      const $el = $(el);
      const a = $el.find("a.active, a[href*='notice_details']").first();
      const href = a.attr("href") || "";
      const name = cleanName(a.text().trim() || a.attr("title") || "");
      if (!name || name.length < 6) return;

      const pubDate = $el.find("span").first().text().trim();
      // 发布日期不等于报名截止；仅当标题含明确截止措辞时才尝试提取
      const deadline = extractDeadline(name) || null;

      out.push({
        name,
        url: absUrl(href, BASE),
        deadline,
        org: "北京大学教务部",
        cat: guessCategory(name),
        level: "List",
        source: "pku_dean",
        pubDate: /^\d{4}-\d{2}-\d{2}$/.test(pubDate) ? pubDate : null,
      });
    } catch (e) {
      console.warn("[pku_dean] 单条 notice_box 解析失败，跳过：", e.message);
    }
  });

  return out;
}

export async function fetchPkuDean() {
  try {
    console.log(`[pku_dean] 抓取 ${LIST_URL}`);
    const html = await fetchHTML(LIST_URL, { referer: BASE });
    const items = parseNoticeList(html);
    console.log(`[pku_dean] 解析 ${items.length} 条`);
    return items;
  } catch (e) {
    console.warn("[pku_dean] 适配器异常，返回空：", e.message);
    return [];
  } finally {
    await randDelay();
  }
}
