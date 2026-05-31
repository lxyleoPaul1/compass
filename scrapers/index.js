// 抓取编排：骨架(cahe) + 多源动态信息 → 归并 → competitions.json + candidates.json
// 用法：npm run scrape   （建议每周一次 cron）
//
// 安全：本进程只做"抓取+写文件"，不执行系统命令、不写非数据文件、不调用 AI。

import "dotenv/config";
import { fetchCaheList } from "./source_cahe_list.js";
import { fetch52Jingsai } from "./source_52jingsai.js";
import { fetchSaikr } from "./source_saikr.js";
import { fetchPkuDean } from "./source_pku_dean.js";
import { normalize, mergeAll } from "./normalize.js";
import { loadCompetitions, saveCompetitions, saveCandidates } from "../lib/store.js";

async function runSource(name, fn) {
  try {
    const raw = await fn();
    console.log(`[${name}] 原始 ${raw.length} 条`);
    return raw.map((r) => normalize(r, name)).filter(Boolean);
  } catch (e) {
    console.warn(`[${name}] 失败，跳过：`, e.message);
    return [];
  }
}

async function run() {
  const scrapedAt = new Date().toISOString();
  const existing = await loadCompetitions();
  const verifiedMap = new Map(
    (existing.items || []).filter((i) => i.verified).map((i) => [i.id, true])
  );

  const caheRaw = await fetchCaheList();
  const caheItems = caheRaw.map((r) => normalize(r, "cahe")).filter(Boolean);
  console.log(`[cahe] 骨架 ${caheItems.length} 条`);

  const dynamicSources = [
    { name: "52jingsai", fn: fetch52Jingsai },
    { name: "saikr", fn: fetchSaikr },
    { name: "pku_dean", fn: fetchPkuDean },
  ];

  const sourceCounts = { cahe: caheItems.length };
  const dynamicItems = [];
  for (const s of dynamicSources) {
    const items = await runSource(s.name, s.fn);
    sourceCounts[s.name] = items.length;
    dynamicItems.push(...items);
  }

  const { official, candidates, conflictCount } = mergeAll(caheItems, dynamicItems, { scrapedAt });

  const mergedOfficial = official.map((item) =>
    verifiedMap.has(item.id) ? { ...item, verified: true } : { ...item, verified: false }
  );
  const mergedCandidates = candidates.map((item) => ({ ...item, verified: false }));

  const compPayload = await saveCompetitions(mergedOfficial);
  const candPayload = await saveCandidates(mergedCandidates);

  console.log("\n========== 抓取汇总 ==========");
  for (const [src, n] of Object.entries(sourceCounts)) {
    console.log(`  ${src}: ${n} 条`);
  }
  console.log(`  合并后正式项: ${compPayload.count} 条 → data/competitions.json`);
  console.log(`  候选项: ${candPayload.count} 条 → data/candidates.json`);
  console.log(`  deadlineConflict 需人工核对: ${conflictCount} 条`);
  console.log("================================\n");
}

run().catch((e) => {
  console.error("抓取进程异常：", e);
  process.exitCode = 1;
});
