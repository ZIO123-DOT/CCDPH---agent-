import {
  clearMarkdownCache,
  clip,
  clipTail,
  escapeHtml,
  highlightCode,
  MARKDOWN_FALLBACK_LIMIT,
  markdown,
  truncateForDisplay,
} from "/markdown-renderer.js";
import {
  createApiClient,
  SESSION_RESPONSE_CHARS,
  SSE_FRAME_CHARS,
} from "/api-client.js";
import { stripAnsi } from "/terminal-text.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let bootstrapToken = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
let sessionAuthPromise = null;
let reauthenticationPromise = null;
function ensureSessionAuth() {
  if (!sessionAuthPromise) {
    sessionAuthPromise = api("auth/session", {}, { retryUnauthorized: false })
      .then((result) => {
        bootstrapToken = "";
        return result;
      })
      .catch((error) => {
        sessionAuthPromise = null;
        throw error;
      });
  }
  return sessionAuthPromise;
}
async function recoverSessionAuth() {
  if (!reauthenticationPromise) {
    sessionAuthPromise = null;
    reauthenticationPromise = ensureSessionAuth()
      .then(() => true)
      .catch((error) => {
        console.error("本地服务会话重新鉴权失败", error);
        toast("本地服务会话已失效，请退出并重新打开 CCDPH");
        return false;
      })
      .finally(() => {
        reauthenticationPromise = null;
      });
  }
  return reauthenticationPromise;
}
const api = createApiClient(() => bootstrapToken, {
  onUnauthorized: recoverSessionAuth,
});

const IS_ELECTRON = /Electron/i.test(navigator.userAgent);
document.body.classList.toggle("electron", IS_ELECTRON);
// 启动入场动画：动画结束后移除标记，避免后续重渲染触发
document.body.classList.add("app-entering");
setTimeout(
  () => document.body.classList.remove("app-entering"),
  1600,
);

// 统一的 SVG 图标助手（来自 /vendor/icons.js，lucide 图标集）
const ic = (name, ...classes) => window.wbIcon(name, ...classes);

const state = {
  projects: [],
  sessions: [],
  settings: {},
  runtime: {},
  projectId: localStorage.getItem("projectId"),
  sessionId: null,
  activeSession: null,
  events: [],
  running: false,
  archived: false,
  sessionView: "all",
  panel: "files",
  folder: "",
  source: null,
  liveText: "",
  liveThinking: "",
  contextFiles: [],
  images: [],
  usage: null,
  providerUsage: null,
  integrations: null,
  nativeApprovalIds: new Map(),
  projectInfo: null,
  terminalId: null,
  terminalSource: null,
  terminalRoot: null,
  terminalOutputChunks: [],
  terminalOutputChars: 0,
  // CCDPH-FIX(L-03): 尚未写进 xterm 的输出增量（隐藏期间会累积，见 feedTerminalView）
  terminalChunk: "",
  terminalExited: true,
  // CCDPH-FIX(F15): 界面事件是否因历史上限被丢弃（服务端 historyTruncated）
  historyTruncated: false,
  previewPath: null,
  previewIsDiff: false,
  commandItems: [],
  commandIndex: 0,
  commandMode: "all",
};
let lastApiAuthWarning = "";
const UNSUPPORTED_SETTINGS = new Set([
  "import",
  "profile",
  "voice",
  "pets",
  "computer",
  "plugins",
]);
for (const tab of UNSUPPORTED_SETTINGS) {
  document.querySelector(`[data-settings-tab="${tab}"]`)?.remove();
  document.querySelector(`[data-settings-panel="${tab}"]`)?.remove();
}
let toastTimer,
  navigationRevision = 0,
  // CCDPH-FIX(D2): 文件预览专用代际计数器。不复用 navigationRevision ——
  // 预览会频繁触发，复用会把在途的 refreshWorkspace 一并判废，导致文件列表不刷新。
  previewRevision = 0,
  submitting = false,
  fileSearchTimer,
  taskSearchTimer,
  commandSearchTimer,
  slashTimer,
  slashItems = [],
  slashIndex = 0,
  settingsTab = "general";
const systemTheme = matchMedia("(prefers-color-scheme: dark)");

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
// CCDPH-FIX(P3-30): 对一个已处于 open 状态的 <dialog> 再调 showModal() 会抛
// InvalidStateError（连续预览 / 连续打开设置会命中），异常经 action() 原样冒成 toast。
// 统一走这个幂等入口。
const openDialog = (selector) => {
  const dialog = $(selector);
  if (dialog && !dialog.open) dialog.showModal();
  return dialog;
};
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.add("hidden"), 5500);
}
function confirmAction(message, title = "确认操作", okText = "确认") {
  return new Promise((resolve) => {
    const dialog = $("#confirm-dialog");
    const form = $("#confirm-form");
    // 根因修复：嵌套 modal（确认框）关闭时浏览器会把先前的顶层弹层（设置页）
    // 一并带掉 —— 记录父弹层状态，收尾时原样恢复，调用方无需各自补救
    const parent = $("#settings-dialog");
    const parentWasOpen = Boolean(parent?.open);
    $("#confirm-title").textContent = title;
    $("#confirm-message").textContent = message;
    form.querySelector(".primary").textContent = okText;
    let result = false;
    const finish = () => {
      cleanup();
      if (parentWasOpen && parent && !parent.open) parent.showModal();
      resolve(result);
    };
    const onSubmit = (event) => {
      event.preventDefault();
      result = true;
      dialog.close();
      finish();
    };
    const onClose = () => finish();
    function cleanup() {
      form.removeEventListener("submit", onSubmit);
      dialog.removeEventListener("close", onClose);
    }
    form.addEventListener("submit", onSubmit);
    dialog.addEventListener("close", onClose);
    try {
      dialog.showModal();
    } catch (error) {
      // CCDPH-FIX(L-09): showModal() 抛错（对话框已处于 modal 状态 / 未连接文档）时
      // cleanup() 原本只能通过 finish() 触达 —— 两个监听器永久留在长生命周期的
      // #confirm-form / #confirm-dialog 上，且这个 Promise 永不 settle。
      console.error("确认框打开失败", error);
      cleanup();
      resolve(false);
    }
  });
}
function slashQuery() {
  const input = $("#prompt");
  const before = input.value.slice(
    0,
    input.selectionStart ?? input.value.length,
  );
  const match = before.match(/(?:^|\s)\/([^\s/]*)$/);
  if (!match) return null;
  return {
    query: match[1],
    start: before.length - match[0].length + (match[0].startsWith("/") ? 0 : 1),
    end: before.length,
  };
}
function hideSlashMenu() {
  slashItems = [];
  slashIndex = 0;
  $("#slash-menu")?.classList.add("hidden");
}
function setupComposerSelects() {
  for (const select of $$(
    "#model, #permission-mode, #effort, #environment-mode",
  )) {
    if (select.dataset.customized) continue;
    select.dataset.customized = "true";
    select.classList.add("native-select-source");
    // CCDPH-FIX(R3-P3-9): 原生 select 被 1px+clip 视觉隐藏，但仍保留在 tab 序列里，于是
    // 每个设置有**两个**焦点（自定义触发器 + 看不见的原生控件），读屏也会重复播报。这里
    // 把它移出键盘 tab 序（tabindex=-1），同时**保留**其可读性：读屏与无障碍树仍能看到它，
    // 自定义触发器也通过 aria-haspopup/aria-expanded 承担了语义。
    select.setAttribute("tabindex", "-1");
    const wrapper = el("div", "composer-select");
    const trigger = el("button", "composer-select-trigger");
    const menu = el("div", "composer-select-menu hidden");
    trigger.type = "button";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    const sync = () => {
      const option = select.options[select.selectedIndex];
      trigger.textContent = option?.textContent || "选择";
      trigger.disabled = select.disabled;
      for (const item of menu.querySelectorAll("button"))
        item.classList.toggle("selected", item.dataset.value === select.value);
    };
    select._syncComposerControl = sync;
    const close = () => {
      menu.classList.add("hidden");
      trigger.setAttribute("aria-expanded", "false");
    };
    for (const option of select.options) {
      const item = el("button", "composer-select-option", option.textContent);
      item.type = "button";
      item.dataset.value = option.value;
      item.onclick = () => {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        sync();
        close();
      };
      menu.append(item);
    }
    trigger.onclick = (event) => {
      event.stopPropagation();
      if (select.disabled) return;
      for (const other of $$(".composer-select-menu")) {
        if (other !== menu) other.classList.add("hidden");
      }
      for (const other of $$(".composer-select-trigger")) {
        if (other !== trigger) other.setAttribute("aria-expanded", "false");
      }
      const open = menu.classList.toggle("hidden");
      trigger.setAttribute("aria-expanded", String(!open));
    };
    select.addEventListener("change", sync);
    const parent = select.parentNode;
    parent.insertBefore(wrapper, select);
    wrapper.append(select, trigger, menu);
    sync();
  }
}
function syncComposerSelects() {
  for (const select of $$(".native-select-source"))
    select._syncComposerControl?.();
}
// CCDPH-FIX(AUDIT-10): slashItems / slashIndex / 菜单 DOM 是共享的模块状态，而 renderSlashMenu
// 由 80ms 防抖触发、两次调用可以重叠 —— 慢的旧响应后到就会把列表换成「上一个查询」的结果，
// 而点击与回车都按 index 取 slashItems（selectSlashSkill），于是插入的可能是用户没选的那条
// 命令。这里加代际号 + 查询串比对，只允许最新一次请求写状态。
let slashRenderRevision = 0;
async function renderSlashMenu() {
  const trigger = slashQuery();
  if (!trigger) return hideSlashMenu();
  const revision = ++slashRenderRevision;
  const query = new URLSearchParams({
    q: trigger.query,
    ...(state.projectId ? { projectId: state.projectId } : {}),
    ...(state.sessionId ? { sessionId: state.sessionId } : {}),
  });
  try {
    const result = await api(`skills?${query}`);
    // 不是最新一次调用 → 直接丢弃
    if (revision !== slashRenderRevision) return;
    const current = slashQuery();
    if (!current) return hideSlashMenu();
    // 触发词已经变了（用户又敲了字符）：这次响应属于旧查询，等下一次防抖渲染拉新结果
    if (current.query !== trigger.query) return;
    slashItems = result.skills || [];
    slashIndex = Math.min(slashIndex, Math.max(0, slashItems.length - 1));
    const menu = $("#slash-menu");
    menu.replaceChildren();
    if (!slashItems.length) {
      menu.append(el("div", "slash-empty", "未找到匹配的 Claude Skill"));
      menu.classList.remove("hidden");
      return;
    }
    slashItems.forEach((skill, index) => {
      const button = el(
        "button",
        `slash-item${index === slashIndex ? " selected" : ""}`,
      );
      button.type = "button";
      button.setAttribute("role", "option");
      button.append(
        el("span", "slash-command", skill.command),
        el(
          "span",
          "slash-description",
          `${skill.description} · ${skill.source}`,
        ),
      );
      button.onclick = () => selectSlashSkill(index);
      menu.append(button);
    });
    menu.classList.remove("hidden");
  } catch {
    hideSlashMenu();
  }
}
// CCDPH-FIX(AUDIT-10): 上下键原先直接再跑一次 renderSlashMenu() —— 每个按键一个 /api/skills
// 请求，而且高亮要等响应回来才动（按住 ↓ 时高亮明显滞后）。列表已经在手里，这里只切本地高亮。
function highlightSlashItem() {
  $$("#slash-menu .slash-item").forEach((button, index) =>
    button.classList.toggle("selected", index === slashIndex),
  );
}
function selectSlashSkill(index = slashIndex) {
  const skill = slashItems[index];
  const trigger = slashQuery();
  if (!skill || !trigger) return hideSlashMenu();
  const input = $("#prompt");
  input.value = `${input.value.slice(0, trigger.start)}${skill.command} ${input.value.slice(trigger.end)}`;
  const cursor = trigger.start + skill.command.length + 1;
  input.setSelectionRange(cursor, cursor);
  input.focus();
  hideSlashMenu();
}
// CCDPH-FIX(FE-02): 会话详情走放宽后的体积上限（见 SESSION_RESPONSE_CHARS）。
const fetchSession = (id) =>
  api(`session?id=${encodeURIComponent(id)}`, undefined, {
    maxChars: SESSION_RESPONSE_CHARS,
  });
// CCDPH-FIX(FE-02): 服务端对超大会话改为返回「字节预算内的尾部事件 + 标记」，
// 标记字段名落地前不做假设，几种常见命名任一为真都按「历史被截断」处理（复用 F15 的提示）。
const sessionTruncatedFlag = (session) =>
  [
    session?.historyTruncated,
    session?.eventsTruncated,
    session?.truncated,
    session?.tailTruncated,
    session?.eventsTailOnly,
  ].some(Boolean);
const action =
  (fn) =>
    (...args) =>
      Promise.resolve()
        .then(() => fn(...args))
        .catch((error) => toast(error.message));
const activeProject = () =>
  state.projects.find((item) => item.id === state.projectId);
const activeSessionMeta = () =>
  state.sessions.find((item) => item.id === state.sessionId);
const workspaceQuery = () =>
  `projectId=${encodeURIComponent(state.projectId || "")}${state.sessionId ? `&sessionId=${encodeURIComponent(state.sessionId)}` : ""}`;

function applyTheme(mode = localStorage.getItem("theme") || "system") {
  const resolved =
    mode === "system" ? (systemTheme.matches ? "dark" : "light") : mode;
  document.documentElement.dataset.theme = resolved;
  localStorage.setItem("theme", mode);
  $("#theme-setting").value = mode;
}
const UI_FONTS = {
  system: 'Inter, ui-sans-serif, "Segoe UI", "Microsoft YaHei UI", sans-serif',
  yahei: '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
  serif: 'Georgia, "Noto Serif SC", "Songti SC", serif',
  mono: 'ui-monospace, "Cascadia Code", Consolas, monospace',
};
function localBoolean(key, fallback) {
  const value = localStorage.getItem(key);
  return value === null ? fallback : value === "true";
}
function applyAppearanceSettings() {
  const font = localStorage.getItem("uiFont") || "system";
  const fontSize = localStorage.getItem("fontSize") || "13";
  const density = localStorage.getItem("density") || "comfortable";
  const reduceMotion = localBoolean("reduceMotion", false);
  document.documentElement.style.setProperty(
    "--ui-font",
    UI_FONTS[font] || UI_FONTS.system,
  );
  document.documentElement.style.setProperty(
    "--base-font-size",
    `${fontSize}px`,
  );
  document.documentElement.dataset.density = density;
  document.documentElement.dataset.reducedMotion = String(reduceMotion);
}
function applyInspectorPreference() {
  const visible = localBoolean("defaultInspector", true);
  $(".app-shell").classList.toggle("no-inspector", !visible);
  $("#toggle-inspector").classList.toggle("active", visible);
}
function handleSystemThemeChange() {
  if ((localStorage.getItem("theme") || "system") === "system")
    applyTheme("system");
}
systemTheme.addEventListener("change", handleSystemThemeChange);
applyTheme();
applyAppearanceSettings();

let stateRefreshSeq = 0;
let stateRefreshApplied = 0;
async function refreshState() {
  const seq = ++stateRefreshSeq;
  const data = await api("state");
  if (seq < stateRefreshApplied) return data;
  stateRefreshApplied = seq;
  state.runtime = data;
  state.projects = data.projects || [];
  state.sessions = data.sessions || [];
  state.settings = data.settings || {};
  state.apiAuthConfigured = data.apiAuthConfigured === true;
  state.apiAuthPersistence = data.apiAuthPersistence || "encrypted";
  state.apiAuthWarning = data.apiAuthWarning || "";
  if (state.apiAuthWarning && state.apiAuthWarning !== lastApiAuthWarning) {
    lastApiAuthWarning = state.apiAuthWarning;
    toast(state.apiAuthWarning);
  }
  if (!activeProject()) state.projectId = state.projects[0]?.id || null;
  $("#connection").textContent = data.claude.error
    ? "Claude Code 未连接"
    : `Claude Code ${data.claude.version?.split(" ")[0] || ""}`;
  $("#connection").title =
    data.claude.error || (data.claude.configured ? "已检测到 Claude Code" : "");
  $("#default-permission").value =
    state.settings.defaultPermissionMode || "default";
  $("#default-environment").value =
    state.settings.defaultEnvironment || "local";
  $("#notifications-setting").checked = state.settings.notifications !== false;
  scheduleProviderUsageRefresh();
  renderSidebar();
  renderHeader();
  void renderProviderSwitcher();
  renderSettingsDiagnostics();
  void refreshProviderUsage();
  return data;
}

let providerUsagePromise = null;
async function refreshProviderUsage(force = false) {
  if (providerUsagePromise) return providerUsagePromise;
  providerUsagePromise = api(`provider-usage${force ? "?refresh=1" : ""}`)
    .then((usage) => {
      state.providerUsage = usage;
      renderUsage();
      return usage;
    })
    .catch((error) => {
      state.providerUsage = {
        available: false,
        providerName: "当前服务商",
        reason: "request-failed",
      };
      renderUsage();
      return state.providerUsage;
    })
    .finally(() => {
      providerUsagePromise = null;
    });
  return providerUsagePromise;
}
let integrationsPromise = null;
async function refreshIntegrations() {
  if (integrationsPromise) return integrationsPromise;
  const query = state.projectId ? `?${workspaceQuery()}` : "";
  integrationsPromise = api(`integrations${query}`)
    .then((value) => {
      state.integrations = value;
      renderSettingsDiagnostics();
      return value;
    })
    .catch((error) => {
      state.integrations = {
        // CCDPH-FIX(P3-34): 不再伪造成 0（会让设置页显示"0 个已配置"，把扫描失败
        // 说成"什么都没配"）。null 会经 ?? "—" 显示为破折号。
        mcpCount: null,
        skillCount: null,
        hookCount: null,
        pluginCount: null,
        configDir: `扫描失败：${error.message}`,
      };
      renderSettingsDiagnostics();
      return state.integrations;
    })
    .finally(() => {
      integrationsPromise = null;
    });
  return integrationsPromise;
}

function renderSidebar() {
  const projectList = $("#projects");
  projectList.replaceChildren();
  for (const project of state.projects) {
    const button = el(
      "button",
      `project-row${project.id === state.projectId ? " active" : ""}`,
    );
    button.title = project.path;
    button.append(ic("folder", "project-icon"), el("span", "", project.name));
    button.onclick = action(() => selectProject(project.id));
    projectList.append(button);
  }
  if (!state.projects.length) {
    const empty = el("button", "sidebar-empty", "＋ 添加第一个项目");
    empty.onclick = openProjectDialog;
    projectList.append(empty);
  }
  const query = $("#task-search").value.trim().toLocaleLowerCase();
  const sessions = state.sessions
    .filter(
      (item) =>
        item.projectId === state.projectId &&
        Boolean(item.archived) === state.archived,
    )
    .filter(
      (item) =>
        state.sessionView !== "worktrees" || item.environment === "worktree",
    )
    .filter((item) => !query || item.title.toLocaleLowerCase().includes(query))
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        Number(b.running) - Number(a.running) ||
        b.updatedAt - a.updatedAt,
    );
  $("#task-list-label").textContent = state.archived
    ? "已归档"
    : state.sessionView === "worktrees"
      ? "Worktrees"
      : "任务";
  $("#show-archived").textContent = state.archived ? "返回" : "归档";
  const list = $("#sessions");
  list.replaceChildren();
  for (const session of sessions) {
    const button = el(
      "button",
      `session-row${session.id === state.sessionId ? " active" : ""}`,
    );
    const status = el(
      "span",
      `session-status${session.running ? " running" : ""}`,
    );
    status.append(
      session.running
        ? ic("circle-dot")
        : session.environment === "worktree"
          ? ic("git-fork")
          : document.createTextNode("·"),
    );
    button.append(status, el("span", "session-name", session.title));
    if (session.pinned) button.append(ic("pin", "session-pin"));
    button.title = `${session.title} \n${session.environment === "worktree" ? "独立 Worktree" : "当前工作区"}`;
    button.onclick = action(() => selectSession(session.id));
    button.ondblclick = () => openRename(session);
    button.oncontextmenu = (event) => {
      event.preventDefault();
      openSessionContextMenu(event.clientX, event.clientY, session, button);
    };
    list.append(button);
  }
  if (!sessions.length)
    list.append(
      el(
        "div",
        "sidebar-empty",
        query
          ? "没有匹配的任务"
          : state.archived
            ? "没有归档任务"
            : "新任务会显示在这里",
      ),
    );
}

// ---- 会话右键菜单：重命名 / 置顶 / 归档 / 删除 ----
function closeSessionContextMenu(restoreFocus = false) {
  const menu = $("#session-context-menu");
  if (!menu || menu.classList.contains("hidden")) return;
  menu.classList.add("hidden");
  menu.replaceChildren();
  if (restoreFocus) state.sessionMenuReturnFocus?.focus?.();
}
function openSessionContextMenu(x, y, session, trigger = null) {
  const menu = $("#session-context-menu");
  if (!menu) return;
  // CCDPH-FIX(R2-P3-12): 关闭后把焦点还给触发它的会话项，键盘用户不会掉到 body。
  state.sessionMenuReturnFocus = trigger || document.activeElement || null;
  menu.replaceChildren();
  const item = (label, handler, danger = false) => {
    const button = el("button", danger ? "danger" : "");
    button.type = "button";
    button.textContent = label;
    // CCDPH-FIX(R2-P2-9): 原来这里直接 `handler()` 并丢弃返回的 Promise —— 请求失败时
    //（服务重启 / 401 / 500）既无 toast 也无 catch，对「删除本地记录」这类不可逆操作
    // 会看起来"什么都没发生"。统一走 action()（失败 toast），与同一菜单的「打开」一致。
    // CCDPH-FIX(R2-P3-12): 补齐 role="menuitem"，读屏软件才能把子项识别成菜单项。
    button.setAttribute("role", "menuitem");
    button.onclick = action(async () => {
      closeSessionContextMenu(true);
      await handler();
    });
    menu.append(button);
  };
  item("打开", () => selectSession(session.id));
  item("重命名", () => openRename(session));
  item(session.pinned ? "取消置顶" : "置顶", () =>
    sessionQuickAction(session, { pinned: !session.pinned }),
  );
  item(session.archived ? "恢复任务" : "归档", () =>
    sessionQuickAction(session, { archived: !session.archived }),
  );
  item("删除本地记录", () => deleteSessionById(session), true);
  menu.classList.remove("hidden");
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
  // CCDPH-FIX(R2-P3-12): 菜单原来既没有 Esc 关闭，也没有焦点管理 —— 键盘/读屏用户
  // 打开后只能靠鼠标点别处。打开即聚焦第一项，并提供 Esc / 方向键导航。
  const items = [...menu.querySelectorAll("button")];
  menu.onkeydown = (event) => {
    const index = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      closeSessionContextMenu(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(index + 1 + items.length) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    }
  };
  items[0]?.focus();
}
async function sessionQuickAction(session, changes) {
  const updated = await api("session/update", {
    sessionId: session.id,
    ...changes,
  });
  state.sessions = state.sessions.map((item) =>
    item.id === updated.id ? { ...item, ...updated } : item,
  );
  if (state.sessionId === updated.id) state.activeSession = updated;
  renderSidebar();
  renderHeader();
  toast(updated.archived ? "已归档" : updated.pinned ? "已置顶" : "已更新");
}
async function deleteSessionById(session) {
  if (
    !(await confirmAction(
      `删除「${session.title}」的工作台记录？\nClaude Code 自身保存的底层会话不会被删除。`,
      "删除任务",
      "删除",
    ))
  )
    return;
  await api("session/delete", { sessionId: session.id });
  if (state.sessionId === session.id) {
    // CCDPH-FIX(L-01): 删除当前会话要像导航一样收尾（关会话流/终端流、停服务端 PTY）
    await teardownActiveSession();
    state.sessionId = null;
    state.activeSession = null;
    state.events = [];
    state.running = false;
    renderMessages();
    renderHeader();
  }
  await refreshState();
  renderSidebar();
  await refreshWorkspace();
  toast("已删除");
}
// CCDPH-FIX(R2-P3-12): 这里必须显式包一层 —— 直接把 closeSessionContextMenu 当监听器
// 会被传入事件对象，而它现在的首参是 restoreFocus（事件对象恒为真值 → 每次点击都会抢焦点）。
document.addEventListener("click", () => closeSessionContextMenu());
document.addEventListener("blur", () => closeSessionContextMenu());
window.addEventListener("resize", () => closeSessionContextMenu());

