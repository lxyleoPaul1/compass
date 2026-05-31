import crypto from "node:crypto";
import { pickUrl } from "./lib_fetch.js";

const CATS = ["综合", "经管", "理工", "人文", "媒传"];

export function canonicalName(name = "") {
  return name
    .replace(/[《》“”"']/g, "")
    .replace(/第[一二三四五六七八九十百零\d]+届/g, "")
    .replace(/20\d{2}\s*年?/g, "")
    .replace(/\s+/g, "")
    .trim();
}

export function makeId(name) {
  return crypto.createHash("md5").update(canonicalName(name)).digest("hex").slice(0, 10);
}

export function normalize(raw, source) {
  const name = (raw.name || "").trim();
  if (!name) return null;
  return {
    id: makeId(name),
    name,
    cat: CATS.includes(raw.cat) ? raw.cat : "综合",
    level: raw.level === "A" ? "A" : "List",
    org: raw.org || "",
    majors: raw.majors || "",
    deadline: raw.deadline || null,
    url: raw.url || "",
    schoolRound: raw.schoolRound ?? null,
    verified: raw.verified === true,
    source: source || raw.source || "unknown",
    pubDate: raw.pubDate || null,
  };
}

function uniqueSources(...parts) {
  const set = new Set();
  for (const p of parts) {
    for (const s of String(p || "")
      .split("+")
      .map((x) => x.trim())
      .filter(Boolean)) {
      set.add(s);
    }
  }
  return [...set].join("+");
}

function collectDeadlineCandidates(prev, item) {
  const list = [];
  const add = (source, value) => {
    if (!value || !source) return;
    if (list.some((c) => c.source === source && c.value === value)) return;
    list.push({ source, value });
  };
  for (const c of prev.deadlineCandidates || []) add(c.source, c.value);
  if (prev.deadline) add((prev.source || "cahe").split("+")[0], prev.deadline);
  if (item.deadline) add((item.source || "unknown").split("+")[0], item.deadline);
  return list;
}

function mergeDeadline(prev, item) {
  const deadlineCandidates = collectDeadlineCandidates(prev, item);
  const values = [...new Set(deadlineCandidates.map((c) => c.value))].sort();
  const deadline =
    values.length > 0
      ? values[0]
      : prev.deadline || item.deadline || null;
  const deadlineConflict = values.length > 1;
  return { deadline, deadlineCandidates, deadlineConflict };
}

/** 合并两条同 id 记录（多源交叉印证） */
export function mergeItem(prev, item) {
  const { deadline, deadlineCandidates, deadlineConflict } = mergeDeadline(prev, item);
  return {
    ...prev,
    ...Object.fromEntries(
      Object.entries(item).filter(
        ([k, v]) =>
          v != null &&
          v !== "" &&
          !["deadline", "deadlineCandidates", "deadlineConflict", "source", "verified", "candidate"].includes(k)
      )
    ),
    url: pickUrl(prev.url, item.url),
    deadline,
    deadlineCandidates,
    deadlineConflict,
    verified: prev.verified === true || item.verified === true,
    source: uniqueSources(prev.source, item.source),
  };
}

/**
 * 多源合并：
 * - cahe 骨架 → 正式项
 * - 仅出现在聚合站 → candidate:true
 */
export function mergeAll(caheItems, dynamicItems, { scrapedAt } = {}) {
  const ts = scrapedAt || new Date().toISOString();
  const skeletonIds = new Set(caheItems.map((i) => i.id));
  const officialMap = new Map(
    caheItems.map((i) => [
      i.id,
      {
        ...i,
        candidate: false,
        verified: i.verified === true,
        deadlineCandidates: i.deadline ? [{ source: "cahe", value: i.deadline }] : [],
        deadlineConflict: false,
        lastScrapedAt: ts,
      },
    ])
  );
  const candidateMap = new Map();

  for (const item of dynamicItems) {
    if (!item?.id) continue;
    if (skeletonIds.has(item.id)) {
      const prev = officialMap.get(item.id);
      officialMap.set(item.id, {
        ...mergeItem(prev, item),
        candidate: false,
        lastScrapedAt: ts,
      });
    } else {
      const prev = candidateMap.get(item.id);
      const merged = prev
        ? mergeItem(prev, item)
        : {
            ...item,
            candidate: true,
            verified: false,
            deadlineCandidates: item.deadline ? [{ source: item.source, value: item.deadline }] : [],
            deadlineConflict: false,
          };
      candidateMap.set(item.id, { ...merged, candidate: true, lastScrapedAt: ts });
    }
  }

  const official = [...officialMap.values()].map((i) => ({
    ...i,
    verified: i.verified === true,
    lastScrapedAt: ts,
  }));
  const candidates = [...candidateMap.values()].map((i) => ({
    ...i,
    verified: false,
    lastScrapedAt: ts,
  }));

  const conflictCount = [...official, ...candidates].filter((i) => i.deadlineConflict).length;
  return { official, candidates, skeletonIds, conflictCount };
}

/** @deprecated 保留兼容；请改用 mergeAll */
export function mergeDedup(lists) {
  const flat = lists.flat().filter(Boolean);
  if (!flat.length) return [];
  const map = new Map();
  for (const item of flat) {
    const prev = map.get(item.id);
    map.set(item.id, prev ? mergeItem(prev, item) : item);
  }
  return [...map.values()];
}

export { pickUrl };
