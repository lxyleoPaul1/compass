// 数据库增量迁移：检测列是否存在再 ALTER，不破坏现有数据。

export function migrate(db) {
  const taskCols = new Set(db.prepare("PRAGMA table_info(tasks)").all().map((c) => c.name));
  const addTaskCol = (name, def) => {
    if (!taskCols.has(name)) db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${def}`);
  };
  addTaskCol("scheduled_date", "TEXT");
  addTaskCol("scheduled_start", "TEXT");
  addTaskCol("scheduled_end", "TEXT");
  addTaskCol("order_index", "INTEGER NOT NULL DEFAULT 0");
  addTaskCol("starred", "INTEGER NOT NULL DEFAULT 0");

  const wallCols = new Set(db.prepare("PRAGMA table_info(wall_posts)").all().map((c) => c.name));
  if (!wallCols.has("skills")) db.exec("ALTER TABLE wall_posts ADD COLUMN skills TEXT");

  db.exec(`
    CREATE TABLE IF NOT EXISTS wall_upvotes (
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES wall_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_wall_upvotes_post ON wall_upvotes(post_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_scheduled ON tasks(user_id, scheduled_date);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id INTEGER PRIMARY KEY,
      theme TEXT NOT NULL DEFAULT 'editorial',
      slogan TEXT NOT NULL DEFAULT '',
      font_scale TEXT NOT NULL DEFAULT 'md',
      reduce_motion INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 用户提问结构化存储（需求洞察）
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      question_text TEXT NOT NULL,
      related_context TEXT NOT NULL DEFAULT 'advisor',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_questions_user ON user_questions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_questions_session ON user_questions(session_id);
  `);

  const chatCols = new Set(db.prepare("PRAGMA table_info(chat_messages)").all().map((c) => c.name));
  const addChatCol = (name, def) => {
    if (!chatCols.has(name)) db.exec(`ALTER TABLE chat_messages ADD COLUMN ${name} ${def}`);
  };
  addChatCol("session_id", "TEXT");
  addChatCol("citations", "TEXT");
  addChatCol("disclaimer", "TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(user_id, session_id, id)");

  // 联网搜索调用日志（成本监控）
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_search_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_id TEXT,
      search_calls INTEGER NOT NULL DEFAULT 1,
      query_hint TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_web_search_user ON web_search_logs(user_id, created_at DESC);
  `);
}