function renderHeader() {
  const project = activeProject(),
    session = state.activeSession || activeSessionMeta();
  $("#session-title").textContent = session?.title || "新任务";
  $("#project-name").textContent = project?.name || "选择一个项目开始";
  $("#environment-badge").textContent =
    session?.environment === "worktree" ? "Worktree" : "本地";
  $("#environment-mode").value =
    session?.environment || state.settings.defaultEnvironment || "local";
  $("#environment-mode").disabled = Boolean(session);
  $("#model").disabled = false;
  $("#permission-mode").disabled = false;
  $("#effort").disabled = false;
  $("#permission-mode").value =
    session?.permissionMode ||
    state.settings.defaultPermissionMode ||
    "default";
  setModelSelect(session?.model);
  $("#effort").value =
    session?.effort || state.settings.defaultEffort || "inherit";
  $("#task-menu").classList.toggle("hidden", !session);
  const branch = $("#branch-badge");
  if (state.projectInfo?.git) {
    branch.classList.remove("hidden");
    branch.querySelector("span").textContent =
      `${state.projectInfo.branch}${state.projectInfo.ahead ? ` ↑${state.projectInfo.ahead}` : ""}${state.projectInfo.behind ? ` ↓${state.projectInfo.behind}` : ""}`;
  } else branch.classList.add("hidden");
  $("#workspace-path").textContent =
    state.projectInfo?.root || project?.path || "文件保留在本机";
  renderSetupBanner();
  syncComposerSelects();
}
function renderSetupBanner() {
  const banner = $("#setup-banner");
  if (!banner) return;
  const missing = Boolean(state.runtime?.claude?.error);
  banner.classList.toggle("hidden", !missing);
  const text = $("#setup-banner-text");
  if (text && missing)
    text.textContent = "请先安装 Claude Code，或在设置→环境中选择 claude.exe。";
}

async function selectProject(id, restoreRecent = true) {
  const revision = ++navigationRevision;
  disconnectSession();
  stopOrphanedTerminal(); // CCDPH-FIX(AUDIT-6): 丢弃 terminalId 前先停掉服务端 shell
  disconnectTerminalStream(true);
  state.projectId = id;
  localStorage.setItem("projectId", id);
  state.folder = "";
  state.sessionId = null;
  state.activeSession = null;
  state.events = [];
  state.running = false;
  state.contextFiles = [];
  state.images = [];
  const recent = state.sessions
    .filter((item) => item.projectId === id && !item.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (recent && restoreRecent) await selectSession(recent.id, revision);
  else {
    renderSidebar();
    renderHeader();
    renderMessages();
    await refreshWorkspace(revision);
  }
}
async function selectSession(id, parentRevision) {
  const revision = parentRevision ?? ++navigationRevision;
  disconnectSession();
  stopOrphanedTerminal(); // CCDPH-FIX(AUDIT-6): 丢弃 terminalId 前先停掉服务端 shell
  disconnectTerminalStream(true);
  const session = await fetchSession(id);
  if (revision !== navigationRevision) return;
  state.sessionId = id;
  state.projectId = session.projectId;
  state.activeSession = session;
  state.events = session.events || [];
  state.historyTruncated = sessionTruncatedFlag(session); // CCDPH-FIX(F15/FE-02)
  seenEventIds = new Set(state.events.map((item) => item.id));
  trimRetainedImages(); // CCDPH-FIX(L-06): 只保留最近若干张图片预览
  state.running = session.running;
  state.liveText = "";
  state.liveThinking = "";
  state.folder = "";
  state.contextFiles = [];
  state.images = [];
  state.usage =
    state.events.findLast?.((item) => item.type === "usage")?.usage || null;
  localStorage.setItem("projectId", session.projectId);
  renderSidebar();
  renderHeader();
  renderContext();
  renderMessages();
  if (session.running) connectSession();
  await refreshWorkspace(revision);
}
// 新建任务：进入"草稿"状态——不立刻创建服务端会话、不进侧栏列表。
// 发出第一条消息时 ensureSession() 才真正创建，避免左侧堆积没用的空对话。
function newSession() {
  ++navigationRevision; // CCDPH-FIX(AUDIT-17): 原为 `const revision = ...`，这个 revision 从未被读
  disconnectSession();
  stopOrphanedTerminal(); // CCDPH-FIX(AUDIT-6): 丢弃 terminalId 前先停掉服务端 shell
  disconnectTerminalStream(true);
  state.sessionId = null;
  state.activeSession = null;
  state.events = [];
  state.running = false;
  state.liveText = "";
  state.liveThinking = "";
  state.contextFiles = [];
  state.images = [];
  state.usage = null;
  state.folder = "";
  renderSidebar();
  renderHeader();
  renderContext();
  renderMessages();
  $("#prompt").focus();
}
// 真正创建会话：仅在发出第一条消息时调用（草稿落定）
async function ensureSession() {
  if (state.sessionId) return state.activeSession || activeSessionMeta();
  if (!activeProject()) return openProjectDialog();
  const revision = ++navigationRevision;
  disconnectSession();
  const session = await api("sessions", {
    projectId: state.projectId,
    environment:
      $("#environment-mode").value || state.settings.defaultEnvironment,
  });
  if (revision !== navigationRevision) return null;
  await refreshState();
  if (revision !== navigationRevision) return null;
  state.sessionId = session.id;
  state.activeSession = session;
  state.events = session.events || [];
  renderSidebar();
  renderHeader();
  return session;
}
function disconnectSession({
  preserveRenderedMessages = false,
  preserveNativeApprovals = false,
} = {}) {
  state.source?.close();
  state.source = null;
  clearTimeout(sessionReconcileTimer);
  sessionReconcileTimer = null;
  // CCDPH-FIX(L-08): 退避计数属于「当前会话」—— 上一会话连续重连失败后切到正常会话，
  // 首次对账会被推迟到 30s（2000×1.5^5 封顶），界面长时间停在旧数据上。
  sessionReconnectAttempts = 0;
  state.liveText = "";
  state.liveThinking = "";
  if (!preserveNativeApprovals) state.nativeApprovalIds.clear();
  seenEventIds.clear();
  renderState.toolCards.clear();
  renderState.pendingToolCards.clear();
  renderState.approvalEvents.clear();
  renderState.approvalResults.clear();
  renderState.hasPendingApproval = false;
  renderState.liveNode = null;
  renderState.workingNode = null;
  renderState.latestThinkingNode = null;
  renderState.liveRenderedText = "";
  if (!preserveRenderedMessages) {
    renderedEventNodes.clear();
    truncationNoticeNode?.remove();
    truncationNoticeNode = null;
    renderWindowNoticeNode?.remove();
    renderWindowNoticeNode = null;
    $("#messages")?.replaceChildren();
  }
  // CCDPH-FIX(L-07): markdown 缓存不能跨会话存活（会话切换/删除时整体清空）
  clearMarkdownCache();
}
// CCDPH-FIX(L-01): 删除/归档当前会话原先只清 state 字段，从不做流收尾 ——
// 实测：删除后终端 EventSource 仍 state=1(OPEN)、服务端 PTY 仍存活，而界面上
// 已经没有入口能停它（terminal/stop 全文件只有 startTerminal 里一处调用）。
// 这里复用导航路径同一套收尾，并先把服务端 shell 停掉（terminalId 一清就再也停不了）。
// 会话 SSE 本身即使空闲也不会自己关（只有消息到达时才懒关闭），必须显式 close。
async function teardownActiveSession() {
  const terminalId = state.terminalId;
  if (terminalId && !state.terminalExited)
    await api("terminal/stop", { id: terminalId }).catch(() => { });
  disconnectSession();
  disconnectTerminalStream(true);
  state.running = false;
  // 让在途的 refreshWorkspace / selectSession 结果作废，避免删完又被旧响应写回
  ++navigationRevision;
}
let sessionReconcileTimer = null;
let sessionReconnectAttempts = 0;
let seenEventIds = new Set();
// CCDPH-FIX(HIGH-1): 前端事件镜像的服务端同款上限（server.mjs 的 historyLimit 最大 5000）
const EVENTS_MAX = 5000;
// 会话事件继续保留给 tool_result / approval 关联，但 DOM 只渲染最近窗口，避免长会话
// 一次创建数千个 Markdown、代码高亮与详情节点导致主线程和内存峰值。
const RENDERED_EVENTS_MAX = 1000;
// CCDPH-FIX(L-06): state.events 里的 user 事件会带 base64 图片预览（每张几十~几百 KB），
// 这些数据会随事件一直留在堆里（5000 条上限并不小）。只保留最近 IMAGE_PREVIEW_KEEP 张的
// 预览，更早的只留文件名占位；渲染侧 userMessage() 对没有 preview 的图片显示占位文案。
const IMAGE_PREVIEW_KEEP = 20;
function trimRetainedImages() {
  let kept = 0;
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const images = state.events[index]?.images;
    if (!Array.isArray(images) || !images.length) continue;
    if (kept < IMAGE_PREVIEW_KEEP) {
      kept += images.length;
      continue;
    }
    for (const image of images) {
      if (!image || !image.preview) continue;
      image.preview = "";
      eventRenderFingerprints.delete(state.events[index]);
    }
  }
}
// CCDPH-FIX(HIGH-4): `#model` 是一个只有 4 个固定 <option> 的 <select>（index.html:246），
// 但服务端在供应商模式下允许**任意**合法模型名（如 deepseek-chat）。给 <select>.value
// 赋一个没有对应 option 的值时，浏览器会把 selectedIndex 置为 -1、读回来变成 ""，
// 随后 syncCurrentSessionControls() 就把它发回服务端 —— 用户切换权限模式或思考强度时，
// 自定义模型被静默重置为「跟随 CC Switch」，且界面不报错。
// 这里在赋值前确保对应 option 存在。
function setModelSelect(value) {
  const select = $("#model");
  if (!select) return;
  const model = typeof value === "string" ? value : "";
  if (model && ![...select.options].some((option) => option.value === model)) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    select.append(option);
  }
  select.value = model;
}
// CCDPH-FIX(R3-P3-10): connectSession 在 `await ensureSessionAuth()` **之前**关掉上一条流、之后才
// 建新流并写 state.source。两次调用都落在该 await 窗口内时，先建的那条 EventSource 会失去引用
// （永不 close），而它 onmessage 里的 `state.sessionId === id` 仍然成立 —— 于是它继续往
// state.liveText 追加，表现为流式文本重复。这里给每次连接发一个序号，只有最新一次才允许注册
// 流；过期的调用直接返回，不再创建 EventSource。
let sessionStreamSeq = 0;
async function connectSession() {
  const seq = ++sessionStreamSeq;
  // 重连同一会话只换 SSE，不清已有节点；导航离开会话仍走 disconnectSession() 默认清理。
  disconnectSession({
    preserveRenderedMessages: true,
    preserveNativeApprovals: true,
  });
  const id = state.sessionId;
  try {
    await ensureSessionAuth();
  } catch (error) {
    console.error("会话流鉴权初始化失败", error);
    if (state.sessionId === id)
      toast("实时会话连接暂不可用，主界面仍可继续使用；稍后将自动重试");
    return;
  }
  if (seq !== sessionStreamSeq) return; // 已经有更晚的一次连接接管
  if (state.sessionId !== id) return;
  const source = new EventSource(
    `/api/events?id=${encodeURIComponent(id)}`,
  );
  state.source = source;
  source.onmessage = (message) => {
    if (state.sessionId !== id) return source.close();
    let event;
    const oversized = message.data.length > SSE_FRAME_CHARS;
    try {
      if (oversized) throw new Error("SSE 消息过大，已丢弃");
      event = JSON.parse(message.data);
    } catch (parseError) {
      console.error("会话事件解析失败", parseError);
      // CCDPH-FIX(FE-03): 连接时的 snapshot 会把整份历史塞进一帧，超过上限时原实现直接
      // disconnectSession() —— 流被主动关掉、onerror 不会触发、对账又因同样的体积问题失败，
      // 界面永久停在「工作中」且没有任何提示。现在：明确告知原因，保持流打开
      // （后续增量仍然可显示），并主动向服务端求证一次真实状态。
      if (oversized) {
        toast(
          /^\s*\{\s*"type"\s*:\s*"snapshot"/.test(message.data.slice(0, 64))
            ? "会话历史过大，已跳过本次完整快照；后续增量仍会实时显示"
            : "收到一条过大的会话事件，已跳过（其余内容不受影响）",
        );
        // 已持有的事件标记为已见，避免随后重放的增量被重复追加
        seenEventIds = new Set(state.events.map((item) => item.id));
        void reconcileSessionState(id);
        return;
      }
      // 单帧解析失败也不该掐断整条实时流（掐断后用户只会看到界面卡在"工作中"）
      toast("收到一条无法解析的会话事件，已跳过");
      return;
    }
    // CCDPH-FIX(AUDIT-9): 退避计数原先在「任何一帧到达」时就清零，而服务端每建立一条 SSE 都会
    // 先发一帧 snapshot（server.mjs 的流开头）—— 于是 2000×1.5^n 的退避永远停在 2s：断流后每
    // ~3s 重连一次，每次重连又收到 snapshot 再清零，同时每轮还顺带 fetchSession()（最大 64MB）。
    // 只有真正收到「增量帧」才证明这条流是健康的，也只在那时清零。
    if (event.type !== "snapshot") sessionReconnectAttempts = 0;
    try {
      if (event.type === "snapshot") {
        state.events = event.events || [];
        seenEventIds = new Set(state.events.map((e) => e.id));
        state.running = event.running;
        state.historyTruncated = Boolean(
          event.historyTruncated || event.eventsTruncated,
        ); // CCDPH-FIX(F15)
        trimRetainedImages(); // CCDPH-FIX(L-06)
        state.usage =
          state.events.findLast?.((item) => item.type === "usage")?.usage || null;
        state.liveText = "";
        state.liveThinking = "";
        renderMessages();
        if (!event.running) {
          state.running = false;
          syncRunState();
        }
      } else if (event.type === "text_delta") {
        state.liveText += event.text;
        // CCDPH-FIX(AUDIT-13): 用 clipTail 截断，不切在代理对中间
        if (state.liveText.length > 50000)
          state.liveText = clipTail(state.liveText, 50000);
        scheduleLiveUpdate();
      } else if (event.type === "thinking_delta") {
        state.liveThinking += event.text;
        if (state.liveThinking.length > 50000)
          state.liveThinking = clipTail(state.liveThinking, 50000); // CCDPH-FIX(AUDIT-13)
        scheduleLiveUpdate();
      } else {
        applyStreamEvent(event);
      }
      if (event.type === "usage" || event.type === "done") renderUsage();
    } catch (error) {
      // CCDPH-FIX(FE-05): 单条事件处理异常（例如工具事件缺 input）原先会直接逃出
      // source.onmessage —— 该条之后的分支（renderUsage 等）被跳过，异常也无人处理。
      console.error("会话事件处理失败", event, error);
    }
  };
  source.onerror = () => {
    if (state.sessionId !== id) return source.close();
    if (!state.running) return source.close();
    // 运行中断流（服务重启/网络闪断）：EventSource 会自动重连，但若一直连不上
    // 或错过了 result 事件，UI 会永久卡在"工作中"。主动向 /api/session 求证
    // 真实状态对账一次，跑完/失败都能被纠正。
    clearTimeout(sessionReconcileTimer);
    const backoff = Math.min(2000 * Math.pow(1.5, sessionReconnectAttempts), 30000);
    sessionReconnectAttempts++;
    sessionReconcileTimer = setTimeout(() => {
      if (state.sessionId !== id || !state.running) return;
      void reconcileSessionState(id);
    }, backoff);
  };
}
// CCDPH-FIX(FE-03): 快照被跳过 / 断流后都用它向服务端求证真实状态（走 64MB 上限）
async function reconcileSessionState(id) {
  try {
    const session = await fetchSession(id);
    if (state.sessionId !== id) return;
    state.events = session.events || [];
    seenEventIds = new Set(state.events.map((item) => item.id));
    state.historyTruncated = sessionTruncatedFlag(session); // CCDPH-FIX(FE-02)
    trimRetainedImages(); // CCDPH-FIX(L-06)
    state.running = session.running;
    state.liveText = "";
    state.liveThinking = "";
    renderMessages();
    syncRunState();
    // 只有真正收到 SSE 增量帧才能证明流恢复；HTTP 对账成功不能重置退避，
    // 否则“HTTP 正常、SSE 持续失败”会每约 2 秒拉一次整会话。
  } catch (error) {
    console.warn("会话状态对账失败", error);
    if (state.sessionId === id && state.running)
      toast("会话状态暂时无法同步，将继续重试");
  }
}

// ===== 增量流式渲染 =====
// 每个文本增量只更新末尾的 live 节点，不再整列表重建 DOM。
const renderState = {
  toolCards: new Map(), // toolId -> { detail, indicator }
  pendingToolCards: new Set(),
  approvalEvents: new Map(), // requestId -> approval event
  approvalResults: new Map(), // requestId -> approval_result event
  liveNode: null,
  workingNode: null,
  latestThinkingNode: null,
  hasPendingApproval: false,
  liveRenderedText: "",
  liveRenderedAt: 0,
};
const LIVE_RENDER_INTERVAL = 120; // 流式期间全量重排很贵（marked+DOMPurify+整个节点），限频
let liveUpdateQueued = false;
function scheduleLiveUpdate() {
  if (liveUpdateQueued) return;
  liveUpdateQueued = true;
  requestAnimationFrame(() => {
    liveUpdateQueued = false;
    syncLive();
  });
}
function workingLabel() {
  return renderState.hasPendingApproval ? "等待你的确认…" : "Claude 正在工作…";
}
function syncLive() {
  const messages = $("#messages"),
    scroll = $("#chat-scroll"),
    nearBottom =
      scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 150;
  if (state.liveText) {
    renderState.workingNode?.remove();
    renderState.workingNode = null;
    const textChanged = state.liveText !== renderState.liveRenderedText;
    const due =
      Date.now() - renderState.liveRenderedAt >= LIVE_RENDER_INTERVAL;
    if (textChanged && (due || !renderState.liveNode?.isConnected)) {
      // 重建整段 markdown（限频）；流式期间跳过代码高亮，结束后整段重渲时再高亮
      renderState.liveNode?.remove();
      // D-02 修复：实时渲染同样做单条兜底，失败时给出可见提示 + 纯文本降级，
      // 不让流式渲染的异常中断整个会话（不再被 action() 静默吞成内部英文报错）。
      try {
        const node = assistantMessage(state.liveText, true);
        messages.append(node);
        renderState.liveNode = node;
        renderState.liveRenderedText = state.liveText;
        renderState.liveRenderedAt = Date.now();
      } catch (error) {
        console.error("实时消息渲染失败", error);
        const node = el("section", "message assistant live-response");
        node.append(
          el(
            "div",
            "error-message",
            `本条消息渲染失败（${error?.message || error}）`,
          ),
          el(
            "pre",
            "markdown-fallback",
            // CCDPH-FIX(AUDIT-13): 同一类定长截断（原报告未列此行，但缺陷相同）也用 clip
            clip(state.liveText, MARKDOWN_FALLBACK_LIMIT),
          ),
        );
        messages.append(node);
        renderState.liveNode = node;
        renderState.liveRenderedText = state.liveText;
        renderState.liveRenderedAt = Date.now();
      }
    } else if (renderState.liveNode && !renderState.liveNode.isConnected) {
      messages.append(renderState.liveNode);
    }
  } else {
    renderState.liveNode?.remove();
    renderState.liveNode = null;
    const label = state.liveThinking ? "正在思考…" : workingLabel();
    if (state.liveThinking || state.running) {
      if (renderState.workingNode?.isConnected)
        renderState.workingNode.textContent = label;
      else {
        renderState.workingNode?.remove();
        const working = el("div", "working", label);
        messages.append(working);
        renderState.workingNode = working;
      }
    } else {
      renderState.workingNode?.remove();
      renderState.workingNode = null;
    }
  }
  if (nearBottom) scroll.scrollTop = scroll.scrollHeight;
}
function syncRunState() {
  $("#send").classList.toggle("hidden", state.running);
  $("#stop").classList.toggle("hidden", !state.running);
  $("#run-state").classList.toggle("busy", state.running);
  $("#run-state").replaceChildren(
    el("i"),
    document.createTextNode(state.running ? " 工作中" : " 就绪"),
  );
}
function toolTarget(event) {
  return (
    event.input?.file_path ||
    event.input?.command ||
    event.input?.pattern ||
    event.input?.description ||
    "查看详情"
  );
}
function setToolIndicator(indicator, mode) {
  indicator.classList.remove("busy", "error");
  indicator.replaceChildren();
  if (mode === "ok") indicator.append(ic("check"));
  else if (mode === "error") {
    indicator.append(ic("circle-alert"));
    indicator.classList.add("error");
  } else if (mode === "busy") {
    indicator.append(ic("loader-circle"));
    indicator.classList.add("busy");
  } else indicator.append(document.createTextNode("·"));
}
function registerToolCard(event, options = {}) {
  const detail = el("details", "tool-card");
  detail.dataset.eventId = event.id;
  detail.open = Boolean(options.open);
  const summary = el("summary");
  const indicator = el("span", "tool-indicator");
  summary.append(
    indicator,
    el("b", "", event.tool),
    el("span", "tool-target", toolTarget(event)),
  );
  detail.append(summary, el("pre", "", truncateForDisplay(JSON.stringify(event.input, null, 2))));
  if (options.result) {
    setToolIndicator(indicator, options.result.error ? "error" : "ok");
    detail.append(el("pre", "", options.result.text));
  } else setToolIndicator(indicator, state.running ? "busy" : "idle");
  if (event.toolId) {
    const card = { detail, indicator };
    renderState.toolCards.set(event.toolId, card);
    if (options.result) renderState.pendingToolCards.delete(card);
    else renderState.pendingToolCards.add(card);
  }
  return detail;
}
function renderThinkingCard(event, open = false) {
  const detail = el("details", "thinking");
  detail.dataset.eventId = event.id;
  detail.open = open;
  detail.append(el("summary", "", "思考过程"), el("p", "", event.text));
  renderState.latestThinkingNode = detail;
  return detail;
}
function resultLine(event) {
  return `${event.failed ? "本轮未完成" : "本轮完成"}${event.task ? `：${event.task}` : ""} · ${((event.duration || 0) / 1000).toFixed(1)} 秒${typeof event.cost === "number" ? ` · 等值估算 ${activeCurrencySymbol()}${event.cost.toFixed(4)}` : ""}`;
}
// CCDPH-FIX(ENC-2)：resultLine() 在渲染时就把货币符号写进文本，而首屏消息通常早于
// /api/provider-usage 返回就渲染完成，之后消息区不再重绘 —— 结果是任务卡片「等值估算」
// 长期缺货币符号（实测：首次加载为空，手动点一次用量状态才补上）。这里记录渲染时所用的
// 符号，在用量返回后按需补绘一次，避免每次刷新都整体重渲染。
let messagesCurrencySymbol = null;
function syncResultCurrencySymbol() {
  const now = activeCurrencySymbol();
  if (now === messagesCurrencySymbol) return;
  messagesCurrencySymbol = now;
  if (!$$("#messages .result-line").length) return;
  renderMessages();
}
// CCDPH-FIX(FE-01): renderMessages() 原本每次都 `replaceChildren()` 销毁整份列表再重建，
// 并因此丢掉 code.dataset.highlighted —— 实测 4000 条事件的会话每次重建阻塞主线程 2.05s
// （1.15MB innerHTML、全局 3 万+ DOM 节点）。流式 done / approval_result 已改为定点更新，
// 这里保留给导航、快照和结构失配时的完整对账。
// 现在按 event.id 复用节点：只有内容真的变了的事件才重建，其余节点原样留在 DOM 里
// （高亮标记、用户手动展开的 details、输入到一半的确认框都随之保留）。
// 顺序用游标维护：已就位的节点零操作，移动/新增用 insertBefore，游标之后的残留统一删除。
const renderedEventNodes = new Map(); // event.id -> { node, key, card }
const eventRenderFingerprints = new WeakMap();
function eventRenderFingerprint(event) {
  if (!event || typeof event !== "object") return String(event ?? "");
  const cached = eventRenderFingerprints.get(event);
  if (cached) return cached;
  let text;
  try {
    text = JSON.stringify(event);
  } catch {
    text = `${event.type || ""}|${event.text || ""}`;
  }
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const fingerprint = `${text.length}:${hash >>> 0}`;
  eventRenderFingerprints.set(event, fingerprint);
  return fingerprint;
}
// 事件节点的渲染签名：只包含会改变节点内容的外部状态，宁可多重建也不能少重建。
function eventNodeKey(event, results, approvals) {
  const parts = [event.type, eventRenderFingerprint(event)];
  if (event.type === "tool") {
    const result = results?.get(event.toolId);
    parts.push(result ? eventRenderFingerprint(result) : "-");
    parts.push(state.running ? "r" : "i");
  }
  if (event.type === "thinking") parts.push(state.running ? "r" : "i");
  if (event.type === "approval") {
    const resolved = approvals?.get(event.requestId);
    parts.push(resolved ? (resolved.allowed ? "y" : "n") : "-");
    parts.push(state.running ? "r" : "i");
  }
  // 结果行内嵌货币符号，符号变化时必须重画（syncResultCurrencySymbol → renderMessages）
  if (event.type === "result") parts.push(messagesCurrencySymbol || "");
  return parts.join("|");
}
function renderEventNode(event, context) {
  const { results, approvals, typed, opened } = context;
  if (event.type === "user") return userMessage(event);
  if (event.type === "text") return assistantMessage(event.text);
  if (event.type === "tool")
    return registerToolCard(event, {
      result: results.get(event.toolId),
      open: opened.has(event.id),
    });
  if (event.type === "thinking")
    return renderThinkingCard(
      event,
      opened.has(event.id) ||
      (localBoolean("showThinking", false) && !state.running),
    );
  if (event.type === "approval" && approvals.has(event.requestId))
    return renderApproval(event, approvals.get(event.requestId), typed);
  if (event.type === "result") return el("div", "result-line", resultLine(event));
  if (event.type === "error") return el("div", "error-message", event.text);
  if (event.type === "stopped") return el("div", "result-line", event.text);
  return null;
}
// CCDPH-FIX(L-06): 历史上限提示复用同一个节点，避免每次渲染新建再删除
let truncationNoticeNode = null;
function truncationNotice() {
  if (!truncationNoticeNode)
    truncationNoticeNode = el(
      "div",
      "result-line",
      "更早的界面事件已达上限被丢弃（Claude 底层会话仍完整）",
    );
  return truncationNoticeNode;
}
let renderWindowNoticeNode = null;
function renderWindowNotice(hiddenCount) {
  if (!renderWindowNoticeNode)
    renderWindowNoticeNode = el("div", "result-line");
  renderWindowNoticeNode.textContent =
    `为控制界面内存，仅渲染最近 ${RENDERED_EVENTS_MAX} 条事件；` +
    `更早的 ${hiddenCount} 条仍保留在当前会话数据中`;
  return renderWindowNoticeNode;
}
function appendEventNode(event) {
  const messages = $("#messages");
  let node = renderEventNode(event, {
    results: new Map(),
    approvals: new Map(),
    typed: new Map(),
    opened: new Set(),
  });
  // 未解决的 approval 暂时只显示在 dock；用注释锚点保留其历史位置，解决时可 O(1) 替换。
  if (!node && event.type === "approval")
    node = document.createComment(`approval:${event.requestId || event.id}`);
  if (!node) return;
  // CCDPH-FIX(FE-01): 流式追加的节点同样登记进缓存，后续结果可直接定点更新。
  if (typeof event.id === "string" && event.id)
    renderedEventNodes.set(event.id, {
      node,
      key: eventNodeKey(event, null, null),
      card:
        event.type === "tool" && event.toolId
          ? renderState.toolCards.get(event.toolId)
          : null,
    });
  node.classList?.add?.("enter");
  $("#welcome").classList.add("hidden");
  messages.append(node);
  if (state.events.length > RENDERED_EVENTS_MAX) {
    const notice = renderWindowNotice(
      state.events.length - RENDERED_EVENTS_MAX,
    );
    if (messages.firstChild !== notice)
      messages.insertBefore(notice, messages.firstChild);
  }
  while (renderedEventNodes.size > RENDERED_EVENTS_MAX) {
    const oldestId = renderedEventNodes.keys().next().value;
    const oldest = renderedEventNodes.get(oldestId);
    oldest?.node?.remove();
    renderedEventNodes.delete(oldestId);
    if (oldest?.card) {
      renderState.pendingToolCards.delete(oldest.card);
      for (const [toolId, card] of renderState.toolCards)
        if (card === oldest.card) renderState.toolCards.delete(toolId);
    }
  }
}
function renderApprovalDock() {
  // CCDPH-FIX(AUDIT-16): pruneNativeApprovalIds 原先只有 syncNativeApprovalState() 一个调用点 ——
  // 桌面桥漏掉 resolved 回调时，过期的 id 会一直参与下面的过滤、把页内确认卡屏蔽掉（最多 10 分钟），
  // 直到下一个原生确认事件或切换会话。这里每次重绘确认面板时顺带清理。
  pruneNativeApprovalIds();
  const pendingApprovals = [...renderState.approvalEvents.values()].filter(
    (event) =>
      !renderState.approvalResults.has(event.requestId) &&
      !state.nativeApprovalIds.has(event.requestId) &&
      state.running,
  );
  renderState.hasPendingApproval = pendingApprovals.length > 0;
  const typed = new Map(
    $$(".approval input").map((node) => [node.dataset.key, node.value]),
  );
  const dock = $("#approval-dock");
  dock.replaceChildren();
  if (pendingApprovals.length) {
    dock.append(
      el(
        "div",
        "approval-dock-head",
        `需要你的确认 · ${pendingApprovals.length} 项待处理`,
      ),
    );
    for (const event of pendingApprovals)
      dock.append(renderApproval(event, null, typed));
    dock.classList.remove("hidden");
  } else dock.classList.add("hidden");
}
let messageReconcileQueued = false;
function scheduleMessageReconcile() {
  if (messageReconcileQueued) return;
  messageReconcileQueued = true;
  requestAnimationFrame(() => {
    messageReconcileQueued = false;
    renderMessages();
  });
}
function refreshResolvedApproval(requestId) {
  const approval = renderState.approvalEvents.get(requestId);
  const resolved = renderState.approvalResults.get(requestId);
  const entry = approval?.id ? renderedEventNodes.get(approval.id) : null;
  if (!approval || !resolved || !entry?.node?.isConnected)
    return scheduleMessageReconcile();
  const node = renderEventNode(approval, {
    results: new Map(),
    approvals: new Map([[requestId, resolved]]),
    typed: new Map(),
    opened: new Set(),
  });
  if (!node) return scheduleMessageReconcile();
  entry.node.replaceWith(node);
  entry.node = node;
  entry.key = eventNodeKey(approval, null, renderState.approvalResults);
}
function finalizeRunRendering() {
  for (const card of renderState.pendingToolCards)
    if (card.indicator?.isConnected) setToolIndicator(card.indicator, "idle");
  renderState.pendingToolCards.clear();
  if (
    renderState.latestThinkingNode?.isConnected &&
    localBoolean("showThinking", false)
  )
    renderState.latestThinkingNode.open = true;
  renderApprovalDock();
  syncLive();
  syncRunState();
}
function applyStreamEvent(event) {
  if (event.type === "done") {
    state.running = false;
    state.liveText = "";
    state.liveThinking = "";
    state.source?.close();
    finalizeRunRendering();
    action(async () => {
      await refreshState();
      await refreshWorkspace();
    })();
    return;
  }
  const isNew = !seenEventIds.has(event.id);
  if (isNew) {
    seenEventIds.add(event.id);
    state.events.push(event);
    if (event.type === "approval")
      renderState.approvalEvents.set(event.requestId, event);
    if (event.type === "approval_result")
      renderState.approvalResults.set(event.requestId, event);
    // CCDPH-FIX(L-06): 只保留最近若干张图片的 base64 预览（仅带图事件才需要扫描）
    if (Array.isArray(event.images) && event.images.length) trimRetainedImages();
    if (state.events.length > EVENTS_MAX) {
      const dropped = state.events.splice(0, state.events.length - EVENTS_MAX);
      for (const item of dropped) {
        const entry = renderedEventNodes.get(item.id);
        if (entry) {
          entry.node.remove();
          renderedEventNodes.delete(item.id);
        }
        if (item.type === "tool" && item.toolId) {
          const card = renderState.toolCards.get(item.toolId);
          if (card) renderState.pendingToolCards.delete(card);
          renderState.toolCards.delete(item.toolId);
        }
        if (item.type === "approval")
          renderState.approvalEvents.delete(item.requestId);
        if (item.type === "approval_result")
          renderState.approvalResults.delete(item.requestId);
      }
      seenEventIds = new Set(state.events.map((item) => item.id));
      state.historyTruncated = true;
    }
  }
  if (event.type === "tool_result") {
    if (!isNew) return;
    const card = renderState.toolCards.get(event.toolId);
    if (!card) return scheduleMessageReconcile();
    renderState.pendingToolCards.delete(card);
    setToolIndicator(card.indicator, event.error ? "error" : "ok");
    card.detail.append(el("pre", "", event.text));
    return;
  }
  if (event.type === "approval") {
    if (!isNew) return;
    appendEventNode(event); // 添加不可见锚点，解决时可定点替换
    renderApprovalDock();
    if (renderState.workingNode?.isConnected)
      renderState.workingNode.textContent = workingLabel();
    return;
  }
  if (event.type === "approval_result") {
    if (!isNew) return;
    renderApprovalDock();
    refreshResolvedApproval(event.requestId);
    return;
  }
  if (event.type === "usage") {
    if (isNew) state.usage = event.usage;
    return;
  }
  if (!isNew) return;
  if (event.type === "text") state.liveText = "";
  if (event.type === "thinking") state.liveThinking = "";
  appendEventNode(event);
  syncLive();
}

function assistantMessage(text, live = false) {
  const wrap = el(
    "section",
    `message assistant${live ? " live-response" : ""}`,
  );
  const label = el("div", "assistant-label");
  label.append(
    el("span", "", "C"),
    el("b", "", "Claude Code"),
  );
  const content = el("div", "markdown");
  // CCDPH-FIX(L-07): live（流式）文本每次都是更长的前缀，缓存永远不会命中，
  // 只会把 400 条大 HTML 留在堆里 —— 流式渲染不再写缓存。
  content.innerHTML = markdown(text, !live);
  // 流式渲染阶段跳过高亮（长回复下每次全量 highlight 很贵），结束后整段重渲
  if (!live) highlightCode(content);
  for (const link of content.querySelectorAll("a")) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  for (const pre of [...content.querySelectorAll("pre")]) {
    const code = pre.querySelector("code");
    const language = [...(code?.classList || [])]
      .find((name) => name.startsWith("language-"))
      ?.slice("language-".length);
    const frame = el("div", "code-frame");
    const toolbar = el("div", "code-toolbar");
    const copy = el("button", "code-copy", "复制");
    copy.type = "button";
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(
          code?.textContent || pre.textContent || "",
        );
        copy.textContent = "已复制";
        setTimeout(() => {
          if (copy.isConnected) copy.textContent = "复制";
        }, 1600);
      } catch {
        toast("复制失败，请手动选择代码");
      }
    };
    toolbar.append(el("span", "code-language", language || "代码"), copy);
    pre.replaceWith(frame);
    frame.append(toolbar, pre);
  }
  wrap.append(label, content);
  return wrap;
}
function renderMessages() {
  messagesCurrencySymbol = activeCurrencySymbol();
  const scroll = $("#chat-scroll"),
    nearBottom =
      scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 150;
  const messages = $("#messages");
  renderState.toolCards.clear();
  renderState.pendingToolCards.clear();
  renderState.approvalEvents.clear();
  renderState.approvalResults.clear();
  renderState.liveNode = null;
  renderState.workingNode = null;
  renderState.latestThinkingNode = null;
  renderState.liveRenderedText = "";
  const opened = new Set(
    $$("#messages details[open]").map((node) => node.dataset.eventId),
  );
  const typed = new Map(
    $$(".approval input").map((node) => [node.dataset.key, node.value]),
  );
  $("#welcome").classList.toggle(
    "hidden",
    state.events.length > 0 || state.liveText,
  );
  const results = new Map();
  for (const event of state.events) {
    if (event.type === "tool_result") results.set(event.toolId, event);
    if (event.type === "approval")
      renderState.approvalEvents.set(event.requestId, event);
    if (event.type === "approval_result")
      renderState.approvalResults.set(event.requestId, event);
  }
  const approvals = renderState.approvalResults;
  renderApprovalDock();
  const renderEvents = state.events.slice(-RENDERED_EVENTS_MAX);
  // CCDPH-FIX(FE-01): 增量渲染。cursor 之前的节点已经就位，cursor 指向「下一个期望位置」，
  // 循环结束后 cursor 之后的一切（消失的事件、上一轮的 live/working 节点）都是残留，删掉。
  const context = { results, approvals, typed, opened };
  const kept = new Set();
  let cursor = messages.firstChild;
  const place = (node) => {
    if (cursor === node) cursor = node.nextSibling;
    else messages.insertBefore(node, cursor);
  };
  // CCDPH-FIX(F15): 事件被历史上限丢弃时在列表顶部给出提示（底层会话仍完整）
  if (state.historyTruncated && state.events.length) place(truncationNotice());
  if (state.events.length > renderEvents.length)
    place(renderWindowNotice(state.events.length - renderEvents.length));
  for (const event of renderEvents) {
    // D-02 修复：单条事件渲染失败（如异常 markdown 触发的栈溢出）不再瘫痪整个会话。
    // 捕获后给出可见提示并继续渲染其余事件，保证会话其余部分仍可读。
    let node = null;
    try {
      const key = eventNodeKey(event, results, approvals);
      const id = typeof event.id === "string" && event.id ? event.id : null;
      const entry = id ? renderedEventNodes.get(id) : null;
      if (entry && entry.key === key) {
        node = entry.node;
        if (event.type === "thinking") renderState.latestThinkingNode = node;
        // 复用的工具卡要重新登记，tool_result 才能继续走"就地更新"分支
        if (entry.card) {
          renderState.toolCards.set(event.toolId, entry.card);
          if (!results.has(event.toolId))
            renderState.pendingToolCards.add(entry.card);
        }
      } else {
        node = renderEventNode(event, context);
        if (!node && event.type === "approval")
          node = document.createComment(`approval:${event.requestId || event.id}`);
        if (node && id)
          renderedEventNodes.set(id, {
            node,
            key,
            card:
              event.type === "tool" && event.toolId
                ? renderState.toolCards.get(event.toolId)
                : null,
          });
      }
    } catch (error) {
      console.error("会话消息渲染失败", event, error);
      node = el(
        "div",
        "error-message",
        `本条消息渲染失败（${error?.message || error}）`,
      );
    }
    if (!node) continue;
    kept.add(event.id);
    place(node);
  }
  while (cursor) {
    const next = cursor.nextSibling;
    cursor.remove();
    cursor = next;
  }
  // 被 EVENTS_MAX 淘汰或换会话后，缓存里不能再留着旧节点引用（Map 迭代中删除是安全的）
  for (const id of renderedEventNodes.keys())
    if (!kept.has(id)) renderedEventNodes.delete(id);
  syncLive();
  syncRunState();
  if (nearBottom) scroll.scrollTop = scroll.scrollHeight;
}
function renderApproval(event, resolved, typed) {
  const card = el("div", "approval");
  const heading = el("h3");
  if (resolved?.allowed) heading.append(ic("check"), document.createTextNode(" 已批准"));
  else heading.textContent = resolved ? "已拒绝" : state.running ? "Claude 需要确认" : "确认已失效";
  card.append(heading, el("b", "", event.tool));
  const isQuestion = event.tool === "AskUserQuestion";
  if (isQuestion && !resolved && state.running) {
    for (const [index, question] of (event.input?.questions || []).entries()) {
      card.append(el("label", "", question.question));
      if (question.options?.length)
        card.append(
          el(
            "small",
            "",
            question.options.map((option) => option.label).join(" / "),
          ),
        );
      const input = el("input");
      input.dataset.question = question.question;
      input.dataset.key = `${event.requestId}:${index}`;
      input.value = typed.get(input.dataset.key) || "";
      input.placeholder = "输入回答";
      card.append(input);
    }
  } else card.append(el("pre", "", truncateForDisplay(JSON.stringify(event.input, null, 2))));
  if (!resolved && state.running) {
    const actions = el("div", "approval-actions");
    for (const allow of [false, true]) {
      const button = el(
        "button",
        allow ? "allow" : "",
        allow
          ? isQuestion
            ? "提交回答"
            : "批准本次"
          : "拒绝",
      );
      button.onclick = action(async () => {
        const fields = [...card.querySelectorAll("input")];
        if (allow && fields.some((field) => !field.value.trim()))
          return toast("请回答所有问题");
        button.disabled = true;
        try {
          await api("approve", {
            sessionId: state.sessionId,
            requestId: event.requestId,
            allow,
            answers: Object.fromEntries(
              fields.map((field) => [field.dataset.question, field.value]),
            ),
          });
          window.workbenchDesktop?.approvalResolved(event.requestId);
        } finally {
          button.disabled = false;
        }
      });
      actions.append(button);
    }
    card.append(actions);
  }
  return card;
}

