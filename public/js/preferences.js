// 用户偏好：主题、slogan、字号、减少动效（localStorage + 登录后服务端同步）
(() => {
  const LS_KEY = "compass_prefs";
  const THEMES = [
    { id: "editorial", label: "杂志", colors: ["#F4EEE3", "#1E1B2E", "#D8442B"] },
    { id: "nocturne", label: "夜读", colors: ["#141820", "#E8E4DC", "#5BA4A4"] },
    { id: "daylight", label: "晴朗", colors: ["#FAFAF8", "#1A2744", "#E05A4A"] },
    { id: "grove", label: "林间", colors: ["#F2F5F0", "#2C3E2E", "#3D7A5A"] },
  ];
  const DEFAULT_SLOGAN_PLACEHOLDER = "点击编辑，写下你的大一宣言或座右铭 ✦";

  const defaults = {
    theme: "editorial",
    slogan: "",
    font_scale: "md",
    reduce_motion: false,
  };

  let prefs = loadLocal();

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return { ...defaults };
      return { ...defaults, ...JSON.parse(raw) };
    } catch {
      return { ...defaults };
    }
  }

  function saveLocal(p) {
    prefs = { ...prefs, ...p };
    localStorage.setItem(LS_KEY, JSON.stringify(prefs));
  }

  /** 将偏好应用到 documentElement（防 FOUC 后再次校正） */
  function applyToDom(p = prefs) {
    const theme = THEMES.some((t) => t.id === p.theme) ? p.theme : defaults.theme;
    const scale = ["sm", "md", "lg"].includes(p.font_scale) ? p.font_scale : defaults.font_scale;
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-font-scale", scale);
    if (p.reduce_motion) document.documentElement.setAttribute("data-reduce-motion", "true");
    else document.documentElement.removeAttribute("data-reduce-motion");
    renderSlogan();
    syncSettingsForm();
    syncThemeButtons();
  }

  function renderSlogan() {
    const el = document.getElementById("sloganDisplay");
    if (!el) return;
    const text = (prefs.slogan || "").trim();
    el.textContent = text || DEFAULT_SLOGAN_PLACEHOLDER;
    el.classList.toggle("is-placeholder", !text);
  }

  function syncThemeButtons() {
    document.querySelectorAll("[data-theme-pick]").forEach((btn) => {
      btn.classList.toggle("on", btn.dataset.themePick === prefs.theme);
      btn.setAttribute("aria-pressed", btn.dataset.themePick === prefs.theme ? "true" : "false");
    });
  }

  function syncSettingsForm() {
    const sloganInp = document.getElementById("prefSlogan");
    if (sloganInp && document.activeElement !== sloganInp) sloganInp.value = prefs.slogan || "";
    document.querySelectorAll("[data-font-pick]").forEach((btn) => {
      btn.classList.toggle("on", btn.dataset.fontPick === prefs.font_scale);
    });
    const motion = document.getElementById("prefReduceMotion");
    if (motion) motion.checked = Boolean(prefs.reduce_motion);
  }

  async function persist(partial) {
    const next = { ...prefs, ...partial };
    applyToDom(next);
    saveLocal(next);

    const user = window.CompassCore?.getUser?.();
    if (user) {
      try {
        const data = await window.apiFetch("preferences", {
          method: "POST",
          body: JSON.stringify(next),
        });
        if (data.preferences) {
          prefs = { ...prefs, ...data.preferences };
          saveLocal(prefs);
          applyToDom(prefs);
        }
      } catch (e) {
        if (typeof window.toast === "function") window.toast("偏好保存失败：" + e.message);
      }
    }
  }

  /** 登录后从服务器拉取并覆盖本地 */
  async function syncFromServer() {
    const user = window.CompassCore?.getUser?.();
    if (!user) return;
    try {
      const data = await window.apiFetch("preferences");
      if (data.preferences) {
        prefs = { ...defaults, ...data.preferences };
        saveLocal(prefs);
        applyToDom(prefs);
      }
    } catch {
      /* 未登录或接口异常时沿用 localStorage */
    }
  }

  /** 登录成功后合并本地偏好上传 */
  async function mergeLocalOnLogin() {
    const user = window.CompassCore?.getUser?.();
    if (!user) return;
    try {
      const server = await window.apiFetch("preferences");
      const remote = server.preferences || {};
      const local = loadLocal();
      const merged = {
        theme: remote.theme !== defaults.theme ? remote.theme : local.theme,
        slogan: remote.slogan || local.slogan,
        font_scale: remote.font_scale !== defaults.font_scale ? remote.font_scale : local.font_scale,
        reduce_motion: remote.reduce_motion || local.reduce_motion,
      };
      await persist(merged);
    } catch {
      await syncFromServer();
    }
  }

  function buildThemeSwatches(container) {
    if (!container || container.dataset.built) return;
    container.dataset.built = "1";
    container.innerHTML = "";
    THEMES.forEach((t) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "theme-swatch";
      btn.dataset.themePick = t.id;
      btn.setAttribute("aria-label", "主题：" + t.label);
      btn.title = t.label;
      btn.innerHTML = `<span class="swatch-colors">${t.colors.map((c) => `<i style="background:${c}"></i>`).join("")}</span><span class="swatch-label">${t.label}</span>`;
      btn.addEventListener("click", () => persist({ theme: t.id }));
      container.appendChild(btn);
    });
    syncThemeButtons();
  }

  function openSettings() {
    syncSettingsForm();
    document.getElementById("prefsOverlay")?.classList.add("open");
  }

  function closeSettings() {
    document.getElementById("prefsOverlay")?.classList.remove("open");
  }

  async function saveSettingsForm() {
    const slogan = (document.getElementById("prefSlogan")?.value || "").trim().slice(0, 120);
    const fontBtn = document.querySelector("[data-font-pick].on");
    const font_scale = fontBtn?.dataset.fontPick || prefs.font_scale;
    const reduce_motion = Boolean(document.getElementById("prefReduceMotion")?.checked);
    await persist({ slogan, font_scale, reduce_motion });
    closeSettings();
    if (typeof window.toast === "function") window.toast("偏好已保存");
  }

  function init() {
    applyToDom(prefs);
    buildThemeSwatches(document.getElementById("headerThemePicker"));
    buildThemeSwatches(document.getElementById("settingsThemePicker"));

    document.getElementById("prefSettingsBtn")?.addEventListener("click", openSettings);
    document.getElementById("sloganEditBtn")?.addEventListener("click", openSettings);
    document.getElementById("sloganBar")?.addEventListener("click", (e) => {
      if (e.target.closest("#sloganEditBtn")) return;
      openSettings();
    });
    document.getElementById("prefSaveBtn")?.addEventListener("click", saveSettingsForm);
    document.getElementById("prefCancelBtn")?.addEventListener("click", closeSettings);

    document.querySelectorAll("[data-font-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-font-pick]").forEach((b) => b.classList.remove("on"));
        btn.classList.add("on");
      });
    });
  }

  window.CompassPrefs = {
    get: () => ({ ...prefs }),
    apply: applyToDom,
    persist,
    syncFromServer,
    mergeLocalOnLogin,
    openSettings,
    closeSettings,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
