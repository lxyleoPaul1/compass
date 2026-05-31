// 日历 + 当日待办（清单/时间轴）工作台。与 CompassCore 联动。
(() => {
  const LS_GUEST = "compass_guest_tasks";
  const today = () => new Date().toISOString().slice(0, 10);

  let selectedDate = today();
  let viewMonth = today().slice(0, 7);
  let dayMode = localStorage.getItem("compass_day_mode") || "checklist";
  let monthCache = null;
  let dayTasks = [];
  let guestTasks = loadGuest();

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s ?? "";
    return d.innerHTML;
  }

  function api(path, opts) {
    return window.apiFetch(path, opts);
  }

  function toast(m) {
    window.toast?.(m);
  }

  function isLoggedIn() {
    return window.CompassCore?.getUser?.();
  }

  function loadGuest() {
    try {
      return JSON.parse(localStorage.getItem(LS_GUEST)) || [];
    } catch {
      return [];
    }
  }

  function saveGuest() {
    localStorage.setItem(LS_GUEST, JSON.stringify(guestTasks));
  }

  function guestForDate(date) {
    return guestTasks.filter((t) => t.scheduled_date === date || (!t.scheduled_date && t.due_date === date));
  }

  async function fetchDayTasks(date) {
    if (isLoggedIn()) {
      const data = await api(`tasks/day?date=${date}`);
      dayTasks = data.tasks || [];
    } else {
      dayTasks = guestForDate(date);
    }
    return dayTasks;
  }

  async function fetchMonth(ym) {
    if (isLoggedIn()) {
      monthCache = await api(`calendar?month=${ym}`);
    } else {
      const comps = (window.DATA || []).filter((c) => c.deadline?.startsWith(ym));
      monthCache = {
        month: ym,
        competitions: comps.map((c) => ({ id: c.id, name: c.name, deadline: c.deadline, level: c.level })),
        tasks: guestTasks.filter((t) => (t.scheduled_date || t.due_date || "").startsWith(ym)),
        pomodorosByDay: {},
      };
    }
    return monthCache;
  }

  function switchTab(tab) {
    document.querySelectorAll("#wbTabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    document.querySelectorAll(".wb-panel").forEach((p) => p.classList.remove("on"));
    document.getElementById(tab === "day" ? "wbDay" : tab === "calendar" ? "wbCalendar" : "wbPomo")?.classList.add("on");
    if (tab === "calendar") renderCalendar();
    if (tab === "day") renderDay();
    if (tab === "pomo") refreshPomoSelect();
  }

  function setMode(mode) {
    dayMode = mode;
    localStorage.setItem("compass_day_mode", mode);
    document.getElementById("modeCheck")?.classList.toggle("on", mode === "checklist");
    document.getElementById("modeTime")?.classList.toggle("on", mode === "timeline");
    document.getElementById("checklistView").style.display = mode === "checklist" ? "" : "none";
    document.getElementById("timelineView").style.display = mode === "timeline" ? "" : "none";
    renderDay();
  }

  function shiftMonth(delta) {
    const [y, m] = viewMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    viewMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    renderCalendar();
  }

  function selectDate(date) {
    selectedDate = date;
    switchTab("day");
    renderDay();
  }

  async function renderCalendar() {
    document.getElementById("calMonthLabel").textContent = viewMonth.replace("-", " 年 ") + " 月";
    await fetchMonth(viewMonth);
    const grid = document.getElementById("calGrid");
    grid.innerHTML = "";
    ["日", "一", "二", "三", "四", "五", "六"].forEach((d) => {
      const h = document.createElement("div");
      h.className = "cal-dow";
      h.textContent = d;
      grid.appendChild(h);
    });

    const [y, m] = viewMonth.split("-").map(Number);
    const first = new Date(y, m - 1, 1).getDay();
    const lastDay = new Date(y, m, 0).getDate();
    const compByDay = {};
    (monthCache?.competitions || []).forEach((c) => {
      compByDay[c.deadline] = (compByDay[c.deadline] || 0) + 1;
    });
    const taskByDay = {};
    (monthCache?.tasks || []).forEach((t) => {
      const d = t.scheduled_date || t.due_date;
      if (d) taskByDay[d] = (taskByDay[d] || 0) + 1;
    });
    const poms = monthCache?.pomodorosByDay || {};

    for (let i = 0; i < first; i++) {
      const cell = document.createElement("div");
      cell.className = "cal-cell other";
      grid.appendChild(cell);
    }
    for (let d = 1; d <= lastDay; d++) {
      const ds = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const cell = document.createElement("div");
      cell.className = "cal-cell";
      if (ds === today()) cell.classList.add("today");
      if (ds === selectedDate) cell.classList.add("selected");
      const urgent = compByDay[ds] && daysLeft(ds) <= 14;
      cell.innerHTML = `<div class="dn">${d}</div><div class="cal-dots">
        ${compByDay[ds] ? '<span class="cal-dot comp"></span>' : ""}
        ${taskByDay[ds] ? '<span class="cal-dot task"></span>' : ""}
        ${poms[ds] ? '<span class="cal-dot pom"></span>' : ""}
      </div>${urgent ? '<span class="cal-urgent"></span>' : ""}`;
      cell.onclick = () => selectDate(ds);
      grid.appendChild(cell);
    }
  }

  function daysLeft(iso) {
    return Math.round((new Date(iso) - new Date()) / 86400000);
  }

  async function renderDay() {
    document.getElementById("wbDayLabel").textContent = selectedDate + (selectedDate === today() ? " · 今天" : "");
    await fetchDayTasks(selectedDate);
    if (dayMode === "checklist") renderChecklist();
    else renderTimeline();
    refreshPomoSelect();
  }

  function renderChecklist() {
    const el = document.getElementById("checklistView");
    el.innerHTML = "";
    const list = [...dayTasks].sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || (a.order_index || 0) - (b.order_index || 0));
    if (!list.length) {
      el.innerHTML = `<div class="empty-state"><p>这一天还没有待办</p><p class="sub">上方添加，或从竞赛雷达/规划加入</p></div>`;
      return;
    }
    list.forEach((t) => {
      const row = document.createElement("div");
      row.className = "check-item" + (t.status === "done" ? " done" : "");
      row.draggable = true;
      row.dataset.id = t.id;
      const pom = t.completed_pomodoros ? ` · 🍅${t.completed_pomodoros}` : "";
      const time = t.scheduled_start ? ` · ${t.scheduled_start}${t.scheduled_end ? "-" + t.scheduled_end : ""}` : "";
      row.innerHTML = `<input type="checkbox" ${t.status === "done" ? "checked" : ""} onchange="Workbench.toggleDone('${t.id}', this.checked)" />
        <button type="button" class="star ${t.starred ? "on" : ""}" onclick="Workbench.toggleStar('${t.id}')" aria-label="标星">★</button>
        <div style="flex:1;min-width:0"><div class="check-t">${esc(t.title)}</div>
        <div class="check-meta">${t.source || "custom"}${time}${pom}</div></div>
        <button type="button" class="btn ghost" style="font-size:11px;padding:4px 8px;min-height:auto" onclick="Workbench.scheduleTask('${t.id}')">排时</button>
        <button type="button" class="plan-rm" onclick="Workbench.removeTask('${t.id}')">×</button>`;
      row.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", t.id);
      });
      row.addEventListener("dragover", (e) => e.preventDefault());
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        reorderDrag(String(t.id), e.dataTransfer.getData("text/plain"));
      });
      el.appendChild(row);
    });
  }

  function renderTimeline() {
    const el = document.getElementById("timelineView");
    el.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "tl-grid";
    for (let h = 8; h <= 22; h++) {
      const label = document.createElement("div");
      label.className = "tl-hour";
      label.textContent = `${String(h).padStart(2, "0")}:00`;
      const slot = document.createElement("div");
      slot.className = "tl-slot";
      slot.dataset.hour = h;
      dayTasks
        .filter((t) => t.scheduled_start && parseInt(t.scheduled_start, 10) === h)
        .forEach((t) => {
          const b = document.createElement("div");
          b.className = "tl-block" + (t.status === "done" ? " done" : "");
          b.textContent = t.title + (t.scheduled_end ? ` (${t.scheduled_start}-${t.scheduled_end})` : "");
          b.onclick = () => window.CompassUI?.selectPomoTask(t.id, t.title);
          slot.appendChild(b);
        });
      grid.appendChild(label);
      grid.appendChild(slot);
    }
    el.appendChild(grid);
  }

  async function reorderDrag(targetId, dragId) {
    if (!dragId || dragId === targetId) return;
    const ids = dayTasks.map((t) => String(t.id));
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    if (isLoggedIn()) {
      await api("tasks/reorder", { method: "POST", body: JSON.stringify({ date: selectedDate, ids: ids.map(Number) }) });
      await fetchDayTasks(selectedDate);
    } else {
      ids.forEach((id, idx) => {
        const t = guestTasks.find((x) => String(x.id) === id);
        if (t) t.order_index = idx;
      });
      saveGuest();
      dayTasks = guestForDate(selectedDate);
    }
    renderChecklist();
  }

  async function toggleDone(id, done) {
    const status = done ? "done" : "todo";
    if (isLoggedIn()) {
      await api(`tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await fetchDayTasks(selectedDate);
      window.CompassCore?.loadTasks?.();
    } else {
      const t = guestTasks.find((x) => String(x.id) === String(id));
      if (t) t.status = status;
      saveGuest();
      dayTasks = guestForDate(selectedDate);
    }
    renderDay();
    window.CompassCore?.loadStats?.();
    window.Dashboard?.refresh?.();
  }

  async function toggleStar(id) {
    const t = dayTasks.find((x) => String(x.id) === String(id));
    if (!t) return;
    if (isLoggedIn()) {
      await api(`tasks/${id}`, { method: "PATCH", body: JSON.stringify({ starred: !t.starred }) });
      await fetchDayTasks(selectedDate);
    } else {
      t.starred = !t.starred;
      saveGuest();
      dayTasks = guestForDate(selectedDate);
    }
    renderChecklist();
  }

  async function scheduleTask(id) {
    const start = prompt("开始时间（HH:MM，如 09:00）", "09:00");
    if (!start) return;
    const end = prompt("结束时间（HH:MM，可留空）", "10:00");
    if (isLoggedIn()) {
      await api(`tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ scheduled_start: start, scheduled_end: end || null, scheduled_date: selectedDate }),
      });
      await fetchDayTasks(selectedDate);
    } else {
      const t = guestTasks.find((x) => String(x.id) === String(id));
      if (t) {
        t.scheduled_start = start;
        t.scheduled_end = end || null;
        t.scheduled_date = selectedDate;
        saveGuest();
        dayTasks = guestForDate(selectedDate);
      }
    }
    setMode("timeline");
  }

  async function addDayTask() {
    const title = document.getElementById("newDayTask").value.trim();
    if (!title) {
      toast("请填写标题");
      return;
    }
    const start = document.getElementById("newDayStart").value;
    const end = document.getElementById("newDayEnd").value;
    const payload = {
      title,
      scheduled_date: selectedDate,
      due_date: selectedDate,
      scheduled_start: start || null,
      scheduled_end: end || null,
      source: "custom",
      status: "todo",
    };
    if (isLoggedIn()) {
      await api("tasks", { method: "POST", body: JSON.stringify(payload) });
      await window.CompassCore?.loadTasks?.();
    } else {
      guestTasks.push({ ...payload, id: "g_" + Date.now(), order_index: guestTasks.length, starred: false, completed_pomodoros: 0 });
      saveGuest();
    }
    document.getElementById("newDayTask").value = "";
    document.getElementById("newDayStart").value = "";
    document.getElementById("newDayEnd").value = "";
    await renderDay();
    toast("已添加");
    window.Dashboard?.refresh?.();
  }

  async function removeTask(id) {
    if (isLoggedIn()) {
      await window.CompassCore?.removeTask?.(id);
    } else {
      guestTasks = guestTasks.filter((t) => String(t.id) !== String(id));
      saveGuest();
    }
    await renderDay();
  }

  function refreshPomoSelect() {
    const sel = document.getElementById("pomoTaskSelect");
    if (!sel) return;
    sel.innerHTML = `<option value="">选择任务（可选）</option>`;
    dayTasks.filter((t) => t.status !== "done").forEach((t) => {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = t.title;
      sel.appendChild(o);
    });
  }

  async function renderAll() {
    document.getElementById("wbDayLabel") && (await renderDay());
    if (document.getElementById("wbCalendar")?.classList.contains("on")) await renderCalendar();
  }

  window.Workbench = {
    switchTab,
    setMode,
    shiftMonth,
    selectDate,
    addDayTask,
    toggleDone,
    toggleStar,
    scheduleTask,
    removeTask,
    renderAll,
    getSelectedDate: () => selectedDate,
    addTaskForDate: async (payload, date) => {
      selectedDate = date || payload.scheduled_date || today();
      if (isLoggedIn()) {
        await api("tasks", { method: "POST", body: JSON.stringify({ ...payload, scheduled_date: selectedDate }) });
        await window.CompassCore?.loadTasks?.();
      } else {
        guestTasks.push({
          ...payload,
          id: "g_" + Date.now(),
          scheduled_date: selectedDate,
          order_index: guestTasks.length,
          starred: false,
          completed_pomodoros: 0,
          status: "todo",
        });
        saveGuest();
      }
      await renderAll();
    },
  };

  document.addEventListener("DOMContentLoaded", () => {
    setMode(dayMode);
    document.getElementById("wbDayLabel") && renderDay();
  });
})();