async function refreshWorkspace(revision = navigationRevision) {
  const projectId = state.projectId;
  if (!projectId) {
    state.projectInfo = null;
    renderHeader();
    renderFiles([]);
    renderChanges({ files: [] });
    return;
  }
  const query = workspaceQuery();
  const [info, files] = await Promise.all([
    api("project-info?" + query),
    state.panel === "files" && !$("#file-search").value.trim()
      ? api(`files?${query}&path=${encodeURIComponent(state.folder)}`)
      : Promise.resolve(null),
  ]);
  if (revision !== navigationRevision || projectId !== state.projectId) return;
  state.projectInfo = info;
  renderHeader();
  renderSettingsDiagnostics();
  renderChanges(info);
  if (files)
    renderFiles(
      Array.isArray(files) ? files : files.files || [],
      false,
      Array.isArray(files) ? "" : files.truncationReason || "",
    );
  if (state.panel === "files" && $("#file-search").value.trim())
    await searchFiles();
}
function renderFiles(files, searching = false, truncationReason = "") {
  const list = $("#file-list");
  list.replaceChildren();
  if (!activeProject())
    return list.append(el("div", "empty-panel", "添加项目后浏览文件"));
  if (truncationReason)
    list.append(el("div", "result-line", truncationReason));
  if (!searching && state.folder) {
    const back = el("button", "file-back", `← ${state.folder}`);
    back.onclick = action(async () => {
      state.folder = state.folder.split("/").slice(0, -1).join("/");
      await refreshWorkspace();
    });
    list.append(back);
  }
  if (!files.length)
    list.append(
      el("div", "empty-panel", searching ? "没有匹配的文件" : "这个文件夹为空"),
    );
  for (const file of files) {
    const item =
      typeof file === "string"
        ? { path: file, name: file, directory: false }
        : file;
    const button = el("button", "file-row");
    button.title = item.directory ? item.path : `${item.path}\n双击加入上下文`;
    button.append(
      item.directory
        ? ic("folder", "file-kind")
        : ic(fileIcon(item.name), "file-kind"),
      el("span", "", searching ? item.path : item.name),
    );
    button.onclick = action(async () => {
      if (item.directory) {
        state.folder = item.path;
        await refreshWorkspace();
      } else await previewFile(item.path, false);
    });
    button.ondblclick = (event) => {
      if (!item.directory) {
        event.preventDefault();
        addContextFile(item.path);
      }
    };
    list.append(button);
  }
}
function fileIcon(name) {
  const ext = name.split(".").pop().toLowerCase();
  return [
    "js",
    "ts",
    "jsx",
    "tsx",
    "c",
    "cpp",
    "h",
    "py",
    "rs",
    "go",
    "java",
  ].includes(ext)
    ? "file-code"
    : ["md", "txt", "json", "yaml", "yml", "toml"].includes(ext)
      ? "file-text"
      : "file";
}
function renderChanges(info = { files: [] }) {
  $("#change-count").textContent = info.files?.length || 0;
  const summary = $("#change-summary");
  summary.replaceChildren(
    el("span", "", `${info.files?.length || 0} 个文件`),
    el("span", "additions", `+${info.additions || 0}`),
    el("span", "deletions", `−${info.deletions || 0}`),
  );
  const list = $("#change-list");
  list.replaceChildren();
  if (info.notGit || info.git === false)
    return list.append(el("div", "empty-panel", "这个工作区不是 Git 仓库"));
  if (!info.files?.length)
    return list.append(el("div", "empty-panel", "工作区干净，没有修改"));
  for (const file of info.files) {
    const button = el("button", "file-row");
    button.title = file.path;
    button.append(
      el("span", "status", file.status.trim() || "M"),
      el("span", "", file.path),
    );
    button.onclick = action(() => previewFile(file.path, true));
    list.append(button);
  }
}
async function searchFiles() {
  const query = $("#file-search").value.trim();
  if (!query) return refreshWorkspace();
  const projectId = state.projectId;
  const result = await api(
    `search-files?${workspaceQuery()}&q=${encodeURIComponent(query)}`,
  );
  if (projectId === state.projectId && query === $("#file-search").value.trim())
    renderFiles(result.files, true, result.truncationReason || "");
}
function addContextFile(file) {
  if (!state.contextFiles.includes(file)) state.contextFiles.push(file);
  renderContext();
  toast(`已添加 ${file}`);
}
// CCDPH-FIX(R3-P3-7): 拼 data: URL 前对 image.type 做白名单。服务端在 /api/send 已经限制
// `^image/(png|jpeg|gif|webp)$`（server.mjs:5045），但**渲染路径读的是持久化历史**里的值 ——
// 直接改 state.json 就能塞进任意 type。`<img>` 本身不执行脚本，此改动是把口径补齐，
// 并避免畸形 type 被拼成奇怪的数据 URL。
const IMAGE_PREVIEW_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
function imagePreviewUrl(image) {
  const type = typeof image?.type === "string" ? image.type.trim().toLowerCase() : "";
  const preview = typeof image?.preview === "string" ? image.preview : "";
  if (!preview || !IMAGE_PREVIEW_TYPES.has(type)) return "";
  return `data:${type};base64,${preview}`;
}
function renderContext() {
  const wrap = $("#context-chips");
  wrap.replaceChildren();
  for (const file of state.contextFiles) {
    const chip = el("div", "context-chip");
    chip.append(ic("at-sign"), el("span", "", file));
    const remove = el("button");
    remove.append(ic("x"));
    remove.onclick = () => {
      state.contextFiles = state.contextFiles.filter((item) => item !== file);
      renderContext();
    };
    chip.append(remove);
    wrap.append(chip);
  }
  for (const image of state.images) {
    const chip = el("div", "context-chip image-chip");
    const previewUrl = imagePreviewUrl(image);
    if (previewUrl) {
      const thumb = document.createElement("img");
      thumb.src = previewUrl;
      thumb.alt = image.name;
      chip.append(thumb);
    }
    chip.append(ic("image"), el("span", "", image.name));
    const remove = el("button");
    remove.append(ic("x"));
    remove.onclick = () => {
      state.images = state.images.filter((item) => item !== image);
      renderContext();
    };
    chip.append(remove);
    wrap.append(chip);
  }
}

function userMessage(event) {
  const message = el("div", "message user");
  message.append(el("div", "user-text", event.text));
  if (Array.isArray(event.images) && event.images.length) {
    const attachments = el("div", "user-images");
    for (const image of event.images) {
      const url = imagePreviewUrl(image);
      if (!url) {
        // CCDPH-FIX(L-06): 旧事件的 base64 预览已被释放（见 trimRetainedImages），
        // 保留文件名占位，不让用户以为附件凭空消失了。
        // CCDPH-FIX(R3-P3-7): type 不在白名单时同样走占位（而不是拼出畸形 data: URL）。
        attachments.append(
          el(
            "small",
            "",
            `${image.name || "图片"}（${image.preview ? "预览不可用" : "预览已释放"}）`,
          ),
        );
        continue;
      }
      const figure = el("figure", "user-image");
      const img = document.createElement("img");
      img.src = url;
      img.alt = image.name || "附加图片";
      figure.append(img, el("figcaption", "", image.name || "图片"));
      attachments.append(figure);
    }
    if (attachments.childElementCount) message.append(attachments);
  }
  return message;
}

function renderUsage() {
  syncResultCurrencySymbol();
  const target = $("#usage-status");
  if (!target) return;
  renderSettingsDiagnostics();
  const providerUsage = state.providerUsage;
  if (providerUsage?.balances?.length) {
    const values = providerUsage.balances
      .filter((item) => typeof item.remaining === "number")
      .map((item) => `${item.unit} ${item.remaining.toFixed(2)}`);
    target.textContent = `${providerUsage.providerName || "供应商"} · ${values.join(" · ")}`;
    target.title = `余额更新时间：${new Date(providerUsage.updatedAt || Date.now()).toLocaleString()}`;
    return;
  }
  if (providerUsage && providerUsage.available === false) {
    // CCDPH-FIX(P3-33): 区分"查询失败"与"服务商确实没有余额接口" —— 原来失败被写成
    // 确定态（"余额不可用"），用户无从判断该重试还是该放弃。
    const failed = providerUsage.reason === "request-failed";
    target.textContent = `${providerUsage.providerName || "当前服务商"} · ${failed ? "余额查询失败" : "余额不可用"}`;
    target.title = failed
      ? "未能从当前服务商取到余额（网络或接口错误）；可点左下角额度重试"
      : "CC Switch 当前供应商未返回可读取的余额";
    return;
  }
  const usage = state.usage;
  if (!usage) {
    target.textContent = "额度：由服务商管理";
    target.title = "CC Switch / API 代理通常不会提供剩余额度接口";
    return;
  }
  if (usage.available === false) {
    target.textContent = "额度：当前服务商未提供";
    target.title = "CC Switch / API 代理未提供剩余额度接口";
    return;
  }
  const limit = usage.rate_limits?.five_hour;
  if (usage.rate_limits_available && typeof limit?.utilization === "number") {
    const remaining = Math.max(0, 100 - limit.utilization);
    target.textContent = `计划额度剩余 ${remaining.toFixed(0)}% `;
    target.title = limit.resets_at
      ? `五小时窗口重置：${new Date(limit.resets_at).toLocaleString()}`
      : "";
    return;
  }
  // Claude 的成本字段是 total_cost_usd（美元），DS 的成本字段是 total_cost_cny（人民币），显示时都要兼容。
  const cost = usage.session?.total_cost_usd ?? usage.session?.total_cost_cny;
  // 成本按当前生效货币显示；未知货币不强加符号
  const symbol = activeCurrencySymbol();
  target.textContent =
    typeof cost === "number"
      ? `本轮等值 ${symbol}${cost.toFixed(4)} · 额度由服务商管理`
      : "额度由 CC Switch / 服务商管理";
  target.title = "API Key、CC Switch 或第三方代理通常不会提供剩余额度接口";
}

