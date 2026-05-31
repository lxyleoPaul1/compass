# 新生指北 Compass

面向"高考结束—大学第一年"的非营利学生服务。

**核心功能**
1. **竞赛雷达** — 高教学会榜单 + 多源聚合，五大类筛选、个性化排序
2. **我的计划 + 番茄钟** — 赛事/规划里程碑变任务，25+5 番茄计时
3. **规划顾问（AI）** — Kimi 驱动的学业/竞赛/履历问答（需登录）
4. **问卷 + 目标拆解 + 校内赛调研**
5. **信息墙** — 组队/答疑/经验分享（轻量 UGC）

---

## ⚠️ 安全
- Kimi API Key 只在服务器 `.env`，不进前端、不进 git
- 密码 bcrypt 哈希；会话 httpOnly + SameSite=Lax cookie
- SQL 全参数化；UGC 文本转义 + 发帖频率限制

---

## 本地运行

要求 **Node ≥ 18.17**。

```bash
cp .env.example .env    # 填入 MOONSHOT_API_KEY、SESSION_SECRET
npm install             # 含 better-sqlite3（Windows 需 VS C++ 构建工具或预编译包）
npm run scrape          # 可选：更新 data/competitions.json
npm start               # http://localhost:8788
```

**Windows 注意**：`better-sqlite3` 为原生模块。若 `npm install` 失败，请安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（勾选「使用 C++ 的桌面开发」），或换 Linux/macOS 部署。

首次启动自动创建 `data/compass.db` 及所有表。

---

## 目录结构

```
server.js                 Express 入口（会话 + 路由挂载）
lib/db.js                 SQLite 连接与建表
lib/kimi.js               Kimi 调用（仅服务端）
lib/store.js              competitions.json 读写
lib/validate.js           输入校验
lib/rateLimit.js          内存速率限制
middleware/auth.js        登录态 / requireAuth
routes/auth.js            注册 / 登录 / 退出 / me
routes/questionnaire.js   问卷存取 + AI 规划
routes/chat.js            规划顾问多轮对话
routes/tasks.js           任务 + 番茄记录
routes/wall.js            信息墙
scrapers/                 竞赛抓取（产物 → competitions.json）
public/index.html         前端单页（Hash 路由）
public/js/compass-modules.js  认证/聊天/番茄/信息墙
data/competitions.json    竞赛数据（抓取产物）
data/compass.db           用户/UGC/任务（SQLite，自动生成）
```

---

## 数据库表（SQLite）

| 表 | 说明 |
|---|---|
| `users` | id, username, email_or_phone, password_hash, role(user/mentor), school, major_cat, created_at |
| `questionnaire` | user_id, payload(JSON), updated_at |
| `chat_messages` | user_id, role, content, created_at |
| `tasks` | user_id, title, due_date, source, related_competition_id, status, estimated/completed_pomodoros |
| `pomodoro_sessions` | user_id, task_id, started_at, duration_sec, completed |
| `wall_posts` | user_id, type(team/help/share), title, body, related_competition, team_size, created_at |

竞赛清单仍在 `competitions.json`，不迁入数据库。

**手动标记学长学姐**：`UPDATE users SET role='mentor' WHERE username='xxx';`

---

## API 列表

| 方法 | 路径 | 说明 | 登录 |
|---|---|---|---|
| GET | `/api/competitions` | 竞赛列表 | 否 |
| GET | `/api/health` | 健康检查 | 否 |
| POST | `/api/decompose` | 目标拆解 | 否 |
| POST | `/api/intramural` | 校内赛调研 | 否 |
| POST | `/api/plan` | 问卷规划（游客） | 否 |
| POST | `/api/auth/register` | 注册 | 否 |
| POST | `/api/auth/login` | 登录 | 否 |
| POST | `/api/auth/logout` | 退出 | 否 |
| GET | `/api/auth/me` | 当前用户 | 否 |
| GET/POST | `/api/questionnaire` | 问卷 | 是 |
| GET/POST | `/api/chat` | 规划顾问 | 是 |
| GET/POST/PATCH/DELETE | `/api/tasks` | 任务 CRUD | 是 |
| POST | `/api/tasks/:id/pomodoro` | 完成番茄 | 是 |
| GET | `/api/tasks/stats` | 番茄/任务统计 | 是 |
| GET/POST | `/api/wall` | 信息墙列表/发帖 | 发帖需登录 |
| DELETE | `/api/wall/:id` | 删帖（作者或 mentor） | 是 |

---

## 本机验证步骤

1. `npm start`，打开 http://localhost:8788
2. **注册** → 登录，顶栏显示用户名
3. **填问卷**（侧栏「开始问卷」）→ 生成规划 → 竞赛雷达按专业大类排序
4. **规划顾问**（导航 `#advisor`）→ 多轮对话
5. 竞赛雷达 **加入计划** → 侧栏/ `#tasks` 见任务 → **番茄钟**计时
6. 规划里程碑点 **转为任务** → 番茄完成 +1
7. **信息墙** `#wall` → 发帖 → 按类型筛选 → 删除自己的帖

---

## 部署

nginx 子路径示例：
```nginx
location /compass/ { proxy_pass http://127.0.0.1:8788/; proxy_set_header Host $host; }
```
生产环境设置 `NODE_ENV=production` 与强随机 `SESSION_SECRET`（HTTPS 下 cookie.secure 自动开启）。

---

## TODO / 简化项

- 登录后 **游客 localStorage 数据合并** 至云端（代码中已留 TODO）
- 信息墙顶部 **QQ/微信群链接** 占位，需管理员填写
- 内容审核依赖作者/mentor 删帖，无自动审核
- 速率限制为单进程内存，多实例部署需换 Redis 等
