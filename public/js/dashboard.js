// 首页总览 Dashboard：聚合今日聚焦、进展、下一步建议
(() => {
  const LS_WELCOME = "compass_welcome_dismissed";

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s ?? "";
    return d.innerHTML;
  }

  function daysLeft(iso) {
    if (!iso) return 9999;
    return Math.round((new Date(iso) - new Date()) / 86400000);
  }

  function fmt(iso) {
    const d = new Date(iso);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function urgencyTxt(n) {
    if (n < 0) return "已截止";
    if (n <= 7) return `仅剩 ${n} 天`;
    if (n <= 21) return `${n} 天后截止`;
    return `${n} 天后截止`;
  }

  /** 游客版：用 localStorage + DATA 本地聚合 */
  function buildGuestDashboard() {
    const profile = window.profile || {};
    const plan = window.plan || [];
    const roadmap = window.getRoadmap?.() || [];
    const DATA = window.DATA || [];
    const today = new Date().toISOString().slice(0, 10);
    let guestTasks = [];
    try {
      guestTasks = JSON.parse(localStorage.getItem("compass_guest_tasks") || "[]");
    } catch {
      guestTasks = [];
    }

    const tasksToday = guestTasks.filter(
      (t) => t.status !== "done" && (t.scheduled_date === today || (!t.scheduled_date && t.due_date === today))
    );
    const urgentCompetitions = DATA.filter((c) => c.deadline && daysLeft(c.deadline) >= 0 && daysLeft(c.deadline) <= 14)
      .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
      .slice(0, 6)
      .map((c) => ({
        id: c.id,
        name: c.name,
        deadline: c.deadline,
        daysLeft: daysLeft(c.deadline),
        inPlan: plan.some((p) => p.id === c.id || p.name === c.name),
        cat: c.cat,
      }));

    const hasProfile = Boolean(profile.cat || profile.goal);
    let nextAction;
    if (!hasProfile) {
      nextAction = { type: "survey", title: "先花 3 分钟认识一下你", desc: "填问卷后竞赛会按专业排序，规划更贴身。", cta: "开始问卷", hash: "#feed", action: "survey" };
    } else if (!plan.length && !guestTasks.length) {
      nextAction = { type: "competition", title: "从一场对口竞赛开始", desc: "加入计划后可在工作台排期、用番茄钟推进。", cta: "去看竞赛", hash: "#feed", action: "feed" };
    } else if (roadmap.length && !guestTasks.some((t) => t.source === "plan")) {
      nextAction = { type: "roadmap", title: "把规划拆成可执行待办", desc: "在侧栏规划里把里程碑落到日历。", cta: "查看规划", hash: "#feed", action: "roadmap" };
    } else {
      nextAction = { type: "daily", title: "专注今日待办", desc: "登录后可云端同步；现在也可在本机推进。", cta: "打开工作台", hash: "#tasks", action: "tasks" };
    }

    const grade = profile.grade || "准大一";
    const goal = profile.goal?.trim();
    const greeting = goal
      ? `${grade} · 朝着「${goal.slice(0, 24)}${goal.length > 24 ? "…" : ""}」稳步前进`
      : hasProfile
        ? `${grade} · 帮你筛对口竞赛、排好节奏`
        : `${grade} · 把上大学拆成看得见的下一步`;

    return {
      greeting,
      slogan: window.CompassPrefs?.get?.()?.slogan || "",
      profile: { cat: profile.cat || "", grade: profile.grade || "", goal: profile.goal || "" },
      stats: {
        pomodorosToday: 0,
        pomodorosWeek: 0,
        tasksDoneToday: guestTasks.filter((t) => t.status === "done" && (t.scheduled_date === today || t.due_date === today)).length,
        tasksDoneWeek: guestTasks.filter((t) => t.status === "done").length,
        planCompetitions: plan.filter((p) => p.type === "competition").length,
        activeTasks: guestTasks.filter((t) => t.status !== "done").length + plan.length,
        milestoneProgress: roadmap.length ? Math.min(100, Math.round((guestTasks.filter((t) => t.status === "done").length / Math.max(1, roadmap.length)) * 100)) : 0,
      },
      focus: {
        tasksToday: tasksToday.map((t) => ({ id: t.id, title: t.title, status: t.status || "todo", scheduled_date: t.scheduled_date })),
        upcomingTasks: [],
        pomoSuggestion: tasksToday[0] ? { id: tasksToday[0].id, title: tasksToday[0].title } : null,
        urgentCompetitions,
      },
      nextAction,
      isGuest: true,
    };
  }

  function renderWelcome(data) {
    const el = document.getElementById("dashWelcome");
    if (!el) return;
    const dismissed = localStorage.getItem(LS_WELCOME) === "1";
    const needsWelcome = !dismissed && (!data.profile?.cat && !data.profile?.goal);
    el.style.display = needsWelcome ? "" : "none";
    if (!needsWelcome) return;
    el.innerHTML = `
      <div class="dash-welcome-inner">
        <div>
          <strong>欢迎来到 Compass 新生指北</strong>
          <p>帮你规划大学第一年、追踪高含金量竞赛、把目标拆成待办——不是一堆工具，而是一条连贯的主线。</p>
        </div>
        <div class="dash-welcome-actions">
          <button type="button" class="btn primary" onclick="Dashboard.runAction('survey')">3 分钟认识我</button>
          <button type="button" class="btn ghost" onclick="Dashboard.dismissWelcome()">稍后再说</button>
        </div>
      </div>`;
  }

  function renderGreeting(data) {
    const g = document.getElementById("dashGreeting");
    if (g) g.textContent = data.greeting || "把上大学拆成看得见的下一步";
    // slogan 由 CompassPrefs 渲染，此处同步占位态
    window.CompassPrefs?.apply?.();
  }

  function renderFocus(data) {
    const el = document.getElementById("dashFocus");
    if (!el) return;
    const { tasksToday, upcomingTasks, pomoSuggestion, urgentCompetitions } = data.focus || {};
    const parts = [];

    if (tasksToday?.length) {
      parts.push(`<div class="dash-focus-group"><h4>今日待办</h4><div class="dash-focus-list">`);
      tasksToday.forEach((t) => {
        parts.push(`<button type="button" class="dash-focus-item" onclick="Dashboard.goTask(${typeof t.id === "number" ? t.id : `'${esc(String(t.id))}'`})">
          <span class="fi-title">${esc(t.title)}</span>
          <span class="fi-meta">去工作台 →</span>
        </button>`);
      });
      parts.push(`</div></div>`);
    }

    if (pomoSuggestion) {
      parts.push(`<div class="dash-focus-group"><h4>建议专注</h4>
        <button type="button" class="dash-focus-item dash-focus-pomo" onclick="Dashboard.goPomo(${typeof pomoSuggestion.id === "number" ? pomoSuggestion.id : `'${esc(String(pomoSuggestion.id))}'`}, '${esc(pomoSuggestion.title).replace(/'/g, "\\'")}')">
          <span class="fi-title">🍅 ${esc(pomoSuggestion.title)}</span>
          <span class="fi-meta">开始番茄 →</span>
        </button></div>`);
    }

    if (urgentCompetitions?.length) {
      parts.push(`<div class="dash-focus-group"><h4>临近截止 · 14 天内</h4><div class="dash-focus-list">`);
      urgentCompetitions.slice(0, 4).forEach((c) => {
        const hot = c.daysLeft <= 7;
        parts.push(`<button type="button" class="dash-focus-item${hot ? " hot" : ""}" onclick="Dashboard.goComp('${esc(c.id)}')">
          <span class="fi-title">${esc(c.name)}</span>
          <span class="fi-meta">${fmt(c.deadline)} · ${urgencyTxt(c.daysLeft)}${c.inPlan ? " · 已在计划" : ""}</span>
        </button>`);
      });
      parts.push(`</div></div>`);
    }

    if (upcomingTasks?.length) {
      parts.push(`<div class="dash-focus-group"><h4>即将到来</h4><div class="dash-focus-list">`);
      upcomingTasks.forEach((t) => {
        parts.push(`<button type="button" class="dash-focus-item" onclick="Dashboard.goTaskDate('${esc(t.scheduled_date)}')">
          <span class="fi-title">${esc(t.title)}</span>
          <span class="fi-meta">${esc(t.scheduled_date)} →</span>
        </button>`);
      });
      parts.push(`</div></div>`);
    }

    if (!parts.length) {
      el.innerHTML = `<div class="dash-empty"><p>今天还没有排定的待办</p><p class="sub">从竞赛加入计划，或在工作台添加今日任务</p>
        <button type="button" class="btn primary" onclick="location.hash='#feed'">去竞赛雷达</button></div>`;
      return;
    }
    el.innerHTML = parts.join("");
  }

  function renderProgress(data) {
    const el = document.getElementById("dashProgress");
    if (!el) return;
    const s = data.stats || {};
    el.innerHTML = `
      <div class="dash-stat-grid">
        <div class="dash-stat"><span class="n">${s.pomodorosWeek ?? 0}</span><span class="l">本周番茄</span></div>
        <div class="dash-stat"><span class="n">${s.tasksDoneWeek ?? 0}</span><span class="l">本周完成任务</span></div>
        <div class="dash-stat"><span class="n">${s.planCompetitions ?? 0}</span><span class="l">计划中的竞赛</span></div>
        <div class="dash-stat"><span class="n">${s.milestoneProgress ?? 0}%</span><span class="l">任务完成度</span></div>
      </div>
      <div class="dash-progress-bar" aria-hidden="true"><i style="width:${Math.min(100, s.milestoneProgress || 0)}%"></i></div>`;
  }

  function renderNextAction(data) {
    const el = document.getElementById("dashNext");
    if (!el || !data.nextAction) return;
    const a = data.nextAction;
    el.innerHTML = `
      <div class="dash-next-card">
        <span class="dash-next-tag">下一步建议</span>
        <h3>${esc(a.title)}</h3>
        <p>${esc(a.desc)}</p>
        <button type="button" class="btn primary" onclick="Dashboard.runAction('${esc(a.action)}')">${esc(a.cta)}</button>
      </div>`;
  }

  function renderAll(data) {
    renderWelcome(data);
    renderGreeting(data);
    renderFocus(data);
    renderProgress(data);
    renderNextAction(data);
  }

  async function refresh() {
    const user = window.CompassCore?.getUser?.();
    let data;
    if (user && window.apiFetch) {
      try {
        data = await window.apiFetch("dashboard");
      } catch {
        data = buildGuestDashboard();
      }
    } else {
      data = buildGuestDashboard();
    }
    renderAll(data);
    return data;
  }

  function dismissWelcome() {
    localStorage.setItem(LS_WELCOME, "1");
    document.getElementById("dashWelcome").style.display = "none";
  }

  function runAction(action) {
    if (action === "survey") {
      if (typeof window.openSurvey === "function") window.openSurvey();
      else location.hash = "#feed";
      return;
    }
    if (action === "roadmap") {
      location.hash = "#feed";
      setTimeout(() => document.getElementById("roadmapPanel")?.scrollIntoView({ behavior: "smooth" }), 200);
      return;
    }
    if (action === "feed") {
      location.hash = "#feed";
      return;
    }
    if (action === "tasks") {
      location.hash = "#tasks";
      return;
    }
    location.hash = "#home";
  }

  function goTask(id) {
    location.hash = "#tasks";
    window.Workbench?.switchTab?.("day");
  }

  function goTaskDate(date) {
    location.hash = "#tasks";
    window.Workbench?.switchTab?.("day");
    if (date && window.Workbench?.selectDate) window.Workbench.selectDate(date);
  }

  function goPomo(id, title) {
    location.hash = "#tasks";
    window.Workbench?.switchTab?.("pomo");
    if (window.CompassUI?.selectPomoTask) window.CompassUI.selectPomoTask(id, title);
  }

  function goComp(id) {
    if (typeof window.openDrawer === "function") window.openDrawer(id);
    else location.hash = "#feed";
  }

  window.Dashboard = { refresh, renderAll, dismissWelcome, runAction, goTask, goTaskDate, goPomo, goComp };

  // 暴露 profile/plan 给游客聚合（index.html 已有，确保引用）
  document.addEventListener("DOMContentLoaded", () => {
    if (location.hash === "" || location.hash === "#") location.hash = "#home";
  });
})();