async function readImage(file) {
  const data = await new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type))
      return reject(new Error("仅支持 PNG、JPEG、GIF 或 WebP 图片"));
    if (file.size > 8 * 1024 * 1024)
      return reject(new Error("单张图片不能超过 8 MB"));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
  const preview = await createImagePreview(data, file.type);
  return {
    name: file.name || "粘贴图片",
    type: file.type,
    data,
    preview,
    bytes: file.size,
  };
}
function createImagePreview(data, type) {
  return new Promise((resolve) => {
    const image = new Image();
    // CCDPH-FIX(AUDIT-8): 下面 onload 的函数体是在 Promise 执行器之外运行的，里面抛出的异常
    // 不会 reject 这个 Promise —— getContext("2d") 返回 null（上下文丢失 / 分配失败，规范允许）
    // 时 `.drawImage` 抛 TypeError，调用方的 await 永远不返回、addImages 的 finally 永不执行，
    // imagesInFlight 减少不了，此后 4 张图片的额度被永久占用（界面上 0 张图也提示「最多同时添加
    // 4 张图片」）。这里整体包 try/catch，任何失败都按"无预览"settle。
    // 另外补一个兜底超时：onload/onerror 都不回调时（异常图片解码路径）也保证 settle 一次。
    const finish = (value) => {
      clearTimeout(settleTimer);
      resolve(value);
    };
    const settleTimer = setTimeout(() => finish(""), 10000);
    image.onload = () => {
      try {
        const scale = Math.min(
          1,
          240 / Math.max(image.naturalWidth, image.naturalHeight),
        );
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas
          .getContext("2d")
          .drawImage(image, 0, 0, canvas.width, canvas.height);
        finish(
          canvas
            .toDataURL(type === "image/png" ? "image/png" : "image/jpeg", 0.76)
            .split(",", 2)[1] || "",
        );
      } catch (error) {
        console.error("图片预览生成失败", error);
        finish("");
      }
    };
    image.onerror = () => finish("");
    image.src = `data:${type};base64,${data}`;
  });
}
// 正在读取中的图片数量：参与 4 张上限计算，避免粘贴/拖拽/选择快速连点越界
let imagesInFlight = 0;
const IMAGE_BATCH_MAX_BYTES = 12 * 1024 * 1024;
const imageBytes = (image) =>
  Number(image?.bytes) || Math.floor(String(image?.data || "").length * 0.75);
async function addImages(files) {
  const available = 4 - state.images.length - imagesInFlight;
  if (available <= 0) return toast("最多同时添加 4 张图片");
  const batch = [...files].slice(0, available);
  const pendingBytes = batch.reduce((sum, file) => sum + (Number(file?.size) || 0), 0);
  const retainedBytes = state.images.reduce((sum, image) => sum + imageBytes(image), 0);
  if (retainedBytes + pendingBytes > IMAGE_BATCH_MAX_BYTES)
    return toast("图片总大小不能超过 12 MB（单张仍不能超过 8 MB）");
  imagesInFlight += batch.length;
  try {
    const settled = await Promise.allSettled(batch.map((file) => readImage(file)));
    const images = settled
      .filter((item) => item.status === "fulfilled")
      .map((item) => item.value);
    const failures = settled.filter((item) => item.status === "rejected");
    state.images.push(...images);
    renderContext();
    if (images.length)
      toast(`已添加 ${images.length} 张图片，Claude 可直接识别`);
    if (failures.length)
      toast(
        `${failures.length} 张图片添加失败：${failures[0].reason?.message || failures[0].reason}`,
      );
  } finally {
    imagesInFlight -= batch.length;
  }
}

async function previewFile(file, diff) {
  const revision = ++previewRevision;
  const result = await api(
    `${diff ? "diff" : "file"}?${workspaceQuery()}&path=${encodeURIComponent(file)}`,
  );
  // CCDPH-FIX(D2): 连续点两个文件时后到的响应可能属于先发的请求，会把新预览覆盖成旧内容
  if (revision !== previewRevision) return;
  state.previewPath = file;
  state.previewIsDiff = diff;
  $("#preview-title").textContent = file;
  $("#preview-meta").textContent = diff ? "工作区修改" : "只读预览";
  const content = $("#preview-content");
  content.replaceChildren();
  if (diff) {
    const diffLines = result.text.split("\n");
    const DIFF_PREVIEW_LIMIT = 4000;
    const visibleLines = diffLines.slice(0, DIFF_PREVIEW_LIMIT);
    for (const line of visibleLines)
      content.append(
        el(
          "span",
          line.startsWith("@@") || line.startsWith("diff ")
            ? "diff-header"
            : line.startsWith("+")
              ? "diff-add"
              : line.startsWith("-")
                ? "diff-remove"
                : "diff-context",
          line || " ",
        ),
      );
    if (diffLines.length > visibleLines.length)
      content.append(
        el(
          "span",
          "diff-header",
          `… 其余 ${diffLines.length - visibleLines.length} 行已省略（在编辑器中查看完整差异）`,
        ),
      );
  }
  else content.textContent = result.text;
  $("#diff-feedback").classList.toggle("hidden", !diff);
  openDialog("#preview-dialog");
}

function setPanel(panel) {
  state.panel = panel;
  for (const button of $$(".panel-tab"))
    button.classList.toggle("active", button.dataset.panel === panel);
  $("#file-list").classList.toggle("hidden", panel !== "files");
  $("#changes-panel").classList.toggle("hidden", panel !== "changes");
  $("#terminal-panel").classList.toggle("hidden", panel !== "terminal");
  $("#file-tools").classList.toggle("hidden", panel !== "files");
  // CCDPH-FIX(L-04): 面板刚变可见时补一次渲染 —— 隐藏期间 renderTerminal() 不再喂 xterm，
  // 累积的输出需要在可见时 flush（startTerminal 完成前也能立刻看到已有内容）
  if (panel === "terminal") renderTerminal();
  // CCDPH-FIX(AUDIT-7): 原来只要 panel 变成 terminal 就无条件 startTerminal()，而它是「先 stop
  // 再 start」—— 面板已经激活时再点一次「终端」标签（或工具栏 打开终端、命令面板里的同一项）
  // 会把正在跑的 shell 连同 cwd、导出的环境变量、后台任务、滚动历史一起杀掉；服务端本来会按
  // root 复用同一个 shell，这个 stop 才是破坏它的那一步。只有当前没有活终端时才启动。
  if (panel === "terminal") {
    if (!state.terminalId || state.terminalExited) action(startTerminal)();
  } else action(refreshWorkspace)();
}
// CCDPH-FIX(L-02): 只加在途保护，不改动原有的启动顺序（旧终端的处理见 startTerminalOnce，
// 现在只在 force=true 时才会 stop）。
// 实测连点 5 次不会产生孤儿终端（服务端按 root 复用并封顶 8，旧的都被正确回收），
// 只有两次调用在 state.terminalId 写回前交错时才会漏掉一个 —— 这里把并发调用折叠成一次。
let terminalStartPromise = null;
const termLimit = () =>
  Math.max(50000, Number(state.settings?.terminalOutputLimit) || 200000);
function setTerminalOutput(value) {
  const text = clipTail(String(value || ""), termLimit());
  state.terminalOutputChunks = text ? [text] : [];
  state.terminalOutputChars = text.length;
}
function appendTerminalOutput(value) {
  const text = String(value || "");
  const limit = termLimit();
  if (text.length >= limit) return setTerminalOutput(text);
  const chunks = state.terminalOutputChunks;
  const last = chunks[chunks.length - 1];
  if (last && last.length + text.length <= 8192) chunks[chunks.length - 1] = last + text;
  else if (text) chunks.push(text);
  state.terminalOutputChars += text.length;
  while (state.terminalOutputChars > limit && chunks.length) {
    const excess = state.terminalOutputChars - limit;
    const first = chunks[0];
    if (first.length <= excess) {
      chunks.shift();
      state.terminalOutputChars -= first.length;
    } else {
      chunks[0] = first.slice(excess);
      state.terminalOutputChars -= excess;
    }
  }
}
const terminalOutputText = () => state.terminalOutputChunks.join("");
function startTerminal(force = false) {
  if (terminalStartPromise) return terminalStartPromise;
  terminalStartPromise = startTerminalOnce(force).finally(() => {
    terminalStartPromise = null;
  });
  return terminalStartPromise;
}
// CCDPH-FIX(R3-P2-3): 代际保护。startTerminalOnce 里 `await api("terminal/start")` 是一次网络
// 往返（服务端还要真正拉起 shell），期间用户完全可能切项目/切会话。旧实现 await 之后无条件写
// state.terminalId / terminalRoot，于是**上一个项目**的终端被绑到新视图上：面板显示 A 的 shell
// 输出、标题却是 B 的路径，而且 setPanel 因 terminalId 非空不再为 B 启动终端，服务端 A 的 PTY
// 也一直留着。这里在 await 前后比对导航代数，发现被取代就丢弃响应并显式停掉刚拉起的终端。
async function startTerminalOnce(force = false) {
  if (!activeProject()) return toast("请先添加项目");
  // CCDPH-FIX(AUDIT-7): force 原先是个从未使用的参数 —— 「重启终端」(force=true) 与
  // 打开面板 / 刷新面板 / 提交命令时的启动 (force=false) 走的是同一段「先 stop 再 start」，
  // 于是连"只是想拿到终端"的路径也会杀掉用户的 shell。现在只有明确要求重启时才停旧终端；
  // force=false 时服务端会按 root 复用已有 shell（含其输出缓冲），行为等同重连。
  if (force && state.terminalId && !state.terminalExited)
    await api("terminal/stop", { id: state.terminalId });
  const revision = navigationRevision;
  const requestedRoot = state.projectInfo?.root || "";
  const terminal = await api("terminal/start", {
    projectId: state.projectId,
    sessionId: state.sessionId,
  });
  if (revision !== navigationRevision) {
    // 用户已经导航走了：绝不能把这个终端写进新视图。
    await api("terminal/stop", { id: terminal.id }).catch(() => { });
    console.info("[ccdph] 终端启动期间发生了导航，已丢弃该终端并停止它");
    return terminal;
  }
  disconnectTerminalStream();
  state.terminalId = terminal.id;
  setTerminalOutput(terminal.output || "");
  state.terminalExited = terminal.exited;
  // CCDPH-FIX(F16): 流式输出分支原本硬编码 -200000，导致「终端输出上限」设置
  // 在会话进行中不生效（只有重连时的 snapshot 才按服务端设置截断）。改为读设置值。
  // CCDPH-FIX(R3-P2-3): terminalRoot 取**请求时**的项目 root，而不是重新读 state.projectInfo ——
  // 后者在 await 期间也可能已经变了。
  state.terminalRoot = requestedRoot;
  setupTerminalView();
  if (!terminal.exited) {
    try {
      await ensureSessionAuth();
    } catch (error) {
      console.error("终端流鉴权初始化失败", error);
      toast("终端已启动，但实时输出连接暂不可用，请稍后重新打开终端面板");
      return terminal;
    }
    const source = new EventSource(
      `/api/terminal/events?id=${encodeURIComponent(terminal.id)}`,
    );
    state.terminalSource = source;
    source.onmessage = (message) => {
      // CCDPH-FIX(L-01): 代际保护 —— 被取代的终端流绝不能再往面板/state 里写
      if (state.terminalSource !== source) return source.close();
      let event;
      try {
        if (message.data.length > SSE_FRAME_CHARS)
          throw new Error("终端 SSE 消息过大，已丢弃");
        event = JSON.parse(message.data);
      } catch (parseError) {
        console.error("终端事件解析失败", parseError);
        return;
      }
      if (event.type === "snapshot") {
        setTerminalOutput(event.text || "");
        state.terminalExited = event.exited;
        resetTerminalView();
        if (event.exited) disconnectTerminalStream();
      } else if (event.type === "output") {
        // CCDPH-FIX(L-03): 原来这里判断 `before + text.length > termLimit()` 就
        // resetTerminalView() —— 但窗口一旦到达上限，该条件对**每一条** chunk 都成立
        // （limit + len > limit 恒真），于是每个几十字节的输出都要 term.reset() 并重写
        // 整个 200KB 窗口（写入放大约 5000×）。现在只累积增量，由 feedTerminalView()
        // 增量写 xterm，裁剪交给 xterm 自己的 scrollback。
        state.terminalChunk = (state.terminalChunk || "") + event.text;
        appendTerminalOutput(event.text);
        // 面板隐藏期间增量不会被消费，不能让它无限增长：超过一个窗口就把增量丢掉，
        // 标记为「未附加」，下次可见时整窗重写一次（见 feedTerminalView）。
        if (state.terminalChunk.length > TERMINAL_CHUNK_MAX) {
          state.terminalChunk = "";
          state.terminalFed = 0;
        }
      }
      else if (event.type === "exit") {
        state.terminalExited = true;
        disconnectTerminalStream();
      }
      renderTerminal();
    };
    source.onerror = () => {
      // CCDPH-FIX(R2-P2-7): 这里主动 close 掉 EventSource（= 放弃浏览器自动重连），但原来
      // 只在 `state.terminalSource === source` 时调 disconnectTerminalStream()，而该函数
      // 在 `if (!reset) return;` 处提前返回 —— terminalId / terminalExited 原样保留。
      // 结果：xterm 面板继续显示"活的"提示符、设置区显示「运行中」，却**再也不会写入任何
      // 输出**；按键被静默丢弃（term.onData 的请求错误被 .catch(()=>{}) 吞掉），重新选中
      // 终端页签也不会重启（setPanel 仅在 !terminalId || terminalExited 时才启动）。
      // 会话流有 reconcileSessionState() + toast 兜底，终端流此前完全没有。
      if (state.terminalSource !== source) {
        source.close();
        return;
      }
      disconnectTerminalStream();
      state.terminalExited = true;
      const notice = "\r\n[终端连接已中断，点击「终端」页签可重新连接]\r\n";
      state.terminalChunk = (state.terminalChunk || "") + notice;
      appendTerminalOutput(notice);
      renderTerminal();
      renderSettingsDiagnostics();
      toast("终端连接已中断，点击「终端」页签可重新连接");
    };
  }
  renderTerminal();
}
// ===== xterm 终端视图（保留纯文本回退）=====
let terminalView = null;
// 隐藏期间累积但尚未写进 xterm 的增量上限（约一个输出窗口）
const TERMINAL_CHUNK_MAX = 200000;
function xtermTheme() {
  return {
    background: "#151515",
    foreground: "#e5e5e5",
    cursor: "#e5e5e5",
    cursorAccent: "#151515",
    selectionBackground: "rgba(255, 255, 255, 0.25)",
  };
}
function ensureTerminalView() {
  if (terminalView || !window.Terminal || !window.FitAddon) return terminalView;
  const container = $("#terminal-xterm");
  const term = new window.Terminal({
    fontFamily:
      "'Cascadia Mono', Consolas, 'SFMono-Regular', ui-monospace, monospace",
    fontSize: 12,
    lineHeight: 1.25,
    cursorBlink: true,
    scrollback: 5000,
    theme: xtermTheme(),
  });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(container);
  term.onData((data) => {
    if (state.terminalId && !state.terminalExited)
      api("terminal/input", { id: state.terminalId, text: data }).catch(
        () => { },
      );
  });
  const resizeObserver = new ResizeObserver(() => {
    try {
      fit.fit();
    } catch { }
  });
  resizeObserver.observe(container);
  terminalView = { term, fit, container, resizeObserver };
  return terminalView;
}
function setupTerminalView() {
  const panel = $("#terminal-panel");
  const view = ensureTerminalView();
  if (view) {
    panel.classList.add("xterm-mode");
    view.container.classList.remove("hidden");
    $("#terminal-output").classList.add("hidden");
    state.terminalFed = 0;
    state.terminalChunk = "";
    try {
      view.fit.fit();
    } catch { }
  } else {
    panel.classList.remove("xterm-mode");
    $("#terminal-output").classList.remove("hidden");
  }
}
function resetTerminalView() {
  if (!terminalView) return;
  terminalView.term.reset();
  state.terminalFed = 0;
  state.terminalChunk = "";
}
// CCDPH-FIX(L-03): state.terminalFed 不再是「滑动窗口内的偏移」，而是「xterm 是否已经
// 附加过当前终端」的标记（0 = 尚未附加，需要整窗重写一次）；稳态路径只写新到的增量
// （state.terminalChunk），因此每个 chunk 的代价与 chunk 本身成正比，永不重写整窗。
function feedTerminalView() {
  if (!terminalView) return;
  const output = terminalOutputText();
  if (!state.terminalFed) {
    terminalView.term.reset();
    terminalView.term.write(output);
    state.terminalFed = 1;
    state.terminalChunk = "";
    return;
  }
  const chunk = state.terminalChunk || "";
  if (!chunk) return;
  state.terminalChunk = "";
  terminalView.term.write(chunk);
}
// CCDPH-FIX(AUDIT-6): 切换项目 / 切换会话 / 新建任务原先只关掉前端 SSE 就丢掉 terminalId，
// 从不通知服务端 —— PTY（Windows 上还有 conhost）会一直活到服务端保留期到期（terminalRetention
// 默认 5 分钟），而 id 已经清掉、界面上再没有入口能停它（terminal/stop 全文件只有 startTerminal
// 和 teardownActiveSession 两处调用）。服务端 terminals 上限 8，反复切换能同时钉住好几个 shell。
// 这里在丢弃 id 之前补一次停止请求：故意不 await（newSession 本身是同步函数），
// 避免导航被一次网络往返（api 最长 30s 超时）拖住。
function stopOrphanedTerminal() {
  const id = state.terminalId;
  if (!id || state.terminalExited) return;
  void api("terminal/stop", { id }).catch(() => { });
}
function disconnectTerminalStream(reset = false) {
  state.terminalSource?.close();
  state.terminalSource = null;
  if (!reset) return;
  state.terminalId = null;
  state.terminalRoot = null;
  setTerminalOutput("");
  state.terminalExited = true;
  state.terminalFed = 0;
  state.terminalChunk = "";
}
function renderTerminal() {
  $("#terminal-cwd").textContent =
    state.terminalRoot || state.projectInfo?.root || "本地终端";
  // CCDPH-FIX(L-04): 面板不可见 / 窗口最小化时不再做 xterm 解析与渲染（实测：最小化
  // 一整天仍在全速烧 CPU）。输出仍累积在 state.terminalOutput / terminalChunk 里，
  // 重新可见时由 renderTerminal() 或 setPanel("terminal") 一次性 flush。
  if (document.hidden || state.panel !== "terminal") return;
  feedTerminalView();
  if (terminalView) return;
  // 纯文本回退模式：增量缓存没有意义，直接丢弃，避免隐藏期间无限增长
  state.terminalChunk = "";
  const output = $("#terminal-output");
  output.textContent = stripAnsi(
    terminalOutputText() || (state.terminalExited ? "终端尚未启动" : ""),
  );
  output.scrollTop = output.scrollHeight;
}

