// Compass 扩展模块：认证、规划顾问、番茄钟/任务、信息墙、Hash 路由
(() => {
  const LS_POMO = "compass_pom_state";
  const POMO_WORK = Number(localStorage.getItem("compass_pom_work") || 25) * 60;
  const POMO_BREAK = Number(localStorage.getItem("compass_pom_break") || 5) * 60;

  let currentUser = null;
  let dbTasks = [];
  let chatHistory = [];
  let chatSessionId = null;
  let chatSessions = [];
  let wallFilter = "";
  let wallPage = 1;
  let wallHasMore = false;
  let wallSearchTimer = null;
  let authTab = "login";
  let pomo = { running: false, mode: "work", endAt: null, taskId: null, pausedRemaining: null };
  let pomoTimer = null;

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s ?? "";
    return d.innerHTML;
  }

  async function api(path, opts = {}) {
    const res = await fetch(`api/${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function toast(msg) {
    if (typeof window.toast === "function") window.toast(msg);
  }

  // ---------- 路由 ----------
  const CRUMB_LABELS = {
    home: "今日总览",
    feed: "竞赛雷达",
    tasks: "规划与任务",
    advisor: "规划顾问",
    wall: "社区",
  };

  function updateBreadcrumb(active) {
    const el = document.getElementById("pageCrumb");
    if (!el) return;
    const label = CRUMB_LABELS[active] || active;
    if (active === "home") {
      el.innerHTML = `<span class="here">${esc(label)}</span>`;
    } else {
      el.innerHTML = `<a href="#home">今日</a><span class="sep">/</span><span class="here">${esc(label)}</span>`;
    }
  }

  function navigate() {
    const raw = location.hash.slice(1) || "home";
    const [routePart, queryPart] = raw.split("?");
    const views = ["home", "feed", "advisor", "tasks", "wall"];
    const active = views.includes(routePart) ? routePart : "home";
    document.querySelectorAll(".page-view").forEach((el) => {
      el.classList.toggle("active", el.dataset.view === active);
    });
    const hero = document.getElementById("heroSection");
    if (hero) hero.style.display = "none";
    document.querySelectorAll(".nav a[data-route]").forEach((a) => {
      a.classList.toggle("active", a.dataset.route === active);
    });
    updateBreadcrumb(active);
    if (active === "home") window.Dashboard?.refresh?.();
    if (active === "tasks") {
      window.Workbench?.renderAll?.();
    }
    if (active === "wall") {
      if (queryPart) {
        const comp = new URLSearchParams(queryPart).get("comp");
        if (comp) {
          const inp = document.getElementById("wallSearch");
          if (inp) inp.value = comp;
        }
      }
      loadWall(true);
    }
    if (active === "advisor" && currentUser) {
      loadChatHistory();
      loadChatSessions();
    }
  }

  // ---------- 认证 ----------
  function renderAuthUI() {
    const area = document.getElementById("authArea");
    if (!area) return;
    if (currentUser) {
      const mentor = currentUser.role === "mentor" ? '<span class="badge">学长学姐</span>' : "";
      area.innerHTML = `<div class="user-menu">
        <button type="button" class="user-menu-btn" onclick="CompassUI.toggleUserMenu(event)">${esc(currentUser.username)} ${mentor} ▾</button>
        <div class="user-dropdown" id="userDropdown">
          <button type="button" onclick="CompassUI.logout()">退出登录</button>
        </div>
      </div>`;
    } else {
      area.innerHTML = `<button type="button" class="auth-btn login-text" onclick="CompassUI.openAuth('login')">登录</button>
        <button type="button" class="auth-btn primary" onclick="CompassUI.openAuth('register')">注册</button>`;
    }
    const hint = document.getElementById("advisorLoginHint");
    if (hint) hint.style.display = currentUser ? "none" : "";
  }

  async function refreshUser() {
    try {
      const data = await api("auth/me");
      currentUser = data.user;
    } catch {
      currentUser = null;
    }
    renderAuthUI();
    if (currentUser) {
      await loadQuestionnaireFromServer();
      await loadTasks();
      updateWallFormVisibility();
      // 登录后同步/合并偏好（主题、slogan 等）
      if (window.CompassPrefs?.mergeLocalOnLogin) {
        await window.CompassPrefs.mergeLocalOnLogin();
      } else if (window.CompassPrefs?.syncFromServer) {
        await window.CompassPrefs.syncFromServer();
      }
    }
  }

  function openAuth(tab = "login") {
    authTab = tab;
    switchAuthTab(tab);
    document.getElementById("authErr").style.display = "none";
    document.getElementById("authOverlay").classList.add("open");
  }

  function closeAuth() {
    document.getElementById("authOverlay").classList.remove("open");
  }

  function switchAuthTab(tab) {
    authTab = tab;
    document.getElementById("tabLogin").classList.toggle("on", tab === "login");
    document.getElementById("tabRegister").classList.toggle("on", tab === "register");
    document.getElementById("authLoginForm").style.display = tab === "login" ? "" : "none";
    document.getElementById("authRegisterForm").style.display = tab === "register" ? "" : "none";
    document.getElementById("authModalTitle").textContent = tab === "login" ? "登录" : "注册";
    document.getElementById("authSubmitBtn").textContent = tab === "login" ? "登录" : "注册";
  }

  async function submitAuth() {
    const errEl = document.getElementById("authErr");
    errEl.style.display = "none";
    const btn = document.getElementById("authSubmitBtn");
    btn.disabled = true;
    try {
      if (authTab === "login") {
        await api("auth/login", {
          method: "POST",
          body: JSON.stringify({
            login: document.getElementById("authLoginId").value.trim(),
            password: document.getElementById("authLoginPw").value,
          }),
        });
      } else {
        await api("auth/register", {
          method: "POST",
          body: JSON.stringify({
            username: document.getElementById("authRegUser").value.trim(),
            email_or_phone: document.getElementById("authRegContact").value.trim(),
            password: document.getElementById("authRegPw").value,
            school: document.getElementById("authRegSchool").value.trim(),
            major_cat: document.getElementById("authRegCat").value,
          }),
        });
      }
      closeAuth();
      await refreshUser();
      // TODO: 可选——将 localStorage 中的问卷/计划/番茄/偏好数据合并到数据库
      toast("欢迎回来");
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = "block";
    }
    btn.disabled = false;
  }

  async function logout() {
    await api("auth/logout", { method: "POST", body: "{}" });
    currentUser = null;
    dbTasks = [];
    renderAuthUI();
    closeUserMenu();
    toast("已退出");
    if (typeof window.renderPlan === "function") window.renderPlan();
  }

  function toggleUserMenu(ev) {
    ev.stopPropagation();
    document.getElementById("userDropdown")?.classList.toggle("open");
  }

  function closeUserMenu() {
    document.getElementById("userDropdown")?.classList.remove("open");
  }

  document.addEventListener("click", closeUserMenu);

  // ---------- 问卷同步 ----------
  async function loadQuestionnaireFromServer() {
    try {
      const data = await api("questionnaire");
      if (data.payload && typeof window.saveProfile === "function") {
        window.saveProfile(data.payload);
        if (typeof window.renderFocus === "function") window.renderFocus();
        if (typeof window.renderFeed === "function") window.renderFeed();
        if (typeof window.updateSurveyStatus === "function") window.updateSurveyStatus();
      }
    } catch {
      /* 未填问卷 */
    }
  }

  // ---------- 任务 ----------
  async function loadTasks() {
    if (!currentUser) return;
    try {
      const data = await api("tasks");
      dbTasks = data.tasks || [];
      await loadTaskStats();
      if (typeof window.renderPlan === "function") window.renderPlan();
      window.renderFeed?.();
      window.Dashboard?.refresh?.();
      window.Workbench?.renderAll?.();
    } catch (e) {
      console.warn("loadTasks", e.message);
    }
  }

  async function loadTaskStats() {
    if (!currentUser) return;
    try {
      const s = await api("tasks/stats");
      document.getElementById("statPomToday").textContent = s.pomodorosToday ?? 0;
      document.getElementById("statPomWeek").textContent = s.pomodorosWeek ?? 0;
      const elDone = document.getElementById("statDoneToday");
      if (elDone) elDone.textContent = s.tasksDoneToday ?? 0;
      const trend = document.getElementById("weekTrend");
      if (trend && s.pomTrend?.length) {
        trend.textContent = "本周番茄：" + s.pomTrend.map((p) => `${p.d.slice(5)}:${p.n}`).join(" · ");
      }
    } catch {
      /* ignore */
    }
  }

  async function createTask(payload) {
    if (!currentUser) return null;
    const today = new Date().toISOString().slice(0, 10);
    const body = { scheduled_date: payload.scheduled_date || payload.due_date || today, ...payload };
    const data = await api("tasks", { method: "POST", body: JSON.stringify(body) });
    await loadTasks();
    window.renderPlan?.();
    window.renderFeed?.();
    window.Dashboard?.refresh?.();
    window.Workbench?.renderAll?.();
    return data.task;
  }

  async function updateTaskStatus(id, status) {
    await api(`tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await loadTasks();
  }

  async function deleteTask(id) {
    await api(`tasks/${id}`, { method: "DELETE" });
    await loadTasks();
  }

  function renderTaskView() {
    /* 已由 Workbench 接管 */
  }

  function selectPomoTask(id, title) {
    if (!id) return;
    pomo.taskId = Number(id) || id;
    const label = document.getElementById("pomoTaskLabel");
    if (label) label.textContent = "当前任务：" + (title || "");
    toast("已选择任务");
  }

  async function completeTask(id) {
    await updateTaskStatus(id, "done");
    toast("任务已完成");
  }

  async function removeTask(id) {
    if (!confirm("确定删除这条任务？")) return;
    await deleteTask(id);
    toast("已删除");
  }

  async function addMilestoneAsTask(step, when) {
    if (!currentUser) {
      toast("登录后可同步到云端任务");
      return;
    }
    await createTask({ title: step, due_date: null, scheduled_date: new Date().toISOString().slice(0, 10), source: "plan", status: "todo" });
    toast("已加入任务");
  }

  // ---------- 番茄钟（时间戳驱动，后台标签页仍准确） ----------
  function savePomoState() {
    localStorage.setItem(
      LS_POMO,
      JSON.stringify({ running: pomo.running, mode: pomo.mode, endAt: pomo.endAt, taskId: pomo.taskId, pausedRemaining: pomo.pausedRemaining })
    );
  }

  function loadPomoState() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_POMO));
      if (s) Object.assign(pomo, s);
    } catch {
      /* ignore */
    }
  }

  function formatSec(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function pomoRemaining() {
    if (pomo.pausedRemaining != null) return pomo.pausedRemaining;
    if (!pomo.endAt) return pomo.mode === "work" ? POMO_WORK : POMO_BREAK;
    return Math.max(0, Math.ceil((pomo.endAt - Date.now()) / 1000));
  }

  function updatePomoDisplay() {
    const rem = pomoRemaining();
    document.getElementById("pomoTime").textContent = formatSec(rem);
    document.getElementById("pomoMode").textContent = pomo.mode === "work" ? `专注 ${POMO_WORK / 60} 分钟` : `休息 ${POMO_BREAK / 60} 分钟`;
  }

  function tickPomo() {
    clearTimeout(pomoTimer);
    updatePomoDisplay();
    if (!pomo.running) return;
    const rem = pomoRemaining();
    if (rem <= 0) {
      onPomoPhaseDone();
      return;
    }
    pomoTimer = setTimeout(tickPomo, 250);
  }

  async function onPomoPhaseDone() {
    if (pomo.mode === "work") {
      toast("专注完成！休息一下吧");
      if (currentUser && pomo.taskId) {
        try {
          await api(`tasks/${pomo.taskId}/pomodoro`, {
            method: "POST",
            body: JSON.stringify({ duration_sec: POMO_WORK, completed: true }),
          });
          await loadTaskStats();
          await loadTasks();
          window.Dashboard?.refresh?.();
          window.Workbench?.renderAll?.();
        } catch {
          /* ignore */
        }
      }
      pomo.mode = "break";
      pomo.endAt = Date.now() + POMO_BREAK * 1000;
      pomo.pausedRemaining = null;
    } else {
      toast("休息结束，继续加油");
      pomo.mode = "work";
      pomo.endAt = Date.now() + POMO_WORK * 1000;
      pomo.pausedRemaining = null;
    }
    savePomoState();
    tickPomo();
  }

  function startPomo() {
    if (!pomo.running) {
      pomo.running = true;
      if (pomo.pausedRemaining != null) {
        pomo.endAt = Date.now() + pomo.pausedRemaining * 1000;
        pomo.pausedRemaining = null;
      } else if (!pomo.endAt) {
        pomo.endAt = Date.now() + (pomo.mode === "work" ? POMO_WORK : POMO_BREAK) * 1000;
      }
    }
    savePomoState();
    tickPomo();
  }

  function pausePomo() {
    if (pomo.running) {
      pomo.pausedRemaining = pomoRemaining();
      pomo.running = false;
      pomo.endAt = null;
      savePomoState();
      clearTimeout(pomoTimer);
      updatePomoDisplay();
    }
  }

  function resetPomo() {
    pomo = { running: false, mode: "work", endAt: null, taskId: pomo.taskId, pausedRemaining: null };
    savePomoState();
    clearTimeout(pomoTimer);
    updatePomoDisplay();
  }

  document.addEventListener("visibilitychange", () => {
    if (pomo.running) tickPomo();
  });

  // ---------- 规划顾问聊天 ----------
  async function loadChatHistory(sessionId) {
    if (!currentUser) return;
    try {
      const q = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
      const data = await api(`chat${q}`);
      chatHistory = data.messages || [];
      chatSessionId = data.session_id || sessionId || null;
      renderChat();
    } catch {
      chatHistory = [];
      renderChat();
    }
  }

  async function loadChatSessions() {
    if (!currentUser) return;
    try {
      const data = await api("chat/history");
      chatSessions = data.sessions || [];
      renderChatSessionList();
    } catch {
      chatSessions = [];
    }
  }

  function renderChatSessionList() {
    const panel = document.getElementById("chatHistoryPanel");
    if (!panel) return;
    if (!chatSessions.length) {
      panel.innerHTML = `<p style="font-size:var(--text-sm);color:var(--ink-faint);padding:var(--space-2)">暂无历史会话</p>`;
      return;
    }
    panel.innerHTML = "";
    chatSessions.forEach((s) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chat-history-item" + (s.session_id === chatSessionId ? " on" : "");
      const preview = (s.first_question || "对话").slice(0, 36);
      btn.textContent = `${preview}${preview.length >= 36 ? "…" : ""} · ${String(s.updated_at || "").slice(0, 10)}`;
      btn.onclick = () => {
        chatSessionId = s.session_id;
        panel.classList.remove("open");
        loadChatHistory(s.session_id);
        renderChatSessionList();
      };
      panel.appendChild(btn);
    });
  }

  function toggleChatHistory() {
    if (!currentUser) {
      openAuth("login");
      return;
    }
    const panel = document.getElementById("chatHistoryPanel");
    if (!panel) return;
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) loadChatSessions();
  }

  function newChatSession() {
    if (!currentUser) {
      openAuth("login");
      return;
    }
    chatSessionId = null;
    chatHistory = [];
    document.getElementById("chatHistoryPanel")?.classList.remove("open");
    renderChat();
    toast("已开始新对话");
  }

  function parseAssistantContent(text) {
    // 识别编号追问，渲染为列表
    const lines = String(text).split("\n");
    const questions = [];
    const rest = [];
    let inQ = false;
    for (const line of lines) {
      const m = line.match(/^\s*(?:\d+[.、)]|[-•])\s*(.+\?|.+？)\s*$/);
      if (m) {
        questions.push(m[1].trim());
        inQ = true;
      } else if (inQ && questions.length && line.trim() === "") {
        /* skip */
      } else {
        rest.push(line);
        inQ = false;
      }
    }
    return { questions, body: rest.join("\n").trim() || text };
  }

  function appendChatSources(wrap, citations, disclaimer, webSearchUsed) {
    if (webSearchUsed) {
      const badge = document.createElement("div");
      badge.className = "chat-search-badge";
      badge.textContent = "已联网检索";
      wrap.appendChild(badge);
    }
    if (citations?.length) {
      const block = document.createElement("div");
      block.className = "chat-sources";
      const label = document.createElement("div");
      label.className = "src-label";
      label.textContent = "参考来源";
      block.appendChild(label);
      const ul = document.createElement("ul");
      citations.forEach((c) => {
        const li = document.createElement("li");
        const tag = document.createElement("span");
        tag.className = "src-tag";
        tag.textContent = c.source === "compass_competition" ? "竞赛库" : c.source === "web_search" ? "联网" : "来源";
        const a = document.createElement("a");
        a.href = c.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = c.title || c.url;
        li.appendChild(tag);
        li.appendChild(a);
        ul.appendChild(li);
      });
      block.appendChild(ul);
      wrap.appendChild(block);
    }
    if (disclaimer) {
      const d = document.createElement("div");
      d.className = "chat-disclaimer";
      d.textContent = disclaimer;
      wrap.appendChild(d);
    }
  }

  function renderAssistantBubble(container, msg) {
    const content = typeof msg === "string" ? msg : msg.content;
    const citations = typeof msg === "object" ? msg.citations : null;
    const disclaimer = typeof msg === "object" ? msg.disclaimer : null;
    const webSearchUsed = typeof msg === "object" ? msg.web_search_used : false;
    const { questions, body } = parseAssistantContent(content);
    const wrap = document.createElement("div");
    wrap.className = "chat-msg assistant";
    if (questions.length >= 1 && questions.length <= 5) {
      const intro = document.createElement("div");
      intro.textContent = body.split("\n").find((l) => l.includes("确认") || l.includes("了解")) || "为了给你更贴身的建议，我想先确认：";
      wrap.appendChild(intro);
      const ul = document.createElement("ol");
      ul.className = "chat-qlist";
      questions.forEach((q) => {
        const li = document.createElement("li");
        li.textContent = q;
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
      if (body && !body.includes(questions[0]?.slice(0, 8))) {
        const extra = document.createElement("div");
        extra.style.marginTop = "8px";
        extra.textContent = body;
        wrap.appendChild(extra);
      }
      const quick = document.createElement("div");
      quick.className = "chat-quick";
      questions.slice(0, 3).forEach((q) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = "回答：" + q.slice(0, 18) + (q.length > 18 ? "…" : "");
        b.onclick = () => {
          document.getElementById("chatInput").value = q.replace(/？$/, "：");
          document.getElementById("chatInput").focus();
        };
        quick.appendChild(b);
      });
      wrap.appendChild(quick);
    } else {
      wrap.textContent = content;
    }
    appendChatSources(wrap, citations, disclaimer, webSearchUsed);
    container.appendChild(wrap);
    // 顾问建议可一键采纳为任务
    if (currentUser && content && content.length > 4) {
      const actions = document.createElement("div");
      actions.className = "chat-adopt-row";
      actions.style.marginTop = "8px";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn ghost";
      btn.style.cssText = "font-size:11px;padding:4px 10px;min-height:auto";
      btn.textContent = "+ 采纳为今日任务";
      btn.onclick = () => adoptChatAsTask(content);
      actions.appendChild(btn);
      wrap.appendChild(actions);
    }
  }

  async function adoptChatAsTask(text) {
    if (!currentUser) {
      openAuth("login");
      return;
    }
    const line = String(text).split("\n").find((l) => l.trim().length > 4) || text;
    const title = line.replace(/^[\d.、\-•]\s*/, "").trim().slice(0, 80);
    if (!title) {
      toast("没有可采纳的内容");
      return;
    }
    try {
      await createTask({ title, source: "advisor", status: "todo" });
      toast("已加入今日待办");
    } catch (e) {
      toast(e.message);
    }
  }

  /** 将竞赛拆成 3 条带日程的任务 */
  async function splitCompTasks(compId) {
    const c = window.getComp?.(compId);
    if (!c) return;
    if (!currentUser) {
      toast("登录后可拆成云端任务并同步日历");
      openAuth("login");
      return;
    }
    const deadline = c.deadline || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const base = new Date(deadline);
    const steps = [
      { title: `调研「${c.name}」报名要求与组队`, daysBefore: 21 },
      { title: `完成「${c.name}」校内/初赛准备`, daysBefore: 10 },
      { title: `提交「${c.name}」报名（截止前）`, daysBefore: 2 },
    ];
    try {
      for (const s of steps) {
        const d = new Date(base);
        d.setDate(d.getDate() - s.daysBefore);
        const sd = d.toISOString().slice(0, 10);
        await createTask({
          title: s.title,
          due_date: deadline,
          scheduled_date: sd,
          source: "competition",
          related_competition_id: c.id,
          status: "todo",
        });
      }
      toast("已拆成 3 条任务，可在工作台查看");
      location.hash = "#tasks";
    } catch (e) {
      toast(e.message);
    }
  }

  function openWallForComp(name) {
    location.hash = `#wall?comp=${encodeURIComponent(name)}`;
  }

  function renderChat() {
    const box = document.getElementById("chatMsgs");
    if (!box) return;
    box.innerHTML = "";
    if (!chatHistory.length) {
      box.innerHTML = `<div class="chat-msg assistant">你好，我是 Compass 规划顾问。可以说说你的年级、专业和目标——信息不全时我会先追问几个关键问题，再给你具体建议。回答下方会标注可验证来源。</div>`;
      return;
    }
    chatHistory.forEach((m) => {
      if (m.role === "assistant") {
        renderAssistantBubble(box, m);
      } else {
        const d = document.createElement("div");
        d.className = "chat-msg user";
        d.textContent = m.content;
        box.appendChild(d);
      }
    });
    box.scrollTop = box.scrollHeight;
  }

  async function sendChat() {
    if (!currentUser) {
      openAuth("login");
      toast("请先登录再使用规划顾问");
      return;
    }
    const input = document.getElementById("chatInput");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    chatHistory.push({ role: "user", content: text });
    renderChat();
    const btn = document.getElementById("chatSend");
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.classList.add("is-loading");
    const thinking = document.createElement("div");
    thinking.className = "chat-msg assistant thinking";
    thinking.id = "chatThinking";
    thinking.textContent = "正在思考…";
    document.getElementById("chatMsgs").appendChild(thinking);
    document.getElementById("chatMsgs").scrollTop = 99999;
    try {
      const msgs = chatHistory.filter((m) => m.role === "user" || m.role === "assistant").slice(-16);
      const payload = { messages: msgs, session_id: chatSessionId };
      if (!chatSessionId) payload.new_session = true;
      const data = await api("chat", { method: "POST", body: JSON.stringify(payload) });
      chatSessionId = data.session_id || chatSessionId;
      chatHistory.push({
        role: "assistant",
        content: data.reply,
        citations: data.citations || [],
        disclaimer: data.disclaimer || null,
        web_search_used: data.web_search_used,
      });
      renderChat();
      loadChatSessions();
    } catch (e) {
      document.getElementById("chatThinking")?.remove();
      toast(e.message || "AI 暂不可用，请稍后再试");
    }
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    btn.classList.remove("is-loading");
    btn.textContent = "发送";
  }

  // ---------- 信息墙 ----------
  function updateWallFormVisibility() {
    const form = document.getElementById("wallForm");
    if (form) form.style.display = currentUser ? "" : "none";
  }

  function renderWallCard(p, list, prepend) {
    const card = document.createElement("article");
    card.className = "wall-card";
    card.dataset.id = p.id;
    const mentor = p.isMentor ? '<span class="mentor-tag">学长学姐</span>' : "";
    const canDel = currentUser && (currentUser.username === p.author || currentUser.role === "mentor");
    const skills = p.skills ? `<div class="foot">技能 · ${esc(p.skills)}</div>` : "";
    const comp = p.related_competition
      ? (window.DATA || []).find((c) => c.name === p.related_competition || c.name.includes(p.related_competition))
      : null;
    const compLine = p.related_competition
      ? comp
        ? `<div class="foot">关联 · <button type="button" class="linkish" onclick="openDrawer('${esc(comp.id)}')">${esc(p.related_competition)} →</button></div>`
        : `<div class="foot">关联 · ${esc(p.related_competition)}</div>`
      : "";
    card.innerHTML = `<div class="wh"><span class="type-tag">${esc(p.typeLabel)}</span>${mentor}</div>
      <h4>${esc(p.title)}</h4>
      <div class="body">${esc(p.body)}</div>
      ${compLine}
      ${skills}
      <div class="foot"><span>${esc(p.author)} · ${esc(String(p.created_at).slice(0, 16).replace("T", " "))}</span>
      <span>
        <button type="button" class="wall-bump ${p.bumped ? "on" : ""}" onclick="CompassUI.bumpWall(${p.id}, this)">${p.type === "team" ? "我也想加入" : "顶一下"} · ${p.upvotes || 0}</button>
        ${canDel ? `<button type="button" class="btn ghost" onclick="CompassUI.deleteWall(${p.id})">删除</button>` : ""}
      </span></div>`;
    if (prepend) list.prepend(card);
    else list.appendChild(card);
  }

  async function loadWall(reset = true) {
    try {
      if (reset) wallPage = 1;
      else wallPage += 1;
      const q = encodeURIComponent(document.getElementById("wallSearch")?.value?.trim() || "");
      const sort = document.getElementById("wallSort")?.value || "latest";
      const typeQ = wallFilter ? `&type=${wallFilter}` : "";
      const data = await api(`wall?page=${wallPage}&limit=15&sort=${sort}&q=${q}${typeQ}`);
      const list = document.getElementById("wallList");
      if (reset) list.innerHTML = "";
      if (reset && !data.posts?.length) {
        list.innerHTML = `<div class="empty-state"><p>还没有相关帖子</p><p class="sub">发一条组队招募，或从竞赛详情页跳转过来</p>
          <button type="button" class="btn primary" onclick="location.hash='#feed'">去看竞赛</button></div>`;
      }
      data.posts?.forEach((p) => renderWallCard(p, list, false));
      wallHasMore = data.hasMore;
      const btn = document.getElementById("wallLoadMore");
      if (btn) btn.style.display = wallHasMore ? "" : "none";
    } catch (e) {
      document.getElementById("wallList").innerHTML = `<div class="empty-state"><p>加载失败：${esc(e.message)}</p></div>`;
    }
  }

  function debounceWallSearch() {
    clearTimeout(wallSearchTimer);
    wallSearchTimer = setTimeout(() => loadWall(true), 350);
  }

  async function bumpWall(id, btn) {
    if (!currentUser) {
      openAuth("login");
      return;
    }
    try {
      const data = await api(`wall/${id}/bump`, { method: "POST", body: "{}" });
      btn.textContent = (btn.textContent.includes("加入") ? "我也想加入" : "顶一下") + " · " + data.upvotes;
      btn.classList.toggle("on", data.bumped);
    } catch (e) {
      toast(e.message);
    }
  }

  function filterWall(type) {
    wallFilter = type;
    document.querySelectorAll("#wallFilters button").forEach((b) => b.classList.toggle("on", b.dataset.type === type));
    loadWall(true);
  }

  async function postWall() {
    if (!currentUser) {
      openAuth("login");
      return;
    }
    try {
      const data = await api("wall", {
        method: "POST",
        body: JSON.stringify({
          type: document.getElementById("wallType").value,
          title: document.getElementById("wallTitle").value,
          body: document.getElementById("wallBody").value,
          related_competition: document.getElementById("wallComp").value,
          team_size: document.getElementById("wallTeamSize").value || null,
          skills: document.getElementById("wallSkills")?.value || null,
        }),
      });
      document.getElementById("wallTitle").value = "";
      document.getElementById("wallBody").value = "";
      document.getElementById("wallComp").value = "";
      document.getElementById("wallTeamSize").value = "";
      if (document.getElementById("wallSkills")) document.getElementById("wallSkills").value = "";
      toast("发布成功");
      const list = document.getElementById("wallList");
      list.querySelector(".empty-state")?.remove();
      renderWallCard(data.post, list, true);
    } catch (e) {
      toast(e.message);
    }
  }

  async function deleteWall(id) {
    if (!confirm("确定删除这条帖子？")) return;
    try {
      await api(`wall/${id}`, { method: "DELETE" });
      toast("已删除");
      loadWall();
    } catch (e) {
      toast(e.message);
    }
  }

  // ---------- 挂钩现有计划/问卷 ----------
  function hookExisting() {
    const origRenderPlan = window.renderPlan;
    window.renderPlan = function () {
      if (currentUser && dbTasks.length) {
        const el = document.getElementById("planList");
        document.getElementById("planCount").textContent = "· " + dbTasks.filter((t) => t.status !== "done").length;
        if (!el) return;
        const active = dbTasks.filter((t) => t.status !== "done");
        if (!active.length) {
          el.innerHTML = `<div class="plan-empty"><p>计划还是空的</p><p class="sub">从竞赛加入计划，再一键拆成待办</p>
            <button type="button" class="btn ghost" onclick="location.hash='#feed'">去看竞赛</button>
            <button type="button" class="btn primary" style="margin-top:8px" onclick="location.hash='#tasks'">打开工作台</button></div>`;
          return;
        }
        active.sort((a, b) => new Date(a.due_date || "2099") - new Date(b.due_date || "2099"));
        el.innerHTML = "";
        active.forEach((t) => {
          const item = document.createElement("div");
          item.className = "plan-item";
          const tag = t.source === "custom" ? "自定义 · " : t.source === "plan" ? "规划 · " : "";
          item.innerHTML = `<div class="node"></div><div class="plan-body">
            <div class="t">${tag}${esc(t.title)}</div>
            <div class="d">${t.due_date ? "截止 · " + t.due_date : "时间待定"}${t.completed_pomodoros ? " · 🍅" + t.completed_pomodoros : ""}</div>
            </div>
            <button type="button" class="btn ghost" style="font-size:11px;padding:4px 8px;min-height:auto" onclick="location.hash='#tasks'">工作台</button>
            <button type="button" class="btn ghost" style="font-size:11px;padding:4px 8px;min-height:auto" onclick="CompassUI.selectPomoTask(${t.id},'${esc(t.title).replace(/'/g, "\\'")}');location.hash='#tasks'">番茄</button>
            <button type="button" class="plan-rm" onclick="CompassUI.removeTask(${t.id})">×</button>`;
          el.appendChild(item);
        });
        return;
      }
      origRenderPlan();
    };

    const origAddPlan = window.addPlan;
    window.addPlan = async function (idOrName) {
      if (!currentUser) return origAddPlan(idOrName);
      const c = typeof idOrName === "string" && window.getComp?.(idOrName) ? window.getComp(idOrName) : null;
      const name = c ? c.name : idOrName;
      if (dbTasks.some((t) => t.title === name || t.related_competition_id === c?.id)) {
        toast("已在计划中");
        return;
      }
      try {
        await createTask({
          title: name,
          due_date: c?.deadline || null,
          scheduled_date: c?.deadline || new Date().toISOString().slice(0, 10),
          source: "competition",
          related_competition_id: c?.id || null,
          status: "todo",
        });
        toast("已加入计划");
        if (typeof window.renderFeed === "function") window.renderFeed();
      } catch (e) {
        toast("云端同步失败：" + e.message);
      }
    };

    const origAddCustom = window.addCustomTodo;
    window.addCustomTodo = async function () {
      const title = document.getElementById("customTitle").value.trim();
      const date = document.getElementById("customDate").value;
      if (!title) {
        toast("请填写待办标题");
        return;
      }
      if (currentUser) {
        try {
          await createTask({ title, due_date: date || null, source: "custom", status: "todo" });
          document.getElementById("customTitle").value = "";
          document.getElementById("customDate").value = "";
          toast("已添加");
        } catch (e) {
          toast(e.message);
        }
        return;
      }
      origAddCustom();
    };

    const origSubmitSurvey = window.submitSurvey;
    window.submitSurvey = async function () {
      if (!currentUser) return origSubmitSurvey();
      const p = {
        school: document.getElementById("svSchool").value.trim(),
        cat: document.getElementById("svCat").value,
        interests: [...document.querySelectorAll("#svInterests .chip.on")].map((ch) => ch.dataset.v),
        grade: document.getElementById("svGrade").value,
        goal: document.getElementById("svGoal").value.trim(),
      };
      window.saveProfile(p);
      window.closeSurvey();
      window.renderFocus?.();
      window.renderFeed?.();
      window.updateSurveyStatus?.();
      window.Dashboard?.refresh?.();
      const btn = document.getElementById("surveySubmit");
      btn.textContent = "生成中…";
      btn.disabled = true;
      try {
        if (currentUser) {
          const data = await api("questionnaire", { method: "POST", body: JSON.stringify(p) });
          window.saveProfile(p);
          window.syncRoadmap?.(data.milestones || []);
          toast("规划已生成并保存");
        }
      } catch (e) {
        toast(e.message || "生成失败");
      }
      btn.textContent = "生成我的规划";
      btn.disabled = false;
    };

    // 为 roadmap 里程碑加「转为任务」按钮
    const origRenderRoadmap = window.renderRoadmap;
    window.renderRoadmap = function () {
      origRenderRoadmap();
      if (!currentUser || !window.getRoadmap?.()?.length) return;
      document.querySelectorAll(".roadmap-ms").forEach((el, i) => {
        if (el.querySelector(".ms-task-btn")) return;
        const m = window.getRoadmap()[i];
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn ghost ms-task-btn";
        b.style.cssText = "margin-top:6px;font-size:11px;padding:4px 10px;min-height:auto";
        b.textContent = "+ 转为任务";
        b.onclick = () => addMilestoneAsTask(m.step, m.when);
        el.appendChild(b);
      });
    };
  }

  // 暴露全局
  window.CompassUI = {
    openAuth,
    closeAuth,
    switchAuthTab,
    submitAuth,
    logout,
    toggleUserMenu,
    sendChat,
    startPomo,
    pausePomo,
    resetPomo,
    selectPomoTask,
    completeTask,
    removeTask,
    filterWall,
    postWall,
    deleteWall,
    loadWall,
    debounceWallSearch,
    bumpWall,
    adoptChatAsTask,
    splitCompTasks,
    openWallForComp,
    addMilestoneAsTask,
    newChatSession,
    toggleChatHistory,
  };

  window.CompassCore = {
    getUser: () => currentUser,
    loadTasks,
    loadStats: loadTaskStats,
    removeTask: deleteTask,
    createTask,
    getTasks: () => dbTasks,
    isInPlan: (compId) => {
      const c = window.getComp?.(compId);
      return dbTasks.some(
        (t) => t.status !== "done" && (t.related_competition_id === compId || (c && t.title === c.name))
      );
    },
  };

  window.apiFetch = api;

  async function init() {
    loadPomoState();
    updatePomoDisplay();
    if (pomo.running) tickPomo();
    hookExisting();
    await refreshUser();
    navigate();
    window.addEventListener("hashchange", navigate);
    document.getElementById("chatInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    });
    updateWallFormVisibility();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
