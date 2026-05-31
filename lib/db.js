// SQLite 连接与建表。优先 better-sqlite3；Windows 无原生编译环境时回退 node:sqlite。
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = join(DATA_DIR, "compass.db");

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email_or_phone TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'mentor')),
    school TEXT,
    major_cat TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS questionnaire (
    user_id INTEGER PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    due_date TEXT,
    source TEXT NOT NULL DEFAULT 'custom' CHECK(source IN ('competition', 'plan', 'custom')),
    related_competition_id TEXT,
    status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'doing', 'done')),
    estimated_pomodoros INTEGER,
    completed_pomodoros INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pomodoro_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    task_id INTEGER,
    started_at TEXT NOT NULL,
    duration_sec INTEGER NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS wall_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('team', 'help', 'share')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    related_competition TEXT,
    team_size INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_messages(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_wall_created ON wall_posts(created_at DESC);
`;

import { migrate } from "./migrate.js";

let db;
let driver = "unknown";

try {
  const BetterSqlite3 = (await import("better-sqlite3")).default;
  db = new BetterSqlite3(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  driver = "better-sqlite3";
} catch {
  const { DatabaseSync } = await import("node:sqlite");
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA foreign_keys = ON;");
  driver = "node:sqlite (fallback)";
  console.warn(
    "[db] better-sqlite3 不可用，已回退 node:sqlite。生产环境请安装 better-sqlite3（Linux/macOS 或 Windows + VS C++ 构建工具）。"
  );
}

db.exec(SCHEMA);
migrate(db);
console.log(`[db] 已就绪 ${DB_PATH} (${driver})`);

export default db;