function openProjectDialog() {
  openDialog("#project-dialog");
  $("#project-path").focus();
}
function openRename(session = state.activeSession || activeSessionMeta()) {
  if (!session) return;
  $("#rename-input").value = session.title;
  openDialog("#rename-dialog");
  $("#rename-input").select();
}
function setSettingsValue(selector, value) {
  const input = $(selector);
  if (!input) return;
  if (input.type === "checkbox") input.checked = Boolean(value);
  else input.value = String(value ?? "");
}
function fillSettingsControls() {
  const settings = state.settings;
  setSettingsValue("#close-to-tray-setting", settings.closeToTray !== false);
  setSettingsValue(
    "#resource-cleanup-setting",
    settings.resourceCleanup !== false,
  );
  setSettingsValue("#persona-setting", settings.personaId || "default");
  $("#persona-custom").value = settings.personaCustom || "";
  $("#persona-custom-row").classList.toggle(
    "hidden",
    settings.personaId !== "custom",
  );
  setSettingsValue("#language-setting", "zh-CN");
  state.settings.shortcuts = { ...DEFAULT_SHORTCUTS, ...(settings.shortcuts || {}) };
  refreshShortcutButtons();
  setSettingsValue(
    "#restore-session-setting",
    settings.restoreLastSession !== false,
  );
  setSettingsValue("#auto-name-setting", settings.autoNameSessions !== false);
  setSettingsValue("#notifications-setting", settings.notifications !== false);
  setSettingsValue(
    "#notification-sound-setting",
    settings.notificationSound !== false,
  );
  setSettingsValue(
    "#notify-focused-setting",
    settings.notifyWhenFocused === true,
  );
  setSettingsValue(
    "#native-approval-setting",
    settings.nativeApprovalWindow !== false,
  );
  setSettingsValue("#default-model-setting", settings.defaultModel || "");
  setSettingsValue(
    "#default-effort-setting",
    settings.defaultEffort || "inherit",
  );
  setSettingsValue("#max-turns-setting", settings.maxTurns || 0);
  setSettingsValue(
    "#default-permission",
    settings.defaultPermissionMode || "default",
  );
  setSettingsValue(
    "#usage-auto-refresh-setting",
    settings.usageAutoRefresh !== false,
  );
  setSettingsValue("#usage-refresh-setting", settings.usageRefreshMinutes || 1);
  setSettingsValue(
    "#default-environment",
    settings.defaultEnvironment || "local",
  );
  setSettingsValue(
    "#default-environment-secondary",
    settings.defaultEnvironment || "local",
  );
  setSettingsValue(
    "#default-environment-worktree",
    settings.defaultEnvironment || "local",
  );
  setSettingsValue(
    "#claude-executable-setting",
    settings.claudeExecutable || "",
  );
  setSettingsValue(
    "#terminal-shell-setting",
    settings.terminalShell || "system",
  );
  setSettingsValue(
    "#terminal-retention-setting",
    settings.terminalRetentionMinutes || 5,
  );
  setSettingsValue(
    "#terminal-output-setting",
    settings.terminalOutputLimit || 200000,
  );
  setSettingsValue("#history-limit-setting", settings.historyLimit || 2500);
  setSettingsValue("#theme-setting", localStorage.getItem("theme") || "system");
  setSettingsValue("#update-manifest-setting", settings.updateManifestUrl || "");
  setSettingsValue(
    "#auto-update-setting",
    settings.autoCheckUpdates === true,
  );
  setSettingsValue("#api-mode-setting", settings.apiMode || "cc-switch");
  syncApiModeFields();
  setSettingsValue("#font-setting", localStorage.getItem("uiFont") || "system");
  setSettingsValue(
    "#font-size-setting",
    localStorage.getItem("fontSize") || "13",
  );
  setSettingsValue(
    "#density-setting",
    localStorage.getItem("density") || "comfortable",
  );
  setSettingsValue(
    "#reduce-motion-setting",
    localBoolean("reduceMotion", false),
  );
  setSettingsValue(
    "#show-thinking-setting",
    localBoolean("showThinking", false),
  );
  setSettingsValue(
    "#default-inspector-setting",
    localBoolean("defaultInspector", true),
  );
  // 回填浏览器「允许/阻止域名」：保证 saveSettings 提交前输入框已同步服务端值，
  // 避免在没打开浏览器面板时把已保存的名单覆盖成空数组。
  const browserSettings = settings.browser || {};
  setSettingsValue(
    "#browser-allow-origins",
    (browserSettings.allowOrigins || []).join("; "),
  );
  setSettingsValue(
    "#browser-block-origins",
    (browserSettings.blockOrigins || []).join("; "),
  );
}
function setSettingsTab(tab) {
  settingsTab = tab;
  $("#settings-search").value = "";
  $("#settings-no-results").classList.add("hidden");
  for (const row of $$(".settings-panel .setting-row, .settings-explainer"))
    row.classList.remove("settings-search-hidden");
  for (const button of $$("[data-settings-tab]"))
    button.classList.toggle("active", button.dataset.settingsTab === tab);
  for (const panel of $$("[data-settings-panel]"))
    panel.classList.toggle("hidden", panel.dataset.settingsPanel !== tab);
  $(".settings-content").scrollTop = 0;
  if (tab === "usage") void renderUsageChart();
  if (tab === "account")
    void renderProviderSwitcher().then(() => {
      renderAccountProfiles();
      renderAccountIdentity();
    });
  if (tab === "integrations") void renderMcpServers();
  if (tab === "hooks") void renderHooks();
  if (tab === "worktrees") void renderWorktrees();
  if (tab === "git") void renderGitConfig();
  if (tab === "browser") void renderBrowserPanel();
}
function searchSettings() {
  const query = $("#settings-search").value.trim().toLocaleLowerCase();
  if (!query) return setSettingsTab(settingsTab);
  let panelMatches = 0;
  for (const button of $$("[data-settings-tab]"))
    button.classList.remove("active");
  for (const panel of $$("[data-settings-panel]")) {
    let matches = 0;
    for (const row of panel.querySelectorAll(
      ".setting-row, .settings-explainer",
    )) {
      const match = row.textContent.toLocaleLowerCase().includes(query);
      row.classList.toggle("settings-search-hidden", !match);
      if (match) matches++;
    }
    const headingMatch = panel
      .querySelector(".settings-heading")
      ?.textContent.toLocaleLowerCase()
      .includes(query);
    if (headingMatch)
      for (const row of panel.querySelectorAll(
        ".setting-row, .settings-explainer",
      ))
        row.classList.remove("settings-search-hidden");
    const visible = Boolean(matches || headingMatch);
    panel.classList.toggle("hidden", !visible);
    if (visible) panelMatches++;
  }
  $("#settings-no-results").classList.toggle("hidden", panelMatches > 0);
  $(".settings-content").scrollTop = 0;
}
function syncApiModeFields() {
  const profile = $("#api-mode-setting")?.value === "profile";
  for (const row of $$("[data-api-profiles]"))
    row.classList.toggle("hidden", !profile);
  if (profile) renderApiProfiles();
}
const PROVIDER_TEMPLATES = [
  {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/anthropic",
    model: "deepseek-chat",
    currency: "CNY",
  },
  {
    name: "Kimi (Moonshot)",
    baseUrl: "https://api.moonshot.cn/anthropic",
    model: "kimi-k2-turbo-preview",
    currency: "CNY",
  },
  {
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    model: "glm-4.6",
    currency: "CNY",
  },
  {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api",
    model: "",
    currency: "USD",
  },
  {
    name: "Anthropic 官方",
    baseUrl: "https://api.anthropic.com",
    model: "",
    currency: "USD",
  },
];
let apiProfileDraft = null; // null=新增，对象=正在编辑的 profile
// ---- 供应商快速切换器（侧栏底部）与货币显示 ----
const currencySymbol = (code) => (code === "USD" ? "$" : "¥");
// 当前生效货币：供应商模式用配置值；跟随 CC Switch 时按余额接口返回的 unit 推断。
function activeCurrencySymbol() {
  const info = state.providerInfo;
  if (info?.mode === "profile") {
    // CCDPH-FIX(FE-09): 与 providerDisplayName / accountChannelInfo 保持一致地加 `|| []`。
    // 这里是 renderMessages() 的第一句且不在任何 try 里，缺 profiles 字段会让整个消息区渲染失败。
    const profile = (info.profiles || []).find((p) => p.id === info.activeProfileId);
    if (profile) return currencySymbol(profile.currency);
  }
  const unit = state.providerUsage?.balances?.find((b) => b.unit)?.unit;
  if (unit === "USD") return "$";
  if (unit === "CNY" || unit === "RMB") return "¥";
  return ""; // 未知货币不强加符号，避免 USD 余额配 ¥ 符号这类矛盾
}
function providerDisplayName() {
  const info = state.providerInfo;
  if (!info) return "跟随 CC Switch";
  if (info.mode === "profile") {
    const profile = info.profiles.find((p) => p.id === info.activeProfileId);
    return profile ? profile.name : "API 供应商";
  }
  return "跟随 CC Switch";
}
async function renderProviderSwitcher() {
  const wrap = $("#provider-switcher");
  const label = $("#provider-switcher-label");
  const menu = $("#provider-switcher-menu");
  if (!wrap || !menu) return;
  let data;
  try {
    data = await api("api-profiles");
  } catch {
    return;
  }
  state.providerInfo = data;
  if (label) label.textContent = providerDisplayName();
  menu.replaceChildren();
  const buildItem = (name, meta, active, handler) => {
    const button = el("button", active ? "active" : "");
    button.type = "button";
    button.append(el("span", "provider-name", name));
    if (meta) button.append(el("small", "", meta));
    if (active) button.append(el("span", "api-profile-badge", "使用中"));
    button.onclick = () => {
      wrap.removeAttribute("open");
      handler();
    };
    return button;
  };
  menu.append(
    buildItem("跟随 CC Switch", "使用本机 CC Switch 配置", data.mode !== "profile", async () => {
      await api("settings", { apiMode: "cc-switch" });
      toast("已切换为跟随 CC Switch，下一次发送消息生效");
      await refreshState();
    }),
  );
  for (const profile of data.profiles || []) {
    menu.append(
      buildItem(
        profile.name,
        `${currencySymbol(profile.currency)}${profile.currency === "USD" ? " USD" : " CNY"} · ${profile.hasKey ? "密钥已配置" : "未配密钥"}`,
        data.mode === "profile" && data.activeProfileId === profile.id,
        () => activateProviderProfile(profile),
      ),
    );
  }
  menu.append(
    buildItem("+ 添加供应商账户", "跳转到 API Key 配置", false, () => {
      // CCDPH-FIX(AUDIT-17): 这里的 wrap.removeAttribute("open") 是死代码 —— buildItem 里的
      // onclick 已经在调用 handler() 之前收起菜单了（其余项都没有这一句）。
      openAddAccountFlow();
    }),
  );
}
async function activateProviderProfile(profile) {
  const result = await api("api-profiles/activate", { id: profile.id });
  toast(
    `已切换到「${profile.name}」${result.migratedSessions ? `，${result.migratedSessions} 个旧会话已迁移模型` : ""}，下一次发送消息生效`,
  );
  await refreshState();
  await renderApiProfiles();
}
// 账户页：添加账户 → API 接入面板的新增表单
function openAddAccountFlow() {
  openSettings("api");
  resetApiProfileForm();
  setTimeout(() => $("#api-profile-name")?.focus(), 80);
}
$("#add-account-button").onclick = () => openAddAccountFlow();
function renderAccountProfiles() {
  const list = $("#account-profile-list");
  if (!list) return;
  const info = state.providerInfo;
  if (!info) return;
  list.replaceChildren();
  if (!info.profiles?.length) {
    list.append(el("div", "muted", "还没有添加供应商账户"));
    return;
  }
  for (const profile of info.profiles) {
    const active =
      info.mode === "profile" && info.activeProfileId === profile.id;
    const row = el("div", `account-profile-row${active ? " active" : ""}`);
    const main = el("div", "api-profile-main");
    const title = el("b", "", profile.name);
    if (active) title.append(el("span", "api-profile-badge", "使用中"));
    main.append(
      title,
      el(
        "small",
        "",
        `${currencySymbol(profile.currency)} ${profile.currency || "CNY"} · ${profile.hasKey ? "密钥已配置" : "未配置密钥"}`,
      ),
    );
    const actions = el("div", "api-profile-actions");
    const useButton = el("button", "setting-action", active ? "当前" : "启用");
    if (active) useButton.disabled = true;
    useButton.onclick = action(() => activateProviderProfile(profile));
    actions.append(useButton);
    row.append(main, actions);
    list.append(row);
  }
}

// ---- 账户页文案：运行客户端 / API 渠道 / 请求链路 ----
function setNodeText(selector, value) {
  const target = $(selector);
  if (target) target.textContent = value;
}
// 当前请求实际发往的渠道：应用内供应商账户优先，否则取 CC Switch 检测到的服务商
function accountChannelInfo() {
  const info = state.providerInfo;
  if (info?.mode === "profile") {
    const profile = (info.profiles || []).find(
      (p) => p.id === info.activeProfileId,
    );
    if (profile) return { name: profile.name, type: "应用内供应商账户" };
  }
  const provider = state.providerUsage?.providerName;
  if (provider && provider !== "当前服务商")
    return { name: provider, type: "由 CC Switch 决定" };
  return { name: "未检测到", type: "由 CC Switch 决定" };
}
function renderAccountIdentity() {
  const claude = state.runtime?.claude;
  const version = claude?.version ? claude.version.split(" ")[0] : "";
  setNodeText(
    "#account-claude-status",
    claude?.error
      ? `未检测到 Claude Code：${claude.error}`
      : `${version || "已安装"}，本机安装的 Claude Code，实际执行任务`,
  );
  const channel = accountChannelInfo();
  setNodeText("#account-provider-status", `${channel.name}，${channel.type}`);
  setNodeText("#account-request-chain", `Claude Code → ${channel.name}`);
}

// ---- Hooks 面板：列出 / 添加 / 编辑 / 删除（命令脱敏显示） ----
let hooksState = { events: [], hooks: {} };
let hooksDraft = null; // null=新增；{event,index}=编辑
function fillHookEventOptions() {
  const select = $("#hooks-event");
  if (!select) return;
  const current = select.value;
  select.replaceChildren();
  for (const event of hooksState.events) select.append(el("option", "", event));
  if (current && hooksState.events.includes(current)) select.value = current;
}
function openHookEditor(event = null, index = null, item = null) {
  hooksDraft = event === null ? null : { event, index };
  fillHookEventOptions();
  const eventSelect = $("#hooks-event");
  if (event) { eventSelect.value = event; eventSelect.disabled = true; }
  else { eventSelect.disabled = false; }
  $("#hooks-matcher").value = item?.matcher || "";
  const hook = item?.hooks?.[0];
  const redacted = Boolean(hook?.redacted);
  $("#hooks-command").value = redacted ? "" : hook?.command || "";
  $("#hooks-command").placeholder = redacted
    ? "（含密钥已脱敏，留空保留原命令）"
    : "如 node ./scripts/check.mjs";
  $("#hooks-editor").classList.remove("hidden");
  $("#hooks-editor").scrollIntoView({ block: "nearest" });
  $("#hooks-command").focus();
}
function closeHookEditor() {
  hooksDraft = null;
  $("#hooks-editor").classList.add("hidden");
}
async function renderHooks() {
  if (!$("#hooks-list")) return;
  let data;
  try {
    data = await api("hooks");
  } catch (error) {
    hooksState = { events: [], hooks: {} };
    $("#hooks-list").replaceChildren(
      el("div", "muted", `读取 Hooks 失败：${error.message}`),
    );
    return;
  }
  hooksState = { events: data.events || [], hooks: data.hooks || {} };
  fillHookEventOptions();
  setNodeText(
    "#settings-hooks-summary",
    data.error ? data.error : `${data.count || 0} 个已配置`,
  );
  const list = $("#hooks-list");
  list.replaceChildren();
  if (data.error) {
    list.append(el("div", "muted", data.error));
    return;
  }
  const events = Object.keys(hooksState.hooks);
  if (!events.length) {
    list.append(
      el("div", "muted", "还没有配置 Hook：点下方「＋ 添加 Hook」创建一条"),
    );
    return;
  }
  for (const event of events) {
    const items = hooksState.hooks[event] || [];
    items.forEach((item, index) => {
      const row = el("div", "hooks-row");
      const main = el("div", "api-profile-main");
      const title = el("b", "", event);
      if (item.matcher)
        title.append(el("span", "hooks-event-badge", item.matcher));
      main.append(title);
      const commands = item.hooks || [];
      if (!commands.length) main.append(el("small", "", "（没有命令）"));
      for (const hook of commands)
        main.append(el("code", "hooks-command", hook.command || "（空命令）"));
      const actions = el("div", "api-profile-actions");
      const editButton = el("button", "setting-action", "编辑");
      editButton.onclick = () => openHookEditor(event, index, item);
      const deleteButton = el("button", "setting-action danger-action", "删除");
      deleteButton.onclick = action(async () => {
        if (
          !(await confirmAction(
            `删除 ${event} 下的这条 Hook？`,
            "删除 Hook",
            "删除",
          ))
        )
          return;
        await api("hooks/save", { action: "delete", event, index });
        toast("Hook 已删除");
        await renderHooks();
      });
      actions.append(editButton, deleteButton);
      row.append(main, actions);
      list.append(row);
    });
  }
}

// ---- Worktrees 面板：列出 / 新建 / 移除 / 打开（路径合法性由后端校验） ----
async function renderWorktrees() {
  if (!$("#worktrees-list")) return;
  let data;
  try {
    data = await api("worktrees?" + workspaceQuery());
  } catch (error) {
    $("#worktrees-list").replaceChildren(
      el("div", "muted", `读取 Worktree 失败：${error.message}`),
    );
    return;
  }
  const list = $("#worktrees-list");
  list.replaceChildren();
  if (!data.git) {
    setNodeText("#worktrees-summary", data.error || "当前工作区不是 Git 仓库");
    list.append(
      el(
        "div",
        "muted",
        data.error === "请先选择项目"
          ? "请先选择一个项目"
          : "当前工作区不是 Git 仓库：Worktree 需要 Git 项目",
      ),
    );
    return;
  }
  const worktrees = data.worktrees || [];
  // CCDPH-FIX(AUDIT-11): 原文案是 `${worktrees.length} ? ? Worktree` —— 那两个「?」是作者编写时
  // 丢字符留下的字面 U+003F（文件里没有 U+FFFD、也没有孤立代理），界面上长期显示「3 ? ? Worktree」。
  setNodeText(
    "#worktrees-summary",
    `${worktrees.length} 个 Worktree · ${data.root || ""}`,
  );
  if (!worktrees.length) {
    list.append(
      el(
        "div",
        "muted",
        "这个仓库还没有额外 Worktree：点上方「＋ 新建 Worktree」创建",
      ),
    );
    return;
  }
  for (const worktree of worktrees) {
    const row = el("div", "worktree-row");
    const main = el("div", "api-profile-main");
    const title = el("b", "", worktree.branch || "(detached)");
    title.append(
      el(
        "span",
        `worktree-badge${worktree.main ? " active" : ""}`,
        worktree.main ? "主工作区" : worktree.detached ? "detached" : "worktree",
      ),
    );
    if (!worktree.exists)
      title.append(el("span", "worktree-badge", "目录缺失"));
    main.append(title, el("small", "", worktree.path));
    main.append(
      el(
        "small",
        "",
        `${worktree.head ? worktree.head.slice(0, 8) : "?"}${worktree.bare ? " · bare" : ""}`,
      ),
    );
    const actions = el("div", "api-profile-actions");
    const openButton = el("button", "setting-action", "打开");
    openButton.onclick = action(async () => {
      const session = state.sessions.find(
        (item) => item.cwd && item.cwd === worktree.path,
      );
      if (session) {
        $("#settings-dialog").close();
        await selectSession(session.id);
        toast(`已切换到 Worktree 会话：${worktree.branch || worktree.path}`);
        return;
      }
      await api("worktrees/open", {
        projectId: state.projectId,
        sessionId: state.sessionId,
        path: worktree.path,
      });
      toast("已在文件管理器中打开该 Worktree");
    });
    actions.append(openButton);
    if (!worktree.main) {
      const removeButton = el("button", "setting-action danger-action", "移除");
      removeButton.onclick = action(async () => {
        if (
          !(await confirmAction(
            `移除 Worktree「${worktree.branch || worktree.path}」？\n目录：${worktree.path}`,
            "移除 Worktree",
            "移除",
          ))
        )
          return;
        await api("worktrees/remove", {
          projectId: state.projectId,
          sessionId: state.sessionId,
          path: worktree.path,
        });
        toast("Worktree 已移除");
        await renderWorktrees();
      });
      actions.append(removeButton);
    }
    row.append(main, actions);
    list.append(row);
  }
}
$("#hooks-add").onclick = () => openHookEditor();
$("#hooks-cancel").onclick = () => closeHookEditor();
$("#hooks-refresh").onclick = action(async () => {
  await refreshIntegrations();
  await renderHooks();
  toast("Hooks 状态已刷新");
});
$("#hooks-save").onclick = action(async () => {
  const event = $("#hooks-event").value;
  const matcher = $("#hooks-matcher").value.trim();
  const command = $("#hooks-command").value.trim();
  if (!event) throw new Error("请选择事件");
  if (hooksDraft) {
    await api("hooks/save", {
      action: "update",
      event: hooksDraft.event,
      index: hooksDraft.index,
      matcher,
      command,
    });
    toast("Hook 已更新");
  } else {
    if (!command) throw new Error("请填写 Hook 命令");
    await api("hooks/save", { action: "add", event, matcher, command });
    toast("Hook 已添加");
  }
  closeHookEditor();
  await renderHooks();
});
$("#worktrees-add").onclick = () => {
  $("#worktree-editor").classList.remove("hidden");
  $("#worktree-branch").value = "";
  $("#worktree-base").value = "";
  $("#worktree-editor").scrollIntoView({ block: "nearest" });
  $("#worktree-branch").focus();
};
$("#worktree-cancel").onclick = () => {
  $("#worktree-editor").classList.add("hidden");
};
$("#worktree-create").onclick = action(async () => {
  const branch = $("#worktree-branch").value.trim();
  const base = $("#worktree-base").value.trim();
  if (!branch) throw new Error("请填写分支名");
  const result = await api("worktrees/create", {
    projectId: state.projectId,
    sessionId: state.sessionId,
    branch,
    base,
  });
  toast(`Worktree 已创建：${result.path}`);
  $("#worktree-editor").classList.add("hidden");
  await renderWorktrees();
});

// ---- 浏览器面板（设计文档 §6）：总开关 / 连接模式 / 状态与标签 / 授权引导 ----
// 解析「允许/阻止域名」输入：按 ; , 换行拆分 → trim → 去空 → 去重 → 最多 50 条
function parseBrowserOrigins(value) {
  const seen = new Set();
  const result = [];
  for (const part of String(value || "").split(/[;,\n]/)) {
    const origin = part.trim();
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    result.push(origin);
    if (result.length >= 50) break;
  }
  return result;
}
let browserPanelRevision = 0;
async function renderBrowserPanel() {
  const revision = ++browserPanelRevision;
  try {
    const [status, detect] = await Promise.all([
      api("browser/status"),
      api("browser/detect"),
    ]);
    if (revision !== browserPanelRevision) return;
    const enabled = Boolean(status.enabled);
    $("#browser-enabled").checked = enabled;
    $("#browser-mode").value = status.mode || "attach";
    $("#browser-mode-row").classList.toggle("hidden", !enabled);
    // 回填「允许/阻止域名」，容忍字段不存在
    const browserSettings = state.settings.browser || {};
    $("#browser-allow-origins").value = (
      browserSettings.allowOrigins || []
    ).join("; ");
    $("#browser-block-origins").value = (
      browserSettings.blockOrigins || []
    ).join("; ");
    // 浏览器检测结果
    const edge = (detect.browsers || []).find((b) => b.kind === "edge");
    const chrome = (detect.browsers || []).find((b) => b.kind === "chrome");
    $("#browser-detected").textContent = [
      edge?.installed ? `Edge ${edge.version || ""}（已安装）` : "Edge 未安装",
      chrome?.installed ? `Chrome ${chrome.version || ""}（已安装）` : "Chrome 未安装",
    ].join(" · ");
    // 连接状态卡
    const conn = status.connection || {};
    const connected = enabled && conn.connected;
    let html;
    if (!enabled) {
      html = `<span class="readonly-status">已停用</span> <small>开启上方开关以启用浏览器能力</small>`;
    } else if (connected) {
      html = `<span class="readonly-status ok">已连接</span> <small>${escapeHtml(conn.browser || "Edge")}（端口 ${escapeHtml(conn.port ?? "")}）</small>`;
    } else if (status.mode === "attach") {
      html = `<span class="readonly-status warn">未检测到已授权的 Edge</span> <small>请按下方引导开启远程调试开关，然后点“刷新状态”</small>`;
    } else {
      html = `<span class="readonly-status warn">专用浏览器未运行</span> <small>点“打开授权页面 / 启动浏览器”启动专用窗口</small>`;
    }
    $("#browser-status").innerHTML = html;
    // 标签列表
    const tabsEl = $("#browser-tabs");
    tabsEl.innerHTML = "";
    if (connected && (status.tabs || []).length) {
      const rows = el("div", "browser-tabs-list");
      for (const tab of status.tabs.slice(0, 12)) {
        const row = el("div", "browser-tab-row");
        row.append(
          // CCDPH-FIX(AUDIT-13): 标签页 URL 的定长截断也用 clip
          el("small", "browser-tab-title", `${tab.title || "（无标题）"} · ${clip(String(tab.url), 60)}`),
        );
        const closeBtn = el("button", "setting-action danger-action", "关闭");
        closeBtn.onclick = action(async () => {
          await api("browser/tabs/close", { targetId: tab.id });
          await renderBrowserPanel();
        });
        row.append(closeBtn);
        rows.append(row);
      }
      tabsEl.append(rows);
    }
    // 授权引导（按模式切换文案）
    const guideTitle = $("#browser-guide-title");
    const guideBody = $("#browser-guide-body");
    if (status.mode === "attach") {
      guideTitle.textContent = "如何授权（一次性操作）";
      guideBody.innerHTML =
        '<p>1. 点下方"打开授权页面 / 启动浏览器"，Edge 会打开 <b>edge://inspect/#remote-debugging</b>。</p>' +
        '<p>2. 勾选 <b>"Allow remote debugging for this browser instance"</b>（开关立即生效、跨重启保留）。</p>' +
        '<p>3. 回到这里点"刷新状态"。此后 AI 操控浏览器时<strong>直接使用你已登录的账号</strong>，无需重新登录。</p>';
    } else {
      guideTitle.textContent = "专用授权 Browser";
      guideBody.innerHTML =
        '<p>点下方"打开授权页面 / 启动浏览器"，CCDPH 会启动一个<strong>独立的 Edge 窗口</strong>（与日常浏览互不影响）。</p>' +
        "<p>在该窗口里登录你需要的网站；登录态会长期保留，之后 AI 可直接使用。</p>";
    }
    $("#browser-launch").textContent = status.mode === "attach" ? "打开授权页面" : "启动专用浏览器";
  } catch (err) {
    if (revision !== browserPanelRevision) return;
    $("#browser-status").innerHTML = `<span class="readonly-status warn">加载失败：${escapeHtml(String(err.message || err).slice(0, 120))}</span>`;
  }
}
$("#browser-enabled").onchange = action(async () => {
  const enabled = $("#browser-enabled").checked;
  await api("browser/" + (enabled ? "enable" : "disable"), {
    mode: $("#browser-mode").value,
  });
  toast(enabled ? "浏览器能力已启用" : "浏览器能力已停用");
  await renderBrowserPanel();
});
$("#browser-mode").onchange = action(async () => {
  await api("browser/enable", { mode: $("#browser-mode").value });
  toast("连接模式已更新");
  await renderBrowserPanel();
});
$("#browser-allow-origins").onchange = action(saveSettings);
$("#browser-block-origins").onchange = action(saveSettings);
$("#browser-launch").onclick = action(async () => {
  const result = await api("browser/launch", { mode: $("#browser-mode").value });
  if (result.hint) toast(result.hint);
  await renderBrowserPanel();
});
$("#browser-refresh").onclick = action(async () => {
  await renderBrowserPanel();
});
async function renderApiProfiles() {
  const list = $("#api-profile-list");
  if (!list) return;
  let data;
  try {
    data = await api("api-profiles");
  } catch {
    list.replaceChildren(el("div", "muted", "供应商列表加载失败"));
    return;
  }
  const profiles = data.profiles || [];
  state.providerInfo = data;
  const editingId = apiProfileDraft?.id || "";
  list.replaceChildren(
    ...profiles.map((profile) => {
      const active = data.activeProfileId === profile.id && data.mode === "profile";
      const row = el("div", `api-profile-row${active ? " active" : ""}`);
      const main = el("div", "api-profile-main");
      const title = el("b", "", profile.name);
      if (active) title.append(el("span", "api-profile-badge", "使用中"));
      main.append(
        title,
        el(
          "small",
          "",
          `${profile.baseUrl}${profile.hasKey ? " · 密钥已配置" : " · 未配置密钥"}`,
        ),
      );
      const actions = el("div", "api-profile-actions");
      const useButton = el(
        "button",
        "setting-action",
        active ? "当前" : "使用",
      );
      if (active) useButton.disabled = true;
      useButton.onclick = action(() => activateProviderProfile(profile));
      const editButton = el("button", "setting-action", "编辑");
      editButton.onclick = () => {
        apiProfileDraft = profile;
        $("#api-profile-name").value = profile.name;
        $("#api-profile-url").value = profile.baseUrl;
        $("#api-profile-model").value = profile.env?.ANTHROPIC_MODEL || "";
        $("#api-profile-currency").value = profile.currency || "CNY";
        $("#api-profile-editing-hint").textContent = `正在编辑：${profile.name}`;
        $("#api-profile-key-status").textContent = profile.hasKey
          ? "已配置（保存在本机，不会回显；留空保存即清除）"
          : "未配置";
      };
      const deleteButton = el("button", "setting-action danger-action", "删除");
      deleteButton.onclick = action(async () => {
        await api("api-profiles/delete", { id: profile.id });
        if (apiProfileDraft?.id === profile.id) resetApiProfileForm();
        toast(`已删除「${profile.name}」`);
        await refreshState();
        await renderApiProfiles();
      });
      actions.append(useButton, editButton, deleteButton);
      row.append(main, actions);
      return row;
    }),
  );
  if (!profiles.length)
    list.append(
      el("div", "muted", "还没有供应商配置：用下面的模板或手动添加一个账户"),
    );
  // 编辑态回显密钥状态
  const draft = profiles.find((p) => p.id === editingId);
  $("#api-profile-key-status").textContent = draft
    ? draft.hasKey
      ? "已配置（保存在本机，不会回显；留空保存即清除）"
      : "未配置"
    : "未配置";
}
function resetApiProfileForm() {
  apiProfileDraft = null;
  $("#api-profile-name").value = "";
  $("#api-profile-url").value = "";
  $("#api-profile-model").value = "";
  $("#api-profile-currency").value = "CNY";
  $("#api-profile-key").value = "";
  $("#api-profile-editing-hint").textContent = "新增模式";
  $("#api-profile-key-status").textContent = "未配置";
}
function exportApiProfiles() {
  const payload = (state.settings.apiProfiles || []).map((p) => ({
    name: p.name,
    baseUrl: p.baseUrl,
    env: p.env || {},
  }));
  const text = JSON.stringify({ exportedFrom: "CCDPH", providers: payload }, null, 2);
  // D-01 修复：原先 `navigator.clipboard?.writeText(text).catch(() => {})` 失败时无任何
  // 提示，属"失败伪装成成功"的假功能。改为失败时给出可见提示（成功路径行为不变）。
  navigator.clipboard?.writeText(text).catch((error) => {
    console.error("复制到剪贴板失败", error);
    toast("复制到剪贴板失败，请手动复制供应商配置");
  });
  const blob = new Blob([text], { type: "application/json" });
  const link = el("a");
  link.href = URL.createObjectURL(blob);
  link.download = "workbench-providers.json";
  link.click();
  URL.revokeObjectURL(link.href);
  toast("已导出供应商配置（不含密钥），JSON 同时复制到剪贴板");
}

