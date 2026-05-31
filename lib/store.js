import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE = join(__dirname, "..", "data", "competitions.json");
const CANDIDATES_STORE = join(__dirname, "..", "data", "candidates.json");

export async function loadCompetitions() {
  try {
    const raw = await readFile(STORE, "utf8");
    return JSON.parse(raw);
  } catch {
    return { items: [] };
  }
}

export async function saveCompetitions(list) {
  const payload = {
    updatedAt: new Date().toISOString(),
    count: list.length,
    items: list,
  };
  await writeFile(STORE, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

export async function saveCandidates(list) {
  const payload = {
    updatedAt: new Date().toISOString(),
    count: list.length,
    items: list,
  };
  await writeFile(CANDIDATES_STORE, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}
