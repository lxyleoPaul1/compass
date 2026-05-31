// 可验证出处：竞赛知识库（优先）+ Kimi $web_search 结构化结果（严禁信任正文链接）

function mentionsCompetition(text, comp) {
  const t = String(text || "");
  const name = comp.name || "";
  if (name.length >= 4 && t.includes(name)) return true;
  const short = name.replace(/(全国|中国|大学生|竞赛|大赛|杯)/g, "").trim();
  if (short.length >= 3 && t.includes(short.slice(0, Math.min(8, short.length)))) return true;
  return false;
}

export function buildCitations({
  userText,
  assistantText,
  competitions = [],
  searchSources = [],
  webSearchUsed = false,
  searchEnabled = false,
}) {
  const citations = [];
  const seen = new Set();

  const add = (title, url, source) => {
    if (!url || url === "#" || !/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    citations.push({
      title: String(title || url).slice(0, 160),
      url,
      source,
    });
  };

  for (const c of competitions) {
    if (mentionsCompetition(userText, c) || mentionsCompetition(assistantText, c)) {
      add(c.name, c.url, "compass_competition");
    }
  }

  for (const s of searchSources || []) {
    add(s.title, s.url, "web_search");
  }

  let disclaimer = null;
  if (!citations.length) {
    if (webSearchUsed) {
      disclaimer =
        "本回答已触发联网检索，但未能从搜索结果中提取可验证的链接。请以学校、教育部及赛事主办方官方发布为准。";
    } else {
      disclaimer = "此为基于一般经验的建议，无确切可验证来源，请以官方信息为准。";
    }
  }

  return { citations, disclaimer };
}

export { mentionsCompetition };