// ---- MCP 服务器管理（用户级 ~/.claude.json，写前自动备份） ----
let mcpDraft = null; // null=新增；字符串=正在编辑的用户级名称
async function renderMcpServers() {
  const list = $("#mcp-server-list");
  if (!list) return;
  let data;
  try {
    data = await api("mcp-servers?" + workspaceQuery());
  } catch {
    list.replaceChildren(el("div", "muted", "MCP 列表加载失败"));
    return;
  }
  const servers = data.servers || [];
  list.replaceChildren();
  if (!servers.length) {
    list.append(el("div", "muted", "还没有配置 MCP：点上方「＋ 添加 MCP」接入外部工具"));
    return;
  }
  for (const server of servers) {
    const row = el("div", "mcp-server-row");
    const main = el("div", "api-profile-main");
    const title = el("b", "", server.name);
    const badge = el(
      "span",
      "api-profile-badge",
      server.source === "project" ? "项目级" : "用户级",
    );
    title.append(badge);
    const detail =
      server.type === "http"
        ? server.url || "http 服务"
        : [server.command, ...(server.args || [])].filter(Boolean).join(" ") || "本地命令";
    main.append(title, el("small", "", detail));
    const actions = el("div", "api-profile-actions");
    if (server.source === "user") {
      const editButton = el("button", "setting-action", "编辑");
      editButton.onclick = () => openMcpEditor(server);
      const deleteButton = el("button", "setting-action danger-action", "删除");
      deleteButton.onclick = action(async () => {
        if (
          !(await confirmAction(`从用户级配置删除 MCP「${server.name}」？`, "删除 MCP", "删除"))
        )
          return;
        await api("mcp-servers/delete", { name: server.name, source: "user" });
        toast(`已删除 ${server.name}`);
        await renderMcpServers();
      });
      actions.append(editButton, deleteButton);
    } else {
      const hint = el("span", "readonly-status", "只读");
      actions.append(hint);
    }
    row.append(main, actions);
    list.append(row);
  }
}
function openMcpEditor(server) {
  mcpDraft = server ? server.name : null;
  $("#mcp-editor").classList.remove("hidden");
  $("#mcp-name").value = server?.name || "";
  $("#mcp-name").disabled = Boolean(server);
  $("#mcp-type").value = server?.type || "stdio";
  $("#mcp-command").value = server?.command || "";
  $("#mcp-args").value = (server?.args || []).join(" ");
  $("#mcp-url").value = server?.url || "";
  $("#mcp-env").value = ""; // 密钥不回显；留空不改已有 env
  syncMcpTypeRows();
  $("#mcp-editor").scrollIntoView({ block: "nearest" });
  $("#mcp-name").focus();
}
function closeMcpEditor() {
  mcpDraft = null;
  $("#mcp-editor").classList.add("hidden");
}
function syncMcpTypeRows() {
  const isHttp = $("#mcp-type").value === "http";
  $("#mcp-command-row").classList.toggle("hidden", isHttp);
  $("#mcp-args-row").classList.toggle("hidden", isHttp);
  $("#mcp-url-row").classList.toggle("hidden", !isHttp);
  $("#mcp-env-row").classList.toggle("hidden", isHttp);
}
$("#mcp-add-button").onclick = () => openMcpEditor(null);
$("#mcp-type").addEventListener("change", syncMcpTypeRows);
$("#mcp-cancel").onclick = closeMcpEditor;
function parseArgs(text) {
  const out = []; let cur = ""; let quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === quote) quote = ""; else cur += ch; }
    else if (ch === "'" || ch === '"') quote = ch;
    else if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ""; } }
    else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
$("#mcp-save").onclick = action(async () => {
  const name = $("#mcp-name").value.trim();
  const type = $("#mcp-type").value;
  const envText = $("#mcp-env").value.trim();
  const env = {};
  for (const line of envText.split("\n")) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  const payload = {
    name,
    type,
    command: $("#mcp-command").value.trim(),
    args: parseArgs($("#mcp-args").value),
    url: $("#mcp-url").value.trim(),
  };
  if (Object.keys(env).length) payload.env = env;
  const saved = await api("mcp-servers/save", payload);
  // CCDPH-FIX(R2-P3-7): env 里的凭据类变量是**明文**写进 MCP 配置文件的，后端会带出
  // warning —— 必须让用户看到，不能只提示"已保存"。
  toast(saved?.warning || `MCP「${name}」已保存，下一轮对话生效`);
  closeMcpEditor();
  await renderMcpServers();
  await refreshIntegrations();
});

// ---- Git 配置中心：仓库概览 + 身份（全局/仓库）+ 当前项目远程仓库 ----
let gitRemoteDraft = null; // null=新增；字符串=正在编辑的远程名
let gitConfigCache = null;
function renderGitOverview(data) {
  setNodeText(
    "#settings-git-branch",
    data.inside ? data.branch || "(detached)" : "不是 Git 仓库",
  );
  setNodeText(
    "#settings-git-upstream",
    data.upstream || (data.inside ? "未设置上游分支" : "—"),
  );
  setNodeText(
    "#settings-git-aheadbehind",
    data.upstream ? `↑ ${data.ahead || 0} ↓ ${data.behind || 0}` : "无上游",
  );
  setNodeText(
    "#settings-git-changestat",
    data.inside ? `${data.changeCount || 0} 个文件有改动` : "非 Git 仓库",
  );
  setNodeText("#settings-git-changes", `${data.changeCount || 0}`);
  setNodeText(
    "#settings-git-lastcommit",
    data.lastCommit
      ? `${data.lastCommit.hash.slice(0, 8)} · ${data.lastCommit.subject}`
      : data.inside
        ? "尚无提交"
        : "—",
  );
  setNodeText("#settings-git-remote", data.origin || "未配置或尚未检测");
  setNodeText(
    "#settings-git-worktrees",
    // CCDPH-FIX(AUDIT-11): 同上，去掉两个字面 U+003F 的「? ?」
    `${data.worktreeCount || 0} 个 Worktree`,
  );
}
function applyGitIdentityScope(data) {
  gitConfigCache = data;
  const local = $("#git-identity-scope")?.value === "local";
  const values = local ? data.local : data.global;
  $("#git-user-name").value = values?.userName || "";
  $("#git-user-email").value = values?.userEmail || "";
  $("#git-user-name").placeholder = values?.userName ? "" : "未设置";
  $("#git-user-email").placeholder = values?.userEmail ? "" : "未设置";
  setNodeText(
    "#git-user-name-hint",
    local
      ? data.inside
        ? "写入当前仓库（git config --local）"
        : "当前工作区不是 Git 仓库，无法写入仓库级身份"
      : "写入全局（git config --global），对所有仓库生效",
  );
}
async function renderGitConfig() {
  if (!$("#git-user-name")) return;
  let data;
  try {
    data = await api("git-config?" + workspaceQuery());
  } catch (error) {
    // CCDPH-FIX(R2-P2-10): 原来这里静默 return —— git 未安装 / PATH 异常 / 权限故障
    // 时界面毫无反馈，用户会以为"本来就没配置"。现在如实展示错误。
    const list = $("#git-remote-list");
    list.replaceChildren(
      el("div", "muted", `读取 Git 配置失败：${error.message}`),
    );
    return;
  }
  renderGitOverview(data);
  applyGitIdentityScope(data);
  const list = $("#git-remote-list");
  list.replaceChildren();
  if (!data.inside) {
    list.append(el("div", "muted", "当前工作区不是 Git 仓库（或未选择项目）"));
    return;
  }
  if (!data.remotes?.length) {
    list.append(el("div", "muted", "还没有远程仓库：点上方「＋ 添加远程」"));
  }
  for (const remote of data.remotes || []) {
    const row = el("div", "git-remote-row");
    const main = el("div", "api-profile-main");
    const title = el("b", "", remote.name);
    main.append(
      title,
      el("small", "", remote.fetch || remote.push || ""),
    );
    const actions = el("div", "api-profile-actions");
    const editButton = el("button", "setting-action", "编辑");
    editButton.onclick = () => {
      gitRemoteDraft = remote.name;
      $("#git-remote-editor").classList.remove("hidden");
      $("#git-remote-name").value = remote.name;
      $("#git-remote-name").disabled = true; // 改名=删旧建新，不在这里做
      $("#git-remote-url").value = remote.fetch || remote.push || "";
      $("#git-remote-editor").scrollIntoView({ block: "nearest" });
      $("#git-remote-url").focus();
    };
    const deleteButton = el("button", "setting-action danger-action", "删除");
    deleteButton.onclick = action(async () => {
      if (
        !(await confirmAction(
          remote.name === "origin"
            ? `确定删除 origin？删除后推送/拉取需要重新添加。`
            : `删除远程「${remote.name}」？`,
          "删除远程",
          "删除",
        ))
      )
        return;
      await api("git-remote/delete", { name: remote.name, confirm: true });
      toast(`已删除远程 ${remote.name}`);
      await renderGitConfig();
    });
    actions.append(editButton, deleteButton);
    row.append(main, actions);
    list.append(row);
  }
}
$("#git-identity-save").onclick = action(async () => {
  const scope = $("#git-identity-scope").value === "local" ? "local" : "global";
  await api(`git-config/save?${workspaceQuery()}`, {
    scope,
    userName: $("#git-user-name").value,
    userEmail: $("#git-user-email").value,
  });
  toast(scope === "local" ? "Git 仓库级身份已保存" : "Git 全局身份已保存");
  await renderGitConfig();
});
$("#git-identity-scope").onchange = () => {
  if (gitConfigCache) applyGitIdentityScope(gitConfigCache);
};
$("#git-remote-add-button").onclick = () => {
  gitRemoteDraft = null;
  $("#git-remote-editor").classList.remove("hidden");
  $("#git-remote-name").value = "";
  $("#git-remote-name").disabled = false;
  $("#git-remote-url").value = "";
  $("#git-remote-editor").scrollIntoView({ block: "nearest" });
  $("#git-remote-name").focus();
};
$("#git-remote-cancel").onclick = () => {
  gitRemoteDraft = null;
  $("#git-remote-editor").classList.add("hidden");
};
$("#git-remote-save").onclick = action(async () => {
  const name = $("#git-remote-name").value.trim();
  const target = $("#git-remote-url").value.trim();
  await api(`git-remote/save?${workspaceQuery()}`, { name, url: target });
  toast(`远程「${name}」已保存`);
  $("#git-remote-editor").classList.add("hidden");
  await renderGitConfig();
});
function renderSettingsDiagnostics() {
  const dialog = $("#settings-dialog");
  if (!dialog || !dialog.open) return;
  const setText = (selector, value) => {
    const target = $(selector);
    if (target) target.textContent = value;
  };
  const provider = state.providerUsage;
  const providerName = provider?.providerName || "尚未检测";
  const providerBalance = provider?.balances?.length
    ? provider.balances
      .filter((item) => typeof item.remaining === "number")
      .map((item) => `${item.unit} ${item.remaining.toFixed(2)}`)
      .join(" · ")
    : provider?.available === false
      ? "当前服务商未返回可读取余额"
      : "等待服务商响应";
  setText("#provider-setting-name", providerName);
  setText("#provider-setting-balance", providerBalance);
  setText(
    "#usage-setting-summary",
    provider?.balances?.length ? providerBalance : providerName,
  );
  setText("#settings-connection-provider", providerName);
  renderAccountProfiles();
  renderAccountIdentity();
  setText(
    "#settings-project-path",
    state.projectInfo?.root || activeProject()?.path || "尚未选择项目",
  );
  setText(
    "#settings-git-origin",
    state.projectInfo?.remote || "未配置或尚未检测",
  );
  setText("#settings-git-branch", state.projectInfo?.branch || "尚未检测");
  setText("#settings-git-remote", state.projectInfo?.remote || "尚未检测");
  setText(
    "#settings-environment-root",
    state.projectInfo?.root || activeProject()?.path || "尚未选择",
  );
  setText(
    "#settings-environment-claude",
    state.runtime?.claude?.configured
      ? state.runtime?.claude?.version || "已检测到 Claude Code"
      : state.runtime?.claude?.error || "未检测到",
  );
  setText("#settings-data-path", "CCDPH 本地数据目录");
  setText("#settings-app-version", state.runtime?.version || "");
  setText(
    "#settings-claude-path",
    state.runtime?.claude?.configured
      ? state.runtime?.claude?.version || "已检测到 Claude Code"
      : state.runtime?.claude?.error || "未检测到",
  );
  setText(
    "#settings-claude-version",
    state.runtime?.claude?.version?.split(" ")[0] || "—",
  );
  const session = state.activeSession || activeSessionMeta();
  setText(
    "#current-session-setting-status",
    session
      ? `${session.title} · ${session.model || "跟随 CC Switch"} · ${session.effort || "跟随思考配置"}`
      : "尚未选择会话",
  );
  if ($("#apply-defaults-current"))
    $("#apply-defaults-current").disabled = !session || state.running;
  setText(
    "#settings-terminal-state",
    state.terminalId
      ? state.terminalExited
        ? "已结束"
        : `运行中 · ${state.terminalRoot || "当前工作区"}`
      : "尚未启动",
  );
  for (const selector of [
    "#settings-restart-terminal",
    "#settings-reveal-project",
  ])
    if ($(selector)) $(selector).disabled = !activeProject();
  if ($("#settings-open-github"))
    $("#settings-open-github").disabled = !state.projectInfo?.remote;
  const integrations = state.integrations;
  setText("#settings-mcp-count", integrations?.mcpCount ?? "—");
  setText("#settings-skill-count", integrations?.skillCount ?? "—");
  setText("#settings-hook-count", integrations?.hookCount ?? "—");
  setText("#settings-plugin-count", integrations?.pluginCount ?? "—");
  setText(
    "#settings-hooks-summary",
    integrations
      ? // CCDPH-FIX(P3-34): 扫描失败时 counts 为 null（不再伪造成 0），此处如实显示。
        integrations.hookCount == null
        ? "扫描失败"
        : `${integrations.hookCount} 个已配置`
      : "正在扫描",
  );
  setText(
    "#settings-claude-config-path",
    integrations?.configDir || "尚未扫描",
  );
}
function openSettings(tab = settingsTab) {
  fillSettingsControls();
  renderSettingsDiagnostics();
  setSettingsTab(typeof tab === "string" ? tab : "general");
  openDialog("#settings-dialog");
  void refreshIntegrations();
}
async function updateSession(changes) {
  if (!state.sessionId) return;
  const rev = navigationRevision;
  const sid = state.sessionId;
  const updated = await api("session/update", {
    sessionId: sid,
    ...changes,
  });
  if (rev !== navigationRevision || state.sessionId !== sid) return;
  state.activeSession = updated;
  await refreshState();
  renderHeader();
}
async function syncCurrentSessionControls() {
  if (!state.sessionId) return;
  const changes = {
    model: $("#model").value,
    permissionMode: $("#permission-mode").value,
    effort: $("#effort").value,
  };
  if (
    state.running &&
    changes.permissionMode === "auto" &&
    state.activeSession?.permissionMode !== "auto"
  ) {
    if (
      !window.confirm(
        "切换到自动模式后，本轮任务将不再逐项请求工具审批。确认继续吗？",
      )
    ) {
      renderHeader();
      return;
    }
    changes.confirmAutoEscalation = true;
  }
  const rev = navigationRevision;
  const sid = state.sessionId;
  let result;
  try {
    result = await api(
      state.running ? "session/control" : "session/update",
      {
        sessionId: sid,
        ...changes,
      },
    );
  } catch (error) {
    // 服务端拒绝无法实时应用的切换时，恢复到当前真实会话状态，
    // 避免下拉框显示一个 SDK 本轮实际上并未采用的权限模式。
    if (rev === navigationRevision && state.sessionId === sid) renderHeader();
    throw error;
  }
  if (rev !== navigationRevision || state.sessionId !== sid) return;
  const updated = result.session || result;
  state.activeSession = updated;
  state.sessions = state.sessions.map((item) =>
    item.id === updated.id ? { ...item, ...updated } : item,
  );
  renderSidebar();
  renderHeader();
  renderSettingsDiagnostics();
  const modeLabels = {
    default: "手动确认",
    acceptEdits: "自动接受编辑",
    plan: "计划模式",
    auto: "自动模式",
  };
  // CCDPH-FIX(P2-3): 服务端会回报"明确请求、但运行中无法应用"的字段；此时不能再笼统提示
  // "已更新"，否则用户会以为自定义模型 / 思考强度已切换，而实际并未生效。
  const rejected = (result.rejected || []).map(
    (field) =>
      ({ model: "模型", effort: "思考强度", permissionMode: "权限模式" })[field] ||
      field,
  );
  if (rejected.length) {
    toast(`已更新，但运行中无法应用：${rejected.join("、")}（未生效）`);
    return;
  }
  const suffix = state.running ? "（运行中已应用）" : "";
  toast(
    `当前会话已更新：${modeLabels[updated.permissionMode] || updated.permissionMode} · ${updated.effort || "跟随思考配置"}${suffix}`,
  );
}
async function handleTaskAction(name) {
  const session = state.activeSession || activeSessionMeta();
  if (!session) return;
  $("#task-menu").removeAttribute("open");
  if (name === "rename") return openRename(session);
  if (name === "pin") return updateSession({ pinned: !session.pinned });
  if (name === "archive") {
    await updateSession({ archived: !session.archived });
    // CCDPH-FIX(L-01): 归档当前会话同样要关流 + 停 PTY（原先直接清字段就返回）
    await teardownActiveSession();
    state.sessionId = null;
    state.activeSession = null;
    state.events = [];
    renderMessages();
    renderSidebar();
    renderHeader();
    return;
  }
  if (name === "delete") {
    if (
      !(await confirmAction(
        `删除“${session.title}”的工作台记录？\nClaude Code 自身保存的底层会话不会被删除。`,
        "删除任务",
        "删除",
      ))
    )
      return;
    await api("session/delete", { sessionId: session.id });
    // CCDPH-FIX(L-01): 删除的是当前会话时先收尾（同 deleteSessionById）
    if (state.sessionId === session.id) await teardownActiveSession();
    state.sessionId = null;
    state.activeSession = null;
    state.events = [];
    await refreshState();
    renderMessages();
    await refreshWorkspace();
    return;
  }
  if (name === "export") {
    // CCDPH-FIX(AUDIT-5): /api/export 会把整份会话记录拼成一个字符串返回（服务端不设上限，
    // 而单会话事件文本本身可以到 8MB 级），api() 却按默认的 5MB 上限拒收 —— 长会话点「导出对话」
    // 必然失败，且提示是「服务响应过大（x.xMB）」这种把用户引向错误方向的话。与 /api/session
    // 一样按调用放宽上限（服务端契约不变）。
    const result = await api(
      "export?id=" + encodeURIComponent(session.id),
      undefined,
      { maxChars: SESSION_RESPONSE_CHARS },
    );
    state.previewPath = null;
    state.previewIsDiff = false;
    $("#preview-title").textContent = `${session.title}.md`;
    $("#preview-meta").textContent = "Markdown 对话记录";
    $("#preview-content").textContent = result.text;
    $("#diff-feedback").classList.add("hidden");
    openDialog("#preview-dialog");
  }
}

async function saveSettings() {
  const rev = navigationRevision;
  const previousClaudeExecutable = state.settings.claudeExecutable || "";
  state.settings = await api("settings", {
    notifications: $("#notifications-setting").checked,
    notificationSound: $("#notification-sound-setting").checked,
    notifyWhenFocused: $("#notify-focused-setting").checked,
    nativeApprovalWindow: $("#native-approval-setting").checked,
    closeToTray: $("#close-to-tray-setting").checked,
    restoreLastSession: $("#restore-session-setting").checked,
    autoNameSessions: $("#auto-name-setting").checked,
    usageAutoRefresh: $("#usage-auto-refresh-setting").checked,
    usageRefreshMinutes: Number($("#usage-refresh-setting").value),
    defaultPermissionMode: $("#default-permission").value,
    defaultEnvironment: $("#default-environment").value,
    defaultModel: $("#default-model-setting").value,
    defaultEffort: $("#default-effort-setting").value,
    maxTurns: Number($("#max-turns-setting").value),
    terminalShell: $("#terminal-shell-setting").value,
    terminalRetentionMinutes: Number($("#terminal-retention-setting").value),
    terminalOutputLimit: Number($("#terminal-output-setting").value),
    historyLimit: Number($("#history-limit-setting").value),
    claudeExecutable: $("#claude-executable-setting").value.trim(),
    updateManifestUrl: $("#update-manifest-setting").value.trim(),
    autoCheckUpdates: $("#auto-update-setting").checked,
    apiMode: $("#api-mode-setting").value,
    resourceCleanup: $("#resource-cleanup-setting").checked,
    personaId: $("#persona-setting").value,
    personaCustom: $("#persona-custom").value.trim(),
    browser: {
      allowOrigins: parseBrowserOrigins($("#browser-allow-origins").value),
      blockOrigins: parseBrowserOrigins($("#browser-block-origins").value),
    },
  });
  // CCDPH-FIX(AUDIT-4): 这个提前返回原先不返回任何值，而唯一解构它的调用方
  // applyClaudeExecutableChange() 写的是 `const { claudeChanged } = await saveSettings()` ——
  // 保存期间只要发生会话/项目切换（++navigationRevision），它就抛 TypeError，用户看到一句原始
  // JS 报错，且 refreshState / 诊断刷新 /「已连接 Claude Code」的确认都不会执行。
  // 统一返回形状：导航已作废就视为「本次没有改 claude.exe」。
  if (rev !== navigationRevision) return { claudeChanged: false };
  state.apiAuthConfigured = state.settings.apiAuthConfigured === true;
  state.apiAuthPersistence = state.settings.apiAuthPersistence || "encrypted";
  state.apiAuthWarning = state.settings.apiAuthWarning || "";
  if (state.apiAuthWarning && state.apiAuthWarning !== lastApiAuthWarning) {
    lastApiAuthWarning = state.apiAuthWarning;
    toast(state.apiAuthWarning);
  }
  if (!state.activeSession) {
    $("#permission-mode").value = state.settings.defaultPermissionMode;
    $("#environment-mode").value = state.settings.defaultEnvironment;
    $("#model").value = state.settings.defaultModel || "";
  }
  scheduleProviderUsageRefresh();
  renderSettingsDiagnostics();
  return {
    claudeChanged:
      previousClaudeExecutable !== (state.settings.claudeExecutable || ""),
  };
}
async function applyClaudeExecutableChange() {
  const { claudeChanged } = await saveSettings();
  if (claudeChanged) {
    await refreshState();
    renderSettingsDiagnostics();
    const claude = state.runtime?.claude;
    toast(
      claude?.error
        ? `Claude Code 检测失败：${claude.error}`
        : `已连接 Claude Code ${claude?.version || ""}，立即生效`,
    );
  } else toast("设置已保存");
}
function saveAppearanceSettings() {
  localStorage.setItem("uiFont", $("#font-setting").value);
  localStorage.setItem("fontSize", $("#font-size-setting").value);
  localStorage.setItem("density", $("#density-setting").value);
  localStorage.setItem(
    "reduceMotion",
    String($("#reduce-motion-setting").checked),
  );
  localStorage.setItem(
    "showThinking",
    String($("#show-thinking-setting").checked),
  );
  localStorage.setItem(
    "defaultInspector",
    String($("#default-inspector-setting").checked),
  );
  applyAppearanceSettings();
  applyInspectorPreference();
}
// CCDPH-FIX(FE-07): localStorage.zoom 可能是非数值（"abc"）—— Number() 得到 NaN，
// Math.max(80, NaN + delta) 也是 NaN，会被写回 localStorage 并渲染成 "NaN%"，
// 缩放按钮从此永久失效。读值逻辑统一到这里，setZoom / initializeZoom 共用。
function storedZoom() {
  const stored = localStorage.getItem("zoom");
  const parsed = stored === null || stored === "" ? 100 : Number(stored);
  return Number.isFinite(parsed) ? parsed : 100;
}
function setZoom(delta) {
  const next = Math.min(130, Math.max(80, storedZoom() + delta));
  localStorage.setItem("zoom", next);
  document.documentElement.style.setProperty("--ui-zoom", next / 100);
  $("#zoom-value").textContent = `${next}%`;
}
function initializeZoom() {
  // 与 setZoom 一致地夹紧，非有限数回落到 100，避免 CSS 变量变成 NaN 或越界
  const zoom = Math.min(130, Math.max(80, storedZoom()));
  document.documentElement.style.setProperty("--ui-zoom", zoom / 100);
  $("#zoom-value").textContent = `${zoom}%`;
}

function openCommandPalette(mode = "all") {
  state.commandMode = mode;
  state.commandIndex = 0;
  $("#command-input").value = "";
  $("#command-dialog").showModal();
  void action(renderCommandItems)();
  $("#command-input").focus();
}
// CCDPH-FIX(AUDIT-3): renderCommandItems 会被 160ms 防抖和上下键处理函数直接调用，两次调用
// 会重叠；原先谁先回来谁写 DOM，于是列表可能是「上一个查询」的结果，而每个按钮的 onclick
// 闭包着自己的 item —— 回车执行的是与输入框不匹配的文件（加错上下文 / 预览错文件）。
// 这里加一个代际号：只有最新一次调用的响应可以写状态。
let commandRenderRevision = 0;
async function renderCommandItems() {
  const revision = ++commandRenderRevision;
  const query = $("#command-input").value.trim().toLocaleLowerCase();
  const items = [];
  if (state.commandMode === "all") {
    items.push(
      { icon: "plus", title: "新建任务", detail: "Ctrl+N", run: newSession },
      {
        icon: "folder-plus",
        title: "添加项目",
        detail: "选择本地文件夹",
        run: openProjectDialog,
      },
      {
        icon: "square-terminal",
        title: "打开终端",
        detail: "在当前工作区运行命令",
        run: () => {
          showInspector();
          setPanel("terminal");
        },
      },
      {
        icon: "panel-right",
        title: "查看代码变更",
        detail: "Git 工作区 Diff",
        run: () => {
          showInspector();
          setPanel("changes");
        },
      },
      {
        icon: "settings",
        title: "设置",
        detail: "主题、权限、环境",
        run: openSettings,
      },
    );
    for (const project of state.projects)
      items.push({
        icon: "folder",
        title: project.name,
        detail: project.path,
        run: () => selectProject(project.id),
      });
    for (const session of state.sessions.filter((item) => !item.archived))
      items.push({
        icon: session.running ? "circle-dot" : "file-text",
        title: session.title,
        detail:
          state.projects.find((p) => p.id === session.projectId)?.name ||
          "任务",
        run: () => selectSession(session.id),
      });
  }
  if (state.projectId && (state.commandMode === "files" || query)) {
    const result = query
      ? await api(
        `search-files?${workspaceQuery()}&q=${encodeURIComponent(query)}`,
      )
      : { files: [] };
    // CCDPH-FIX(AUDIT-3): 响应回来时若已发起更新的渲染、或输入框内容已经变了，就丢弃这次结果
    // （同 renderFiles 在 1745 行的做法）——否则旧查询的文件会被写进列表并被执行。
    if (revision !== commandRenderRevision) return;
    if (query !== $("#command-input").value.trim().toLocaleLowerCase()) return;
    for (const file of result.files)
      items.push({
        icon: "file-text",
        title: file,
        detail: state.commandMode === "files" ? "添加到上下文" : "项目文件",
        run: () =>
          state.commandMode === "files"
            ? addContextFile(file)
            : previewFile(file, false),
      });
  }
  state.commandItems = items
    .filter(
      (item) =>
        !query ||
        `${item.title} ${item.detail}`.toLocaleLowerCase().includes(query),
    )
    .slice(0, 80);
  state.commandIndex = Math.min(
    state.commandIndex,
    Math.max(0, state.commandItems.length - 1),
  );
  const results = $("#command-results");
  results.replaceChildren();
  for (const [index, item] of state.commandItems.entries()) {
    const button = el(
      "button",
      `command-item${index === state.commandIndex ? " selected" : ""}`,
    );
    const copy = el("div");
    copy.append(el("b", "", item.title), el("small", "", item.detail));
    button.append(ic(item.icon), copy);
    button.onclick = action(async () => {
      $("#command-dialog").close();
      await item.run();
    });
    results.append(button);
  }
  if (!state.commandItems.length)
    results.append(
      el("div", "empty-panel", query ? "没有匹配结果" : "输入文件名开始搜索"),
    );
}
function showInspector() {
  $(".app-shell").classList.remove("no-inspector");
  $("#toggle-inspector").classList.add("active");
}
function setNavActive(name) {
  for (const button of $$("[data-nav]"))
    button.classList.toggle("active", button.dataset.nav === name);
}
async function handleNavigation(name) {
  setNavActive(name);
  if (name === "workspace") {
    state.sessionView = "all";
    renderSidebar();
    return;
  }
  if (name === "worktrees") {
    state.sessionView = "worktrees";
    renderSidebar();
    if (!state.sessions.some((item) => item.environment === "worktree"))
      toast("还没有 Worktree 任务，可在新任务环境中创建");
    return;
  }
  if (name === "changes") {
    showInspector();
    setPanel("changes");
    return;
  }
  if (name === "github") {
    const root =
      state.activeSession?.cwd ||
      activeProject()?.path ||
      state.projectInfo?.root;
    let info = state.projectInfo;
    if (!info || info.root !== root) {
      try {
        info = await api("project-info?" + workspaceQuery());
        if (root === state.projectInfo?.root || state.projectInfo === null) {
          state.projectInfo = info;
          renderHeader();
        }
      } catch (error) {
        return toast(error.message);
      }
    }
    const remote = githubUrl(info?.remote || "");
    if (!remote) return toast("当前项目未配置可打开的 origin 远程仓库");
    // CCDPH-FIX(FE-10): origin 完全由仓库配置决定，而 window.open 最终会落到
    // desktop.cjs 的 shell.openExternal（用户真实浏览器）——被 agent/hook 改写 origin
    // 的项目就能把用户静默引导到任意站点。只放行公认托管域名，且必须是 https。
    const target = trustedRepoUrl(remote);
    if (!target)
      return toast("为安全起见，只允许打开 GitHub / GitLab / Bitbucket 等托管仓库地址");
    window.open(target, "_blank", "noopener,noreferrer");
    return;
  }
  if (name === "settings") openSettings();
}
const TRUSTED_REPO_HOSTS = [
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "gitee.com",
  "codeberg.org",
];
function trustedRepoUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:") return "";
  const host = parsed.hostname.toLowerCase();
  const allowed = TRUSTED_REPO_HOSTS.some(
    (item) => host === item || host.endsWith(`.${item}`),
  );
  return allowed ? parsed.href : "";
}
function githubUrl(remote) {
  if (/^https?:\/\//i.test(remote))
    return remote.replace(/\.git$/i, "").replace(/\/$/, "");
  const match = remote.match(
    /^(?:git@|ssh:\/\/git@|git\+ssh:\/\/git@)github\.com[:/](.+)$/i,
  );
  return match ? `https://github.com/${match[1].replace(/\.git$/i, "")}` : "";
}

$("#new-session").onclick = action(newSession);
$("#add-project").onclick = openProjectDialog;
$("#settings-button").onclick = openSettings;
$("#open-setup-settings").onclick = () => openSettings("environment");
for (const selector of ["#model", "#permission-mode", "#effort"])
  $(selector).onchange = action(syncCurrentSessionControls);
$("#usage-status").onclick = () => action(() => refreshProviderUsage(true))();
$("#show-archived").onclick = () => {
  state.archived = !state.archived;
  renderSidebar();
};
$("#task-search").oninput = () => {
  clearTimeout(taskSearchTimer);
  taskSearchTimer = setTimeout(renderSidebar, 180);
};
$("#collapse-sidebar").onclick = () => {
  $(".app-shell").classList.add("sidebar-collapsed");
  $("#sidebar").classList.add("hidden");
  $("#reopen-sidebar").classList.remove("hidden");
};
$("#reopen-sidebar").onclick = () => {
  $(".app-shell").classList.remove("sidebar-collapsed");
  $("#sidebar").classList.remove("hidden");
  $("#reopen-sidebar").classList.add("hidden");
};
for (const button of $$("[data-nav]"))
  button.onclick = () => handleNavigation(button.dataset.nav);
$("#toggle-inspector").onclick = () => {
  const hidden = $(".app-shell").classList.toggle("no-inspector");
  $("#toggle-inspector").classList.toggle("active", !hidden);
};
$("#open-terminal").onclick = () => {
  showInspector();
  setPanel("terminal");
};
$("#reveal-project").onclick = action(() => {
  if (!activeProject()) throw new Error("请先添加项目");
  return api("reveal", {
    projectId: state.projectId,
    sessionId: state.sessionId,
  });
});
for (const button of $$(".panel-tab"))
  button.onclick = () => setPanel(button.dataset.panel);
$("#refresh-panel").onclick = action(() =>
  state.panel === "terminal" ? startTerminal() : refreshWorkspace(),
);
$("#file-search").oninput = () => {
  clearTimeout(fileSearchTimer);
  fileSearchTimer = setTimeout(action(searchFiles), 220);
};
$("#review-changes").onclick = () => {
  $("#prompt").value =
    "审查当前工作区的所有修改。重点检查明确的逻辑错误、安全问题、回归风险和缺失的必要测试，并给出文件与位置依据。";
  $("#prompt").focus();
};
$("#add-context").onclick = () => openCommandPalette("files");
$("#add-image").onclick = () => $("#image-input").click();
$("#image-input").onchange = (event) => {
  const files = [...event.target.files];
  action(() => addImages(files))();
  event.target.value = "";
};
for (const eventName of ["dragenter", "dragover"])
  $("#composer").addEventListener(eventName, (event) => {
    if (event.dataTransfer?.types.includes("Files")) {
      event.preventDefault();
      $("#composer").classList.add("image-drop");
    }
  });
for (const eventName of ["dragleave", "drop"])
  $("#composer").addEventListener(eventName, (event) => {
    $("#composer").classList.remove("image-drop");
    if (eventName === "drop" && event.dataTransfer?.files?.length) {
      event.preventDefault();
      action(() => addImages(event.dataTransfer.files))();
    }
  });
$("#prompt").addEventListener("paste", (event) => {
  const files = [...(event.clipboardData?.files || [])].filter((file) =>
    file.type.startsWith("image/"),
  );
  if (files.length) {
    event.preventDefault();
    action(() => addImages(files))();
  }
});
$("#restart-terminal").onclick = action(() => startTerminal(true));
$("#terminal-form").onsubmit = (event) => {
  event.preventDefault();
  action(async () => {
    const input = $("#terminal-input"),
      command = input.value;
    if (!command.trim()) return;
    if (!state.terminalId || state.terminalExited) await startTerminal();
    // CCDPH-FIX(AUDIT-15): startTerminalOnce 在没有项目时只 toast 就返回，terminalId 仍是 null，
    // 原代码随即 POST {id:null} 并拿到服务端的「终端不存在」—— 用户敲的命令被丢掉，
    // 只看到一句与真实原因无关的报错。这里重新确认一次。
    if (!state.terminalId) return;
    await api("terminal/input", {
      id: state.terminalId,
      text: command + "\r\n",
    });
    input.value = "";
  })();
};
$("#project-form").onsubmit = (event) => {
  event.preventDefault();
  action(async () => {
    const project = await api("projects", {
      path: $("#project-path").value.trim().replace(/^"|"$/g, ""),
    });
    $("#project-dialog").close();
    await refreshState();
    await selectProject(project.id);
  })();
};
$("#browse-folder").onclick = action(async () => {
  const button = $("#browse-folder");
  button.disabled = true;
  try {
    const result = await api("pick-folder", {});
    if (result.path) $("#project-path").value = result.path;
  } finally {
    button.disabled = false;
  }
});
$("#rename-form").onsubmit = (event) => {
  event.preventDefault();
  action(async () => {
    await updateSession({ title: $("#rename-input").value });
    $("#rename-dialog").close();
  })();
};
for (const button of $$("[data-close]"))
  button.onclick = () => document.getElementById(button.dataset.close).close();
$("#settings-dialog .settings-shell")?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const tag = (event.target.tagName || "").toLowerCase();
  if (tag === "input" && event.target.type !== "button" && event.target.type !== "submit") {
    event.preventDefault();
    event.target.blur();
    return;
  }
  // CCDPH-FIX(P3-32): 焦点在 <select> 上按 Enter 会触发 method="dialog" 表单提交并**关闭设置窗**。
  // 一并拦掉（与 input 同样处理：阻止默认行为并移开焦点）。
  if (tag === "select") {
    event.preventDefault();
    event.target.blur();
  }
});
for (const button of $$("#task-menu [data-action]"))
  button.onclick = action(() => handleTaskAction(button.dataset.action));
$("#reveal-file").onclick = action(
  () =>
    state.previewPath &&
    api("reveal", {
      projectId: state.projectId,
      sessionId: state.sessionId,
      path: state.previewPath,
    }),
);
$("#diff-feedback").onsubmit = (event) => {
  event.preventDefault();
  const feedback = $("#diff-feedback-input").value.trim();
  if (!feedback) return;
  $("#prompt").value = `关于文件 @${state.previewPath} 的当前差异：${feedback}`;
  $("#preview-dialog").close();
  $("#prompt").focus();
};
$("#theme-setting").onchange = () => applyTheme($("#theme-setting").value);
for (const selector of [
  "#font-setting",
  "#font-size-setting",
  "#density-setting",
  "#reduce-motion-setting",
  "#show-thinking-setting",
  "#default-inspector-setting",
])
  $(selector).onchange = saveAppearanceSettings;
for (const selector of [
  "#close-to-tray-setting",
  "#restore-session-setting",
  "#auto-name-setting",
  "#notifications-setting",
  "#notification-sound-setting",
  "#notify-focused-setting",
  "#native-approval-setting",
  "#default-model-setting",
  "#default-effort-setting",
  "#max-turns-setting",
  "#default-permission",
  "#usage-auto-refresh-setting",
  "#usage-refresh-setting",
  "#default-environment",
  "#terminal-shell-setting",
  "#terminal-retention-setting",
  "#terminal-output-setting",
  "#history-limit-setting",
  "#auto-update-setting",
  "#resource-cleanup-setting",
  "#persona-setting",
  "#language-setting",
])
  $(selector).onchange = action(saveSettings);
$("#persona-custom").onchange = action(saveSettings);
// 输入即存（防抖）：避免打完字直接关软件时，靠失焦触发 change 丢掉最后一段
let personaSaveTimer = null;
$("#persona-custom").addEventListener("input", () => {
  clearTimeout(personaSaveTimer);
  personaSaveTimer = setTimeout(() => {
    void api("settings", {
      personaId: $("#persona-setting").value,
      personaCustom: $("#persona-custom").value.trim(),
    }).then(() => {
      state.settings.personaCustom = $("#persona-custom").value.trim();
    }).catch((err) => toast("人格保存失败：" + (err?.message || err)));
  }, 800);
});
$("#persona-setting").addEventListener("change", () => {
  $("#persona-custom-row").classList.toggle(
    "hidden",
    $("#persona-setting").value !== "custom",
  );
});
$("#language-setting").addEventListener("change", (event) => {
  if (event.target.value !== "zh-CN") {
    toast("英文界面正在翻译中，当前版本先提供简体中文");
    event.target.value = "zh-CN";
  }
});
for (const button of $$(".shortcut-edit[data-shortcut]")) {
  button.onclick = () => {
    shortcutRecording = { name: button.dataset.shortcut, button };
    button.querySelector("kbd").textContent = "按下组合键…";
  };
}
// ---- 用量统计图（设置 → 使用情况和计费） ----
// 把刻度上限取整到 1/2/2.5/5×10^n 的"好看"步长（5 档刻度）
function usageNiceStep(value) {
  if (!(value > 0)) return 1;
  const rough = value / 4;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const frac = rough / power;
  const nice =
    frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10;
  return nice * power;
}
const usageFormatTokens = (value) => {
  if (value >= 1e9)
    return `${Number((value / 1e9).toFixed(1))}B`;
  if (value >= 1e6) return `${Number((value / 1e6).toFixed(1))}M`;
  if (value >= 1000) return `${Number((value / 1000).toFixed(1))}k`;
  return String(Math.round(value));
};
// Catmull-Rom 转三次贝塞尔，得到平滑曲线的 path d；yClamp 钳制控制点，
// 防止尖峰两侧的贝塞尔过冲画出坐标区（下穿 0 线）之外
function smoothPath(points, yClamp) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  const clampY = (y) =>
    yClamp ? Math.min(Math.max(y, yClamp[0]), yClamp[1]) : y;
  let d = `M ${points[0][0]} ${clampY(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = clampY(p1[1] + (p2[1] - p0[1]) / 6);
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = clampY(p2[1] - (p3[1] - p1[1]) / 6);
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0]} ${clampY(p2[1])}`;
  }
  return d;
}
async function renderUsageChart() {
  const target = $("#usage-chart");
  if (!target) return;
  let data;
  try {
    data = await api("usage-daily?days=14");
  } catch {
    target.textContent = "用量数据加载失败";
    return;
  }
  const days = data.days || [];
  const symbol = activeCurrencySymbol();
  const totalTokens = days.reduce(
    (sum, day) => sum + day.inputTokens + day.outputTokens,
    0,
  );
  const totalUsd = days.reduce((sum, day) => sum + (day.costUsd || 0), 0);
  const totalCny = days.reduce((sum, day) => sum + (day.costCny || 0), 0);
  const totalTarget = $("#usage-chart-total");
  if (totalTarget) {
    const parts = [`${(totalTokens / 1000).toFixed(1)}k tokens`];
    if (totalUsd > 0) parts.push(`${totalUsd.toFixed(4)} USD`);
    if (totalCny > 0) parts.push(`\u00A5${totalCny.toFixed(2)} CNY`);
    totalTarget.textContent = `14d total: ${parts.join(" ")}`;
  }
  // 坐标系：绘图区 左52（Y 轴刻度）/ 上12 / 右24 / 下30（日期）
  const width = 680,
    height = 280,
    plotX = 52,
    plotY = 12,
    plotW = width - plotX - 24,
    plotH = height - plotY - 30,
    baseY = plotY + plotH;
  const maxTokens = Math.max(
    0,
    ...days.map((day) => day.inputTokens + day.outputTokens),
  );
  const step = usageNiceStep(maxTokens);
  const axisMax = step * 4;
  const parts = [
    `<svg viewBox="0 0 ${width} ${height}" class="usage-chart-svg" role="img" aria-label="最近 14 天 token 用量">`,
    `<defs><linearGradient id="usage-grad-output" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="color-mix(in srgb, var(--accent) 28%, transparent)"></stop>`,
    `<stop offset="1" stop-color="color-mix(in srgb, var(--accent) 0%, transparent)"></stop>`,
    `</linearGradient></defs>`,
  ];
  // Y 轴：5 档网格线 + 刻度；0 刻度省略文字（与 X 轴首标签打架，基线自明）
  for (let tick = 0; tick <= 4; tick++) {
    const value = step * tick;
    const y = baseY - (value / axisMax) * plotH;
    parts.push(
      `<line x1="${plotX}" y1="${y.toFixed(1)}" x2="${plotX + plotW}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-dasharray="3 4"></line>`,
    );
    if (tick > 0)
      parts.push(
        `<text x="${plotX - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="var(--muted)" font-size="10">${usageFormatTokens(value)}</text>`,
      );
  }
  // X 轴：每 2 天一个标签，且最后一个数据点必须有标签；
  // 首标签左对齐、尾标签右对齐，避免贴边被裁或与相邻标签打架
  const xAt = (index) =>
    plotX + (days.length > 1 ? (index / (days.length - 1)) * plotW : plotW / 2);
  const last = days.length - 1;
  days.forEach((day, index) => {
    if (index % 2 === 0 || index === last) {
      const anchor =
        index === 0 ? "start" : index === last ? "end" : "middle";
      parts.push(
        `<text x="${xAt(index).toFixed(1)}" y="${height - 8}" text-anchor="${anchor}" fill="var(--muted)" font-size="10">${escapeHtml(day.date.slice(5).replace("-", "/"))}</text>`,
      );
    }
  });
  // 两条平滑曲线（输入 / 输出），全 0 也贴基线正常绘制；数值钳制在 [0, axisMax]
  const tokenY = (value) =>
    baseY - (Math.min(Math.max(value, 0), axisMax) / axisMax) * plotH;
  const inputPoints = days.map((day, index) => [xAt(index), tokenY(day.inputTokens)]);
  const outputPoints = days.map((day, index) => [
    xAt(index),
    tokenY(day.outputTokens),
  ]);
  const outputLine = smoothPath(outputPoints, [plotY, baseY]);
  const inputLine = smoothPath(inputPoints, [plotY, baseY]);
  if (outputLine && days.length > 1) {
    const first = outputPoints[0],
      last = outputPoints[outputPoints.length - 1];
    parts.push(
      `<path d="${outputLine} L ${last[0].toFixed(1)} ${baseY} L ${first[0].toFixed(1)} ${baseY} Z" fill="url(#usage-grad-output)" stroke="none"></path>`,
    );
  }
  parts.push(
    `<path d="${outputLine}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round"></path>`,
    `<path d="${inputLine}" fill="none" stroke="color-mix(in srgb, var(--accent) 45%, var(--panel))" stroke-width="2" stroke-linecap="round"></path>`,
  );
  // 数据点：两条曲线各一个 circle；悬浮信息由容器级 HTML tooltip 显示（即时、可样式化）
  days.forEach((day, index) => {
    const costParts = [];
    if (day.costUsd) costParts.push(`${day.costUsd.toFixed(4)}`);
    if (day.costCny) costParts.push(`\u00A5${day.costCny.toFixed(2)}`);
    const tip = `${day.date.slice(5).replace("-", "/")} in ${day.inputTokens.toLocaleString()} out ${day.outputTokens.toLocaleString()}${costParts.length ? " " + costParts.join(" ") : ""}`;
    for (const [points, color] of [
      [inputPoints, "color-mix(in srgb, var(--accent) 45%, var(--panel))"],
      [outputPoints, "var(--accent)"],
    ]) {
      parts.push(
        `<circle class="usage-dot" cx="${points[index][0].toFixed(1)}" cy="${points[index][1].toFixed(1)}" r="4" fill="${color}" stroke="var(--elevated)" stroke-width="1.5" data-tip="${escapeHtml(tip)}"></circle>`,
      );
    }
  });
  parts.push("</svg>");
  // 用 SVG XML 解析器构造独立命名空间节点，不再把 SVG 字符串注入 HTML 解析上下文。
  const svgDocument = new DOMParser().parseFromString(
    parts.join(""),
    "image/svg+xml",
  );
  if (svgDocument.querySelector("parsererror"))
    throw new Error("用量图 SVG 构造失败");
  target.replaceChildren(document.importNode(svgDocument.documentElement, true));
  // 空态提示放在统计图下方（HTML），不塞进坐标系里
  if (!totalTokens)
    target.append(
      el(
        "div",
        "usage-chart-empty",
        "还没有用量记录：完成一轮任务后，这里会出现每日 token 统计。",
      ),
    );
  // 悬浮 tooltip：跟随数据点的自定义提示框（显示日期 / 输入 / 输出 / 消耗）
  const tipBox = document.createElement("div");
  tipBox.className = "usage-chart-tip hidden";
  target.append(tipBox);
  target.onmouseover = (event) => {
    const dot = event.target.closest?.(".usage-dot");
    if (!dot) return tipBox.classList.add("hidden");
    tipBox.textContent = dot.dataset.tip || "";
    tipBox.classList.remove("hidden");
    const host = target.getBoundingClientRect();
    const dotRect = dot.getBoundingClientRect();
    // 先显示再测量宽度，左右钳制在容器内，首尾点不溢出
    const half = tipBox.offsetWidth / 2;
    const cx = Math.max(half + 2, Math.min(dotRect.left - host.left + dotRect.width / 2, host.width - half - 2));
    tipBox.style.left = `${cx}px`;
    tipBox.style.top = `${dotRect.top - host.top - 8}px`;
  };
  target.onmouseleave = () => tipBox.classList.add("hidden");
  target.onmouseout = (event) => {
    if (event.target.closest?.(".usage-dot")) tipBox.classList.add("hidden");
  };
}
$("#update-manifest-setting").onchange = action(saveSettings);
$("#api-mode-setting").onchange = action(async () => {
  syncApiModeFields();
  await saveSettings();
  toast(
    $("#api-mode-setting").value === "profile"
      ? "已切换为供应商配置模式，下一次发送消息生效"
      : "已切换回 CC Switch，下一次发送消息生效",
  );
});
// ---- 多供应商配置 ----
for (const template of PROVIDER_TEMPLATES) {
  const chip = el("button", "api-template-chip", template.name);
  chip.type = "button";
  chip.onclick = () => {
    apiProfileDraft = null;
    $("#api-profile-name").value = template.name;
    $("#api-profile-url").value = template.baseUrl;
    $("#api-profile-model").value = template.model;
    $("#api-profile-currency").value = template.currency || "CNY";
    $("#api-profile-editing-hint").textContent = "新增模式（模板已填入）";
    $("#api-profile-name").focus();
  };
  $("#api-template-chips").append(chip);
}
const profileEnvPayload = () => {
  const model = $("#api-profile-model").value.trim();
  return model ? { ANTHROPIC_MODEL: model } : {};
};
$("#api-profile-save").onclick = action(async () => {
  const result = await api("api-profiles/save", {
    id: apiProfileDraft?.id,
    name: $("#api-profile-name").value,
    baseUrl: $("#api-profile-url").value,
    currency: $("#api-profile-currency").value,
    env: profileEnvPayload(),
  });
  toast(`供应商「${result.name}」已保存`);
  // 保存后立即切到该供应商
  await api("api-profiles/activate", { id: result.id });
  await refreshState();
  await renderApiProfiles();
  $("#api-profile-key-status").textContent = result.hasKey
    ? "已配置（保存在本机，不会回显；留空保存即清除）"
    : "未配置";
});
$("#api-profile-key-save").onclick = action(async () => {
  if (!apiProfileDraft?.id) {
    // 还没保存过供应商时，先落库再存密钥
    const created = await api("api-profiles/save", {
      name: $("#api-profile-name").value,
      baseUrl: $("#api-profile-url").value,
      currency: $("#api-profile-currency").value,
      env: profileEnvPayload(),
    });
    apiProfileDraft = created;
    $("#api-profile-editing-hint").textContent = `正在编辑：${created.name}`;
  }
  const token = $("#api-profile-key").value;
  const result = await api("api-profiles/key", {
    id: apiProfileDraft.id,
    token,
  });
  $("#api-profile-key").value = "";
  $("#api-profile-key-status").textContent = result.hasKey
    ? result.persistent
      ? "已配置（系统安全存储加密，不会回显；留空保存即清除）"
      : "已配置（仅本次运行保存在内存中；退出后需重新输入）"
    : "未配置";
  toast(
    result.hasKey
      ? result.persistent
        ? "API 密钥已加密保存"
        : result.warning || "API 密钥仅在本次运行中可用"
      : "API 密钥已清除",
  );
  await renderApiProfiles();
});
$("#api-profile-reset").onclick = resetApiProfileForm;
$("#api-profile-export").onclick = exportApiProfiles;
for (const button of $$("[data-settings-tab]"))
  button.onclick = () => setSettingsTab(button.dataset.settingsTab);
$("#settings-search").oninput = searchSettings;
$("#settings-search").onkeydown = (event) => {
  if (event.key === "Enter") event.preventDefault();
};
$("#apply-defaults-current").onclick = action(async () => {
  if (!state.sessionId) return toast("请先选择会话");
  await updateSession({
    model: state.settings.defaultModel || "",
    effort: state.settings.defaultEffort || "inherit",
    permissionMode: state.settings.defaultPermissionMode || "default",
  });
  setModelSelect(state.activeSession?.model);
  $("#permission-mode").value =
    state.activeSession?.permissionMode || "default";
  renderSettingsDiagnostics();
  toast("已将默认模型、思考强度和权限应用到当前会话");
});
$("#refresh-provider-setting").onclick = action(async () => {
  await refreshProviderUsage(true);
  renderSettingsDiagnostics();
  toast("额度信息已刷新");
});
$("#settings-reveal-project").onclick = action(() => {
  if (!activeProject()) throw new Error("请先选择项目");
  return api("reveal", {
    projectId: state.projectId,
    sessionId: state.sessionId,
  });
});
$("#settings-open-github").onclick = action(() => handleNavigation("github"));
$("#settings-restart-terminal").onclick = action(async () => {
  if (!activeProject()) throw new Error("请先选择项目");
  $("#settings-dialog").close();
  showInspector();
  setPanel("terminal");
  await startTerminal(true);
});
$("#settings-open-data").onclick = action(() => api("reveal-data", {}));
$("#settings-git-refresh").onclick = action(async () => {
  await refreshWorkspace();
  renderSettingsDiagnostics();
  toast("Git 信息已刷新");
});
$("#settings-environment-reveal").onclick = action(() => {
  if (!activeProject()) throw new Error("请先选择项目");
  return api("reveal", {
    projectId: state.projectId,
    sessionId: state.sessionId,
  });
});
$("#pick-claude-executable").onclick = action(async () => {
  const result = await api("pick-file", {});
  if (!result.path) return;
  $("#claude-executable-setting").value = result.path;
  await applyClaudeExecutableChange();
});
$("#claude-executable-setting").onchange = action(async () => {
  await applyClaudeExecutableChange();
});
$("#redetect-claude").onclick = action(async () => {
  const button = $("#redetect-claude");
  button.disabled = true;
  try {
    await api("claude/detect", {});
    await refreshState();
    renderSettingsDiagnostics();
    const claude = state.runtime?.claude;
    toast(
      claude?.error
        ? `未检测到 Claude Code：${claude.error}`
        : `已连接 Claude Code ${claude?.version || ""}`,
    );
  } finally {
    button.disabled = false;
  }
});
$("#check-update").onclick = action(async () => {
  const status = $("#update-check-status");
  status.textContent = "正在检查更新…";
  const result = await api("update/check");
  state.updateStatus = result;
  if (result.error) {
    status.textContent = result.error;
    $("#install-update").classList.add("hidden");
    return;
  }
  if (result.updateAvailable) {
    status.textContent = `发现新版本 ${result.latest}（当前 ${result.current}）${result.notes ? ` · ${result.notes}` : ""}`;
    $("#install-update").classList.remove("hidden");
  } else {
    status.textContent = `已是最新版本（${result.current}）`;
    $("#install-update").classList.add("hidden");
  }
});
let updatePollTimer = null;
let updatePollInFlight = false;
function clearUpdatePollTimer() {
  if (updatePollTimer !== null) clearInterval(updatePollTimer);
  updatePollTimer = null;
}
async function pollUpdateStatus() {
  if (updatePollInFlight) return;
  updatePollInFlight = true;
  const status = $("#update-check-status");
  const installButton = $("#install-update");
  try {
    let job;
    try {
      job = await api("update/status");
    } catch {
      return; // 服务端可能正在重启替换文件，下一轮再试
    }
    if (job.running) {
      status.textContent = `正在后台更新：${job.stage || "处理中"}…`;
      return;
    }
    clearUpdatePollTimer();
    if (job.error) {
      status.textContent = `更新失败：${job.error}`;
      installButton.disabled = false;
      return;
    }
    if (job.stage === "完成") {
      status.textContent = "更新包已就绪，即将重启…";
      toast("应用将自动退出并完成更新");
      setTimeout(() => {
        if (window.workbenchDesktop?.quitForUpdate) window.workbenchDesktop.quitForUpdate();
        else window.close();
      }, 1500);
    } else {
      installButton.disabled = false;
    }
  } finally {
    updatePollInFlight = false;
  }
}
function startUpdatePolling() {
  clearUpdatePollTimer();
  updatePollTimer = setInterval(() => void pollUpdateStatus(), 2000);
}
$("#install-update").onclick = action(async () => {
  if (
    !(await confirmAction(
      "下载并安装新版本？\n完成后会自动退出、替换程序文件并重新启动。",
      "安装更新",
      "下载并安装",
    ))
  )
    return;
  const status = $("#update-check-status");
  const installButton = $("#install-update");
  installButton.disabled = true;
  // CCDPH-FIX(H-9): 安装接口已后台化 —— 服务端立即返回 { started, jobId }，前端每 2 秒
  // 轮询 /api/update/status 并显示阶段；running 期间保持安装按钮禁用。闸门被占（409）
  // 时 api() 会以服务端错误文案抛出，直接展示即可。完成后应用被 apply-update.bat
  // 自动退出并重启，无需其他交互。
  try {
    await api("update/install", {});
  } catch (error) {
    status.textContent = error?.message || "更新任务启动失败";
    installButton.disabled = false;
    return;
  }
  status.textContent = "正在后台下载更新包…";
  toast("更新任务已开始，正在后台下载更新包");
  startUpdatePolling();
  await pollUpdateStatus();
});
for (const selector of [
  "#default-environment-secondary",
  "#default-environment-worktree",
])
  $(selector).onchange = action(async (event) => {
    $("#default-environment").value = event.target.value;
    await saveSettings();
    toast("默认工作环境已更新");
  });
$("#refresh-integrations-setting").onclick = action(async () => {
  await refreshIntegrations();
  toast("MCP、Skills、Hooks 和插件状态已刷新");
});
$("#open-claude-config-setting").onclick = action(() =>
  api("reveal-claude-config", {}),
);
$("#clear-archived-setting").onclick = action(async () => {
  if (
    !(await confirmAction(
      "删除所有已归档的 Workbench 任务记录？此操作不能撤销。",
      "清除归档",
      "清除",
    ))
  )
    return;
  const result = await api("clear-archived", {});
  await refreshState();
  toast(`已清空 ${result.removed} 个归档任务`);
});
$("#zoom-out").onclick = () => setZoom(-10);
$("#zoom-in").onclick = () => setZoom(10);

$("#composer").onsubmit = (event) => {
  event.preventDefault();
  action(async () => {
    const displayPrompt = $("#prompt").value.trim();
    if ((!displayPrompt && !state.images.length) || state.running || submitting)
      return;
    const requestPrompt =
      displayPrompt || "请识别这些图片并描述其中的关键内容。";
    hideSlashMenu();
    const draftImages = state.images.slice();
    const draftContextFiles = state.contextFiles.slice();
    if (!activeProject()) return openProjectDialog();
    submitting = true;
    $("#send").disabled = true;
    try {
      if (!state.sessionId && !(await ensureSession())) return;
      if (draftImages.length) state.images = draftImages;
      if (draftContextFiles.length) state.contextFiles = draftContextFiles;
      const sessionId = state.sessionId;
      const context = state.contextFiles.length
        ? `\n\n请同时参考这些项目文件：\n${state.contextFiles.map((file) => `- ${file}`).join("\n")}`
        : "";
      const images = state.images.map(({ name, type, data, preview }) => ({
        name,
        type,
        data,
        preview,
      }));
      await api("send", {
        sessionId,
        prompt: requestPrompt + context,
        displayPrompt: requestPrompt,
        images,
        model: $("#model").value,
        permissionMode: $("#permission-mode").value,
        effort: $("#effort").value,
      });
      if (state.sessionId === sessionId) {
        $("#prompt").value = "";
        state.contextFiles = [];
        state.images = [];
        renderContext();
        state.running = true;
        connectSession();
      }
      await refreshState();
    } finally {
      submitting = false;
      $("#send").disabled = false;
    }
  })();
};
$("#prompt").oninput = () => {
  clearTimeout(slashTimer);
  slashTimer = setTimeout(() => void renderSlashMenu(), 80);
};
$("#prompt").onkeydown = (event) => {
  if (!$("#slash-menu").classList.contains("hidden") && slashItems.length) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      slashIndex =
        (slashIndex +
          (event.key === "ArrowDown" ? 1 : -1) +
          slashItems.length) %
        slashItems.length;
      highlightSlashItem(); // CCDPH-FIX(AUDIT-10): 只切高亮，不再为每次按键重发请求
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      selectSlashSkill();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      hideSlashMenu();
      return;
    }
  }
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("#composer").requestSubmit();
  }
};
$("#stop").onclick = action(() => api("stop", { sessionId: state.sessionId }));
for (const button of $$("[data-prompt]"))
  button.onclick = () => {
    $("#prompt").value = button.dataset.prompt;
    $("#prompt").focus();
    if (!activeProject()) openProjectDialog();
  };

$("#command-input").oninput = () => {
  clearTimeout(commandSearchTimer);
  commandSearchTimer = setTimeout(action(renderCommandItems), 160);
};
$("#command-input").onkeydown = (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    state.commandIndex = Math.max(
      0,
      Math.min(
        state.commandItems.length - 1,
        state.commandIndex + (event.key === "ArrowDown" ? 1 : -1),
      ),
    );
    renderCommandItems();
  }
  if (event.key === "Enter") {
    event.preventDefault();
    $("#command-results .command-item.selected")?.click();
  }
};
const handleAppCommand = (detail) => {
  if (detail === "new-session") action(newSession)();
  if (detail === "command-palette") openCommandPalette();
  if (detail === "settings") openSettings();
  if (detail?.type === "fullscreen") setFullscreen(detail.enabled);
  if (detail?.type === "select-session")
    action(() => selectSession(detail.id))();
};
window.workbenchDesktop?.onAppCommand?.(handleAppCommand);
// ---- 快捷键：设置里可录制修改，组合串格式 "ctrl+n" / "f11" ----
const DEFAULT_SHORTCUTS = { newSession: "ctrl+n", palette: "ctrl+k", settings: "ctrl+," };
function shortcutCombo(event) {
  const parts = [];
  if (event.ctrlKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  if (event.metaKey) parts.push("meta");
  const key = event.key.toLowerCase();
  if (["control", "alt", "shift", "meta"].includes(key)) return "";
  // CCDPH-FIX(F7): 空格键的 event.key 是 " "，必须规范化为 "space"。
  // 否则拼出的 "ctrl+ " 过不了服务端校验，用户会以为保存成功其实没生效。
  // （arrowup / pageup / home / enter 等本来就能通过服务端正则）
  parts.push(key === " " ? "space" : key);
  return parts.join("+");
}
function shortcutMatches(event, name) {
  const combo = (state.settings.shortcuts?.[name] || DEFAULT_SHORTCUTS[name] || "").toLowerCase();
  return combo && shortcutCombo(event) === combo;
}
let shortcutRecording = null; // { name, button }
function formatShortcut(combo) {
  if (!combo) return "未设置";
  // CCDPH-FIX(FE-04): "ctrl++".split("+") → ["ctrl","",""]，空片段走到 part[0].toUpperCase()
  // 抛 TypeError；它从 refreshShortcutButtons() 冒到 openSettings()，而 openSettings() 是
  // 先 fillSettingsControls() 再 showModal() —— 于是**设置窗口彻底打不开**。
  return String(combo)
    .split("+")
    .filter(Boolean)
    .map((part) =>
      part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1),
    )
    .join("+");
}
function refreshShortcutButtons() {
  for (const button of $$(".shortcut-edit[data-shortcut]")) {
    const name = button.dataset.shortcut;
    button.querySelector("kbd").textContent = formatShortcut(
      state.settings.shortcuts?.[name] || DEFAULT_SHORTCUTS[name],
    );
  }
}
function stopShortcutRecording(save) {
  if (!shortcutRecording) return;
  const name = shortcutRecording.name;
  // 录制时本地已先写入期望值；这里提交后以服务端返回为准回写，
  // 被服务端丢弃的组合键不会在界面上"假装已保存"。
  const wanted = state.settings.shortcuts?.[name] || "";
  shortcutRecording = null;
  refreshShortcutButtons();
  if (!save) return;
  void api("settings", { shortcuts: state.settings.shortcuts || {} })
    .then((res) => {
      const stored = res && res.shortcuts ? res.shortcuts : null;
      if (stored) {
        state.settings.shortcuts = { ...DEFAULT_SHORTCUTS, ...stored };
        refreshShortcutButtons();
      }
      if (wanted && stored && !stored[name]) toast("这个组合键不受支持，未能保存");
      else if (stored && stored[name]) toast(`快捷键已保存：${formatShortcut(stored[name])}`);
      else toast("快捷键已保存");
    })
    .catch((err) => toast(`快捷键保存失败：${err?.message || err}`));
}
document.addEventListener("keydown", (event) => {
  if (shortcutRecording) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") return stopShortcutRecording(false);
    if (event.key === "Backspace") {
      delete state.settings.shortcuts[shortcutRecording.name];
      return stopShortcutRecording(true);
    }
    const combo = shortcutCombo(event);
    if (!combo) return;
    // CCDPH-FIX(FE-04): `+` 键拼出的组合串必然含空片段（"ctrl++"），服务端 SHORTCUT_RE
    // 不接受它，格式化成按钮文字时还会抛错。这里直接拒绝并提示，不再让它污染设置界面。
    if (combo.split("+").some((part) => !part)) {
      toast("这个组合键不受支持");
      return stopShortcutRecording(false);
    }
    // CCDPH-FIX(F7): 不再在此处先 toast「已设置」，统一由 stopShortcutRecording 处理
    // 依据服务端返回的真实结果提示（否则被拒时仍会显示成功，且出现两条 toast）。
    state.settings.shortcuts[shortcutRecording.name] = combo;
    return stopShortcutRecording(true);
  }
  if (shortcutMatches(event, "newSession")) {
    event.preventDefault();
    action(newSession)();
  }
  if (shortcutMatches(event, "palette")) {
    event.preventDefault();
    openCommandPalette();
  }
  if (shortcutMatches(event, "settings")) {
    event.preventDefault();
    openSettings();
  }
  if (event.key === "F11") {
    event.preventDefault();
    window.workbenchDesktop?.toggleFullscreen();
  }
  if (
    event.key === "Escape" &&
    document.body.classList.contains("is-fullscreen")
  )
    window.workbenchDesktop?.toggleFullscreen();
});

function setFullscreen(enabled) {
  document.body.classList.toggle("is-fullscreen", enabled);
  $("#fullscreen-exit").classList.toggle("hidden", !enabled);
}
window.workbenchDesktop?.onFullscreenChange(setFullscreen);
// CCDPH-FIX(L-10): state.nativeApprovalIds 原先是一个无上限的 Set —— 任何漏掉 resolved
// 回调的原生确认（窗口被系统关掉、主进程重载、提交竞态）都会永久留在集合里，还会连带
// 屏蔽页面内的确认面板。改成 Map<id, 时间戳> 并按 10 分钟过期（Map 同样有 has/delete）。
const NATIVE_APPROVAL_TTL = 10 * 60000;
function pruneNativeApprovalIds() {
  const now = Date.now();
  for (const [id, at] of state.nativeApprovalIds)
    if (now - at > NATIVE_APPROVAL_TTL) state.nativeApprovalIds.delete(id);
}
// 原生确认只影响确认面板，不需要整表 renderMessages()（那正是 FE-01 的 2 秒冻结）
function syncNativeApprovalState() {
  pruneNativeApprovalIds();
  renderApprovalDock();
  if (renderState.workingNode?.isConnected)
    renderState.workingNode.textContent = workingLabel();
}
window.workbenchDesktop?.onNativeApproval((requestId) => {
  state.nativeApprovalIds.set(requestId, Date.now());
  syncNativeApprovalState();
});
window.workbenchDesktop?.onNativeApprovalResolved((requestId) => {
  state.nativeApprovalIds.delete(requestId);
  syncNativeApprovalState();
});
$("#fullscreen-exit").onclick = () =>
  window.workbenchDesktop?.toggleFullscreen();

initializeZoom();
setupComposerSelects();
applyInspectorPreference();
let providerUsageTimer = null;
let rendererVisibilityRestorePending = false;
function scheduleProviderUsageRefresh() {
  clearInterval(providerUsageTimer);
  providerUsageTimer = null;
  if (state.settings.usageAutoRefresh === false) return;
  const interval = Math.max(1, Number(state.settings.usageRefreshMinutes) || 1);
  providerUsageTimer = setInterval(() => {
    if (!document.hidden) void refreshProviderUsage(true);
  }, interval * 60000);
}
function handleVisibilityChange() {
  if (document.hidden) return;
  if (rendererVisibilityRestorePending) {
    rendererVisibilityRestorePending = false;
    if (state.sessionId) connectSession();
    action(refreshState)();
  }
  if (state.settings.usageAutoRefresh !== false) void refreshProviderUsage(true);
}
// CCDPH-FIX(L-04): 窗口重新可见且终端面板处于激活态时补渲染一次，flush 隐藏期间累积的输出
function handleTerminalVisibility() {
  if (!document.hidden && state.panel === "terminal") renderTerminal();
}
document.addEventListener("visibilitychange", handleTerminalVisibility);
document.addEventListener("visibilitychange", handleVisibilityChange);
document.addEventListener("click", (event) => {
  const taskMenu = $("#task-menu");
  if (taskMenu?.open && !taskMenu.contains(event.target))
    taskMenu.removeAttribute("open");
  // 供应商切换器：点击菜单外任意位置收起（details 原生没有外点关闭）
  for (const details of $$("details.provider-switcher[open]"))
    if (!details.contains(event.target)) details.removeAttribute("open");
  for (const menu of $$(".composer-select-menu")) menu.classList.add("hidden");
  for (const trigger of $$(".composer-select-trigger"))
    trigger.setAttribute("aria-expanded", "false");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape")
    for (const details of $$("details.provider-switcher[open]"))
      details.removeAttribute("open");
});
let rendererDisposed = false;
function disposeRendererResources() {
  if (rendererDisposed) return;
  rendererDisposed = true;
  clearInterval(providerUsageTimer);
  clearUpdatePollTimer();
  clearTimeout(toastTimer);
  clearTimeout(fileSearchTimer);
  clearTimeout(taskSearchTimer);
  clearTimeout(commandSearchTimer);
  clearTimeout(slashTimer);
  clearTimeout(personaSaveTimer);
  // CCDPH-FIX(L-05): 退出时主动停掉服务端 shell。原先只关 SSE，PTY 只能等服务端保留期
  // （terminalRetentionMinutes，默认 5 分钟）到期；sendBeacon 在卸载阶段仍能发出请求。
  const terminalId = state.terminalId;
  if (terminalId && !state.terminalExited && navigator.sendBeacon)
    navigator.sendBeacon(
      "/api/terminal/stop",
      new Blob([JSON.stringify({ id: terminalId })], {
        type: "application/json",
      }),
    );
  disconnectSession({ preserveRenderedMessages: true });
  disconnectTerminalStream(true);
  // 释放 xterm 视图持有的 ResizeObserver 与终端实例，避免渲染资源泄漏
  terminalView?.resizeObserver?.disconnect?.();
  terminalView?.term?.dispose?.();
  // CCDPH-FIX(L-05): 必须置空，否则 bfcache 恢复（pageshow）时 ensureTerminalView() 会把
  // 已 dispose 的实例交回去 —— fit.fit() 抛错、term.write() 写进死终端。
  terminalView = null;
  systemTheme.removeEventListener("change", handleSystemThemeChange);
  window.workbenchDesktop?.offAppCommand?.(handleAppCommand);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  document.removeEventListener("visibilitychange", handleTerminalVisibility);
}
window.addEventListener("pagehide", disposeRendererResources);
window.addEventListener("beforeunload", disposeRendererResources);
// CCDPH-FIX(AUDIT-14): disposeRendererResources 同时挂在 pagehide 与 beforeunload 上，而 pageshow
// 恢复原先只把 terminalView 置空 —— 主题监听、两个 visibilitychange 监听已经被摘掉、
// providerUsageTimer 已被清、SSE 已关，恢复后的页面既不自动刷新也没有实时流（只能手动刷新救回）。
// 这里把恢复需要的重新挂载补齐；只在 bfcache 恢复（event.persisted）时做，避免首次加载多跑一遍
// refreshState（那会与文件末尾的初始化并发）。监听器用的是同一批函数引用，重复注册本身是幂等的。
function restoreRendererResources(event) {
  if (!event.persisted) return;
  rendererDisposed = false;
  terminalView = null;
  systemTheme.addEventListener("change", handleSystemThemeChange);
  window.workbenchDesktop?.onAppCommand?.(handleAppCommand);
  document.addEventListener("visibilitychange", handleTerminalVisibility);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  scheduleProviderUsageRefresh();
  if ($("#install-update")?.disabled) {
    startUpdatePolling();
    void pollUpdateStatus();
  }
  if (document.visibilityState !== "visible") {
    rendererVisibilityRestorePending = true;
    return;
  }
  rendererVisibilityRestorePending = false;
  if (state.sessionId) connectSession();
  action(refreshState)();
}
window.addEventListener("pageshow", restoreRendererResources);
action(async () => {
  await ensureSessionAuth().catch((error) =>
    console.warn("会话 Cookie 初始化失败，先使用一次性启动令牌继续加载界面", error),
  );
  await refreshState();
  $("#environment-mode").value = state.settings.defaultEnvironment || "local";
  $("#permission-mode").value =
    state.settings.defaultPermissionMode || "default";
  if (state.settings.autoCheckUpdates && state.settings.updateManifestUrl)
    action(async () => {
      const result = await api("update/check");
      if (result.updateAvailable)
        toast(`发现新版本 ${result.latest}：可在 设置 → 关于 中下载安装`);
    })();
  if (state.projectId)
    await selectProject(
      state.projectId,
      state.settings.restoreLastSession !== false,
    );
  else {
    renderSidebar();
    renderHeader();
    renderMessages();
    renderFiles([]);
    renderChanges({ files: [] });
  }
  renderUsage();
})();
