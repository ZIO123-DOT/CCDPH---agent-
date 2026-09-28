import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createTerminalProcessRegistry } from "./terminal-registry.mjs";
import { createDefaultCredentialProtector } from "./credential-protector.mjs";
import {
  classifyRouteDomain,
  createRouteDomainHandlers,
} from "./route-registry.mjs";
import { createWorkspaceIoRoute } from "./routes/workspace-io.mjs";
import { createIntegrationRoute } from "./routes/integration.mjs";
import { createWorkspaceMutationRoute } from "./routes/workspace-mutation.mjs";
export { classifyRouteDomain } from "./route-registry.mjs";
import {
  assertJsonDepth,
  browserRestrictions,
  canApplyPermissionModeLive,
  decodeJsonBuffer,
  isValidPort,
  maxNestingDepth,
  normalizePermissionMode,
  permissionOptions,
  PERMISSION_MODES,
  scanStateComplexity,
  SHORTCUT_MODIFIER_RE,
  SHORTCUT_NAMED_KEY_RE,
  SHORTCUT_RE,
} from "./server-policies.mjs";
export {
  assertJsonDepth,
  browserRestrictions,
  canApplyPermissionModeLive,
  decodeJsonBuffer,
  isValidPort,
  normalizePermissionMode,
  permissionOptions,
  PERMISSION_MODES,
} from "./server-policies.mjs";
import {
  assertJsonTextDepth,
  fitsJsonBudget,
  foldDeepStateSubtrees,
  previewBounded,
  STATE_CONTENT_MAX_DEPTH,
  STATE_SAFE_SERIALIZATION_DEPTH,
} from "./state-safety.mjs";
export {
  assertJsonTextDepth,
  fitsJsonBudget,
  foldDeepStateSubtrees,
  STATE_CONTENT_MAX_DEPTH,
  STATE_SAFE_SERIALIZATION_DEPTH,
} from "./state-safety.mjs";

const exec = promisify(execFile);
const WINDOWS_SYSTEM32 = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
);
const WINDOWS_TASKKILL_EXE = path.join(WINDOWS_SYSTEM32, "taskkill.exe");
const WINDOWS_WHERE_EXE = path.join(WINDOWS_SYSTEM32, "where.exe");
const WINDOWS_CMD_EXE = path.join(WINDOWS_SYSTEM32, "cmd.exe");
export const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.WORKBENCH_DATA_DIR || path.join(ROOT, ".data");
// 浏览器集成（设计文档 docs/browser-integration-design.md）
import { detectBrowsers, probeCdp, probeTabs } from "./browser/detect.mjs";
import { buildPlaywrightMcpConfig, browserMcpEnabled } from "./browser/mcp-config.mjs";
import { browserStatus, dedicatedEdgeState, launchDedicatedEdge, stopDedicatedEdge, sweepStaleDedicatedEdge, cdpEndpointFromSettings, cleanupScreenshots } from "./browser/service.mjs";
import { reconcileDedicatedBrowser, withBrowserSettingsTransition } from "./browser/lifecycle.mjs";
const token = randomBytes(32).toString("hex");
const streamAuthToken = randomBytes(32).toString("hex");
const STREAM_AUTH_COOKIE = "ccdph_stream_auth";
const port = Number(process.env.WORKBENCH_PORT || 4318);
const origin = `http://127.0.0.1:${port}`;
const CCSWITCH_DB =
  process.env.CCSWITCH_DB_PATH ||
  path.join(os.homedir(), ".cc-switch", "cc-switch.db");
const CLAUDE_CONFIG_DIR =
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
// CCDPH-FIX(R2-P2-12b): 用户级 MCP 配置就在 ~/.claude.json。原来这里写死
// `path.join(os.homedir(), ".claude.json")`，于是**任何**只改了 CLAUDE_CONFIG_DIR 的
// 测试/临时运行都会改写真实用户目录下的 .claude.json（实测：一次探针就把测试用的 MCP
// 条目写进了 C:\Users\<用户>\.claude.json）—— 与 README 里「离线套件全程使用临时数据
// 目录，不触碰部署目录」的承诺直接矛盾。改为跟随 CLAUDE_CONFIG_DIR 的父目录：
// 默认仍然是 ~/.claude.json（行为不变），而 CLAUDE_CONFIG_DIR=/tmp/x/.claude 时落到
// /tmp/x/.claude.json。
const MCP_FILE = path.join(path.dirname(CLAUDE_CONFIG_DIR), ".claude.json");
let DatabaseSync;
let providerUsageCache = { expiresAt: 0, value: null };
export function invalidateProviderUsageCache() {
  providerUsageCache = { expiresAt: 0, value: null };
}
const DEFAULT_SETTINGS = {
  notifications: true,
  notificationSound: true,
  notifyWhenFocused: false,
  nativeApprovalWindow: true,
  closeToTray: true,
  defaultPermissionMode: "default",
  defaultEnvironment: "local",
  defaultModel: "",
  defaultEffort: "inherit",
  maxTurns: 0,
  terminalShell: "system",
  terminalRetentionMinutes: 5,
  terminalOutputLimit: 200000,
  restoreLastSession: true,
  autoNameSessions: true,
  usageAutoRefresh: true,
  usageRefreshMinutes: 1,
  historyLimit: 2500,
  claudeExecutable: "",
  updateManifestUrl: "",
  autoCheckUpdates: false,
  // API 接入方式：cc-switch 跟随 CC Switch 当前 Provider（读进程环境），
  // profile 则用应用内的供应商配置库（apiProfiles），密钥按 profileId 存 api-auth.json
  apiMode: "cc-switch",
  apiProfiles: [],
  activeProfileId: "",
  // 退出时清理终端 / SSE / 审批窗口 / 额度计时器（桌面版 before-quit 读取）
  resourceCleanup: true,
  // 个性化：回答角色背景（注入 system prompt）与界面快捷键
  personaId: "default",
  personaCustom: "",
  shortcuts: {},
  // 每日用量统计：{ "YYYY-MM-DD": { requests, cost, inputTokens, outputTokens } }
  usageDaily: {},
  // 运行引擎固定为 Claude Agent SDK。第三方模型通过 Anthropic 兼容供应商接入。
  engine: "claude",
  // 浏览器集成（Playwright MCP + 本地浏览器服务）
  // mode: attach = 连接用户日常 Edge（edge://inspect 授权）；dedicated = 专用授权 Profile
  browser: {
    enabled: false,
    mode: "attach",
    cdpEndpoint: "",
    dedicatedPort: 9223,
    profileDir: "",
    allowOrigins: [],
    blockOrigins: [],
    imageResponses: "omit",
  },
};
// CCDPH-FIX(A10-17): 深度上限改为「相对」语义 —— 只约束**单条事件 / 单条消息内容自身**的
// 嵌套层数（见 prepareEventForStorage / trimMessagesByVolume），不再从 state 根算绝对深度。
// 原实现从根算绝对深度，导致「多层 sessions/events/messages 包裹」的合法库被误判损坏（V4/V5）。
// CCDPH-FIX(A10-17): 节点上限不再独立拍定 —— 改由 MAX_STATE_BYTES 推导（见下方 STATE_MAX_NODES），
// 且**不再作为致命门禁**，只用于诊断日志。
let db = { projects: [], sessions: [], settings: structuredClone(DEFAULT_SETTINGS) };
const runs = new Map();
const configuredRunLimit = Number(process.env.WORKBENCH_MAX_CONCURRENT_RUNS);
export const MAX_CONCURRENT_RUNS = Number.isInteger(configuredRunLimit)
  ? Math.min(32, Math.max(1, configuredRunLimit))
  : Math.min(16, Math.max(4, os.availableParallelism?.() || os.cpus().length || 4));
export function canStartAnotherRun(activeRuns, limit = MAX_CONCURRENT_RUNS) {
  return Number.isInteger(activeRuns) && activeRuns >= 0 && activeRuns < limit;
}
const terminals = new Map();
const terminalProcessRegistry = createTerminalProcessRegistry({
  dataDir: DATA,
  getRootPids: () =>
    [...terminals.values()]
      .filter((terminal) => !terminal.exited)
      .map((terminal) => terminal.child?.pid),
});
let saveQueue = Promise.resolve();
let savePending = false;
// CCDPH-FIX(LOW-12): 脏版本号记账（详见 save()）。saveSnapshotRevision 记录「在飞写盘
// 取 JSON.stringify 快照时的脏版本号」，-1 表示还没取快照。
let saveRevision = 0;
let saveSnapshotRevision = -1;
let apiAuthSaving = Promise.resolve();
let foldedStateBackupPending = null;
// CCDPH-FIX(R2-P2-3): 当 state.json 无法读取、或损坏后**无法原子隔离**时置位。
// 原实现在这种情况下仍以空白数据启动，之后任何一次 save() 都会用 temp+rename
// 直接覆盖掉「恢复说明里承诺保留」的原文件 —— 一次瞬时占用（杀软/索引器持有文件）
// 就演变成静默数据丢失。置位后 save() 直接失败并如实回 400，绝不覆盖原文件。
let stateWritesBlocked = false;
// CCDPH-FIX(MED-15): /api/update/install 的重入闸门（见该路由）。
const updateRuntime = {
  installRunning: false,
  installResetTimer: null,
  job: {
    running: false,
    stage: "",
    startedAt: 0,
    finishedAt: 0,
    error: "",
  },
};
// A successful install hands control to apply-update.bat. If that hand-off is
// interrupted, do not leave the in-process update gate permanently closed.
const UPDATE_INSTALL_GATE_TIMEOUT_MS = 10 * 60_000;
export function armUpdateInstallGateTimer(onTimeout, ms = UPDATE_INSTALL_GATE_TIMEOUT_MS) {
  const delay = Number.isFinite(Number(ms)) && Number(ms) > 0
    ? Math.max(1, Number(ms))
    : UPDATE_INSTALL_GATE_TIMEOUT_MS;
  const timer = setTimeout(onTimeout, delay);
  timer.unref?.();
  return timer;
}
// CCDPH-FIX(H-9): 更新流程后台化。下载+解压最坏可跑 900 秒，而前端所有 API 30 秒就
// abort —— 用户必然看到「请求失败」并重试，撞上 MED-15 闸门。现在 POST /api/update/install
// 只启动后台任务并立即返回 { started, jobId }；真实下载/解包/写脚本在任务里执行，
// 全程更新 updateJob；GET /api/update/status 供前端每 2 秒轮询进度（stage 为中文阶段名）。
let lastSaveAt = 0;
let scheduleTimer = null;
const SAVE_MIN_INTERVAL = 800;
const SAVE_LARGE_INTERVAL_MS = 2_500;
const SAVE_VERY_LARGE_INTERVAL_MS = 5_000;
let lastSerializedStateBytes = 0;
// CCDPH-FIX(LOW-9): 死代码 wait() 已删除 —— PERF-2 把节流从 save() 里挪走后它就再没有
// 任何调用点，留着只会让人误以为写盘路径上还有延迟。
// B-03 修复：极小的串行队列工具。用于给「读-改-写」文件操作加进程内互斥。
// 关键：队列尾（tail）本身永不 rejected（否则会重蹈 B-01 的覆辙：一次失败毒化整条
// 队列）；但每个任务的返回值 promise 原样返回给调用者，所以**本次调用者仍能看到
// 自己的失败**（不吞错）。
const makeSerialQueue = () => {
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task, task);
    const nextTail = run.then(
      () => {},
      () => {},
    );
    tail = nextTail;
    // 队列完全空闲后切断已完成的 Promise 祖先链。任务闭包可能捕获大型请求体；
    // 若永远把最后一条 settled promise 留在 tail 上，V8 会延迟回收整段链及其闭包。
    void nextTail.then(() => {
      if (tail === nextTail) tail = Promise.resolve();
    });
    return run;
  };
};
const mcpWriteQueue = makeSerialQueue();
const hooksWriteQueue = makeSerialQueue();
const sessionWriteQueue = makeSerialQueue();
const settingsWriteQueue = makeSerialQueue();
const terminalStartQueue = makeSerialQueue();
// CCDPH-FIX(LOW-10): 供应商（Claude apiProfiles）的写接口也都是
// 「读-改-写 + 中间夹 await」的结构，与 MCP / hooks 同一类竞态，用同一把串行队列。
// 供应商、浏览器和通用设置最终都写 db.settings，必须共用同一把锁。
// 分成三把锁会让并发请求各自基于旧快照写回，导致已返回 200 的改动丢失。
const profileWriteQueue = settingsWriteQueue;
// B-03 修复：原子替换用的临时文件名必须唯一。原来用固定名 `${file}.workbench-tmp`，
// 并发时后到请求会把先到者的 tmp rename 走 / 读成空 → 大量丢更新（实测 MCP 60 并发
// 只落盘 1 条）。加入 pid + 时间 + 自增序号 + 随机后缀保证唯一。
let tmpSeq = 0;
const uniqueTmpPath = (file, tag) =>
  `${file}.${tag}-${process.pid}-${Date.now()}-${(tmpSeq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
// CCDPH-FIX(R2-P3-6 / R2-P2-6): 裸令牌脱敏。此前只有 hook 命令走 redactHookCommand，
// 而 sanitizeError 与「运行失败」的 SSE 事件文本都不处理 `sk-xxx` / `Bearer xxx`，
// 于是密钥出现在错误文本里时会被回给客户端、写进 state.json 并显示在界面。
const redactBareTokens = (text) =>
  String(text ?? "")
    .replace(/\bsk-[A-Za-z0-9_-]{5,}/g, (match) => `${match.slice(0, 4)}…`)
    .replace(
      /\bBearer\s+([A-Za-z0-9._-]{6,})/gi,
      (_match, value) => `Bearer ${value.slice(0, 4)}…`,
    );
// CCDPH-FIX(R2-P2-2): 原子替换必须同时**持久**。原来只有 writeFile + rename：
// writeFile 返回 ≠ 数据落盘。掉电/硬断电后磁盘上可能留下零长或半截文件，下次启动
// JSON.parse 失败 → state.json 被改名隔离 → 用户看到空工作区（数据丢失）。
// 现在：独立句柄写入 → fsync → rename → （POSIX）尽力 sync 目录项。
const syncDirBestEffort = async (dir) => {
  if (process.platform === "win32") return; // Windows 不支持对目录句柄 fsync
  let handle;
  try {
    handle = await fs.open(dir, "r");
    await handle.sync();
  } catch {
    /* 目录 sync 属尽力而为，不影响「内容已 fsync + 原子改名」这一保证 */
  } finally {
    await handle?.close().catch(() => { });
  }
};
const writeFileAtomicDurable = async (target, text, tag = "state") => {
  const tmp = uniqueTmpPath(target, tag);
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const handle = await fs.open(tmp, "w");
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, target);
    await syncDirBestEffort(path.dirname(target));
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => { });
    throw error;
  }
};
const MAX_SESSIONS = 500;
export const MAX_PROJECTS = 200;
export function pickArchivedSessionEvictions(
  sessions,
  needed,
  activeIds = new Set(),
) {
  if (needed <= 0) return [];
  return sessions
    // 未归档会话永远不能被后台保存或创建新会话静默删除。
    .filter(
      (s) =>
        s.archived &&
        !s.pinned &&
        !s.running &&
        !activeIds.has(s.id),
    )
    .sort(
      (a, b) =>
        (a.updatedAt || a.createdAt || 0) - (b.updatedAt || b.createdAt || 0),
    )
    .slice(0, needed);
}
function selectSessionEvictionsForNewSession() {
  const needed = db.sessions.length + 1 - MAX_SESSIONS;
  if (needed <= 0) return [];
  const candidates = pickArchivedSessionEvictions(
    db.sessions,
    needed,
    new Set(runs.keys()),
  );
  if (candidates.length < needed)
    throw new Error(
      `会话数量已达上限（${MAX_SESSIONS}），且没有足够的已归档会话可回收；请先归档或删除旧会话。`,
    );
  return candidates.slice(0, needed).map((s) => s.id);
}
const MAX_STATE_BYTES = 256 * 1024 * 1024;
// CCDPH-FIX(A10-17): 唯一的「硬」尺寸上限就是 MAX_STATE_BYTES（字节）。节点上限改由它推导
//（单个对象/数组节点的最小 JSON 体积按 8 字节估），不再独立拍定，也不再作为致命门禁。
const STATE_MIN_NODE_BYTES = 8;
const STATE_MAX_NODES = Math.floor(MAX_STATE_BYTES / STATE_MIN_NODE_BYTES);
let serializerWorker = null;
let serializerSeq = 0;
const serializerPending = new Map();
// CCDPH-FIX(A10-20): 序列化请求硬超时。worker 若静默悬挂（既不 postMessage 也不 exit），
// 原实现会让本 Promise 永不 settle → saveQueue 永久 pending、savePending 卡 true →
// 此后所有 save() 全部挂死且无恢复路径。超时后 terminate + 重建 worker 使 save() 自愈。
const SERIALIZER_TIMEOUT_MS = 15_000;
function failSerializerPending(error) {
  for (const pending of serializerPending.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  serializerPending.clear();
}
// CCDPH-FIX(A10-20): 放弃当前序列化线程（terminate）并拒绝所有在飞请求；下次 save() 会重建 worker。
function recycleSerializerWorker(error) {
  const worker = serializerWorker;
  serializerWorker = null;
  if (worker) {
    try {
      worker.terminate();
    } catch { }
  }
  failSerializerPending(error);
}
async function disposeSerializerWorker() {
  const worker = serializerWorker;
  serializerWorker = null;
  failSerializerPending(new Error("服务已关闭"));
  if (worker) {
    await worker.terminate().catch(() => { });
    // Windows/libuv 还需要至少一个事件循环 tick 完成 async handle 的 close 回调；
    // 否则调用方在 server.close 回调里立即 process.exit() 会触发 UV_HANDLE_CLOSING 断言。
    await new Promise((resolve) => setImmediate(resolve));
  }
}
function ensureSerializerWorker() {
  if (serializerWorker) return serializerWorker;
  const worker = new Worker(
    `const { parentPort } = require("node:worker_threads");
     parentPort.on("message", ({ id, value, maxBytes }) => {
       try {
         const text = JSON.stringify(value);
         const bytes = Buffer.byteLength(text, "utf8");
         if (bytes > maxBytes) throw new Error("state.json 超过持久化上限（" + bytes + " > " + maxBytes + " 字节）");
         parentPort.postMessage({ id, text, bytes });
       } catch (error) {
         parentPort.postMessage({ id, error: String(error && error.message || error) });
       }
     });`,
    { eval: true },
  );
  serializerWorker = worker;
  worker.on("message", ({ id, text, bytes, error }) => {
    const pending = serializerPending.get(id);
    if (!pending) return;
    serializerPending.delete(id);
    clearTimeout(pending.timer); // CCDPH-FIX(A10-20): 正常应答即撤掉硬超时
    if (!serializerPending.size) worker.unref();
    if (error) pending.reject(new Error(error));
    else pending.resolve({ text, bytes });
  });
  worker.on("error", (error) => {
    failSerializerPending(error);
  });
  worker.on("exit", (code) => {
    if (serializerPending.size)
      failSerializerPending(new Error(`状态序列化工作线程退出（${code}）`));
    if (serializerWorker === worker) serializerWorker = null;
  });
  worker.unref();
  return worker;
}
function stringifyStateOffThread(value) {
  const worker = ensureSerializerWorker();
  const id = ++serializerSeq;
  worker.ref();
  return new Promise((resolve, reject) => {
    // CCDPH-FIX(A10-20): 硬超时兜底（见 SERIALIZER_TIMEOUT_MS）。超时即重建工作线程并拒绝本次写盘，
    // 使后续 save() 能恢复，而不是像原实现那样永久挂起。
    const timer = setTimeout(() => {
      if (!serializerPending.has(id)) return;
      const message = `状态序列化超时（${SERIALIZER_TIMEOUT_MS}ms），已重建序列化线程`;
      console.error("[ccdph]", message);
      recycleSerializerWorker(new Error(message));
    }, SERIALIZER_TIMEOUT_MS);
    timer.unref?.();
    serializerPending.set(id, { resolve, reject, timer });
    try {
      // postMessage 的结构化克隆在此刻完成，因此这就是本次写盘的一致快照。
      worker.postMessage({ id, value, maxBytes: MAX_STATE_BYTES });
    } catch (error) {
      clearTimeout(timer);
      serializerPending.delete(id);
      if (!serializerPending.size) worker.unref();
      reject(error);
    }
  });
}
const STATE_LOAD_TIMEOUT_MS = 60_000;
function loadStateOffThread(stateFile) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./state-load-worker.mjs", import.meta.url), {
      workerData: {
        stateFile,
        maxBytes: MAX_STATE_BYTES,
        serializationDepth: STATE_SAFE_SERIALIZATION_DEPTH,
      },
    });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().catch(() => { });
      callback(value);
    };
    const timer = setTimeout(
      // CCDPH-FIX(R2-P2-3): 超时属于「读取失败」而非「内容损坏」，必须带 errno，
      // 否则 start() 会把它当成坏 JSON，去隔离一个其实完好的 state.json。
      () => {
        const error = new Error("state.json 后台解析超时");
        error.code = "ETIMEDOUT";
        finish(reject, error);
      },
      STATE_LOAD_TIMEOUT_MS,
    );
    timer.unref?.();
    worker.once("message", (message) => {
      if (message?.error) {
        const error = new Error(message.error);
        if (message.code) error.code = message.code;
        finish(reject, error);
      } else finish(resolve, message);
    });
    worker.once("error", (error) => finish(reject, error));
    worker.once("exit", (code) => {
      if (!settled && code !== 0)
        finish(reject, new Error(`state.json 后台解析线程退出（${code}）`));
    });
  });
}
const save = () => {
  // CCDPH-FIX(LOW-12): 脏版本号。只有「在飞写盘还没取过快照」时才允许复用它的 promise
  // —— 那时它的 JSON.stringify 还没执行，必然包含本次调用之前的全部改动。快照一旦
  // 取走（saveSnapshotRevision >= 0），就必须另排一次写盘，否则调用方 await 到的是一次
  // 早于自己改动的落盘：接口回 200，磁盘上却没有这次改动（进程随后退出就永久丢失）。
  saveRevision++;
  if (savePending && saveSnapshotRevision < 0) return saveQueue;
  savePending = true;
  saveSnapshotRevision = -1;
  const revision = saveRevision;
  saveQueue = saveQueue
    .catch((err) => {
      // B-01 修复：这里**绝不能** rethrow（原实现在日志后 `throw err`）。
      // 一旦把失败留在 saveQueue 上，下一次 save() 会在这条 rejected 链上再挂
      // .then(...)，其 onFulfilled 永不执行 → 写盘分支永久不可达；同时下面
      // `savePending = false` 也永不执行 → 标志永久卡 true，此后每次 save() 都在
      // 开头直接早退，进程终生无法再持久化任何配置/会话（写接口持续 400 并回放这条
      // 陈旧错误，读接口仍 200，界面看起来完全正常）。
      // 只吞掉、不抛出：本轮调用者仍会从下面的 .then 拿到写盘失败的 rejection
      //（错误可见性不变，路由照旧回 400），而**下一次**调用的这个 .catch 会吞掉
      // 这条旧 rejection 并重新尝试写盘 → 自愈。
      // CCDPH-FIX(A10-observability): 日志改到队尾 catch（见下），避免同一次失败被记两遍。
    })
    .then(async () => {
      // CCDPH-FIX(R2-P2-3): 启动时若 state.json 无法读取、或损坏后无法原子隔离，
      // 我们**绝不能**再写盘 —— 否则会用空白数据覆盖掉恢复说明里承诺保留的原文件。
      // 这里只拒绝「落盘」：内存中的运行不受影响，读接口仍可用，写接口如实回 400。
      if (stateWritesBlocked)
        throw new Error(
          "会话数据文件当前无法安全写入（疑似被其它程序占用，或损坏后未能隔离）；" +
            "为免覆盖原始文件，本次运行已暂停保存。请关闭占用该文件的程序后重启应用。",
        );
      // A deep-but-valid state is folded in memory so the service can start,
      // but the original bytes must remain recoverable before any writeback.
      // Keep this pending across failures; the first successful save retries
      // the backup before it is allowed to replace state.json.
      if (foldedStateBackupPending) {
        const pending = foldedStateBackupPending;
        let backedUp = false;
        try {
          await fs.copyFile(pending.source, pending.target);
          backedUp = true;
        } catch (error) {
          // CCDPH-FIX(P2-4): 原实现的 copyFile 失败会**永久保留** foldedStateBackupPending，
          // 于是此后每一次 save() 都在这里抛错 → 所有写接口持续 400，进程终生无法持久化
          //（读接口仍 200，界面看似正常）。区分两种失败：
          //  - ENOENT：原始文件已不存在（被外部改名/删除），已无可保护的字节 → 清掉 pending 继续写盘；
          //  - 其他（EACCES/EBUSY/ENOSPC…）：仍坚持"先备份再覆盖"的安全原则，如实抛错由调用方回 400。
          if (error?.code !== "ENOENT") throw error;
          console.warn(
            "[ccdph] 超深状态原文件已不存在，跳过备份并继续写盘:",
            error?.message || error,
          );
        }
        if (foldedStateBackupPending === pending)
          foldedStateBackupPending = null;
        if (backedUp) {
          console.warn(`[ccdph] 超深状态原文件已备份为 ${pending.target}`);
          await cleanupFoldedStateBackups(pending.source).catch((error) =>
            console.warn("[ccdph] 清理旧的深状态备份失败:", error?.message || error),
          );
        }
      }
      // CCDPH-FIX(PERF-2): 节流从 save() 里挪走了。原实现在这里 await wait(...)，
      // 而**所有**写接口都 `await save()`，于是「节流」变成了调用方无法回避的
      // 地板延迟：实测每个 POST /api/settings 恒为 ~800ms（797/802/806/810…），
      // 用户改一项设置就要等满 800ms，脚本连续写更被压到 ~1.25 次/秒。
      // 现在 save() 立即写盘（await 语义不变：返回时改动确实已在磁盘上），
      // 「最多 ~1.25 次/秒」的合并改由下面的 scheduleSave() 承担。
      lastSaveAt = Date.now();
      // save() 只负责持久化，绝不能在普通设置保存、事件落盘等无关路径中
      // 静默淘汰会话。会话上限只在创建会话的事务里处理。
      // 序列化移到 worker thread，避免大型历史在主线程上长时间卡住 HTTP/SSE。
      // postMessage 返回时快照已取；之后的修改必须另排一轮 save。
      const textPromise = stringifyStateOffThread(db);
      saveSnapshotRevision = revision;
      const serialized = await textPromise;
      const text = serialized.text;
      lastSerializedStateBytes = serialized.bytes;
      // CCDPH-FIX(MED-14) 保留：原子写失败（ENOSPC / EACCES / 杀软占用）时必须回收唯一临时
      // 文件，否则 state.json.state-<pid>-<ts>-… 会在数据目录里永久堆积（回收在 helper 内）。
      // CCDPH-FIX(R2-P2-2): 改为「fsync 后再 rename」的持久化原子写，避免掉电留下半截文件。
      await writeFileAtomicDurable(path.join(DATA, "state.json"), text, "state");
    })
    .finally(() => {
      savePending = false;
      saveSnapshotRevision = -1;
    })
    // CCDPH-FIX(A10-observability): 让**当轮**写盘失败也记 stderr。原来 console.error 只挂在**上一轮**
    // saveQueue 的 .catch 上（上一条 queue 已 resolved 时便不打印），于是第一次写盘失败
    // 不打任何日志，错误只出现在 400 的 body 里。这里补一层队尾 catch：记日志后原样 rethrow，
    // 返回值语义不变（仍 reject 给调用方 → 路由照旧回 400）。
    .catch((err) => {
      console.error("[ccdph] 保存状态失败:", err?.message || err);
      throw err;
    });
  return saveQueue;
};
// 节流写盘：流式回复期间每个事件都会触发保存，若背靠背做全库 stringify + 写盘，
// 长会话会持续吃 CPU 和磁盘。这里合并成最多 ~1.25 次/秒。
// 只给「不要求立即落盘」的调用点用（publish 等）；要求落盘的写接口继续用 save()。
const scheduleSave = () => {
  if (scheduleTimer) return;
  const idle = Date.now() - lastSaveAt;
  const interval =
    lastSerializedStateBytes > 64 * 1024 * 1024
      ? SAVE_VERY_LARGE_INTERVAL_MS
      : lastSerializedStateBytes > 16 * 1024 * 1024
        ? SAVE_LARGE_INTERVAL_MS
        : SAVE_MIN_INTERVAL;
  const delay = idle >= interval ? 0 : interval - idle;
  scheduleTimer = setTimeout(() => {
    scheduleTimer = null;
    save().catch(() => { });
  }, delay);
  scheduleTimer.unref?.();
};
export function within(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
export async function safePath(root, relative = "") {
  // CCDPH-FIX(M-4): 拒绝 NTFS 备用数据流 / 设备路径
  // 闸门）。`GET /api/file?path=normal.txt:secret` 此前能读出 ADS 隐藏内容；正常路径不含
  // 冒号，盘符（含 \\?\D: 形式）里的 ':' 不是数据流，故先剥前缀、剥盘符再检查。
  // CCDPH-FIX(P3-5): ':' 是 **Windows** 的 ADS/设备分隔符，POSIX 下是合法文件名 ——
  // 原来无条件拒绝，导致非 Windows 平台正常文件读不了。
  if (process.platform === "win32") {
    const withoutExtendedPrefix = String(relative).replace(/^\\\\\?\\/, "");
    const withoutDrive = withoutExtendedPrefix.replace(/^[a-zA-Z]:(?=[\\/]|$)/, "");
    if (withoutDrive.includes(":"))
      throw new Error(
        "路径包含非法字符 ':'（不支持 NTFS 备用数据流 / 设备路径），请改用普通文件名。",
      );
  }
  const base = await fs.realpath(root);
  let target;
  try {
    target = await fs.realpath(path.resolve(base, relative));
  } catch (error) {
    if (error?.code === "ENOENT") {
      const missing = new Error("文件不存在或已被删除");
      missing.code = "ENOENT";
      throw missing;
    }
    throw error;
  }
  if (!within(base, target)) throw new Error("只能查看当前项目内的文件");
  return target;
}
export async function readStableBoundedFile(target, maxBytes = 500_000) {
  const expected = await fs.stat(target);
  const handle = await fs.open(target, "r");
  try {
    const opened = await handle.stat();
    // CCDPH-FIX(P3-4): Windows 上多数文件系统的 ino 恒为 0，dev/ino 比对形同失效
    //（0 === 0 恒成立）。Windows 下补一个 size 判据，让"读取准备期间被原子替换"仍能被发现。
    if (
      opened.dev !== expected.dev ||
      opened.ino !== expected.ino ||
      (process.platform === "win32" && opened.size !== expected.size)
    )
      throw new Error("文件在读取准备期间已被替换，已拒绝本次读取，请重试");
    if (!opened.isFile()) throw new Error("目标不是普通文件");
    if (opened.size > maxBytes) throw new Error(`文件超过 ${maxBytes} 字节上限`);
    // 只从已复验的句柄读取 maxBytes+1。即使文件在 stat 后继续增长，也不会把增长部分
    // 无界读入内存；多出的 1 字节用于准确区分「恰好上限」与「已经超限」。
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        total,
        buffer.length - total,
        total,
      );
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > maxBytes) throw new Error(`文件超过 ${maxBytes} 字节上限`);
    return buffer.subarray(0, total);
  } finally {
    await handle.close().catch(() => { });
  }
}
export async function quarantineOversizedStateFile(
  stateFile,
  bytes,
  maxBytes = MAX_STATE_BYTES,
) {
  if (!(bytes > maxBytes)) return null;
  const backup = `${stateFile}.oversize-${Date.now()}-${randomUUID().slice(0, 8)}`;
  await fs.rename(stateFile, backup);
  const message =
    `会话数据文件体积 ${bytes} 字节，超过安全读取上限 ${maxBytes} 字节。\n` +
    `为防止启动时耗尽内存，应用没有读取或复制该文件，而是将它原子改名为：\n${backup}\n` +
    "应用已使用空白会话数据启动；原始数据仍完整保留，可在拆分或裁剪后恢复。\n";
  await fs
    .writeFile(`${stateFile}.oversize-readme.txt`, message, "utf8")
    .catch((error) =>
      console.error("[ccdph] 写入超限数据恢复说明失败:", error?.message || error),
    );
  return backup;
}
// CCDPH-FIX(P3-13): `.corrupt-*` / `.oversize-*` 此前**没有保留期清理**（只有 `.folded-` 有），
// 反复启动失败会让数据目录无界增长、且用户看不到恢复入口。这里与 folded 备份同一口径：
// 保留最近 `keep` 个且不超过 `maxAgeMs`，其余删除。
export async function cleanupStateQuarantineBackups(
  stateFile,
  { keep = 3, maxAgeMs = 30 * 86_400_000 } = {},
) {
  const folder = path.dirname(stateFile);
  const base = path.basename(stateFile);
  const prefixes = [`${base}.corrupt-`, `${base}.oversize-`];
  const backups = [];
  let directory;
  try {
    directory = await fs.opendir(folder);
    for await (const entry of directory) {
      if (!entry.isFile()) continue;
      const prefix = prefixes.find((candidate) => entry.name.startsWith(candidate));
      if (!prefix) continue;
      // CCDPH-FIX(P3-13b) 保留：必须排除恢复说明文件（`state.json.corrupt-readme.txt`
      // 同样以 `state.json.corrupt-` 开头！），否则它时间解析为 NaN→0 会排"最旧"被删掉。
      // CCDPH-FIX(R2-P2-1): 但旧判据要求前缀后**只有**数字，而 `.oversize-*` 的真名是
      // `state.json.oversize-<Date.now()>-<uuid8>`（见 quarantineOversizedStateFile），
      // 于是 `.oversize-*` 永远不入选、永不清理 → 每个 ≥256MiB 永久堆积。
      // 现在允许「数字时间戳 + 可选 -<短随机后缀>」，readme（.txt）仍被排除。
      const stamp = entry.name.slice(prefix.length);
      const stampMatch = /^(\d{10,})(?:-[0-9a-z]{1,16})?$/i.exec(stamp);
      if (!stampMatch) continue;
      backups.push({
        name: entry.name,
        time: Number(stampMatch[1]) || 0,
      });
      if (backups.length >= 10_000) break;
    }
  } catch (error) {
    console.warn("[ccdph] 扫描隔离备份失败:", error?.message || error);
    return { removed: 0 };
  } finally {
    await directory?.close().catch(() => { });
  }
  backups.sort((a, b) => b.time - a.time);
  const now = Date.now();
  let removed = 0;
  for (let index = keep; index < backups.length; index += 1) {
    if (now - backups[index].time <= maxAgeMs) continue;
    await fs.rm(path.join(folder, backups[index].name), { force: true }).catch(() => { });
    removed += 1;
  }
  if (removed)
    console.warn(`[ccdph] 已清理 ${removed} 个过期的状态隔离备份（.corrupt-* / .oversize-*）`);
  return { removed };
}
export async function cleanupFoldedStateBackups(
  stateFile,
  { keep = 3, maxAgeMs = 30 * 86_400_000 } = {},
) {
  const folder = path.dirname(stateFile);
  const prefix = `${path.basename(stateFile)}.folded-`;
  const backups = [];
  let directory;
  try {
    directory = await fs.opendir(folder);
    for await (const entry of directory) {
      if (!entry.isFile() || !entry.name.startsWith(prefix)) continue;
      backups.push({
        name: entry.name,
        time: Number(entry.name.slice(prefix.length).split("-")[0]) || 0,
      });
      if (backups.length >= 10_000) break;
    }
  } catch {
    return 0;
  } finally {
    await directory?.close().catch(() => { });
  }
  const now = Date.now();
  backups.sort((a, b) => b.time - a.time);
  let removed = 0;
  for (let index = 0; index < backups.length; index += 1) {
    const entry = backups[index];
    if (index < keep && now - entry.time <= maxAgeMs) continue;
    await fs.rm(path.join(folder, entry.name), { force: true });
    removed += 1;
  }
  return removed;
}
function project(id) {
  const p = db.projects.find((p) => p.id === id);
  if (!p) throw new Error("项目不存在");
  return p;
}
function session(id) {
  const s = db.sessions.find((s) => s.id === id);
  if (!s) throw new Error("会话不存在");
  return s;
}
function sessionRoot(s) {
  return s.cwd || project(s.projectId).path;
}
function workspaceRoot(projectId, sessionId) {
  if (!sessionId) return project(projectId).path;
  const s = session(sessionId);
  if (s.projectId !== projectId) throw new Error("会话与项目不匹配");
  return sessionRoot(s);
}
// CCDPH-FIX(MED-10): preview() 必须先封顶再美化。调用点拿到返回值之后才 slice(0,40000)，
// 而原来这里直接 JSON.stringify(value, null, 2) —— 一次 200MB 的工具结果会被**完整**美化
// （缩进 + 转义通常是原体积的 2~4 倍）再被丢掉，同步卡死事件循环，就在流式热路径上。
// 现在：字符串直接截断；对象先用紧凑形式做**有界**序列化（replacer 里就把超长字符串截断），
// 只有结果确实很小时才再美化一次，输出与原来逐字节一致。
export const preview = previewBounded;
// B-02 修复：SSE 广播此前把 client.write() 的返回值直接丢弃（全文件 0 处 drain），
// 内核缓冲写满后仍持续硬灌，未消费的数据只能在用户态内存里堆积（实测随输出量线性
// 增长，比值 ≈1.5×；停滞客户端可把 RSS 顶到 OOM）。
// 现在：write() 返回 false 表示内核缓冲已满，改为把后续消息存入**每客户端有上限**
// 的待发队列，等 drain 再按序冲掉；队列超过上限（客户端持续不消费）才如实断开。
// 正常客户端 write() 恒返回 true，走与修复前逐字节一致的直接写路径，不排队、不丢消息。
const SSE_MAX_PENDING_BYTES = 8 * 1024 * 1024;
const SSE_MAX_CLIENTS_PER_RUN = 16;
const ssePending = new WeakMap(); // res -> { queue: [{chunk,size}], bytes, waitingDrain }
function dropSseClient(clients, client) {
  clients.delete(client);
  ssePending.delete(client);
  try {
    client.destroy();
  } catch { }
}
function flushSseQueue(client, st) {
  st.waitingDrain = false;
  while (st.queue.length) {
    const item = st.queue.shift();
    st.bytes -= item.size;
    let ok;
    try {
      ok = client.write(item.chunk);
    } catch {
      st.queue.length = 0;
      st.bytes = 0;
      try {
        client.destroy();
      } catch { }
      return;
    }
    if (!ok) {
      st.waitingDrain = true;
      break;
    }
  }
  if (st.waitingDrain && !client.destroyed && !client.writableEnded)
    client.once("drain", () => flushSseQueue(client, st));
}
function writeSseClient(clients, client, payload) {
  const size = Buffer.byteLength(payload, "utf8");
  if (client.destroyed || client.writableEnded) {
    clients.delete(client);
    ssePending.delete(client);
    return;
  }
  let st = ssePending.get(client);
  if (!st) {
    st = { queue: [], bytes: 0, waitingDrain: false };
    ssePending.set(client, st);
  }
  if (st.waitingDrain || st.queue.length) {
    // 内核缓冲未排空：不再直接 write，改为入队等待 drain（有上限，防止无限堆积）
    if (size > SSE_MAX_PENDING_BYTES || st.bytes + size > SSE_MAX_PENDING_BYTES) {
      // 该客户端持续不消费、待发量超限：如实断开，避免用户态内存线性增长
      dropSseClient(clients, client);
      return;
    }
    st.queue.push({ chunk: payload, size });
    st.bytes += size;
    return;
  }
  let ok;
  try {
    ok = client.write(payload);
  } catch {
    dropSseClient(clients, client);
    return;
  }
  if (!ok) {
    st.waitingDrain = true;
    client.once("drain", () => flushSseQueue(client, st));
  }
}
function writeSseClients(clients, payload) {
  for (const client of [...clients]) writeSseClient(clients, client, payload);
}
function writeSseInitialFrame(clients, client, payload, running) {
  if (running) {
    clients.add(client);
    writeSseClient(clients, client, payload);
    return;
  }
  const temporaryClients = new Set([client]);
  writeSseClient(temporaryClients, client, payload);
  if (!client.destroyed && !client.writableEnded) client.end();
  temporaryClients.clear();
}
function closeSseClients(clients) {
  for (const client of [...clients]) {
    try {
      client.end();
    } catch { }
  }
  clients.clear();
}
const EVENT_TEXT_LIMIT = 120_000;
const EVENT_INPUT_LIMIT = 60_000;
const EVENT_RECORD_LIMIT = 512_000;
// CCDPH-FIX(F-03): 事件历史除了「条数」还必须按「内容总量」封顶。historyLimit 只限
// 条数，而单条事件上限 12 万字符、工具结果 4 万字符 → 5000 条最坏 6 亿字符，随后每次
// save() 都要把整个 db 同步 JSON.stringify 一遍，直接卡死事件循环。
// CCDPH-FIX(A10-01): 预算一律以 **UTF-8 字节**为准。原按 UTF-16 字符计数，中文 1 字符≈3 字节，
// 字符预算永远追不上落盘字节上限（中文 192M 字符 ≈ 576MB > 256MB），导致裁剪后仍写盘失败。
const EVENTS_MAX_BYTES = 8 * 1024 * 1024;
// 全局历史预算 = 落盘硬上限的 90%。取 90%（而非更激进的 60%）是为满足「不引入新数据丢失」：
// 230MB ≥ 原先能被完整保留的 ASCII 库上界（192M 字符≈192MB），故此前能正常持久化的库不会
// 因这次改动被多裁；只有**字节已越限、此前根本无法落盘**的库才会被裁到该预算内。
const GLOBAL_HISTORY_MAX_BYTES = Math.floor(MAX_STATE_BYTES * 0.9);
// 内容总量的**增量**记账。绝不能每次 publish 都对整个历史重新 stringify 一遍：
// 2500 条 × 40KB 的历史意味着每条事件都要分配上百 MB 字符串，比原来的 splice 更糟。
// 用 WeakMap 而不是往 session 上挂字段，避免把这个纯粹的内部计数写进 state.json。
// CCDPH-FIX(A10-01): 记账单位统一为 UTF-8 字节（与落盘口径一致）。
const eventBytesBySession = new WeakMap();
const messageBytesBySession = new WeakMap();
const eventBytesByItem = new WeakMap();
let globalHistoryBytes = 0;
let globalHistoryBytesDirty = true;
let globalHistoryOrderRevision = 0;
let globalHistoryOrderCache = {
  expiresAt: 0,
  revision: -1,
  preferredSession: null,
  sessions: [],
};
function invalidateGlobalHistoryOrder() {
  globalHistoryOrderRevision += 1;
  globalHistoryOrderCache.expiresAt = 0;
}
function setEventBytesForSession(sessionItem, bytes) {
  const previous = eventBytesBySession.get(sessionItem) || 0;
  eventBytesBySession.set(sessionItem, bytes);
  globalHistoryBytes += bytes - previous;
}
function setMessageBytesForSession(sessionItem, bytes) {
  const previous = messageBytesBySession.get(sessionItem) || 0;
  messageBytesBySession.set(sessionItem, bytes);
  globalHistoryBytes += bytes - previous;
}
function markGlobalHistoryBytesDirty() {
  globalHistoryBytesDirty = true;
  invalidateGlobalHistoryOrder();
}
export function eventSize(event) {
  if (event && typeof event === "object" && eventBytesByItem.has(event))
    return eventBytesByItem.get(event);
  // CCDPH-FIX(A10-01): 以 UTF-8 字节计量，而非 UTF-16 字符数。
  try {
    const text = JSON.stringify(event ?? null);
    const bytes = text ? Buffer.byteLength(text, "utf8") : 0;
    if (event && typeof event === "object") eventBytesByItem.set(event, bytes);
    return bytes;
  } catch {
    if (event && typeof event === "object")
      eventBytesByItem.set(event, EVENTS_MAX_BYTES);
    return EVENTS_MAX_BYTES; // 无法序列化的按「已超限」处理
  }
}
const truncate = (text, limit) =>
  text.length > limit
    ? text.slice(0, limit) + `\n\n…（内容过长，已截断 ${text.length - limit} 字符）`
    : text;
function compactEvent(event, fallbackText) {
  return {
    id: typeof event?.id === "string" ? event.id : randomUUID(),
    time: Number.isFinite(event?.time) ? event.time : Date.now(),
    type: typeof event?.type === "string" ? event.type : "error",
    ...(typeof event?.tool === "string" ? { tool: event.tool.slice(0, 200) } : {}),
    ...(typeof event?.toolId === "string" ? { toolId: event.toolId.slice(0, 200) } : {}),
    text: truncate(
      typeof event?.text === "string" ? event.text : fallbackText,
      EVENT_TEXT_LIMIT,
    ),
    historyItemTruncated: true,
  };
}
export function prepareEventForStorage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const event = {
      id: randomUUID(),
      time: Date.now(),
      type: "error",
      text: "历史事件格式无效，已折叠",
    };
    return { event, bytes: eventSize(event), changed: true };
  }
  const event = value;
  let changed = false;
  if (typeof event.text === "string") {
    const text = truncate(event.text, EVENT_TEXT_LIMIT);
    if (text !== event.text) changed = true;
    event.text = text;
  }
  if (
    event.input &&
    !fitsJsonBudget(event.input, EVENT_INPUT_LIMIT, {
      maxDepth: STATE_CONTENT_MAX_DEPTH,
      maxNodes: 20_000,
    })
  ) {
    event.input = {
      截断提示: "工具输入过大、过深或无法安全遍历，已折叠显示",
    };
    changed = true;
  }
  // CCDPH-FIX(A10-17): 单条事件内容**自身**嵌套过深时只折叠**这一条**（相对深度计数、
  // 局部问题局部处理），绝不因此把整库判损坏、更不空白启动。原实现按「从 state 根算起的
  // 绝对深度」整库判定，合法库也会被误杀。
  if (maxNestingDepth(event) > STATE_CONTENT_MAX_DEPTH) {
    const compacted = compactEvent(event, "事件嵌套过深，已折叠");
    return { event: compacted, bytes: eventSize(compacted), changed: true };
  }
  const bytes = eventSize(event);
  if (bytes <= EVENT_RECORD_LIMIT) return { event, bytes, changed };
  const compacted = compactEvent(event, "事件附加数据过大，已折叠");
  return { event: compacted, bytes: eventSize(compacted), changed: true };
}
// CCDPH-FIX(LOW-11): 共享的冻结空集合。publish/broadcast 在会话没有运行中的轮次时，
// 原来每个事件（流式 token delta 每秒几十次）都要分配一个一次性的 new Set()。
const EMPTY_CLIENT_SET = Object.freeze(new Set());
function publish(s, event) {
  event.id = randomUUID();
  event.time = Date.now();
  // 调用方可能曾预览/计量过这个对象；id/time 与规范化会改变序列化结果，先失效旧值。
  eventBytesByItem.delete(event);
  // 兜底截断：text/input 与整条事件同时有上限，防止未知字段把整库放大。
  const prepared = prepareEventForStorage(event);
  event = prepared.event;
  // CCDPH-FIX(A10-01): 记账单位统一为 UTF-8 字节（与落盘口径一致），并复用规范化
  // 阶段已经得到的大小，避免同一事件在主线程连续 JSON.stringify 两次。
  const newEventBytes = prepared.bytes;
  eventBytesByItem.set(event, newEventBytes);
  let totalBytes = eventBytesBySession.get(s);
  // 首次见到该会话（例如刚从 state.json 载入）时重建一次总量，之后全程增量维护。
  // CCDPH-FIX(MED-9): 从 state.json 载入的会话现在由 start() 在规范化阶段就把总量种进
  // eventBytesBySession —— 否则重启后的**第一条** publish 会在这里把整段历史（最坏
  // ~8MB）重新 stringify 一遍，正好卡在首轮回复的最前面。这里只作为兜底保留。
  if (typeof totalBytes !== "number" || Number.isNaN(totalBytes))
    totalBytes = s.events.reduce((sum, item) => sum + eventSize(item), 0);
  totalBytes += newEventBytes;
  s.events.push(event);
  const historyLimit = Math.max(500, Number(db.settings.historyLimit) || 2500);
  if (s.events.length > historyLimit) {
    const dropped = s.events.splice(0, s.events.length - historyLimit);
    for (const item of dropped) totalBytes -= eventSize(item);
    s.historyTruncated = true;
  }
  // CCDPH-FIX(F-03): 再按内容总量从最旧开始裁剪（与 trimMessagesByVolume 同一思路）。
  // 与条数上限一样，触发裁剪就置 historyTruncated，让界面如实提示。
  let dropCount = 0;
  let remaining = totalBytes;
  while (dropCount < s.events.length - 1 && remaining > EVENTS_MAX_BYTES) {
    remaining -= eventSize(s.events[dropCount]);
    dropCount++;
  }
  if (dropCount > 0) {
    s.events.splice(0, dropCount);
    totalBytes = remaining;
    s.historyTruncated = true;
  }
  setEventBytesForSession(s, totalBytes);
  enforceGlobalHistoryBudget(s);
  s.updatedAt = event.time;
  writeSseClients(
    runs.get(s.id)?.clients || EMPTY_CLIENT_SET,
    `data: ${JSON.stringify(event)}\n\n`,
  );
  scheduleSave();
  return event;
}
function broadcast(s, event) {
  writeSseClients(
    runs.get(s.id)?.clients || EMPTY_CLIENT_SET,
    // CCDPH-FIX(P3-6): 原来这里多一个尾随空格（`} \n\n`），与 publish 的帧格式不一致。
    `data: ${JSON.stringify(event)}\n\n`,
  );
}
function currentTaskLabel(s) {
  let text;
  for (let i = s.events.length - 1; i >= 0; i--) {
    if (s.events[i].type === "user") {
      // CCDPH-FIX(P3-7): `text?.replace` 的 `?.` 只挡 null/undefined，挡不住 number 等类型
      // → 会抛 TypeError（渲染任务标题时）。统一走 String()。
      text = String(s.events[i].text ?? "").replace(/\s+/g, " ").trim();
      break;
    }
  }
  return text ? text.slice(0, 72) : s.title;
}
async function findClaude() {
  const candidates = [];
  const push = (value) => {
    if (value && value.trim()) candidates.push(value.trim());
  };
  push(db.settings.claudeExecutable);
  push(process.env.CLAUDE_CODE_EXECUTABLE);
  const home = os.homedir();
  const appData =
    process.env.APPDATA || path.join(home, "AppData", "Roaming");
  const localAppData =
    process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  // 常见安装位置：原生安装器 / npm 全局 / bun / 本地程序目录
  push(path.join(home, ".local", "bin", "claude.exe"));
  push(path.join(home, ".local", "bin", "claude"));
  push(path.join(appData, "npm", "claude.cmd"));
  push(path.join(appData, "npm", "claude.exe"));
  push(path.join(appData, "npm", "node_modules",
    "@anthropic-ai", "claude-code", "bin", "claude.exe"));
  push(path.join(home, ".bun", "bin", "claude.exe"));
  push(path.join(localAppData, "Programs", "claude", "claude.exe"));
  // where.exe 兜底：能找到 PATH 里注册的 claude.cmd / claude.exe / claude.bat
  try {
    const { stdout } = await exec(WINDOWS_WHERE_EXE, ["claude"], {
      windowsHide: true,
      timeout: 8000,
    });
    for (const line of stdout.split(/\r?\n/)) push(line.trim());
  } catch { }
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    push(path.join(dir, "claude.exe"));
    push(path.join(dir, "claude.cmd"));
    push(path.join(dir, "node_modules", "@anthropic-ai", "claude-code",
      "bin", "claude.exe"));
  }
  const seen = new Set();
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      await fs.access(candidate);
      const version = await claudeVersionOf(candidate);
      return { path: candidate, version };
    } catch { }
  }
  throw new Error(
    "没有找到可用的 Claude Code。已尝试 PATH、%APPDATA%\\npm、~\\.local\\bin 等常见位置；可在下方手动选择 claude.exe 或 claude.cmd。",
  );
}
async function claudeVersionOf(candidatePath) {
  const options = { windowsHide: true, timeout: 20000 };
  // CCDPH-FIX(CMD-4): .cmd/.bat 无法被 execFile 直接执行（Node 会 EINVAL），确实需要
  // 一个 shell；但**绝不能**把路径插进命令串。原实现是：
  //     exec(`"${candidatePath}" --version`, { shell: true })
  // 而 candidatePath 最终来自 POST /api/settings 的 claudeExecutable，于是
  // `C:\x.cmd" & <任意命令> & rem "` 会在**没有任何审批**的情况下被执行。
  // 现在改为「参数数组 + 显式 cmd.exe + windowsVerbatimArguments」：命令行由一个
  // 数组原样拼出，不存在字符串拼接注入；命令形式用微软推荐的
  // `cmd /d /s /c ""<path>" --version"`（已实测含空格的路径可用）。
  // verbatim 会绕过 Node 的转义，所以路径必须先过字符白名单：任何引号 / 百分号 /
  // & | < > ^ ! ( ) 或换行一律拒绝 —— Windows 文件名不能含 `"`，这条同时挡住了
  // 「用引号闭合再拼接命令」的注入。
  if ([".cmd", ".bat"].includes(path.extname(candidatePath).toLowerCase())) {
    if (
      !/^[a-zA-Z]:\\/.test(candidatePath) ||
      !/^[^"&|<>^%!()\r\n]+$/.test(candidatePath)
    )
      throw new Error("Claude 可执行文件路径含有不安全的字符，已拒绝执行");
    const { stdout } = await exec(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", `""${candidatePath}" --version"`],
      { ...options, windowsVerbatimArguments: true },
    );
    return stdout.trim().split(/\r?\n/)[0] || "已安装";
  }
  const { stdout } = await exec(candidatePath, ["--version"], options);
  return stdout.trim().split(/\r?\n/)[0] || "已安装";
}
let claudeDetecting = null;
async function redetectClaude() {
  // 并发去重：多处同时触发只跑一次检测
  if (claudeDetecting) return claudeDetecting;
  claudeDetecting = (async () => {
    try {
      const found = await findClaude();
      claudePath = found.path;
      claudeVersion = found.version;
      claudeError = "";
    } catch (error) {
      claudePath = undefined;
      claudeVersion = undefined;
      claudeError = error.message;
    } finally {
      claudeDetecting = null;
    }
    return {
      claude: {
        configured: Boolean(claudePath),
        version: claudeVersion,
        error: claudeError,
      },
    };
  })();
  return claudeDetecting;
}

// ===== 自动更新 =====
// CCDPH-FIX(M-6): 版本号唯一事实源 —— 从 package.json 的 version 读取（本次已升到
// 0.3.2），根治硬编码常量与 package.json 漂移的问题。server.mjs 是 ESM，用
// createRequire 读 JSON 兼容性最稳；读取失败（文件缺失/JSON 损坏）时回退 "0.3.0"
// 并落一行错误日志，不影响启动。
const APP_VERSION = (() => {
  try {
    const require = createRequire(import.meta.url);
    return String(require("./package.json").version) || "0.3.0";
  } catch (error) {
    console.error(
      "[ccdph] 读取 package.json 版本失败，回退 0.3.0:",
      error?.message || error,
    );
    return "0.3.0";
  }
})();
function newerVersion(candidate, current) {
  const parse = (value) =>
    (String(value).match(/\d+(\.\d+)+/) || ["0"])[0]
      .split(".")
      .map(Number);
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] || 0;
    const right = b[i] || 0;
    if (left !== right) return left > right;
  }
  return false;
}
// 更新包必须走 https；仅本机测试源（127.0.0.1 / localhost / ::1）允许明文 http，
// 否则一个被劫持的更新源就等于远程代码执行（bat 会覆盖安装目录并重启）。
function isLoopbackUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return (
      host === "127.0.0.1" ||
      host === "localhost" ||
      host === "::1" ||
      host === "[::1]"
    );
  } catch {
    return false;
  }
}
export async function readJsonResponseBounded(response, maxBytes = 1024 * 1024) {
  const declared = Number(response.headers?.get?.("content-length") || 0);
  if (declared && declared > maxBytes)
    throw new Error(`JSON 响应过大（${declared} 字节，上限 ${maxBytes} 字节）`);
  if (!response.body) throw new Error("JSON 响应为空");
  const chunks = [];
  let received = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    received += buffer.length;
    if (received > maxBytes) {
      try {
        await response.body.cancel?.();
      } catch { }
      throw new Error(`JSON 响应超过大小上限（${maxBytes} 字节）`);
    }
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks, received).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("JSON 响应必须是对象");
  return parsed;
}
async function checkForUpdate() {
  const manifestUrl = (db.settings.updateManifestUrl || "").trim();
  const result = {
    current: APP_VERSION,
    latest: "",
    updateAvailable: false,
    url: "",
    notes: "",
  };
  if (!manifestUrl)
    return {
      ...result,
      error: "未配置更新源：请在下方填写包含 latest.json 的地址",
    };
  if (!/^https?:\/\//i.test(manifestUrl))
    return { ...result, error: "更新源地址必须是 http(s) 链接" };
  if (!/^https:\/\//i.test(manifestUrl) && !isLoopbackUrl(manifestUrl))
    return {
      ...result,
      error: "更新源地址必须使用 https（本机测试源可用 127.0.0.1 / localhost）",
    };
  const response = await fetch(manifestUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok)
    throw new Error(`更新源返回 ${response.status}，请检查地址是否可公开访问`);
  const manifest = await readJsonResponseBounded(response);
  const latest = String(manifest.version || "").trim();
  if (!latest) throw new Error("更新源缺少 version 字段");
  const url = String(manifest.url || "").trim();
  if (manifest.url && !/^https?:\/\//i.test(url))
    throw new Error("更新包地址必须是 http(s) 链接");
  if (url && !/^https:\/\//i.test(url) && !isLoopbackUrl(url))
    throw new Error("更新包地址必须使用 https（本机测试源可用 127.0.0.1 / localhost）");
  const sha256 = String(manifest.sha256 || "")
    .trim()
    .toLowerCase();
  if (sha256 && !/^[0-9a-f]{64}$/.test(sha256))
    throw new Error("更新源的 sha256 格式不正确（应为 64 位十六进制）");
  // CCDPH-FIX(R4-P3-5): 明文 http（本机回环）时 sha256 与清单同源拉取，无法提供完整性
  // 保证（同机进程可同时伪造两者）。不阻断——本机测试源是合法用例——但必须如实带出警告，
  // 前端据此提示用户，绝不静默。
  const plaintextChannel =
    !/^https:\/\//i.test(manifestUrl) ||
    (Boolean(url) && !/^https:\/\//i.test(url));
  return {
    ...result,
    latest,
    updateAvailable: Boolean(url) && newerVersion(latest, APP_VERSION),
    url,
    sha256,
    integrity: sha256 ? "sha256" : "none",
    notes: String(manifest.notes || ""),
    ...(plaintextChannel
      ? {
          warning:
            "更新源或更新包使用明文 http（本机回环地址）。sha256 与清单同源拉取，" +
            "无法抵御可伪造回环流量的同机进程；明文源仅建议用于受信本机测试环境。",
        }
      : {}),
  };
}
export function assertSafeZipEntries(extractDir, entryNames) {
  const root = path.resolve(extractDir);
  const destinations = new Set();
  for (const rawName of entryNames) {
    const name = String(rawName || "").replace(/\\/g, "/");
    if (!name || name.includes("\0")) throw new Error("更新包包含无效的空文件名");
    if (
      name.startsWith("/") ||
      name.startsWith("//") ||
      /^[a-zA-Z]:/.test(name)
    )
      throw new Error(`更新包包含绝对路径：${name.slice(0, 160)}`);
    const segments = name.split("/").filter(Boolean);
    if (segments.some((segment) => Buffer.byteLength(segment, "utf8") > 255))
      throw new Error(
        `更新包包含超过 255 字节的路径段：${name.slice(0, 160)}`,
      );
    if (
      segments.some(
        (segment) =>
          segment === "." || segment === ".." || segment.includes(":"),
      )
    )
      throw new Error(`更新包包含路径穿越或 NTFS 数据流：${name.slice(0, 160)}`);
    const canonicalSegments = segments.map((segment) =>
      segment.replace(/[. ]+$/g, ""),
    );
    if (canonicalSegments.some((segment, index) => segment !== segments[index]))
      throw new Error(
        `更新包包含 Windows 会归一化的尾随点或空格：${name.slice(0, 160)}`,
      );
    if (
      canonicalSegments.some(
        (segment, index) =>
          !segment ||
          segment === "." ||
          segment === ".." ||
          segments[index].includes(":"),
      )
    )
      throw new Error(`更新包包含路径穿越或 NTFS 数据流：${name.slice(0, 160)}`);
    if (
      canonicalSegments.some((segment) =>
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment),
      )
    )
      throw new Error(`更新包包含 Windows 设备文件名：${name.slice(0, 160)}`);
    const destinationKey = canonicalSegments.join("/").toLowerCase();
    if (destinations.has(destinationKey))
      throw new Error(`更新包包含归一化后冲突的重复路径：${name.slice(0, 160)}`);
    destinations.add(destinationKey);
    const target = path.resolve(root, ...segments);
    if (!within(root, target))
      throw new Error(`更新包条目越过解包目录：${name.slice(0, 160)}`);
  }
}

export async function sha256File(file, maxBytes = 300 * 1024 * 1024) {
  const handle = await fs.open(file, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let bytes = 0;
  try {
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > maxBytes)
        throw new Error(`文件超过哈希校验上限（${maxBytes} 字节）`);
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest();
  } finally {
    await handle.close().catch(() => { });
  }
}

export async function validateZipArchivePaths(zipPath, extractDir) {
  const handle = await fs.open(zipPath, "r");
  try {
    const { size } = await handle.stat();
    const tailSize = Math.min(size, 22 + 0xffff);
    const tail = Buffer.alloc(tailSize);
    const tailRead = await handle.read(tail, 0, tailSize, size - tailSize);
    if (tailRead.bytesRead !== tailSize) throw new Error("更新包读取不完整");
    let eocd = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (
        tail.readUInt32LE(index) === 0x06054b50 &&
        index + 22 + tail.readUInt16LE(index + 20) === tail.length
      ) {
        eocd = index;
        break;
      }
    }
    if (eocd < 0) throw new Error("更新包不是有效的 ZIP 文件（缺少中央目录）");
    if (
      tail.readUInt16LE(eocd + 4) !== 0 ||
      tail.readUInt16LE(eocd + 6) !== 0 ||
      tail.readUInt16LE(eocd + 8) !== tail.readUInt16LE(eocd + 10)
    )
      throw new Error("不支持跨磁盘 ZIP 更新包");
    const entries = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    const eocdOffset = size - tailSize + eocd;
    if (
      entries === 0xffff ||
      directorySize === 0xffffffff ||
      directoryOffset === 0xffffffff
    )
      throw new Error("更新包使用了不支持的 ZIP64 格式");
    if (entries > 20_000) throw new Error("更新包文件数量过多（上限 20000）");
    if (
      directorySize > 32 * 1024 * 1024 ||
      directoryOffset + directorySize > eocdOffset
    )
      throw new Error("更新包中央目录异常或过大");
    const directory = Buffer.alloc(directorySize);
    const directoryRead = await handle.read(
      directory,
      0,
      directorySize,
      directoryOffset,
    );
    if (directoryRead.bytesRead !== directorySize)
      throw new Error("更新包中央目录读取不完整");
    const names = [];
    let totalExtractedBytes = 0;
    let cursor = 0;
    for (let index = 0; index < entries; index += 1) {
      if (
        cursor + 46 > directory.length ||
        directory.readUInt32LE(cursor) !== 0x02014b50
      )
        throw new Error("更新包中央目录条目损坏");
      const nameLength = directory.readUInt16LE(cursor + 28);
      const extraLength = directory.readUInt16LE(cursor + 30);
      const commentLength = directory.readUInt16LE(cursor + 32);
      const versionMadeBy = directory.readUInt16LE(cursor + 4);
      const flags = directory.readUInt16LE(cursor + 8);
      const compressedSize = directory.readUInt32LE(cursor + 20);
      const uncompressedSize = directory.readUInt32LE(cursor + 24);
      const externalAttributes = directory.readUInt32LE(cursor + 38);
      const localHeaderOffset = directory.readUInt32LE(cursor + 42);
      const end = cursor + 46 + nameLength + extraLength + commentLength;
      if (end > directory.length) throw new Error("更新包中央目录长度异常");
      if (
        (versionMadeBy >>> 8) === 3 &&
        ((externalAttributes >>> 16) & 0xf000) === 0xa000
      )
        throw new Error("更新包包含不允许的符号链接条目");
      if (flags & 1) throw new Error("更新包包含不支持的加密条目");
      if (
        compressedSize === 0xffffffff ||
        uncompressedSize === 0xffffffff ||
        localHeaderOffset === 0xffffffff
      )
        throw new Error("更新包条目使用了不支持的 ZIP64 格式");
      if (localHeaderOffset >= directoryOffset)
        throw new Error("更新包本地条目偏移异常");
      totalExtractedBytes += uncompressedSize;
      if (totalExtractedBytes > 1024 * 1024 * 1024)
        throw new Error("更新包解压后体积超过 1 GiB 安全上限");
      names.push(directory.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"));
      cursor = end;
    }
    // CCDPH-FIX(P3-1): 校验中央目录被**完整消费** —— 循环结束后 cursor 必须落在目录末尾，
    // 否则说明"声明的条目数"与目录实际内容不一致（尾部藏着未校验的结构）。
    // 允许紧随其后的可选"数字签名"记录（0x05054b50）。
    if (cursor !== directory.length) {
      const isSignatureRecord =
        cursor + 6 <= directory.length &&
        directory.readUInt32LE(cursor) === 0x05054b50;
      if (!isSignatureRecord)
        throw new Error("更新包中央目录长度与条目数不一致");
    }
    assertSafeZipEntries(extractDir, names);
    return names;
  } finally {
    await handle.close().catch(() => { });
  }
}
export function equalSha256Hex(expectedHex, actualDigest) {
  const normalized = String(expectedHex || "");
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) return false;
  const expected = Buffer.from(normalized, "hex");
  const actual = Buffer.isBuffer(actualDigest)
    ? actualDigest
    : Buffer.from(actualDigest || []);
  return (
    expected.length === 32 &&
    actual.length === 32 &&
    timingSafeEqual(expected, actual)
  );
}
// CCDPH-FIX(R2-P3-3): 更新包 1 GiB 上限此前只按 ZIP 中央目录里**声明的** uncompressedSize
// 累加（见 validateZipArchivePaths），而 Expand-Archive 解压的是真实数据流：伪造声明
// （声明值很小、deflate 实际膨胀到数 GiB）即可绕过限额、把 %TEMP% 撑爆。
// 这里在解压**之后**按真实文件大小复核；超限即抛错（外层会清掉整个随机暂存目录）。
const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024;
async function assertExtractedSizeWithin(dir, limit = MAX_EXTRACTED_BYTES) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = await fs
      .readdir(current, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue; // 不跟随链接：避免把外部目录计入或成环
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      total += await fs
        .stat(full)
        .then((value) => value.size)
        .catch(() => 0);
      if (total > limit)
        throw new Error("更新包解压后体积超过 1 GiB 安全上限，已中止安装");
    }
  }
  return total;
}
// CCDPH-FIX(H-9): onStage 用于把当前阶段上报给后台更新任务（下载 → 解压 → 替换）。
async function installUpdate(onStage = () => { }) {
  if (process.env.WORKBENCH_DESKTOP !== "1")
    throw new Error("自动安装仅支持桌面版；网页版请手动下载新版本");
  // 打包版：进程 exe 就是 "CCDPH.exe"，它所在的目录即安装目录；
  // 该目录里的 .data / .desktop-data 不会被 robocopy /E 覆盖删除
  const execName = path.basename(process.execPath).toLowerCase();
  if (execName !== "ccdph.exe")
    throw new Error("当前是开发模式运行，自动更新已跳过（请使用打包版）");
  const installDir = path.dirname(process.execPath);
  const check = await checkForUpdate();
  if (!check.updateAvailable || !check.url)
    throw new Error(
      check.latest && !check.updateAvailable
        ? `已是最新版本（${APP_VERSION} ）`
        : "更新源没有提供可下载的安装包",
    );
  const stageDir = path.join(
    os.tmpdir(),
    `ccdph-update-${Date.now()}-${randomUUID().slice(0, 8)}`,
  );
  await fs.mkdir(stageDir, { recursive: true });
  // CCDPH-FIX(F-07/RES-5): 整个下载/解包/写脚本阶段包在 try 里。原来任何一步抛错都会
  // 把刚建好的 %TEMP%\ccdph-update-<ts>\（含完整 update.zip，几十~几百 MB）永久留下，
  // 用户重试 N 次就留下 N 份。
  try {
    const zipPath = path.join(stageDir, "update.zip");
    // CCDPH-FIX(F-07/RES-5): 先校验元数据再下载 —— sha256 缺失时不必先下载一遍。
    if (!check.sha256)
      throw new Error(
        "更新源缺少 sha256 校验值，为避免安装被篡改的更新包已拒绝；请在 latest.json 里加上 sha256 字段",
      );
    const response = await fetch(check.url, {
      redirect: "error",
      signal: AbortSignal.timeout(600000),
    });
    if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
    // CCDPH-FIX(F-07/RES-5): 边下边写盘、边算 sha256，不再 arrayBuffer() 整个安装包。
    // 更新源 URL 是用户可配置的，原来 Content-Length 完全不看、也没有流式上限，
    // 一个超大/无限长的响应会被整段缓冲进主进程内存（RSS 一路涨到 600s 超时或 OOM）；
    // 而完整性校验发生在缓冲区已经存在之后，等于完全没有保护内存。
    // 现在：先看 Content-Length，再对实际到达的字节计数，超过上限立即中止下载。
    const MAX_UPDATE_BYTES = 300 * 1024 * 1024;
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared && declared > MAX_UPDATE_BYTES)
      throw new Error(
        `更新包过大（${declared} 字节，上限 ${MAX_UPDATE_BYTES} 字节），已拒绝下载`,
      );
    const hash = createHash("sha256");
    let received = 0;
    const out = await fs.open(zipPath, "w");
    try {
      for await (const chunk of response.body) {
        received += chunk.length;
        if (received > MAX_UPDATE_BYTES)
          throw new Error(
            `更新包超过大小上限（${MAX_UPDATE_BYTES} 字节），已中止下载`,
          );
        hash.update(chunk);
        await out.write(chunk);
      }
    } finally {
      await out.close().catch(() => { });
    }
    // 完整性校验：更新源必须自带 sha256，下载后逐字节比对，不匹配直接拒绝。
    const actualHash = hash.digest();
    if (!equalSha256Hex(check.sha256, actualHash))
      throw new Error("更新包 sha256 校验失败，已拒绝安装（文件可能被篡改或下载不完整）");
    onStage("解压");
    const extractDir = path.join(stageDir, "raw");
    await fs.mkdir(extractDir, { recursive: true });
    // 解压前读取 ZIP 中央目录并验证每一个条目；事后 realpath 检查已经太晚，恶意条目可能
    // 在 Expand-Archive 阶段就写出 raw/。拒绝绝对路径、..、ADS 和 Windows 设备名。
    await validateZipArchivePaths(zipPath, extractDir);
    // 中央目录验证完成后再从磁盘重算一次，关闭“下载校验通过后替换 update.zip”窗口。
    if (!equalSha256Hex(check.sha256, await sha256File(zipPath, MAX_UPDATE_BYTES)))
      throw new Error("更新包在解压前发生变化，已拒绝安装");
    // CCDPH-FIX(LOW-1): 与下面 .bat 路径同一条字符闸门。PowerShell 的双引号字符串里
    // `$` 与反引号**仍然会被求值**（`$(…)` 会执行子表达式），而 zipPath/extractDir 派生自
    // %TEMP%（用户可控）。原来的闸门只覆盖 .bat 正文、且在这条命令之后才跑，等于
    // PowerShell 这条路径完全没设防；现在先把危险字符挡掉，再拼 -Command 字符串。
    for (const [label, value] of [
      ["更新包", zipPath],
      ["解包目录", extractDir],
    ]) {
      if (/["$`\r\n]/.test(value))
        throw new Error(
          `${label}路径包含 PowerShell 无法安全处理的字符（引号、$ 或反引号），已中止自动更新`,
        );
    }
    await exec(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${extractDir}" -Force`,
      ],
      { windowsHide: true, timeout: 300000 },
    );
    // PowerShell 解压期间若包被并发改写，结果不可再信任；只清理随机暂存目录，不进入替换阶段。
    if (!equalSha256Hex(check.sha256, await sha256File(zipPath, MAX_UPDATE_BYTES)))
      throw new Error("更新包在解压期间发生变化，已拒绝安装");
    // CCDPH-FIX(R2-P3-3): 声明值可伪造，必须按解压后的**真实**体积复核 1 GiB 上限。
    await assertExtractedSizeWithin(extractDir);
    // 安装包根目录或一级子目录里找 "CCDPH.exe"
    const exeName = "CCDPH.exe";
    let appDir = "";
    const entries = await fs.readdir(extractDir, { withFileTypes: true });
    // CCDPH-FIX(P3-21): 原来只比 `entry.name === "CCDPH.exe"`（大小写敏感、且不校验是否为文件）。
    // 不同机器/打包器可能产出小写名，或同名项其实是目录 → "找不到应用目录"。
    const isExe = (entry) =>
      entry.isFile() && entry.name.toLowerCase() === exeName.toLowerCase();
    if (entries.some(isExe)) appDir = extractDir;
    else {
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const child = path.join(extractDir, entry.name);
        const childEntries = await fs.readdir(child, { withFileTypes: true });
        if (childEntries.some(isExe)) {
          appDir = child;
          break;
        }
      }
    }
    if (!appDir) throw new Error("安装包里没有找到 CCDPH.exe");
    onStage("替换");
    const batPath = path.join(stageDir, "apply-update.bat");
    // robocopy 退出码 0-7 都算成功，>= 8 才是失败；失败时绝不能启动。
    // 可能新旧混合的安装目录。
    // CCDPH-FIX(F-12/ELE-3): 脚本正文必须是**纯 ASCII**。cmd.exe 是按字节、用控制台
    // OEM 代码页（CP936/CP932/…）读 .bat 的，它不会按 UTF-8 解码；而 %TEMP% 和安装目录
    // 都可能含中文（本应用的目标用户尤其如此），UTF-8 字节会被解成乱码 → robocopy 拿到
    // 不存在的源、以 errorlevel>=8 退出 → 更新静默不生效。
    // 因此路径全部改由**环境变量**传入：CreateProcess 传的是宽字符，cmd 在运行时展开，
    // 既不经过 OEM 解码，也不再出现「路径里的 %VAR% 被二次展开」（ELE-3）。
    // 这里额外做一次字符闸门：引号会破坏引号配对，换行会切断命令。
    for (const [label, value] of [
      ["更新源", appDir],
      ["安装目录", installDir],
      ["暂存目录", stageDir],
    ]) {
      if (/["\r\n]/.test(value))
        throw new Error(`${label}路径包含 cmd 无法处理的字符（引号或换行），已中止自动更新`);
    }
    // 注意：下面这个数组是**生成到磁盘上的 .bat 正文**，必须保持纯 ASCII ——
    // 中文说明只能写在这里（JS 源文件按 UTF-8 读，.bat 不是）。
    const bat = [
      "@echo off",
      '"%SystemRoot%\\System32\\chcp.com" 65001 >nul',
      '"%SystemRoot%\\System32\\timeout.exe" /t 3 /nobreak >nul',
      `"%SystemRoot%\\System32\\taskkill.exe" /pid ${process.pid} /f >nul 2>&1`,
      '"%SystemRoot%\\System32\\timeout.exe" /t 1 /nobreak >nul',
      '"%SystemRoot%\\System32\\robocopy.exe" "%CCDPH_SRC%" "%CCDPH_DST%" /E /NFL /NDL /NJH /NJS /NP',
      "rem robocopy exit code >= 8 means the copy failed",
      "if errorlevel 8 (",
      '  cd /d "%TEMP%" & rmdir /s /q "%CCDPH_STAGE%"',
      "  rem CCDPH-FIX(P2-9): the app was already taskkilled above; relaunch it so a failed",
      "  rem copy does not leave the user with neither an updated nor a running app.",
      '  start "" "%CCDPH_EXE%"',
      "  exit /b 1",
      ")",
      'start "" "%CCDPH_EXE%"',
      "rem final step: reclaim the whole staging folder (update.zip included)",
      'cd /d "%TEMP%" & rmdir /s /q "%CCDPH_STAGE%"',
      "",
    ].join("\r\n");
    await fs.writeFile(batPath, bat, "utf8");
    // CCDPH-FIX(P1-2): 原来直接 `spawn(...).unref()` 且**没有 error 监听** —— cmd.exe 启动失败
    // （被杀软拦截 / EACCES / 磁盘异常）会抛出未处理的 'error' 事件，触发 desktop.cjs 的全局
    // uncaughtException 兜底，把整个应用退出。这里改为等 'spawn' 确认启动成功后再 unref；
    // 失败则 reject，交由外层 catch 回收暂存目录并如实回 400（不再"失败伪装成功"）。
    await new Promise((resolve, reject) => {
      const updater = spawn(WINDOWS_CMD_EXE, ["/c", batPath], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: {
          ...process.env,
          CCDPH_SRC: appDir,
          CCDPH_DST: installDir,
          CCDPH_STAGE: stageDir,
          CCDPH_EXE: path.join(installDir, exeName),
        },
      });
      updater.once("spawn", () => {
        updater.unref();
        resolve();
      });
      updater.once("error", (error) => reject(error));
    });
    return { ok: true, version: check.latest };
  } catch (error) {
    // CCDPH-FIX(F-07): 失败必须回收暂存目录（含已下载的 update.zip）
    await fs.rm(stageDir, { recursive: true, force: true }).catch(() => { });
    throw error;
  }
}
async function loadDatabaseSync() {
  if (DatabaseSync !== undefined) return DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    DatabaseSync = null;
  }
  return DatabaseSync;
}
function unavailableProviderUsage(providerName, reason) {
  return {
    available: false,
    providerName: providerName || "当前服务商",
    reason,
    balances: [],
    updatedAt: Date.now(),
  };
}
function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function providerEnv(row) {
  try {
    const config = JSON.parse(row.settings_config || "{}");
    return config.env && typeof config.env === "object" ? config.env : {};
  } catch {
    return {};
  }
}
// ---- 应用内多供应商配置（不依赖 CC Switch）--------------------------------
// 非密信息（名称/地址/模型映射）放 db.settings.apiProfiles；密钥按 profileId 存
// DATA/api-auth.json 存 tokens 表，绝不放进 db.settings，也就绝不会回传给页面。
const API_AUTH_FILE = path.join(DATA, "api-auth.json");
const API_AUTH_MAX_BYTES = 1024 * 1024;
let apiTokens = {}; // profileId -> key
let credentialProtector = createDefaultCredentialProtector(API_AUTH_MAX_BYTES);
let apiAuthNeedsRewrite = false;
let apiAuthLockedError = "";
let apiAuthPersistence = credentialProtector ? "encrypted" : "session";
let apiAuthWarning = credentialProtector
  ? ""
  : "当前平台没有可用的系统安全存储；API 密钥仅在本次运行期间保存在内存中";
export function setCredentialProtector(protector) {
  credentialProtector =
    protector &&
    typeof protector.name === "string" &&
    typeof protector.encrypt === "function" &&
    typeof protector.decrypt === "function"
      ? protector
      : null;
  apiAuthPersistence = credentialProtector ? "encrypted" : "session";
  apiAuthWarning = credentialProtector
    ? ""
    : "当前平台没有可用的系统安全存储；API 密钥仅在本次运行期间保存在内存中";
}
// CCDPH-FIX(F-13): 形如凭据的环境变量名（*_TOKEN / *_API_KEY / *_AUTH* / *_SECRET* /
// *_PASSWORD）一律不允许出现在 profile.env —— 那条通道会被写进 state.json 并回传页面。
const CREDENTIAL_ENV_KEY_RE = /(_TOKEN|_API_KEY|_AUTH|_SECRET|_PASSWORD)/;
// CCDPH-FIX(R3-P3-11): 浏览器域名的允许字符集。这些值会被 `;` 拼进命令行参数交给
// @playwright/mcp 解析（本进程是 argv 数组、无 shell，注入不进 shell，但下游怎么解析不由
// 我们控制，且 CR/LF/引号/`;` 本身也不该出现在域名里）。写入与**载入**两条路径共用它。
const ORIGIN_PATTERN_RE = /^[A-Za-z0-9*._:/[\].-]+$/;
const isValidOriginEntry = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !value.startsWith("-") &&
  ORIGIN_PATTERN_RE.test(value);
async function loadApiAuth() {
  try {
    const stored = JSON.parse(
      (await readStableBoundedFile(API_AUTH_FILE, API_AUTH_MAX_BYTES)).toString(
        "utf8",
      ),
    );
    let data = stored;
    if (stored?.version === 2) {
      if (!credentialProtector)
        throw new Error("当前运行环境无法解密供应商密钥");
      if (stored.protection !== credentialProtector.name)
        throw new Error(
          `供应商密钥由 ${stored.protection || "未知保护器"} 加密，当前环境无法解密`,
        );
      data = JSON.parse(
        (await credentialProtector.decrypt(String(stored.payload || ""))) || "",
      );
    }
    apiTokens =
      data.tokens && typeof data.tokens === "object" ? { ...data.tokens } : {};
    // 旧版单密钥格式：暂存到 legacy 键，等迁移逻辑挪进对应 profile
    if (typeof data.token === "string" && data.token) apiTokens.legacy = data.token;
    apiAuthNeedsRewrite = stored?.version !== 2;
    apiAuthLockedError = "";
    apiAuthPersistence = credentialProtector ? "encrypted" : "session";
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error("[ccdph] 读取供应商密钥失败:", error?.message || error);
      apiAuthLockedError = String(error?.message || "供应商密钥无法解密");
      apiAuthPersistence = "locked";
      apiAuthWarning = "供应商密钥库无法解密，已锁定且不会覆盖原文件";
    } else {
      apiAuthLockedError = "";
      apiAuthPersistence = credentialProtector ? "encrypted" : "session";
      apiAuthWarning = credentialProtector
        ? ""
        : "当前平台没有可用的系统安全存储；API 密钥仅在本次运行期间保存在内存中";
    }
    apiTokens = {};
    apiAuthNeedsRewrite = false;
  }
}
async function writeApiAuth() {
  if (apiAuthLockedError)
    throw new Error(
      `供应商密钥库已锁定，原文件保持不变：${apiAuthLockedError}`,
    );
  // 串行化并发写入，避免多个 save 请求竞态写出半截 JSON
  const task = apiAuthSaving.then(async () => {
    const clean = Object.fromEntries(
      Object.entries(apiTokens).filter(([, value]) => value),
    );
    if (!Object.keys(clean).length) {
      // CCDPH-FIX(P3-13): 删除失败被静默吞掉会留下"内存里没有密钥、磁盘上仍有旧密钥"
      // —— 重启后密钥"复活"。至少留下可查日志。
      try {
        await fs.rm(API_AUTH_FILE, { force: true });
      } catch (error) {
        console.error(
          "[ccdph] 删除空密钥文件失败（磁盘上可能仍残留旧密钥）:",
          error?.message || error,
        );
      }
      apiAuthNeedsRewrite = false;
      return { persistent: apiAuthPersistence === "encrypted" };
    }
    if (!credentialProtector || apiAuthPersistence === "session") {
      await fs.rm(API_AUTH_FILE, { force: true });
      apiAuthNeedsRewrite = false;
      apiAuthPersistence = "session";
      apiAuthWarning =
        "系统安全存储不可用；API 密钥仅在本次运行期间保存在内存中，退出后需要重新输入";
      return { persistent: false };
    }
    const plaintext = JSON.stringify({ tokens: clean });
    const document = {
      version: 2,
      protection: credentialProtector.name,
      payload: await credentialProtector.encrypt(plaintext),
    };
    const text = JSON.stringify(document, null, 2);
    if (Buffer.byteLength(text, "utf8") > API_AUTH_MAX_BYTES)
      throw new Error("API 密钥配置超过安全写入上限");
    // CCDPH-FIX(R2-P3-5): 原来是裸 writeFile —— 写中途崩溃会留下截断文件，下次
    // JSON.parse 失败 → 密钥库被判定为不可读、拒绝覆盖，用户在手工清理前无法再保存密钥。
    // 改为与 state.json 相同的「fsync 后 rename」持久化原子写。
    await writeFileAtomicDurable(API_AUTH_FILE, text, "api-auth");
    apiAuthNeedsRewrite = false;
    apiAuthPersistence = "encrypted";
    apiAuthWarning = "";
    return { persistent: true };
  });
  // CCDPH-FIX(F-05): 原来把 .catch(console.error) 挂在链尾并返回它，写盘失败被彻底
  // 吞掉 → /api/api-profiles/key 对一个「只存在内存里」的密钥回 {ok:true,hasKey:true}。
  // 现在与 save() 同一口径：队列尾永不 rejected（避免一次失败毒化后续写入），
  // 但本次任务的 promise 原样返回给调用者，失败可以如实回 400。
  apiAuthSaving = task.then(
    () => {},
    (err) => console.error("[ccdph] 写入 api-auth 失败:", err?.message || err),
  );
  return task;
}
// CCDPH-FIX(F-05): 内存与磁盘必须一致 —— 写盘失败就回滚内存里的密钥，
// 否则界面显示「已配置」、重启后密钥却不存在。
// 注意：原始 errno 的 message 带绝对路径（MED-1 明确要求不外泄），所以细节只写日志，
// 回给客户端的是一句干净的中文（包装后的 Error 没有 code/path，sanitizeError 不会再过滤）。
const apiAuthFailure = (error, action) => {
  console.error(`[ccdph] ${action}失败:`, error?.message || error);
  return new Error(`${action}失败（未写入磁盘），请检查数据目录权限后重试`);
};
async function saveProfileToken(id, token) {
  const previous = apiTokens[id];
  if (token) apiTokens[id] = token;
  else delete apiTokens[id];
  try {
    return await writeApiAuth();
  } catch (error) {
    if (previous === undefined) delete apiTokens[id];
    else apiTokens[id] = previous;
    throw apiAuthFailure(error, "密钥保存");
  }
}
// 旧版单配置（apiMode=custom + apiBaseUrl + 单密钥）迁移成 profile 模式。
// 返回 true 表示发生过迁移，调用方需要 writeApiAuth + save。
function migrateApiProfiles() {
  db.settings.apiProfiles = Array.isArray(db.settings.apiProfiles)
    ? db.settings.apiProfiles
    : [];
  if (
    db.settings.apiMode === "custom" &&
    db.settings.apiBaseUrl &&
    !db.settings.apiProfiles.length
  ) {
    const id = randomUUID();
    db.settings.apiProfiles.push({
      id,
      name: "自定义 API",
      baseUrl: db.settings.apiBaseUrl,
      env: {},
    });
    if (apiTokens.legacy) apiTokens[id] = apiTokens.legacy;
    db.settings.apiMode = "profile";
    db.settings.activeProfileId = id;
    db.settings.apiBaseUrl = "";
    return true;
  }
  // CCDPH-FIX(F-11): 绝不能「无副作用地」丢弃内存里的 legacy 密钥 —— 删了却不写盘，
  // 之后任何一次 writeApiAuth()（改别的 profile 密钥等）都会把它从 api-auth.json 里
  // 抹掉，而那是用户唯一的凭据。只有确认它已经被搬进某个 profile 才允许删除，
  // 并返回 true 让调用方 writeApiAuth() + save() 把磁盘改成一致状态。
  if (apiTokens.legacy) {
    const alreadyCopied = (db.settings.apiProfiles || []).some(
      (p) => apiTokens[p.id] === apiTokens.legacy,
    );
    if (alreadyCopied) {
      delete apiTokens.legacy;
      return true;
    }
  }
  if (!db.settings.activeProfileId) db.settings.activeProfileId = "";
  return false;
}
// 供应商模式下注入给 Claude Code 的环境变量；未配置完整则返回 null（继续走继承环境）
function customApiEnv() {
  if (db.settings.apiMode !== "profile") return null;
  const profile = (db.settings.apiProfiles || []).find(
    (p) => p.id === db.settings.activeProfileId,
  );
  if (!profile) return null;
  const base = String(profile.baseUrl || "").trim().replace(/\/+$/, "");
  const token = apiTokens[profile.id] || "";
  if (!base || !token) return null;
  const extra = {};
  for (const [key, value] of Object.entries(profile.env || {}))
    if (/^ANTHROPIC_[A-Z0-9_]+$/.test(key) && typeof value === "string" && value)
      extra[key] = value;
  return { ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: token, ...extra };
}
// 当前生效的供应商标识（"cc-switch" 或 profileId）；会话创建时快照到 session.providerId
function currentProviderId() {
  return db.settings.apiMode === "profile"
    ? db.settings.activeProfileId || "cc-switch"
    : "cc-switch";
}
function activeProfileCurrency() {
  if (db.settings.apiMode !== "profile") return "";
  const profile = (db.settings.apiProfiles || []).find(
    (p) => p.id === db.settings.activeProfileId,
  );
  return profile?.currency === "USD" ? "USD" : profile ? "CNY" : "";
}
// 借鉴 Codex「切换 Provider 后旧会话失效」的修复思路：切换供应商时把旧会话
// 的 provider 元数据迁到新供应商；绑定的是旧供应商专属模型名的会话，把模型
// 归位到新供应商的默认模型（对话事件不动，只改元数据，旧对话可继续）。
const GENERIC_MODELS = new Set(["", "inherit", "sonnet", "opus", "haiku"]);
// CCDPH-FIX(HIGH-2/HIGH-3): model 字段的统一校验。此前 /api/session/update 有
// 「≤80 字符 + 字符集」两重校验，而 /api/send 却把原始字符串直接塞进 s.model
// （实测能落盘 200000 字符），同一字段两套口径；并且 /api/send 在该字段缺省时会
// 把已选模型改写成 ""（静默清空）。统一为：合法 → 返回规范化值；
// 非法或非字符串 → 返回 null，调用方保持原值不动。
// CCDPH-FIX(R4-P3-1): 与 MCP/hook 名、审批答案同一收口口径——这些名字不可能是合法模型名，
// 放行只会留下「在校验层通过了原型相关名」的不一致（实测虽无污染路径，但口径应统一）。
const PROTOTYPE_POLLUTION_NAMES = new Set(["__proto__", "prototype", "constructor"]);
export function normalizeModel(value) {
  if (typeof value !== "string") return null;
  const model = value.trim();
  if (model.length > 80) return null;
  if (PROTOTYPE_POLLUTION_NAMES.has(model)) return null;
  return GENERIC_MODELS.has(model) || /^[a-zA-Z0-9._\-/:]+$/.test(model) ? model : null;
}
function migrateSessionsTo(targetProviderId, fallbackModel) {
  let migrated = 0;
  for (const s of db.sessions) {
    if (!s.providerId || s.providerId === targetProviderId) continue;
    s.providerId = targetProviderId;
    if (s.model && !GENERIC_MODELS.has(s.model)) {
      // 旧供应商专属模型名在新供应商大概率不存在，归位到默认模型
      s.model = fallbackModel || "";
      migrated++;
    }
    s.updatedAt = Date.now();
  }
  return migrated;
}
// 个性化角色背景 → 附加 system prompt（不改写 Claude Code 自身设定）
const PERSONA_PROMPTS = {
  college:
    "用户的背景设定：在校大学生。请循序渐进地讲解，多用类比和完整示例，遇到专业术语时顺带解释；在用户可能不熟悉的环节给出明确的下一步指引。",
  senior:
    "用户的背景设定：资深程序员。请直击要点，省略基础概念解释，直接给结论、代码和权衡分析；保持简洁，不要重复用户已知的内容。",
  student:
    "用户的背景设定：中学生。请用通俗易懂的语言讲解，多用生活化的例子，避免专业术语；回答保持简短友好，鼓励提问。",
};
const USAGE_DAILY_KEEP_DAYS = 60;
export function normalizeUsageDaily(value, limit = USAGE_DAILY_KEEP_DAYS) {
  // CCDPH-FIX(P3-23): limit=0 时 `.slice(-0)` 等价 `.slice(0)` → 一条都不删（保留上限失效）。
  const keep = Math.max(1, Math.floor(Number(limit)) || USAGE_DAILY_KEEP_DAYS);
  const entries = Object.entries(value || {})
    .filter(
      ([date, item]) =>
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        item &&
        typeof item === "object" &&
        !Array.isArray(item),
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-keep);
  return Object.fromEntries(entries);
}
function buildPersonaPrompt() {
  const id = db.settings.personaId;
  if (id === "custom") return db.settings.personaCustom || "";
  return PERSONA_PROMPTS[id] || "";
}
// 每日用量统计：按本地日期累计请求数、等值成本与 token 数，供设置里的统计图
function recordDailyUsage(message) {
  const day = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD（本地时区）
  const bucket = db.settings.usageDaily || (db.settings.usageDaily = {});
  const entry = bucket[day] || { requests: 0, cost: 0, costUsd: 0, costCny: 0, inputTokens: 0, outputTokens: 0 };
  entry.requests += 1;
  if (typeof message.total_cost_usd === "number") {
    entry.costUsd = Math.round((entry.costUsd + message.total_cost_usd) * 10000) / 10000;
    entry.cost = entry.costUsd;
  }
  if (typeof message.costCny === "number") {
    entry.costCny = Math.round((entry.costCny + message.costCny) * 10000) / 10000;
  }
  if (message.usage && typeof message.usage === "object") {
    entry.inputTokens += Number(message.usage.input_tokens) || 0;
    entry.outputTokens += Number(message.usage.output_tokens) || 0;
  }
  bucket[day] = entry;
  db.settings.usageDaily = normalizeUsageDaily(bucket);
}
// npm 全局安装的 claude 在 Windows 上是个 .cmd 包装器，而 SDK 直接 spawn 它会
// 抛 spawn EINVAL（Node 出于安全禁止 shell:false 时执行 .bat/.cmd）。
// 这里解析包装器里引用的原生 exe，把真实可执行文件交给 SDK。
export async function resolveNativeClaudeExecutable(claudePath) {
  if (!/\.(cmd|bat)$/i.test(claudePath || "")) return claudePath;
  try {
    const script = (
      await readStableBoundedFile(claudePath, 1024 * 1024)
    ).toString("utf8");
    const dir = path.dirname(claudePath);
    const candidates = [];
    for (const match of script.matchAll(/"([^"]+)"/g)) {
      let candidate = match[1].trim();
      if (!/\.(exe|cmd|bat)$/i.test(candidate)) continue;
      candidates.push(
        candidate
          .replace(/%~dp0/gi, () => dir + path.sep)
          .replace(/%dp0%/gi, () => dir + path.sep),
      );
    }
    for (const candidate of candidates) {
      if (!/\.exe$/i.test(candidate)) continue;
      const resolvedCandidate = path.resolve(candidate);
      if (
        !within(path.resolve(dir), resolvedCandidate) ||
        path.basename(resolvedCandidate).toLowerCase() !== "claude.exe"
      )
        continue;
      try {
        if ((await fs.stat(resolvedCandidate)).isFile()) return resolvedCandidate;
      } catch { }
    }
    // 常见 npm 全局布局兜底：<dir>\node_modules\@anthropic-ai\claude-code\bin\claude.exe
    const fallback = path.join(
      dir,
      "node_modules",
      "@anthropic-ai",
      "claude-code",
      "bin",
      "claude.exe",
    );
    try {
      if ((await fs.stat(fallback)).isFile()) return fallback;
    } catch { }
  } catch { }
  return claudePath;
}
function providerMeta(row) {
  try {
    return JSON.parse(row.meta || "{}");
  } catch {
    return {};
  }
}
async function fetchJson(url, tokenValue) {
  const parsed = new URL(url);
  const allowed = new Set([
    "api.deepseek.com",
    "api.stepfun.com",
    "api.stepfun.ai",
    "api.siliconflow.cn",
    "api.siliconflow.com",
    "openrouter.ai",
    "api.novita.ai",
  ]);
  if (!allowed.has(parsed.hostname.toLowerCase()))
    throw new Error("当前供应商没有受支持的余额接口");
  const response = await fetch(parsed, {
    headers: {
      Authorization: `Bearer ${tokenValue}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12000),
    // CCDPH-FIX(P3-19): 余额请求此前跟随重定向，而域名白名单只校验**初始** URL —— 白名单域
    // 返回 302 即可把请求导向非白名单主机（本地/内网 SSRF）。这里直接拒绝重定向
    //（与更新清单/安装包的处理保持一致）。undici 跨源会剥掉 Authorization，
    // 但请求本身仍会被发出，所以必须在此拦住。
    redirect: "error",
  });
  if (!response.ok) throw new Error(`余额接口返回 HTTP ${response.status}`);
  return readJsonResponseBounded(response, 1024 * 1024);
}
async function queryNativeProviderUsage(row) {
  const env = providerEnv(row);
  const tokenValue = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
  if (!tokenValue || tokenValue === "PROXY_MANAGED")
    return unavailableProviderUsage(row.name, "provider-token-unavailable");
  let base;
  try {
    base = new URL(env.ANTHROPIC_BASE_URL || "");
  } catch {
    return unavailableProviderUsage(row.name, "provider-url-invalid");
  }
  const host = base.hostname.toLowerCase();
  try {
    if (host === "api.deepseek.com") {
      const data = await fetchJson(
        "https://api.deepseek.com/user/balance",
        tokenValue,
      );
      const balances = Array.isArray(data.balance_infos)
        ? data.balance_infos
          .map((item) => ({
            unit: String(item.currency || "USD"),
            remaining: numberValue(item.total_balance),
            available: data.is_available !== false,
          }))
          .filter((item) => item.remaining !== null)
        : [];
      return {
        available: data.is_available !== false && balances.length > 0,
        providerName: row.name,
        providerId: row.id,
        balances,
        updatedAt: Date.now(),
      };
    }
    if (host === "api.stepfun.com" || host === "api.stepfun.ai") {
      const data = await fetchJson(
        "https://api.stepfun.com/v1/accounts",
        tokenValue,
      );
      const remaining = numberValue(data.balance ?? data.data?.balance);
      return {
        available: remaining !== null,
        providerName: row.name,
        providerId: row.id,
        balances:
          remaining === null
            ? []
            : [{ unit: "CNY", remaining, available: true }],
        updatedAt: Date.now(),
      };
    }
    if (host === "api.siliconflow.cn" || host === "api.siliconflow.com") {
      const data = await fetchJson(`https://${host}/v1/user/info`, tokenValue);
      const remaining = numberValue(
        data.data?.totalBalance ?? data.totalBalance,
      );
      return {
        available: remaining !== null,
        providerName: row.name,
        providerId: row.id,
        balances:
          remaining === null
            ? []
            : [{ unit: "CNY", remaining, available: true }],
        updatedAt: Date.now(),
      };
    }
    if (host === "openrouter.ai") {
      const data = await fetchJson(
        "https://openrouter.ai/api/v1/credits",
        tokenValue,
      );
      const remaining = numberValue(
        (data.data?.total_credits ?? 0) - (data.data?.total_usage ?? 0),
      );
      return {
        available: remaining !== null,
        providerName: row.name,
        providerId: row.id,
        balances:
          remaining === null
            ? []
            : [{ unit: "USD", remaining, available: true }],
        updatedAt: Date.now(),
      };
    }
    if (host === "api.novita.ai") {
      const data = await fetchJson(
        "https://api.novita.ai/v3/user/balance",
        tokenValue,
      );
      const remaining = numberValue(data.availableBalance);
      return {
        available: remaining !== null,
        providerName: row.name,
        providerId: row.id,
        balances:
          remaining === null
            ? []
            : [{ unit: "USD", remaining: remaining / 10000, available: true }],
        updatedAt: Date.now(),
      };
    }
  } catch (error) {
    return unavailableProviderUsage(row.name, error.message.slice(0, 160));
  }
  return unavailableProviderUsage(row.name, "provider-not-supported");
}
async function queryRestrictedUsageTemplate(row) {
  const usage = providerMeta(row).usage_script;
  if (
    !usage?.enabled ||
    usage.language !== "javascript" ||
    typeof usage.code !== "string"
  )
    return null;
  const env = providerEnv(row);
  const tokenValue = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
  if (!tokenValue || tokenValue === "PROXY_MANAGED")
    return unavailableProviderUsage(row.name, "provider-token-unavailable");
  let base;
  try {
    base = new URL(env.ANTHROPIC_BASE_URL || "");
  } catch {
    return unavailableProviderUsage(row.name, "provider-url-invalid");
  }
  const template = usage.code.match(/url\s*:\s*["'`]([^"'`]+)["'`]/i)?.[1];
  if (!template) return null;
  let target;
  try {
    const baseHref = base.href.replace(/\/$/, "");
    target = new URL(template.replaceAll("{{baseUrl}}", () => baseHref));
  } catch {
    return unavailableProviderUsage(row.name, "usage-url-invalid");
  }
  if (
    target.origin !== base.origin ||
    !["https:", "http:"].includes(target.protocol)
  )
    return unavailableProviderUsage(row.name, "usage-url-not-same-origin");
  const method =
    usage.code.match(/method\s*:\s*["'`]([A-Z]+)["'`]/i)?.[1] || "GET";
  if (method.toUpperCase() !== "GET")
    return unavailableProviderUsage(row.name, "usage-method-not-supported");
  try {
    const response = await fetch(target, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenValue}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(
        Math.min(15000, Math.max(3000, Number(usage.timeout || 10) * 1000)),
      ),
    });
    if (!response.ok) throw new Error(`余额接口返回 HTTP ${response.status}`);
    const data = await readJsonResponseBounded(response, 1024 * 1024);
    const value =
      data?.data && typeof data.data === "object" ? data.data : data;
    const remaining = numberValue(
      value?.remaining ?? value?.quota?.remaining ?? value?.balance,
    );
    if (remaining === null)
      return unavailableProviderUsage(row.name, "usage-response-not-supported");
    return {
      available: value?.is_active !== false && value?.isValid !== false,
      providerName: row.name,
      providerId: row.id,
      balances: [
        {
          unit: String(value?.unit ?? value?.quota?.unit ?? "USD"),
          remaining,
          available: value?.is_active !== false && value?.isValid !== false,
        },
      ],
      updatedAt: Date.now(),
    };
  } catch (error) {
    return unavailableProviderUsage(row.name, error.message.slice(0, 160));
  }
}
async function getCCSwitchUsage(force = false) {
  if (
    !force &&
    providerUsageCache.value &&
    providerUsageCache.expiresAt > Date.now()
  )
    return providerUsageCache.value;
  // 自定义 API 模式：直接用应用内配置的 Base URL / 密钥查余额（仍受域名白名单约束）
  const customEnv = customApiEnv();
  if (customEnv) {
    const row = {
      id: "custom",
      name: "自定义 API",
      settings_config: JSON.stringify({ env: customEnv }),
      meta: "{}",
    };
    const value =
      (await queryRestrictedUsageTemplate(row)) ||
      (await queryNativeProviderUsage(row));
    providerUsageCache = { value, expiresAt: Date.now() + 30000 };
    return value;
  }
  const Ctor = await loadDatabaseSync();
  if (!Ctor) {
    const value = unavailableProviderUsage("当前服务商", "sqlite-unavailable");
    providerUsageCache = { value, expiresAt: Date.now() + 30000 };
    return value;
  }
  let db;
  try {
    db = new Ctor(CCSWITCH_DB, { readOnly: true });
    const row = db
      .prepare(
        "select id,name,settings_config,meta from providers where app_type = ? and is_current = 1 limit 1",
      )
      .get("claude");
    const value = row
      ? (await queryRestrictedUsageTemplate(row)) ||
      (await queryNativeProviderUsage(row))
      : unavailableProviderUsage("当前服务商", "provider-not-configured");
    providerUsageCache = { value, expiresAt: Date.now() + 30000 };
    return value;
  } catch (error) {
    const value = unavailableProviderUsage(
      "当前服务商",
      error.message.slice(0, 160),
    );
    providerUsageCache = { value, expiresAt: Date.now() + 10000 };
    return value;
  } finally {
    try {
      db?.close();
    } catch { }
  }
}
async function readJsonFile(filename) {
  try {
    const raw = await readStableBoundedFile(filename, CONFIG_JSON_MAX_BYTES);
    return JSON.parse(decodeJsonBuffer(raw));
  } catch (error) {
    if (error?.code !== "ENOENT")
      console.warn(
        `[ccdph] 跳过无法安全读取的配置文件 ${path.basename(filename)}:`,
        error?.message || error,
      );
    return {};
  }
}
// CCDPH-FIX(R3-P3-3/R3-P3-4): 项目目录里的文件（技能的 SKILL.md、项目的 .mcp.json）必须
// **不跟随符号链接**。原来只对符号链接**目录**做了排除（listSkills 里的 entry.isSymbolicLink()），
// 文件侧没有 —— 于是可以在项目里放一个指向项目外文件的符号链接，把该文件的首个
// `description:`/`# ` 行（≤120 字符）当作技能描述、或把外部 MCP 的 command/args/env 键名
// 通过 API 回传出来（两种都实测复现过）。其它读路径（/api/file、/api/files、/api/diff）
// 走的是 safePath 的 realpath + 包含校验，这里是最小口径对齐。
async function statRegularFileNoSymlink(file) {
  let info;
  try {
    info = await fs.lstat(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (info.isSymbolicLink()) {
    console.warn("[ccdph] 已拒绝读取指向外部位置的符号链接:", file);
    return null;
  }
  return info.isFile() ? info : null;
}
async function readProjectJsonFileNoSymlink(file) {
  if (!(await statRegularFileNoSymlink(file))) return {};
  return readJsonFile(file);
}
const CONFIG_JSON_MAX_BYTES = 16 * 1024 * 1024;
const INTEGRATION_DIRECTORY_MAX = 1000;
const SKILL_CANDIDATE_MAX = 200;
const SKILL_FILE_MAX_BYTES = 256 * 1024;
async function countDirectories(folder) {
  let directory;
  try {
    directory = await fs.opendir(folder);
    let count = 0;
    for await (const entry of directory) {
      if (entry.isDirectory()) count += 1;
      if (count >= INTEGRATION_DIRECTORY_MAX) break;
    }
    return count;
  } catch {
    return 0;
  } finally {
    await directory?.close().catch(() => { });
  }
}
async function getIntegrationInfo(root) {
  const [
    claudeGlobal,
    mcpGlobal,
    settings,
    projectMcp,
    globalSkills,
    projectSkills,
    plugins,
  ] = await Promise.all([
    readJsonFile(path.join(os.homedir(), ".claude.json")),
    readJsonFile(path.join(os.homedir(), ".mcp.json")),
    readJsonFile(path.join(CLAUDE_CONFIG_DIR, "settings.json")),
    root ? readProjectJsonFileNoSymlink(path.join(root, ".mcp.json")) : {},
    countDirectories(path.join(CLAUDE_CONFIG_DIR, "skills")),
    root ? countDirectories(path.join(root, ".claude", "skills")) : 0,
    countDirectories(path.join(CLAUDE_CONFIG_DIR, "plugins")),
  ]);
  const mcpNames = new Set([
    ...Object.keys(claudeGlobal.mcpServers || {}),
    ...Object.keys(mcpGlobal.mcpServers || {}),
    ...Object.keys(projectMcp.mcpServers || {}),
  ]);
  const hooks =
    settings.hooks && typeof settings.hooks === "object" ? settings.hooks : {};
  const hookCount = Object.values(hooks).reduce(
    (total, value) => total + (Array.isArray(value) ? value.length : 0),
    0,
  );
  return {
    mcpCount: mcpNames.size,
    skillCount: globalSkills + projectSkills,
    hookCount,
    pluginCount: plugins,
    configDir: CLAUDE_CONFIG_DIR,
  };
}
async function listSkills(root, query = "") {
  const folders = [path.join(CLAUDE_CONFIG_DIR, "skills")];
  if (root) folders.push(path.join(root, ".claude", "skills"));
  const normalized = query.trim().toLocaleLowerCase();
  // 先收集所有候选技能目录，再并行读取 SKILL.md，避免串行 I/O。
  const candidates = [];
  for (const folder of folders) {
    let directory;
    try {
      directory = await fs.opendir(folder);
      for await (const entry of directory) {
        if (candidates.length >= SKILL_CANDIDATE_MAX) break;
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const name = entry.name;
        if (normalized && !name.toLocaleLowerCase().includes(normalized))
          continue;
        candidates.push({
          name,
          folder,
          source: folder === folders[0] ? "全局" : "项目",
        });
      }
    } catch {
      continue;
    } finally {
      await directory?.close().catch(() => { });
    }
    if (candidates.length >= SKILL_CANDIDATE_MAX) break;
  }
  const skills = new Map();
  await Promise.all(candidates.map(async ({ name, folder, source }) => {
    let description = "Claude Code Skill";
    try {
      const skillFile = path.join(folder, name, "SKILL.md");
      // CCDPH-FIX(R3-P3-3): 与目录侧的 entry.isSymbolicLink() 同口径 —— 文件侧的符号链接
      // 同样拒绝（否则项目里一个指向外部的 SKILL.md 就能把该文件的内容当描述回传）。
      if (!(await statRegularFileNoSymlink(skillFile))) throw new Error("跳过符号链接/非普通文件");
      const text = (
        await readStableBoundedFile(skillFile, SKILL_FILE_MAX_BYTES)
      ).toString("utf8");
      const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
      const frontmatter = text.match(/^description:\s*(.+)$/m)?.[1]?.trim();
      description = (frontmatter || heading || description).slice(0, 120);
    } catch { }
    skills.set(name.toLocaleLowerCase(), { name, command: `/${name}`, description, source });
  }));
  return [...skills.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 30);
}
let claudePath, claudeVersion, claudeError;
let folderPicker;
let pathOpener;
// 外部协议 opener（shell.openExternal）：用于 edge:// 这类浏览器内部 URL。
// 与 pathOpener（文件系统路径）语义不同，不能混用。见 /api/browser/launch。
let externalOpener;
let notifier;
export function setFolderPicker(picker) {
  folderPicker = picker;
}
let filePicker;
export function setFilePicker(picker) {
  filePicker = picker;
}
export function setPathOpener(opener) {
  pathOpener = opener;
}
export function setExternalOpener(opener) {
  externalOpener = opener;
}
export function setNotifier(callback) {
  notifier = callback;
}
export function safeNotify(payload) {
  if (typeof notifier !== "function") return;
  const reportFailure = (error) =>
    console.warn("[ccdph] 原生通知失败，已忽略:", error?.message || error);
  try {
    const result = notifier(payload);
    if (result && typeof result.then === "function")
      Promise.resolve(result).catch(reportFailure);
  } catch (error) {
    reportFailure(error);
  }
}
export function getRuntime() {
  return { url: `${origin}/#${token}`, activeRuns: runs.size };
}
export function getSettings() {
  return { ...db.settings };
}
// CCDPH-FIX(HIGH-4): 终端必须**整棵进程树**一起结束。Windows 上 ChildProcess.kill()
// 只终止 shell 自己（cmd.exe / powershell.exe），用户在终端里启动的孙进程
// （npm run dev / python app.py / docker compose up …）会被重新挂到系统上继续跑，
// 端口与继承来的 stdio 管道都不会释放 —— 实测：终端里跑
// `start "" /b cmd /c "ping -n 900 127.0.0.1 > nul"` 后调 POST /api/terminal/stop，
// ping.exe 依然存活。这里统一走 taskkill /T /F（argv 数组，绝不经 shell 字符串）。
// 约定：
//   - 非 Windows 或拿不到 pid → 退回 child.kill()；
//   - taskkill 失败（含「进程早已退出」，此时它回非 0 退出码）→ 同样退回 child.kill()；
//   - 全部包在 try/catch 里，永不抛出、永不 reject（本文件跑在 Electron 主进程里，
//     未处理的 rejection / 异常会直接带走整个应用）；
//   - **不 await**：调用点在请求路径与退出路径上，taskkill 通常 <100ms，且即便本进程
//     随后退出，已由 CreateProcess 启动的 taskkill.exe 仍会独立跑完。
const KILL_TREE_TIMEOUT = 5000;
// CCDPH-FIX(A10-21): killProcessTree 现在返回 Promise，在树杀灭真正完成（或到达
// 有界超时）后才 resolve。原实现是 fire-and-forget：stopRuns() 在 taskkill 尚未落地
// 时就继续向下走，shutdown() 末尾的 process.exit(0) 随即把本进程带走，终端孙进程
// 成为孤儿 —— 实测即使信号真实投递、shutdown() 确实执行、exit 0 正常退出，孙进程
// （如 PING.EXE）依然残留。Promise 只 resolve、永不 reject，未 await 的旧调用点
// （LRU 淘汰 / 请求路径的 terminal stop）行为不变、也不会产生 unhandled rejection。
function killProcessTree(child) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    if (!child || typeof child.kill !== "function") return settle();
    let fellBack = false;
    const fallback = () => {
      if (fellBack) return settle();
      fellBack = true;
      try {
        child.kill();
      } catch { }
      settle();
    };
    const pid = Number(child.pid);
    if (process.platform !== "win32" || !Number.isInteger(pid) || pid <= 0)
      return fallback();
    try {
      const killer = execFile(
        WINDOWS_TASKKILL_EXE,
        ["/PID", String(pid), "/T", "/F"],
        { windowsHide: true, timeout: KILL_TREE_TIMEOUT },
        (error) => {
          // taskkill 找不到进程（已退出）也会走这里，退回 child.kill() 是无害的空操作
          if (error) fallback();
          else settle();
        },
      );
      killer.on("error", fallback); // spawn 本身失败（taskkill 不存在 / EPERM）
      killer.unref?.();
    } catch {
      fallback();
    }
    // 有界兜底：无论 taskkill 因何卡住，KILL_TREE_TIMEOUT + 1s 内必然 settle，
    // 保证调用方（stopRuns → shutdown）的退出路径不会被拖死。
    setTimeout(settle, KILL_TREE_TIMEOUT + 1000).unref?.();
  });
}
export async function stopRuns() {
  for (const run of runs.values()) {
    clearRunTimers(run);
    run.abort.abort();
    closeSseClients(run.clients);
  }
  // CCDPH-FIX(P3-16): 原来是逐条 `await killProcessTree()`，串行会把退出拖成
  // N × KILL_TREE_TIMEOUT（上限 8 个终端即数十秒）。改为并行收尾，仍然等待全部完成。
  const killTasks = [];
  for (const terminal of terminals.values()) {
    clearTimeout(terminal.releaseTimer);
    closeSseClients(terminal.clients);
    // CCDPH-FIX(HIGH-4): 原来是 terminal.child.kill()，只杀 shell，孙进程全部变孤儿
    // CCDPH-FIX(A10-21): 必须 await 树杀灭完成 —— 否则 stopRuns() 在 taskkill 落地前
    // 就 resolve，shutdown() 紧接着 process.exit(0)，孙进程照样残留（fire-and-forget
    // 与退出的竞态）。有 KILL_TREE_TIMEOUT+1s 的有界兜底，不会拖死退出路径。
    if (!terminal.exited) killTasks.push(killProcessTree(terminal.child));
  }
  await Promise.all(killTasks);
  terminals.clear();
  await terminalProcessRegistry.schedule();
  await save();
}
// ---- Claude Code 引擎：调用 Agent SDK 跑一轮任务 ----
export const RUN_HARD_DEADLINE_MS = (() => {
  const configured = Number(process.env.WORKBENCH_RUN_HARD_DEADLINE_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.max(1000, configured)
    : 2 * 60 * 60_000;
})();
export function armRunDeadlineTimer(run, onTimeout, ms = RUN_HARD_DEADLINE_MS) {
  clearTimeout(run.deadlineTimer);
  const delay = Number.isFinite(Number(ms)) && Number(ms) > 0
    ? Math.max(1, Number(ms))
    : RUN_HARD_DEADLINE_MS;
  run.deadlineTimer = setTimeout(onTimeout, delay);
  run.deadlineTimer.unref?.();
  return run.deadlineTimer;
}
function clearRunTimers(run) {
  clearTimeout(run?.settleWatchdog);
  clearTimeout(run?.deadlineTimer);
}
export function closeRunQuery(run) {
  if (!run) return undefined;
  run.queryCleanupRequested = true;
  if (!run.query || run.queryCleanupPromise) return run.queryCleanupPromise;
  try {
    run.query.close?.();
  } catch (error) {
    console.warn("[ccdph] 强制关闭 SDK 传输失败:", error?.message || error);
  }
  const cleanup = Promise.resolve()
    .then(() => run.query.return?.())
    .catch((error) =>
      console.warn("[ccdph] SDK 查询迭代器收尾失败:", error?.message || error),
    );
  run.queryCleanupPromise = cleanup;
  return cleanup;
}
// CCDPH-FIX(A10-04): 强制收尾一条卡死的 run —— 与 runTurn finally 里的清理等价，
// 但不依赖 SDK 侧任何回调：pending 审批全部拒绝、会话回 running=false、
// 广播 stopped + done、关闭 SSE、从 runs 摘除。s 查不到（会话已删）时也保证 run 被摘除。
function forceSettleRun(sessionId, run, message) {
  if (runs.get(sessionId) !== run) return; // 已自然收尾或已被移除
  clearRunTimers(run);
  void closeRunQuery(run);
  for (const pending of [...run.pending.values()])
    pending.finish({ behavior: "deny", message: message || "任务已结束" });
  const s = db.sessions.find((x) => x.id === sessionId);
  if (s) {
    s.running = false;
    publish(s, { type: "stopped", text: message || "任务已停止" });
    publish(s, { type: "done" });
  }
  for (const client of run.clients) client.end();
  runs.delete(sessionId);
}
async function runTurn(s, prompt, model, permissionMode, images = []) {
  const run = runs.get(s.id);
  let usagePublished = false;
  try {
    const canUseTool = async (tool, input, context) => {
      const id = randomUUID();
      return new Promise((resolve) => {
        const finish = (result) => {
          context.signal.removeEventListener("abort", cancel);
          run.pending.delete(id);
          resolve(result);
        };
        const cancel = () =>
          finish({ behavior: "deny", message: "用户已停止任务" });
        if (context.signal.aborted) return cancel();
        run.pending.set(id, { finish, input, tool });
        context.signal.addEventListener("abort", cancel, { once: true });
        publish(s, { type: "approval", requestId: id, tool, input });
        safeNotify({
          title: `需要确认：${tool}`,
          failed: true,
          sessionId: s.id,
          requestId: id,
          tool,
          input,
        });
      });
    };
    const customEnv = customApiEnv();
    // 供应商模式下配置不完整时宁可明确报错，也不能静默回落到 CC Switch 的
    // 环境——那会把请求发到用户没打算用的服务商上。
    if (db.settings.apiMode === "profile" && !customEnv)
      throw new Error(
        "当前供应商配置不完整（缺地址或密钥）：请在 设置 → API 接入 里补全，或切回跟随 CC Switch",
      );
    // 个性化角色背景：作为附加设定注入 system prompt，不改写 Claude Code 自身
    const personaPrompt = buildPersonaPrompt();
    // 浏览器能力：按设置运行时注入 Playwright MCP（不写用户全局配置，见设计文档 §8）
    const browserMcp =
      browserMcpEnabled(db.settings.browser)
        ? { mcpServers: { browser: buildPlaywrightMcpConfig(db.settings.browser) } }
        : {};
    // auto 模式不会调用宿主审批回调。浏览器开启时，禁止两个可执行任意
    // 页面 JavaScript / Playwright 代码的 MCP 工具，防止页面提示注入在无审批下放大。
    // 其他模式保留这些工具，但会走 canUseTool 宿主审批。
    const browserToolRestrictions = browserRestrictions(
      permissionMode,
      browserMcpEnabled(db.settings.browser),
    );
    const options = {
      cwd: sessionRoot(s),
      pathToClaudeCodeExecutable: await resolveNativeClaudeExecutable(claudePath),
      abortController: run.abort,
      includePartialMessages: true,
      settingSources: ["user", "project", "local"],
      ...browserMcp,
      ...browserToolRestrictions,
      systemPrompt: personaPrompt
        ? {
          type: "preset",
          preset: "claude_code",
          append: personaPrompt,
        }
        : { type: "preset", preset: "claude_code" },
      ...(model ? { model } : {}),
      ...(s.effort && s.effort !== "inherit" ? { effort: s.effort } : {}),
      ...(db.settings.maxTurns > 0 ? { maxTurns: db.settings.maxTurns } : {}),
      ...(s.claudeSessionId ? { resume: s.claudeSessionId } : {}),
      ...(customEnv ? { env: { ...process.env, ...customEnv } } : {}),
      ...permissionOptions(permissionMode, canUseTool),
      stderr: (text) => {
        run.stderr = ((run.stderr || "") + text).slice(-6000);
      },
    };
    const blocks = [
      { type: "text", text: prompt },
      ...images.map((image) => ({
        type: "image",
        source: {
          type: "base64",
          media_type: image.type,
          data: image.data,
        },
      })),
    ];
    const queryPrompt = (async function* () {
      yield {
        type: "user",
        message: { role: "user", content: blocks },
        parent_tool_use_id: null,
      };
    })();
    run.query = query({ prompt: queryPrompt, options });
    if (run.queryCleanupRequested) void closeRunQuery(run);
    for await (const message of run.query) {
      if (message.session_id) s.claudeSessionId = message.session_id;
      if (message.type === "stream_event") {
        const delta = message.event?.delta;
        if (
          message.event?.type === "content_block_delta" &&
          delta?.type === "text_delta"
        )
          broadcast(s, { type: "text_delta", text: delta.text || "" });
        if (
          message.event?.type === "content_block_delta" &&
          delta?.type === "thinking_delta"
        )
          broadcast(s, { type: "thinking_delta", text: delta.thinking || "" });
      }
      if (message.type === "system" && message.subtype === "init")
        publish(s, {
          type: "init",
          model: message.model,
          version: message.claude_code_version,
        });
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text" && block.text)
            publish(s, { type: "text", text: block.text });
          if (block.type === "tool_use")
            publish(s, {
              type: "tool",
              tool: block.name,
              input: block.input,
              toolId: block.id,
            });
          if (block.type === "thinking" && block.thinking)
            publish(s, { type: "thinking", text: block.thinking });
        }
      }
      if (message.type === "user" && Array.isArray(message.message.content)) {
        for (const block of message.message.content)
          if (block.type === "tool_result")
            publish(s, {
              type: "tool_result",
              toolId: block.tool_use_id,
              text: preview(block.content)?.slice(0, 40000) || "",
              error: !!block.is_error,
            });
      }
      if (message.type === "rate_limit_event")
        publish(s, {
          type: "usage",
          usage: {
            rate_limits_available: true,
            rate_limits: {
              five_hour: {
                utilization: message.rate_limit_info?.utilization ?? null,
                resets_at: message.rate_limit_info?.resetsAt
                  ? new Date(message.rate_limit_info.resetsAt).toISOString()
                  : null,
              },
            },
          },
        });
      if (message.type === "result") {
        recordDailyUsage(message);
        if (message.is_error)
          publish(s, {
            type: "error",
            // CCDPH-FIX(P3-22): message.errors 非数组（上游给字符串/对象）时 `.join` 会抛
            // TypeError，异常文案又经 sanitizeError 回显 → 该轮错误内容失真。
            text: (Array.isArray(message.errors)
              ? message.errors
              : [message.result || message.subtype]
            ).join(
              "\n",
            ),
          });
        publish(s, {
          type: "result",
          cost: message.total_cost_usd,
          duration: message.duration_ms,
          turns: message.num_turns,
          failed: !!message.is_error,
          task: currentTaskLabel(s),
        });
      }
    }
  } catch (error) {
    // CCDPH-FIX(A10-04): 若 /api/stop 看门狗已强制收尾（runs 里已摘除），不再补发事件
    if (runs.get(s.id) === run)
      publish(s, {
        type: run.abort.signal.aborted ? "stopped" : "error",
        // CCDPH-FIX(R2-P2-6): 这条文本会进 SSE、被 s.events.push 持久化到 state.json
        // 并显示在界面，而 CLI/供应商的 stderr 可能内嵌 ANTHROPIC_AUTH_TOKEN 或绝对路径。
        // 走 sanitizeError 同一口径（脱敏令牌 + 路径），与 HTTP 错误响应保持一致。
        text: run.abort.signal.aborted
          ? "任务已停止"
          : sanitizeError(
              new Error(
                `${error.message}${run.stderr ? "\n" + run.stderr : ""}`,
              ),
            ),
      });
  } finally {
    try {
      if (
        run.query?.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET
      ) {
        // CCDPH-FIX(A10-04): usage 调用必须有界。原实现直接 await 且无超时，而
        // s.running=false / done / clients.end() / runs.delete() 全部排在它之后 ——
        // provider 停滞（如 TCP 黑洞：连接建立后永不应答）时该 await 永不 settle，
        // 实测会话 ≥75s 卡在 running=true、SSE 不 end、/api/stop 无效。
        // 现用 Promise.race 加 5s 超时：超时/出错都走下方 !usagePublished 分支，
        // 保证四步清理在任何情况下必达。正常路径（provider 可用）语义不变。
        const usagePromise =
          run.query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
            skipBehaviors: true,
          });
        // 吸收「超时先赢、真值迟到后 reject」的情况，避免 unhandled rejection
        if (usagePromise?.catch) usagePromise.catch(() => { });
        const usage = await Promise.race([
          usagePromise,
          new Promise((resolve) =>
            setTimeout(() => resolve(null), 5000).unref?.(),
          ),
        ]).catch(() => null);
        if (usage) {
          publish(s, { type: "usage", usage });
          usagePublished = true;
        }
      }
    } catch { }
    if (!usagePublished)
      publish(s, {
        type: "usage",
        usage: { available: false, reason: "provider-unavailable" },
      });
    // CCDPH-FIX(A10-04): 看门狗定时器在此清除（自然收尾成功，无需强制）。
    clearRunTimers(run);
    // CCDPH-FIX(A10-04): 若 /api/stop 看门狗已强制收尾（runs 里已摘除），这里不得
    // 重复广播 / 清理，只继续走下面的落盘。
    if (runs.get(s.id) === run) {
      for (const pending of [...run.pending.values()])
        pending.finish({ behavior: "deny", message: "任务已结束" });
      s.running = false;
      publish(s, { type: "done" });
      if (db.settings.notifications)
        safeNotify({
          title: currentTaskLabel(s),
          failed: s.events.slice(-5).some((event) => event.type === "error"),
          sessionId: s.id,
        });
      for (const client of run.clients) client.end();
      runs.delete(s.id);
    }
    // CCDPH-FIX(F-01): 同上 —— runTurn 的 promise 同样是 void 出去的，
    // finally 里的写盘失败必须就地吃掉，否则整个 server 进程被未处理 rejection 带走。
    try {
      await save();
    } catch (error) {
      console.error("[ccdph] 轮次结束后写盘失败:", error?.message || error);
    }
  }
}
// CCDPH-FIX(MED-4): 按「字符总量」截断转录。原来只按条数 slice(-400)，
// 而单条 tool 消息的上限可能达到 40000 字符 → 最坏留下 ~16MB，
// 并整体写进 state.json。
// CCDPH-FIX(A10-01): 与 eventSize 统一改为 UTF-8 字节计量（原来按 UTF-16 字符）。
const MESSAGES_MAX_BYTES = 2 * 1024 * 1024;
const messageSize = (message) => {
  try {
    const text = JSON.stringify(message ?? null);
    return text ? Buffer.byteLength(text, "utf8") : 0;
  } catch {
    return MESSAGES_MAX_BYTES; // 无法序列化的按「已超限」处理
  }
};
// CCDPH-FIX(A10-17): 单条消息自身嵌套过深时**只丢弃那一条**（相对深度计数），绝不因此把整库判损坏。
function dropOverDeepMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) return messages;
  const kept = messages.filter(
    (m) => maxNestingDepth(m) <= STATE_CONTENT_MAX_DEPTH,
  );
  return kept.length === messages.length ? messages : kept;
}
function trimMessagesByVolume(messages) {
  messages = dropOverDeepMessages(messages);
  if (!Array.isArray(messages) || !messages.length) return [];
  // 单条就超过整个转录预算时不能“为了至少留一条”而突破上限。
  // messages 是 SDK 内部续聊转录，用户可见历史仍保留在 events。
  if (messageSize(messages.at(-1)) > MESSAGES_MAX_BYTES) return [];
  let total = 0;
  let start = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    total += messageSize(messages[i]);
    if (total > MESSAGES_MAX_BYTES) break;
    start = i;
  }
  // 正常尺寸的转录至少保留最后一条。
  if (start >= messages.length) start = messages.length - 1;
  // 不能从 role:"tool" 起头 —— 那些消息的 tool_calls 配对在更早的 assistant 消息里
  while (start < messages.length && messages[start]?.role === "tool") start++;
  if (start >= messages.length) start = messages.length - 1;
  return messages.slice(start);
}
function enforceGlobalHistoryBudget(preferredSession = null) {
  if (globalHistoryBytesDirty) {
    globalHistoryBytes = 0;
    for (const item of db.sessions) {
      globalHistoryBytes += eventBytesBySession.get(item) || 0;
      globalHistoryBytes += messageBytesBySession.get(item) || 0;
    }
    globalHistoryBytesDirty = false;
  }
  let total = globalHistoryBytes;
  if (total <= GLOBAL_HISTORY_MAX_BYTES) return false;
  let excess = total - GLOBAL_HISTORY_MAX_BYTES;
  let changed = false;
  const now = Date.now();
  if (
    globalHistoryOrderCache.expiresAt <= now ||
    globalHistoryOrderCache.sessions.length !== db.sessions.length ||
    globalHistoryOrderCache.revision !== globalHistoryOrderRevision ||
    globalHistoryOrderCache.preferredSession !== preferredSession
  ) {
    globalHistoryOrderCache = {
      expiresAt: now + 1000,
      revision: globalHistoryOrderRevision,
      preferredSession,
      sessions: [...db.sessions].sort((a, b) => {
        if (Boolean(a.archived) !== Boolean(b.archived))
          return a.archived ? -1 : 1;
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? 1 : -1;
        return (a.updatedAt || a.createdAt || 0) - (b.updatedAt || b.createdAt || 0);
      }),
    };
  }
  const candidates = preferredSession
    ? [
        ...globalHistoryOrderCache.sessions.filter(
          (item) => item !== preferredSession,
        ),
        preferredSession,
      ]
    : globalHistoryOrderCache.sessions;
  const trimOldest = (sessionItem, key, sizeOf, cache) => {
    const list = Array.isArray(sessionItem[key]) ? sessionItem[key] : [];
    if (list.length <= 1 || excess <= 0) return;
    // CCDPH-FIX(A10-01): 记账单位为 UTF-8 字节（excess 亦为字节）。
    let removedBytes = 0;
    let count = 0;
    while (count < list.length - 1 && removedBytes < excess) {
      removedBytes += sizeOf(list[count]);
      count++;
    }
    if (!count) return;
    list.splice(0, count);
    const nextBytes = Math.max(0, (cache.get(sessionItem) || 0) - removedBytes);
    if (cache === eventBytesBySession)
      setEventBytesForSession(sessionItem, nextBytes);
    else setMessageBytesForSession(sessionItem, nextBytes);
    excess -= removedBytes;
    sessionItem.historyTruncated = true;
    changed = true;
  };
  for (const item of candidates) {
    // 先裁削仅供 SDK 续聊的内部转录，再裁削用户可见事件。
    trimOldest(item, "messages", messageSize, messageBytesBySession);
    trimOldest(item, "events", eventSize, eventBytesBySession);
    if (excess <= 0) break;
  }
  // 第一轮为了上下文完整性会给每个会话留一条 messages；会话很多时
  // 这些“最后一条”之和仍可能超过全局上限。转录可重建、events 才是用户可见历史，
  // 因此第二轮从最旧会话开始清空剩余转录，确保上限真正可达。
  if (excess > 0) {
    for (const item of candidates) {
      const bytes = messageBytesBySession.get(item) || 0;
      if (!bytes) continue;
      item.messages = [];
      setMessageBytesForSession(item, 0);
      item.historyTruncated = true;
      excess -= bytes;
      changed = true;
      if (excess <= 0) break;
    }
  }
  return changed;
}
// CCDPH-FIX(P1-SESSION-SIZE): /api/session 的响应字节预算。前端 api() 对
// raw.length > 5MB 的响应直接抛「服务返回了无法解析的数据」，所以服务端必须保证
// 单个会话响应远低于这个门槛。预算按 **UTF-8 字节** 计（字节数 ≥ UTF-16 码元数，
// 因此 4MB 字节的载荷必然也满足前端 5MB 的字符数判定）；events 与 messages 共用
// 同一份额度，避免「各 4MB × 2」在中文场景下叠出超过 5MB 的字符量。
const SESSION_EVENTS_BYTES_MAX = 4 * 1024 * 1024;
// CCDPH-FIX(HIGH-3): /api/export 的 events 字节预算（见该路由）。取 2 MiB 而不是沿用
// /api/session 的 4 MiB：导出正文进 json() 时每个换行/引号都会被转义（最坏情况下字符数
// 是字节数的 2 倍，例如整段都是换行的日志），而前端 api() 是按**字符数** > 5MiB 拒收的。
// 2 MiB 字节预算给这条转义放大留了 2 倍以上余量，任何情况下都不会再触发客户端拒收。
const EXPORT_EVENTS_BYTES_MAX = 2 * 1024 * 1024;
const recordBytes = (record) => {
  try {
    return Buffer.byteLength(JSON.stringify(record ?? null), "utf8");
  } catch {
    return SESSION_EVENTS_BYTES_MAX; // 无法序列化的按「已超限」处理
  }
};
// 从尾部（最新）往前收，只保留**整条**记录，并如实报告丢弃了几条。
// 单条记录本身就超预算时仍然返回它 —— 绝不返回空数组（会话会看起来像空的）。
const tailWithinBudget = (list, maxBytes) => {
  if (!Array.isArray(list) || !list.length) return { items: [], bytes: 0, omitted: 0 };
  const last = list.length - 1;
  let start = last;
  let bytes = recordBytes(list[last]);
  for (let i = last - 1; i >= 0; i--) {
    const size = recordBytes(list[i]);
    if (bytes + size > maxBytes) break;
    bytes += size;
    start = i;
  }
  return { items: list.slice(start), bytes, omitted: start };
};
// CCDPH-FIX(P2-BODY-BUDGET): 请求体**全局在途字节预算**。body() 原来只限制单个请求
// （16MB），总量没有上限：20 并发 × 32MB 就能把 RSS 从 72MB 顶到 528MB，且压力结束后
// V8 不把内存还给操作系统。这里像 MESSAGES_MAX_BYTES 那样给一个进程级预算，超额直接
// 用中文报错拒绝，而不是让 N 个 16MB 请求体无上限并发。
const MAX_INFLIGHT_BODY_BYTES = 64 * 1024 * 1024;
const DEFAULT_BODY_BYTES = 16 * 1024 * 1024;
const SEND_BODY_BYTES = 18 * 1024 * 1024;
const HEADER_READ_TIMEOUT_MS = 10_000;
const BODY_READ_TIMEOUT_MS = 30_000;
let inflightBodyBytes = 0;
async function body(req, maxBytes = DEFAULT_BODY_BYTES) {
  // CCDPH-FIX(P2-BODY-BUDGET): 单请求 16MB 上限之外，再加一层**进程级在途字节预算**。
  // 原来 20 并发 × 32MB 请求体把 RSS 从 72MB 顶到 528MB，压力过后 V8 也不把内存还给
  // 操作系统（RSS 永久停在峰值）。这里按「到达的字节」实时记账，超预算立即拒绝。
  // 记账放在 try/finally 里，早退 / 抛错 / 客户端中断都不会漏减。
  // B-07 修复：存在 Content-Type 且媒体类型不是 application/json（含 +json 后缀，
  // 如 application/merge-patch+json）时直接拒绝；**缺失 Content-Type 时保持放行**，
  // 避免误伤既有调用方（前端无请求体时就不发 Content-Type）。
  const contentType = req.headers["content-type"];
  if (contentType) {
    const mediaType = String(contentType).split(";")[0].trim().toLowerCase();
    if (mediaType && mediaType !== "application/json" && !mediaType.endsWith("+json"))
      throw new Error("Content-Type 必须是 application/json");
  }
  // 必须按字符流解码：Buffer 直接 += 时，中文等多字节字符恰好被网络分块
  // 切在字节中间会产生 U+FFFD 乱码；setEncoding 让 Node 自动拼接跨块序列。
  req.setEncoding("utf8");
  let data = "";
  let oversized = false;
  let bytes = 0;
  let reserved = 0; // 本请求已计入全局预算的字节数
  let overBudget = false;
  // server.requestTimeout 在当前 Node 版本下不会可靠地中止已经进入
  // for-await 请求体读取的慢连接。这里使用从 body() 开始计算的绝对截止时间，
  // 防止客户端每隔一段时间只发送少量数据、永久占住请求与内存预算。
  let bodyTimedOut = false;
  const bodyDeadline = setTimeout(() => {
    bodyTimedOut = true;
    req.destroy();
  }, BODY_READ_TIMEOUT_MS);
  bodyDeadline.unref?.();
  const releaseBudget = () => {
    if (!reserved) return;
    inflightBodyBytes = Math.max(0, inflightBodyBytes - reserved);
    reserved = 0;
  };
  try {
    for await (const chunk of req) {
      if (oversized) continue; // 继续排空请求流，否则中途断读会 RST 连接，
      data += chunk; // 复用 keep-alive 的下一个请求就会间歇性 ECONNRESET
      // B-05 修复：原来的上限按 UTF-16 码元（data.length）计，中文等多字节字符会被
      // 放大 ≈3×（实测 16.02MB 字节的中文仍通过）。改为按 UTF-8 字节累计。
      const size = Buffer.byteLength(chunk, "utf8");
      bytes += size;
      reserved += size;
      inflightBodyBytes += size;
      // CCDPH-FIX(P2-BODY-BUDGET): 单请求上限或全局在途预算任一被突破就停止累积
      //（并立即把内存还给 V8：data 清空 + 预算释放），剩下只把流排空。
      if (bytes > maxBytes || inflightBodyBytes > MAX_INFLIGHT_BODY_BYTES) {
        oversized = true;
        overBudget = inflightBodyBytes > MAX_INFLIGHT_BODY_BYTES;
        data = "";
        releaseBudget();
      }
    }
    if (oversized)
      throw new Error(
        overBudget
          ? "服务器当前正在处理过多请求，请稍后重试"
          : "请求过大",
      );
    if (!data) return {};
    const text = data.charCodeAt(0) === 0xfeff ? data.slice(1) : data;
    assertJsonTextDepth(text);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      // CCDPH-FIX(LOW-1): 原来把 JSON.parse 的原始报错原样回给客户端
      //（如 "Expected property name or '}' in JSON at position 1 (line 1 column 2)"），
      // 既泄漏解析器内部信息，对用户也没有意义。
      if (error instanceof SyntaxError) throw new Error("请求体不是合法 JSON");
      console.error("[ccdph] 请求体 JSON 解析异常:", error?.stack || error);
      throw new Error("请求体解析失败，请稍后重试");
    }
    return assertJsonDepth(parsed);
  } catch (error) {
    if (bodyTimedOut) throw new Error("请求体接收超时");
    throw error;
  } finally {
    clearTimeout(bodyDeadline);
    // 无论正常返回、抛错（含 JSON 解析失败）还是客户端中断（for await 抛出），
    // 都必须归还预算，否则一次异常就会让计数器永久偏高、后续请求全被拒绝。
    releaseBudget();
  }
}
// B-06 修复：请求体类型校验，避免 null 等非法正文触发内部 TypeError 文案外泄。
const requireObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("请求体必须是 JSON 对象");
  return value;
};
// CCDPH-FIX(MED-1): 绝不把 Node fs 错误的原始 message 回给客户端 —— ENOENT /
// EPERM / EACCES 的 message 里都带**已解析的绝对路径**
//（实测 `realpath 'D:\nonexistent-xyz.txt'`、`'D:\.data\api-auth.json'`、
// `'\\localhost\c$\Windows\win.ini'`），等于向调用方泄漏服务器目录结构。
// 带 syscall/path 的 errno 一律换成业务化文案，详情只写服务端日志。
export const sanitizeError = (error) => {
  const raw = String(error?.message || error || "操作失败");
  const code = String(error?.code || "").toUpperCase();
  if (["EPERM", "EACCES"].includes(code)) {
    console.error("[ccdph] 文件权限错误:", raw);
    return "文件写入权限不足，请检查目录权限或安全软件拦截";
  }
  if (code === "ENOSPC") {
    console.error("[ccdph] 磁盘空间不足:", raw);
    return "磁盘空间不足，无法保存数据";
  }
  if (
    !error?.code &&
    ["RangeError", "TypeError", "ReferenceError", "SyntaxError"].includes(
      error?.name,
    )
  ) {
    console.error("[ccdph] 内部异常:", error?.stack || raw);
    return "操作失败，详情见服务端日志";
  }
  let clean = raw.replace(/'[^']*'|"[^"]*"/g, (quoted) => {
    const inner = quoted.slice(1, -1);
    return /^[a-zA-Z]:[\\/]|^\\\\|^\//.test(inner) ? "'…'" : quoted;
  });
  // child_process/git 错误通常只有 code/message，没有 syscall/path/dest，不能提前返回。
  clean = clean
    // 未加引号的 Windows/UNC 路径可以包含空格，无法可靠区分路径末尾与后续命令参数。
    // 错误响应宁可从绝对路径起把本行剩余内容整体收掉，也不能留下 `Program Files` 等片段。
    .replace(/\b[a-zA-Z]:[\\/][^'"`\r\n]*/g, "…")
    .replace(/\\\\[^'"`\r\n]*/g, "…")
    // 未加引号的 POSIX 绝对路径；要求位于行首或空白/左括号之后，避免误伤 https:// URL。
    .replace(/(^|[\s(])\/(?!\/)[^'"`\r\n]*/g, "$1…")
    .replace(/(https?:\/\/)([^@\s/]+)@/gi, "$1***@")
    .replace(
      /([?&](?:access[_-]?token|auth[_-]?token|api[_-]?key|password|secret)=)[^&\s]+/gi,
      "$1***",
    );
  // CCDPH-FIX(R2-P3-6): 上面的规则只认「引号/绝对路径/URL 凭据/query 凭据」，
  // 裸 `sk-xxx` 或 `Bearer xxx` 会原样通过；而 redactHookCommand 会处理它们。
  // 统一补上，避免错误文本把令牌回给客户端。
  clean = redactBareTokens(clean);
  if (clean !== raw || error?.code)
    console.error("[ccdph] 操作失败:", clean);
  return clean;
};
const json = (res, value, code = 200) => {
  // B-04 修复：先 stringify 再 writeHead。原来的顺序是「先发头、后序列化」，
  // 深嵌套结构会让 JSON.stringify 抛 RangeError，此时 headersSent 已为 true，路由
  // 兜底只能 res.end()，客户端收到 HTTP 200 + 0 字节且零日志（界面白屏、极难定位）。
  let text;
  try {
    text = JSON.stringify(value);
  } catch (error) {
    // QA 残留补齐：序列化失败此前只回 500、不落日志，排查无迹可循。补一行日志
    //（前缀沿用文件既有 `[ccdph]` 风格）。
    console.error("[ccdph] 响应序列化失败:", error?.message || error);
    res.writeHead(500, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    res.end(JSON.stringify({ error: "响应序列化失败" }));
    return;
  }
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(text);
};
async function git(cwd, args) {
  const safeDirectory = path.resolve(cwd);
  return (
    await exec(
      "git",
      [
        "--no-optional-locks",
        "--literal-pathspecs",
        "-c",
        "core.quotepath=false",
        "-c",
        `safe.directory=${safeDirectory}`,
        ...args,
      ],
      {
        cwd,
        env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined },
        windowsHide: true,
        encoding: "utf8",
        maxBuffer: 4_000_000,
        timeout: 15000,
      },
    )
  ).stdout;
}
export function gitChangesFailure(error) {
  if (
    error &&
    (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
      error.killed ||
      error.signal === "SIGTERM")
  )
    return {
      files: [],
      additions: 0,
      deletions: 0,
      tooLarge: true,
      error:
        "仓库变更过多，无法一次列出（已超出读取上限）；请缩小范围、清理未跟踪文件，或使用命令行 git",
    };
  const diagnostic = `${error?.stderr || ""} ${error?.message || ""}`.toLowerCase();
  if (/not a git repository|不是 git 仓库|not a repository/.test(diagnostic))
    return { files: [], additions: 0, deletions: 0, notGit: true };
  console.warn("[ccdph] Git 变更查询失败:", error?.message || error);
  return {
    files: [],
    additions: 0,
    deletions: 0,
    error: "Git 变更查询失败，请检查仓库权限、safe.directory 设置或 Git 安装状态",
  };
}
export function normalizeApprovalAnswers(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("请先回答问题");
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 50)
    throw new Error("回答数量无效（最多 50 项）");
  const answers = {};
  for (const [key, answer] of entries) {
    if (
      !key ||
      key.length > 500 ||
      ["__proto__", "prototype", "constructor"].includes(key)
    )
      throw new Error("问题标识无效");
    if (typeof answer !== "string" || !answer.trim() || answer.length > 4000)
      throw new Error("回答必须是非空字符串且不超过 4000 字");
    answers[key] = answer;
  }
  return answers;
}
const FILE_EXCLUDES = new Set([
  ".git",
  "node_modules",
  ".npm-cache",
  ".data",
  ".desktop-data",
  ".venv",
  "__pycache__",
  "dist",
  "build",
]);
async function createWorktree(p, id) {
  const inside = (
    await git(p.path, ["rev-parse", "--is-inside-work-tree"])
  ).trim();
  if (inside !== "true") throw new Error("独立 Worktree 需要 Git 仓库");
  const base = worktreeBaseDir(p.path);
  await fs.mkdir(base, { recursive: true });
  const target = path.join(base, id);
  await git(p.path, ["worktree", "add", "--detach", target, "HEAD"]);
  return target;
}
// Worktree 会话被删除时，磁盘目录与 git worktree 元数据也要一起回收，
// 否则会无限累积（评审 P1）。有未提交改动的 worktree 一律保留，避免误删用户工作。
export async function removeWorktreeOf(session) {
  if (!session || session.environment !== "worktree" || !session.cwd)
    return { removed: 0, kept: 0 };
  let repositoryRoot = "";
  if (session.projectId) {
    try {
      repositoryRoot = project(session.projectId).path;
    } catch { }
  }
  const expectedBase = repositoryRoot ? worktreeBaseDir(repositoryRoot) : "";
  const authorized = await resolveAuthorizedWorktreeTarget(session.cwd, expectedBase);
  if (!authorized) {
    console.warn(`[ccdph] 拒绝删除越界的 worktree 路径: ${sanitizeError(session.cwd)}`);
    return { removed: 0, kept: 1 };
  }
  try {
    await fs.stat(authorized.target);
  } catch (error) {
    if (error?.code !== "ENOENT") return { removed: 0, kept: 1 };
    if (repositoryRoot)
      await git(repositoryRoot, ["worktree", "prune"]).catch(() => { });
    return { removed: 0, kept: 0 };
  }
  try {
    const dirty = (await git(authorized.target, ["status", "--porcelain"])).trim() !== "";
    if (dirty) return { removed: 0, kept: 1 };
  } catch {
    // “不是 Git 仓库”、权限错误、磁盘故障都不等于“可安全删除”。
    // fail closed：无法确认干净就保留。
    return { removed: 0, kept: 1 };
  }
  // 删除前再次解析，防止“检查干净后、删除前”把目录项换成 junction/symlink。
  const currentTarget = await fs.realpath(authorized.target).catch(() => "");
  if (
    currentTarget !== authorized.target ||
    !isDirectChildPath(authorized.base, currentTarget)
  )
    return { removed: 0, kept: 1 };
  // 先把已授权的目录项原子改名为同一父目录下不可预测的 tombstone。之后即使原路径被
  // 重新创建，rm 也只会触碰我们捕获到的那个目录项；若 tombstone 解析到 base 外则回滚。
  const tombstone = path.join(
    authorized.base,
    `.ccdph-remove-${randomUUID()}`,
  );
  try {
    await fs.rename(authorized.target, tombstone);
  } catch {
    return { removed: 0, kept: 1 };
  }
  const capturedTarget = await fs.realpath(tombstone).catch(() => "");
  if (
    capturedTarget !== tombstone ||
    !isDirectChildPath(authorized.base, capturedTarget)
  ) {
    await fs.rename(tombstone, authorized.target).catch(() => { });
    return { removed: 0, kept: 1 };
  }
  try {
    await fs.rm(tombstone, { recursive: true, force: true });
  } catch {
    await fs.rename(tombstone, authorized.target).catch(() => { });
    return { removed: 0, kept: 1 };
  }
  if (repositoryRoot)
    await git(repositoryRoot, ["worktree", "prune"]).catch(() => { });
  return { removed: 1, kept: 0 };
}
async function findFiles(root, needle, limit = 120) {
  const normalized = needle.trim().toLocaleLowerCase();
  if (!normalized) return { files: [], truncated: false };
  const matches = [];
  const pending = [root];
  // CCDPH-FIX(BUG-2): 目录遍历上限。原来唯一停止条件是"匹配数够了"。
  // 搜索一个命中极少/为 0 的关键词会遍历完整棵目录树，让 /api/search-files
  // 卡住。使用目录队列硬上限约束病态目录树。
  // 5000 个目录已覆盖正常项目规模，只对病态目录树封顶。
  let dirsQueued = 1;
  const MAX_DIRS = 5000;
  const MAX_ENTRIES = 100_000;
  let entriesVisited = 0;
  let entryLimitReached = false;
  let dirsSkipped = 0;
  while (pending.length && matches.length < limit && !entryLimitReached) {
    const folder = pending.pop();
    let directory;
    try {
      directory = await fs.opendir(folder);
      for await (const entry of directory) {
        entriesVisited += 1;
        if (entriesVisited > MAX_ENTRIES) {
          entryLimitReached = true;
          break;
        }
        if (entry.isSymbolicLink() || FILE_EXCLUDES.has(entry.name)) continue;
        const absolute = path.join(folder, entry.name);
        if (entry.isDirectory()) {
          if (dirsQueued < MAX_DIRS) {
            dirsQueued++;
            pending.push(absolute);
          } else {
            // CCDPH-FIX(P3-10): 记录"真的丢弃了目录"，用于如实判断 truncated
            //（原来只看 dirsQueued >= MAX_DIRS，恰好排满且全部处理完也会误报截断）。
            dirsSkipped += 1;
          }
        } else if (entry.name.toLocaleLowerCase().includes(normalized)) {
          matches.push(path.relative(root, absolute).replaceAll("\\", "/"));
          if (matches.length >= limit) break;
        }
      }
    } catch (error) {
      // CCDPH-FIX(P3-10): 原来静默 continue —— 权限/IO 错误会让结果缺失却 truncated=false。
      console.warn(
        "[ccdph] 搜索文件时读取目录失败，已跳过:",
        folder,
        error?.message || error,
      );
      continue;
    } finally {
      await directory?.close().catch(() => { });
    }
  }
  // CCDPH-FIX(LOW-5): 目录队列达到 MAX_DIRS 后，剩余目录会被**静默丢弃**，
  // 搜索结果可能不完整却毫无提示。这里把「是否被截断」如实回传给前端。
  return {
    files: matches.sort((a, b) => a.length - b.length || a.localeCompare(b)),
    truncated: dirsSkipped > 0 || entryLimitReached,
    truncationReason:
      entryLimitReached
        ? `文件条目超过 ${MAX_ENTRIES}，仅返回部分结果`
        : dirsSkipped > 0
        ? `目录数量超过 ${MAX_DIRS}，仅返回部分结果`
        : "",
  };
}
// git status 结果缓存：一次调用要 spawn 3 个 git 进程，切换会话/面板会
// 连续触发。1.5s 内的重复查询直接复用，突发导航不再放大成进程风暴。
const CHANGES_CACHE_TTL = 1500;
// CCDPH-FIX(F-09): 这个上限现在真正生效（原来被前面一段硬编码的 size>=32 抢先清空，
// 导致本常量与它的淘汰分支恒不可达）。这个 Map 以 root 为键只写不删，而 worktree 会话的
// root 是「worktreeBaseDir/会话id」—— 每个新会话都是新键，长期使用会单调增长。
const CHANGES_CACHE_MAX = 64;
const changesCache = new Map(); // root -> { at, value }
async function getChanges(root) {
  const cached = changesCache.get(root);
  if (cached && Date.now() - cached.at < CHANGES_CACHE_TTL) return cached.value;
  const status = await git(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=normal",
    "--",
    ".",
  ]);
  const repo = (await git(root, ["rev-parse", "--show-toplevel"])).trim();
  const entries = status.split("\0"),
    files = [];
  for (let i = 0; i < entries.length; i++) {
    if (!entries[i]) continue;
    const code = entries[i].slice(0, 2),
      filename = entries[i].slice(3);
    if (/[RC]/.test(code)) i++;
    const absolute = path.resolve(repo, filename);
    if (within(root, absolute))
      files.push({
        status: code,
        path: path.relative(root, absolute).replaceAll("\\", "/"),
      });
  }
  let additions = 0,
    deletions = 0;
  try {
    // CCDPH-FIX(P3-9): 原来 `git diff --numstat` 失败被静默吞掉，改动行数静默显示为 0
    //（界面看起来"没有改动"）。至少留下可查日志。
    const numstat = await git(root, [
      "diff",
      "--numstat",
      "HEAD",
      "--",
      ".",
    ]).catch((error) => {
      console.warn(
        "[ccdph] git diff --numstat 失败，本次改动行数按 0 统计:",
        error?.message || error,
      );
      return "";
    });
    for (const line of numstat.trim().split("\n")) {
      const [add, del] = line.split("\t");
      if (/^\d+$/.test(add)) additions += Number(add);
      if (/^\d+$/.test(del)) deletions += Number(del);
    }
  } catch { }
  const result = { files, additions, deletions };
  // CCDPH-FIX(F-09): 只保留一处淘汰逻辑。原来这里有两段重叠的 MED-3 修复 ——
  // 先按硬编码的 size>=32 淘汰一条（按 at 排序），紧接着又按 CHANGES_CACHE_MAX(=64)
  // 淘汰一条；32 段跑完后 size 至多 31，第二段的条件恒不可达 → 命名常量、它的注释和
  // 它那套「按插入序淘汰」的策略全是死代码，改常量也不会生效。
  // 现在统一为「按 at 淘汰最旧的一条」，并让 CHANGES_CACHE_MAX 真正生效。
  if (changesCache.size >= CHANGES_CACHE_MAX) {
    let oldestKey;
    let oldestAt = Infinity;
    for (const [key, entry] of changesCache) {
      if (entry.at < oldestAt) {
        oldestAt = entry.at;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) changesCache.delete(oldestKey);
  }
  changesCache.set(root, { at: Date.now(), value: result });
  return result;
}
const PROJECT_INFO_CACHE_TTL = 1500;
const PROJECT_INFO_CACHE_MAX = 64;
const projectInfoCache = new Map();
async function loadProjectInfo(root) {
  let gitError = "";
  try {
    const inside = (
      await git(root, ["rev-parse", "--is-inside-work-tree"])
    ).trim();
    if (inside !== "true") throw new Error("这个工作区不是 Git 仓库");
  } catch (error) {
    // CCDPH-FIX(A10-18): git 错误原文含绝对路径（如 safe.directory=C:\Users\…），必须脱敏，
    // 与 /api/diff、/api/git-remote/* 的写法一致。原来直接回传 error.message 泄漏用户名/目录。
    gitError = sanitizeError(error);
    return {
      git: false,
      branch: "",
      head: "",
      files: [],
      additions: 0,
      deletions: 0,
      ahead: 0,
      behind: 0,
      remote: "",
      gitError,
    };
  }
  // branch / head / ahead-behind / remote / changes 互不依赖，并行执行以减少总耗时。
  const [branchRes, headRes, countsRes, remoteRes, changesRes] = await Promise.all([
    git(root, ["branch", "--show-current"]).catch((e) => { gitError ||= sanitizeError(e); return ""; }),
    git(root, ["rev-parse", "--short", "HEAD"]).catch(() => ""),
    git(root, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"])
      .then((out) => out.trim().split(/\s+/)).catch(() => []),
    git(root, ["remote", "get-url", "origin"]).catch((e) => { gitError ||= sanitizeError(e); return ""; }),
    getChanges(root).catch((e) => { gitError ||= sanitizeError(e); return { files: [], additions: 0, deletions: 0 }; }),
  ]);
  const branch = branchRes;
  const head = headRes;
  const ahead = Number(countsRes[1]) || 0;
  const behind = Number(countsRes[0]) || 0;
  const remote = remoteRes.trim();
  const changes = changesRes;
  return {
    git: true,
    branch: branch.trim() || (head.trim() ? "detached" : "未提交"),
    head: head.trim(),
    ahead,
    behind,
    remote,
    gitError,
    ...changes,
  };
}
async function getProjectInfo(root) {
  const cached = projectInfoCache.get(root);
  if (cached && Date.now() - cached.at < PROJECT_INFO_CACHE_TTL) {
    // CCDPH-FIX(P3-24): 命中时刷新插入序，使其成为真正的 LRU。原来淘汰按**插入序**取
    // `keys().next()`，热点条目会被误逐（与 changesCache 的"按 at"策略不一致）。
    projectInfoCache.delete(root);
    projectInfoCache.set(root, cached);
    return cached.value;
  }
  const pending = loadProjectInfo(root).catch((error) => {
    projectInfoCache.delete(root);
    throw error;
  });
  if (projectInfoCache.size >= PROJECT_INFO_CACHE_MAX) {
    const oldest = projectInfoCache.keys().next().value;
    if (oldest !== undefined) projectInfoCache.delete(oldest);
  }
  projectInfoCache.set(root, { at: Date.now(), value: pending });
  return pending;
}

// ---- Worktree 目录落点：与 createWorktree 保持一致（数据目录在项目内时回退到系统临时目录）----
function worktreeBaseDir(root) {
  const inData = path.join(DATA, "worktrees");
  return within(root, inData) ? path.join(os.tmpdir(), "ccdph-worktrees") : inData;
}
async function resolveAuthorizedWorktreeTarget(targetValue, expectedBase = "") {
  if (typeof targetValue !== "string" || !targetValue.trim()) return null;
  const target = path.resolve(targetValue);
  const allowedBases = expectedBase
    ? [path.resolve(expectedBase)]
    : [path.resolve(path.join(DATA, "worktrees")), path.resolve(path.join(os.tmpdir(), "ccdph-worktrees"))];
  for (const base of allowedBases) {
    const realBase = await fs.realpath(base).catch(() => null);
    const realTarget = await fs.realpath(target).catch(() => null);
    if (!realBase || !realTarget) continue;
    // createWorktree 只会创建 <base>/<session-id>：仅允许直系子目录，
    // 拒绝 base 本身、更深层路径和指向 base 外的 junction/symlink。
    if (isDirectChildPath(realBase, realTarget))
      return { base: realBase, target: realTarget };
  }
  return null;
}
export function isDirectChildPath(base, target) {
  const relative = path.relative(path.resolve(base), path.resolve(target));
  return Boolean(
    relative &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative) &&
      !relative.includes(path.sep),
  );
}
async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
function repoRootFor(projectId, sessionId) {
  if (projectId) return workspaceRoot(projectId, sessionId);
  if (sessionId) return sessionRoot(session(sessionId));
  throw new Error("请先选择项目");
}
// 解析 `git worktree list --porcelain`：path / HEAD / branch / detached / bare / 是否主工作区 / 是否存在
async function listWorktrees(root) {
  const out = await git(root, ["worktree", "list", "--porcelain"]);
  const entries = [];
  let current = null;
  for (const raw of out.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = {
        path: line.slice("worktree ".length),
        head: "",
        branch: "",
        detached: false,
        bare: false,
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("HEAD ")) current.head = line.slice(5).trim();
    else if (line.startsWith("branch "))
      current.branch = line.slice(7).trim().replace(/^refs\/heads\//, "");
    else if (line === "detached") current.detached = true;
    else if (line === "bare") current.bare = true;
  }
  if (current) entries.push(current);
  return Promise.all(
    entries.map(async (entry, index) => ({
      ...entry,
      main: index === 0, // git worktree list 的第一项即主工作区
      exists: await pathExists(entry.path),
    })),
  );
}
// 从 worktree 列表中按路径匹配（Windows 大小写不敏感），用于阻止任意路径操作
function matchWorktree(worktrees, target) {
  const resolved = path.resolve(target);
  const lower = process.platform === "win32";
  return worktrees.find((item) => {
    const candidate = path.resolve(item.path);
    return lower
      ? candidate.toLowerCase() === resolved.toLowerCase()
      : candidate === resolved;
  });
}
// ---- Hooks：读写 CLAUDE_CONFIG_DIR/settings.json 的 hooks 字段（保留文件其它所有键）----
const SUPPORTED_HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "UserPromptSubmit",
  "Stop",
  "SubagentStop",
  "PreCompact",
  "SessionStart",
  "SessionEnd",
];
const settingsJsonPath = () => path.join(CLAUDE_CONFIG_DIR, "settings.json");
// 严格读取：文件不存在返回 {}；存在但非法则不返回空对象，避免写回时整坏原文件
async function readSettingsJsonStrict(file) {
  let raw;
  try {
    raw = (await readStableBoundedFile(file, CONFIG_JSON_MAX_BYTES)).toString(
      "utf8",
    );
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  if (!raw.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("settings.json 不是合法 JSON，已中止写入以免破坏原文件");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("settings.json 顶层必须是对象");
  return parsed;
}
// 原子写：先备份为 settings.json.hooksbak，写临时文件校验可解析后再替换
async function writeSettingsJson(doc) {
  const file = settingsJsonPath();
  await fs.mkdir(CLAUDE_CONFIG_DIR, { recursive: true });
  try {
    await fs.copyFile(file, `${file}.hooksbak`);
  } catch { }
  const tmp = uniqueTmpPath(file, "hooks-tmp");
  // CCDPH-FIX(MED-14): 校验/rename 失败必须回收临时文件。uniqueTmpPath 刻意让名字唯一，
  // 于是「写盘失败」这条路径（ENOSPC / EACCES / 杀软占用 settings.json）每失败一次就在
  // ~/.claude/ 下留一份 settings.json.hooks-tmp-… 垃圾文件，且和文档一样大。
  try {
    await fs.writeFile(tmp, JSON.stringify(doc, null, 2), "utf8");
    JSON.parse(
      (await readStableBoundedFile(tmp, CONFIG_JSON_MAX_BYTES)).toString(
        "utf8",
      ),
    ); // 写入内容必须可解析且不超过尺寸上限才替换
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => { });
    throw error;
  }
}
// 命令里的敏感值脱敏：sk-xxx / Bearer xxx / token=xxx 只保留前 4 位
function redactHookCommand(command) {
  return String(command ?? "")
    .replace(/\bsk-[A-Za-z0-9_-]{5,}/g, (match) => `${match.slice(0, 4)}…`)
    .replace(
      /\bBearer\s+([A-Za-z0-9._-]{6,})/gi,
      (_match, value) => `Bearer ${value.slice(0, 4)}…`,
    )
    .replace(
      /((?:api[_-]?key|auth[_-]?token|access[_-]?token|token|secret|password|passwd|pwd)\s*[=:]\s*)([A-Za-z0-9._-]{6,})/gi,
      (_match, prefix, value) => `${prefix}${value.slice(0, 4)}…`,
    );
}
// CCDPH-FIX(MED-16): 「脱敏产物」识别。redactHookCommand 一律把密钥替换成
// 「前 4 位 + …（U+2026）」，所以一段命令只要命中这些形状，就说明它**来自 GET /api/hooks
// 的脱敏回包**，而不是用户真正要写入的命令。
const REDACTED_HOOK_COMMAND_RE =
  /\bsk-[A-Za-z0-9_-]{1,4}…|\bBearer\s+[A-Za-z0-9._-]{1,4}…|(?:api[_-]?key|auth[_-]?token|access[_-]?token|token|secret|password|passwd|pwd)\s*[=:]\s*[A-Za-z0-9._-]{1,4}…/i;
// CCDPH-FIX(MED-16): 按「事件 + 条目下标 + hooks 下标」把 action:"set" 提交上来的脱敏命令
// 还原成磁盘上真实的命令；无法对应（说明客户端改写过脱敏串、或没有对应的旧条目）的
// 一律记进 unresolved，由调用方拒绝整次写入。
function restoreRedactedHookCommands(next, current) {
  let restored = 0;
  const unresolved = [];
  for (const [event, list] of Object.entries(next)) {
    const storedList = Array.isArray(current?.[event]) ? current[event] : [];
    list.forEach((item, index) => {
      const storedHooks = Array.isArray(storedList[index]?.hooks)
        ? storedList[index].hooks
        : [];
      item.hooks.forEach((hook, hookIndex) => {
        const stored =
          typeof storedHooks[hookIndex]?.command === "string"
            ? storedHooks[hookIndex].command
            : "";
        if (
          stored &&
          stored !== hook.command &&
          redactHookCommand(stored) === hook.command
        ) {
          hook.command = stored;
          restored++;
          return;
        }
        if (REDACTED_HOOK_COMMAND_RE.test(hook.command))
          unresolved.push(`${event}[${index}].hooks[${hookIndex}]`);
      });
    });
  }
  return { restored, unresolved };
}
// 客户端结构：事件名 → [ { matcher, hooks: [ { type, command, redacted } ] } ]
function serializeHooks(hooks) {
  const out = {};
  for (const [event, list] of Object.entries(hooks || {})) {
    if (!Array.isArray(list)) continue;
    out[event] = list.map((entry) => {
      const rawHooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
      return {
        matcher: typeof entry?.matcher === "string" ? entry.matcher : "",
        hooks: rawHooks.map((hook) => {
          const command = typeof hook?.command === "string" ? hook.command : "";
          const redacted = redactHookCommand(command);
          return {
            type: typeof hook?.type === "string" ? hook.type : "command",
            command: redacted,
            redacted: redacted !== command,
          };
        }),
      };
    });
  }
  return out;
}
function hooksCount(hooks) {
  return Object.values(hooks || {}).reduce(
    (total, list) => total + (Array.isArray(list) ? list.length : 0),
    0,
  );
}
// 校验单条 hook（matcher + 至少一条命令），返回可写入的标准结构
function validateHookItem(item, event) {
  // CCDPH-FIX(P3-10): 非字符串 matcher 会被 String() 静默变成 "[object Object]" 落盘。
  if (item?.matcher !== undefined && typeof item.matcher !== "string")
    throw new Error(`事件 ${event} 的 matcher 必须是字符串`);
  const matcher = item?.matcher === undefined ? "" : String(item.matcher);
  if (matcher.length > 200)
    throw new Error(`事件 ${event} 的 matcher 不能超过 200 字`);
  const list = Array.isArray(item?.hooks) ? item.hooks : [];
  if (!list.length) throw new Error(`事件 ${event} 至少需要一条命令`);
  if (list.length > 20) throw new Error("单个 Hook 最多 20 条命令");
  const hooks = [];
  for (const hook of list) {
    const command = typeof hook?.command === "string" ? hook.command.trim() : "";
    if (!command) throw new Error("Hook 命令不能为空");
    if (command.length > 2000) throw new Error("Hook 命令不能超过 2000 字");
    // CCDPH-FIX(P3-9): 原来只保留 type/command，把 hook 上的其他字段（如 timeout）
    // 静默丢弃。这里保留除 type/command 之外的自有字段。
    const extraHook = {};
    for (const [key, value] of Object.entries(hook || {}))
      if (key !== "type" && key !== "command") extraHook[key] = value;
    hooks.push({
      ...extraHook,
      type: hook?.type === "prompt" ? "prompt" : "command",
      command,
    });
  }
  // CCDPH-FIX(P3-9): 同理保留条目上除 matcher/hooks 之外的自有字段（如 name/timeout）。
  const extra = {};
  for (const [key, value] of Object.entries(item || {}))
    if (key !== "matcher" && key !== "hooks") extra[key] = value;
  return { ...extra, matcher, hooks };
}
// CCDPH-FIX(F-08): 单事件 Hook 条数上限提取成常量 —— 之前 50 只是 action:"set"
// 路径里的字面量，action:"add" 完全不受约束，同一份文档因此有两套口径。
const MAX_HOOKS_PER_EVENT = 50;
function validateHooksStructure(hooks) {
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks))
    throw new Error("hooks 必须是一个对象");
  const clean = {};
  for (const [event, value] of Object.entries(hooks)) {
    if (!SUPPORTED_HOOK_EVENTS.includes(event))
      throw new Error(`不支持的事件名：${event}`);
    if (!Array.isArray(value)) throw new Error(`事件 ${event} 必须是数组`);
    if (value.length > MAX_HOOKS_PER_EVENT)
      throw new Error(`事件 ${event} 的 Hook 数量过多（上限 ${MAX_HOOKS_PER_EVENT}）`);
    clean[event] = value.map((item) => validateHookItem(item, event));
  }
  return clean;
}

export function appendBoundedText(target, text, limit) {
  const value = String(text || "");
  const cap = Math.max(1, Number(limit) || 1);
  target.outputChunks ||= [];
  target.outputChars ||= 0;
  if (value.length >= cap) {
    target.outputChunks = [value.slice(-cap)];
    target.outputChars = target.outputChunks[0].length;
    return;
  }
  const last = target.outputChunks[target.outputChunks.length - 1];
  if (last && last.length + value.length <= 8192) {
    target.outputChunks[target.outputChunks.length - 1] = last + value;
  } else if (value) {
    target.outputChunks.push(value);
  }
  target.outputChars += value.length;
  while (target.outputChars > cap && target.outputChunks.length) {
    const excess = target.outputChars - cap;
    const first = target.outputChunks[0];
    if (first.length <= excess) {
      target.outputChunks.shift();
      target.outputChars -= first.length;
    } else {
      target.outputChunks[0] = first.slice(excess);
      target.outputChars -= excess;
    }
  }
}
export const boundedText = (target) => (target.outputChunks || []).join("");

export function attachTerminalEncodingInitializer(
  child,
  terminal,
  shell,
  platform = process.platform,
) {
  if (platform !== "win32") return;
  child.once("spawn", () => {
    if (
      terminal.stdinClosed ||
      child.stdin.destroyed ||
      child.stdin.writableEnded
    )
      return;
    child.stdin.write(
      shell === "powershell" || shell === "pwsh"
        ? "[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); $env:PYTHONIOENCODING='utf-8'\r\n"
        : "chcp 65001>nul & set PYTHONIOENCODING=utf-8\r\n",
    );
  });
}

function terminalBroadcast(terminal, event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  writeSseClients(terminal.clients, payload);
}
const TERMINAL_STARTUP_BUFFER_LIMIT = 256 * 1024;
export function consumeTerminalStartupChunk(
  terminal,
  text,
  limit = TERMINAL_STARTUP_BUFFER_LIMIT,
) {
  if (!terminal.startup) return { waiting: false, text };
  const promptEnd = text.indexOf(">");
  if (promptEnd >= 0) {
    terminal.startup = false;
    terminal.startupOutput = "";
    return { waiting: false, text: text.slice(promptEnd + 1) };
  }
  const boundedLimit = Math.max(1024, Number(limit) || TERMINAL_STARTUP_BUFFER_LIMIT);
  const previous = terminal.startupOutput || "";
  if (previous.length + text.length <= boundedLimit) {
    terminal.startupOutput = previous + text;
    return { waiting: true, text: "" };
  }
  const tail =
    text.length >= boundedLimit
      ? text.slice(-boundedLimit)
      : previous.slice(-(boundedLimit - text.length)) + text;
  terminal.startup = false;
  terminal.startupOutput = "";
  return {
    waiting: false,
    text: `\r\n[终端启动输出超过 ${boundedLimit} 字符，已截断]\r\n${tail}`,
  };
}
function finishTerminal(terminal, code, error) {
  if (terminal.exited) return;
  clearTimeout(terminal.startupTimer);
  terminal.exited = true;
  terminalBroadcast(terminal, {
    type: "exit",
    code,
    ...(error ? { error } : {}),
  });
  closeSseClients(terminal.clients);
  terminal.child.stdout?.off("data", terminal.append);
  terminal.child.stderr?.off("data", terminal.append);
  if (terminal.onStdinDrain)
    terminal.child.stdin?.off("drain", terminal.onStdinDrain);
  const retentionMs = process.env.WORKBENCH_TERMINAL_RETENTION_MS
    ? Math.max(1000, Number(process.env.WORKBENCH_TERMINAL_RETENTION_MS))
    : Math.max(1, Number(db.settings.terminalRetentionMinutes) || 5) * 60000;
  terminal.releaseTimer = setTimeout(() => {
    if (terminals.get(terminal.id) === terminal) terminals.delete(terminal.id);
    void terminalProcessRegistry.schedule();
  }, retentionMs);
  terminal.releaseTimer.unref?.();
  void terminalProcessRegistry.schedule();
}
async function startTerminal(root) {
  const existing = [...terminals.values()].find(
    (terminal) => terminal.root === root && !terminal.exited,
  );
  if (existing) return existing;
  // CCDPH-FIX(MED-7): 每个不同的 root（项目 / worktree）都会常驻一个 shell，
  // 原来没有总数上限。这里先回收已退出的，再对在用数量封顶 —— 超过上限时淘汰**真正最久
  // 未使用**的那个（见下方 LOW-6：原来按 Map 插入序淘汰，其实是 FIFO）。
  for (const [key, item] of terminals) if (item.exited) terminals.delete(key);
  const MAX_TERMINALS = 8;
  while (terminals.size >= MAX_TERMINALS) {
    // CCDPH-FIX(LOW-6): 真正的 LRU。原来是 terminals.values().next() —— Map 的插入序即
    // 创建序，于是被回收的恒是**最早打开**的那个终端（很可能正是用户正在盯着看的长任务），
    // 而后来新建、从未使用过的终端反而留着；提示语却写着「已回收最久未使用的终端」。
    // lastUsedAt 在 /api/terminal/input 与 /api/terminal/events 上刷新。
    let oldest = null;
    for (const item of terminals.values()) {
      // A connected SSE client is actively watching this terminal. Do not evict it
      // merely because the user has not typed input recently.
      if (item.clients?.size) continue;
      if (
        !oldest ||
        (item.lastUsedAt || item.createdAt || 0) <
          (oldest.lastUsedAt || oldest.createdAt || 0)
      )
        oldest = item;
    }
    if (!oldest)
      throw new Error("终端数量已达上限，当前终端都正在使用，请先关闭一个终端");
    terminals.delete(oldest.id);
    // CCDPH-FIX(P3-12): killProcessTree 抛错时原实现会既没 finishTerminal、又已经把它从
    // terminals 里删掉 —— 子进程/监听器残留且面板不再更新。这里兜住并始终收尾。
    try {
      // CCDPH-FIX(HIGH-4): 整棵进程树一起结束（原来 child.kill() 只杀 shell，孙进程变孤儿）
      await killProcessTree(oldest.child);
    } catch (error) {
      console.error(
        "[ccdph] 回收终端时结束进程树失败:",
        error?.message || error,
      );
    }
    finishTerminal(oldest, null, "终端数量已达上限，已回收最久未使用的终端");
  }
  const id = randomUUID();
  const shell = db.settings.terminalShell || "system";
  const command =
    process.platform !== "win32"
      ? process.env.SHELL || "/bin/sh"
      : shell === "powershell"
        ? "powershell.exe"
        : shell === "pwsh"
          ? "pwsh.exe"
          : process.env.ComSpec || "cmd.exe";
  const args =
    process.platform !== "win32"
      ? []
      : shell === "powershell" || shell === "pwsh"
        ? ["-NoLogo", "-NoProfile", "-NoExit", "-Command", "-"]
        : ["/d", "/q"];
  const child = spawn(command, args, {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, TERM: "xterm-256color" },
  });
  const terminal = {
    id,
    root,
    child,
    clients: new Set(),
    outputChunks: [],
    outputChars: 0,
    exited: false,
    startup: true,
    startupOutput: "",
    releaseTimer: null,
    // CCDPH-FIX(LOW-6): 最近使用时间（LRU 淘汰依据），在 input / events 上刷新
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    stdinBackpressured: false,
  };
  const releaseStartup = () => {
    if (!terminal.startup) return;
    terminal.startup = false;
    const buffered = terminal.startupOutput;
    terminal.startupOutput = "";
    if (buffered) append(buffered);
  };
  const append = (chunk) => {
    let text = chunk.toString("utf8");
    if (terminal.startup) {
      const startupChunk = consumeTerminalStartupChunk(terminal, text);
      if (startupChunk.waiting) return;
      clearTimeout(terminal.startupTimer);
      text = startupChunk.text;
    }
    const outputLimit = Math.max(
      50000,
      Number(db.settings.terminalOutputLimit) || 200000,
    );
    appendBoundedText(terminal, text, outputLimit);
    terminalBroadcast(terminal, { type: "output", text });
  };
  terminal.append = append;
  terminal.startupTimer = setTimeout(releaseStartup, 1500);
  terminal.startupTimer.unref?.();
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  const onOutputError = (error) =>
    console.warn("[ccdph] 终端输出流异常，已隔离:", error?.message || error);
  child.stdout.on("error", onOutputError);
  child.stderr.on("error", onOutputError);
  // EPIPE 兜底：stop 之后、'exit' 之前写 stdin 会打到已销毁的流上，
  // 没有 error 监听器时未处理的 EPIPE 会直接崩掉服务进程。
  terminal.onStdinDrain = () => {
    terminal.stdinBackpressured = false;
  };
  child.stdin.on("drain", terminal.onStdinDrain);
  child.stdin.on("error", () => { terminal.stdinClosed = true; });
  child.on("exit", (code) => finishTerminal(terminal, code));
  child.on("error", (error) => {
    append(`\r\n${error.message}\r\n`);
    finishTerminal(terminal, -1, error.message);
  });
  terminals.set(id, terminal);
  void terminalProcessRegistry.schedule();
  attachTerminalEncodingInitializer(child, terminal, shell);
  return terminal;
}
// CCDPH-FIX(MED-1): 单个 provider profile 的对外投影。原来只有 publicSettings() 里的
// /api/state 过滤了凭据，而 /api/api-profiles 直接展开 profile 对象 —— 修复前就已经把
// 凭据写进 profile.env 的旧数据（ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY）会被原样
// 回传给页面，而 /api/state 却正确隐藏了它，等于同一份数据两套口径。这里提取成一处，
// 三个出口（/api/state、/api/api-profiles、/api/api-profiles/save）共用。
const publicProfile = (profile) => ({
  ...profile,
  env: Object.fromEntries(
    Object.entries(profile?.env || {}).filter(
      ([key]) => !CREDENTIAL_ENV_KEY_RE.test(key),
    ),
  ),
});
const publicSettings = () => {
  const rest = { ...db.settings };
  for (const key of [
    "dsApiKey",
    "dsProfiles",
    "dsActiveId",
    "dsBaseUrl",
    "dsModel",
    "dsPriceIn",
    "dsPriceOut",
    "dsHistoryLimit",
  ])
    delete rest[key];
  return {
    ...rest,
    engine: "claude",
    // CCDPH-FIX(F-13): 第二道防线 —— 兼容修复前就已经把凭据写进 profile.env 的旧数据，
    // 也不允许再从 /api/state 回传给页面/其它本机客户端。
    apiProfiles: (rest.apiProfiles || []).map(publicProfile),
  };
};
function buildNextSettings(input, current) {
  const next = structuredClone(current);
  for (const key of [
    "notifications",
    "notificationSound",
    "notifyWhenFocused",
    "nativeApprovalWindow",
    "closeToTray",
    "restoreLastSession",
    "autoNameSessions",
    "usageAutoRefresh",
    "resourceCleanup",
  ])
    if (typeof input[key] === "boolean") next[key] = input[key];

  if (["default", "student", "college", "senior", "custom"].includes(input.personaId))
    next.personaId = input.personaId;
  next.engine = "claude";

  if (input.browser && typeof input.browser === "object" && !Array.isArray(input.browser)) {
    const b = input.browser;
    const cur = {
      ...structuredClone(DEFAULT_SETTINGS.browser),
      ...(next.browser && typeof next.browser === "object" && !Array.isArray(next.browser)
        ? next.browser
        : {}),
    };
    if (typeof b.enabled === "boolean") cur.enabled = b.enabled;
    if (["attach", "dedicated"].includes(b.mode)) cur.mode = b.mode;
    if (typeof b.cdpEndpoint === "string")
      cur.cdpEndpoint = b.cdpEndpoint.trim().slice(0, 300);
    if (isValidPort(b.dedicatedPort)) cur.dedicatedPort = b.dedicatedPort;
    if (typeof b.profileDir === "string")
      cur.profileDir = b.profileDir.trim().slice(0, 300);
    for (const key of ["allowOrigins", "blockOrigins"])
      if (Array.isArray(b[key]))
        cur[key] = b[key]
          .filter((value) => typeof value === "string")
          .map((value) => value.trim().slice(0, 200))
          // CCDPH-FIX(R3-P3-11): 字符白名单（见 isValidOriginEntry 的说明）。
          .filter(isValidOriginEntry)
          .slice(0, 50);
    if (["allow", "omit"].includes(b.imageResponses))
      cur.imageResponses = b.imageResponses;
    next.browser = cur;
  }

  if (typeof input.personaCustom === "string")
    next.personaCustom = input.personaCustom.trim().slice(0, 2000);
  if (input.shortcuts && typeof input.shortcuts === "object" && !Array.isArray(input.shortcuts)) {
    const clean = {};
    for (const [name, combo] of Object.entries(input.shortcuts)) {
      if (!["newSession", "palette", "settings"].includes(name)) continue;
      if (typeof combo !== "string") continue;
      const key = combo.trim().toLowerCase();
      if (
        key &&
        key.length <= 32 &&
        SHORTCUT_RE.test(key) &&
        (SHORTCUT_MODIFIER_RE.test(key) || SHORTCUT_NAMED_KEY_RE.test(key))
      )
        clean[name] = key;
    }
    next.shortcuts = clean;
  }
  if (PERMISSION_MODES.includes(input.defaultPermissionMode))
    next.defaultPermissionMode = input.defaultPermissionMode;
  if (["local", "worktree"].includes(input.defaultEnvironment))
    next.defaultEnvironment = input.defaultEnvironment;
  if (["", "sonnet", "opus", "haiku"].includes(input.defaultModel))
    next.defaultModel = input.defaultModel;
  if (typeof input.claudeExecutable === "string")
    next.claudeExecutable = input.claudeExecutable.trim().slice(0, 500);

  if (typeof input.updateManifestUrl === "string") {
    const manifestUrl = input.updateManifestUrl.trim().slice(0, 500);
    if (manifestUrl) {
      if (!/^https?:\/\//i.test(manifestUrl))
        throw new Error("更新源地址必须是 http(s) 链接");
      if (!/^https:\/\//i.test(manifestUrl) && !isLoopbackUrl(manifestUrl))
        throw new Error(
          "更新源地址必须使用 https（本机测试源可用 127.0.0.1 / localhost）",
        );
    }
    next.updateManifestUrl = manifestUrl;
  }
  if (typeof input.autoCheckUpdates === "boolean")
    next.autoCheckUpdates = input.autoCheckUpdates;
  if (typeof input.apiMode === "string" && ["cc-switch", "profile"].includes(input.apiMode))
    next.apiMode = input.apiMode;
  if (["inherit", "low", "medium", "high", "xhigh", "max"].includes(input.defaultEffort))
    next.defaultEffort = input.defaultEffort;
  if ([0, 10, 20, 50, 100].includes(Number(input.maxTurns)))
    next.maxTurns = Number(input.maxTurns);
  if (["system", "cmd", "powershell", "pwsh"].includes(input.terminalShell))
    next.terminalShell = input.terminalShell;
  if ([1, 5, 15, 30].includes(Number(input.terminalRetentionMinutes)))
    next.terminalRetentionMinutes = Number(input.terminalRetentionMinutes);
  if ([50000, 200000, 500000].includes(Number(input.terminalOutputLimit)))
    next.terminalOutputLimit = Number(input.terminalOutputLimit);
  if ([1, 5, 15].includes(Number(input.usageRefreshMinutes)))
    next.usageRefreshMinutes = Number(input.usageRefreshMinutes);
  if ([500, 1000, 2500, 5000].includes(Number(input.historyLimit)))
    next.historyLimit = Number(input.historyLimit);
  return next;
}
function normalizeLoadedSettings(settings) {
  const allowed = (value, values, fallback) =>
    values.includes(value) ? value : fallback;
  settings.maxTurns = allowed(
    Number(settings.maxTurns),
    [0, 10, 20, 50, 100],
    DEFAULT_SETTINGS.maxTurns,
  );
  settings.terminalRetentionMinutes = allowed(
    Number(settings.terminalRetentionMinutes),
    [1, 5, 15, 30],
    DEFAULT_SETTINGS.terminalRetentionMinutes,
  );
  settings.terminalOutputLimit = allowed(
    Number(settings.terminalOutputLimit),
    [50000, 200000, 500000],
    DEFAULT_SETTINGS.terminalOutputLimit,
  );
  settings.usageRefreshMinutes = allowed(
    Number(settings.usageRefreshMinutes),
    [1, 5, 15],
    DEFAULT_SETTINGS.usageRefreshMinutes,
  );
  settings.historyLimit = allowed(
    Number(settings.historyLimit),
    [500, 1000, 2500, 5000],
    DEFAULT_SETTINGS.historyLimit,
  );
  settings.usageDaily = normalizeUsageDaily(settings.usageDaily);
  // CCDPH-FIX(R3-P3-5): browser.* 此前**只在写入时**校验（buildNextSettings 用 isValidPort /
  // mode 枚举），而 state.json 是本地可写文件 —— 直接改它就能让 dedicatedPort 变成 80 或
  // 任意整数，随后 cdpEndpointFromSettings / buildPlaywrightMcpConfig 会带着它去连
  // `http://127.0.0.1:<port>`（仍限 loopback，但口径必须一致）。载入时按同一套规则收口。
  const browser = { ...structuredClone(DEFAULT_SETTINGS.browser) };
  if (settings.browser && typeof settings.browser === "object" && !Array.isArray(settings.browser)) {
    const raw = settings.browser;
    if (typeof raw.enabled === "boolean") browser.enabled = raw.enabled;
    if (["attach", "dedicated"].includes(raw.mode)) browser.mode = raw.mode;
    if (isValidPort(raw.dedicatedPort)) browser.dedicatedPort = raw.dedicatedPort;
    if (typeof raw.profileDir === "string")
      browser.profileDir = raw.profileDir.trim().slice(0, 300);
    if (["allow", "omit"].includes(raw.imageResponses))
      browser.imageResponses = raw.imageResponses;
    for (const key of ["allowOrigins", "blockOrigins"])
      if (Array.isArray(raw[key]))
        browser[key] = raw[key]
          .filter((value) => typeof value === "string")
          .map((value) => value.trim().slice(0, 200))
          .filter(isValidOriginEntry)
          .slice(0, 50);
  }
  settings.browser = browser;
}
// CCDPH-FIX(R2-P2-12b): MCP_FILE 已提到模块作用域（见文件上方的 CLAUDE_CONFIG_DIR），
// 不再在这里写死 os.homedir()。
async function readMcpDoc() {
  let raw;
  try {
    raw = (
      await readStableBoundedFile(MCP_FILE, CONFIG_JSON_MAX_BYTES)
    ).toString("utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  if (!raw.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(".claude.json 不是合法 JSON，已中止写入以免破坏原文件");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(".claude.json 顶层必须是对象");
  return parsed;
}
async function writeMcpDoc(doc) {
  let currentParsable = false;
  try {
    JSON.parse(
      (
        await readStableBoundedFile(MCP_FILE, CONFIG_JSON_MAX_BYTES)
      ).toString("utf8"),
    );
    currentParsable = true;
  } catch { }
  const backup = currentParsable
    ? `${MCP_FILE}.workbench-bak`
    : `${MCP_FILE}.workbench-bak-${Date.now()}`;
  try {
    await fs.copyFile(MCP_FILE, backup);
  } catch { }
  const tmp = uniqueTmpPath(MCP_FILE, "workbench-tmp");
  try {
    await fs.writeFile(tmp, JSON.stringify(doc, null, 2), "utf8");
    JSON.parse(
      (await readStableBoundedFile(tmp, CONFIG_JSON_MAX_BYTES)).toString(
        "utf8",
      ),
    );
    await fs.rename(tmp, MCP_FILE);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => { });
    throw error;
  }
}
function sanitizeMcpEntry(input) {
  const type = input.type === "http" ? "http" : "stdio";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(String(input.name || "")))
    throw new Error("MCP 名称只能是字母数字与 .-_（≤64 字符）");
  const entry = { type };
  if (type === "stdio") {
    const command = String(input.command || "").trim().slice(0, 500);
    if (!command) throw new Error("stdio 类型必须填写启动命令");
    entry.command = command;
    if (Array.isArray(input.args))
      entry.args = input.args
        .slice(0, 20)
        .map((arg) => String(arg).slice(0, 300))
        .filter(Boolean);
    const env = {};
    if (input.env && typeof input.env === "object" && !Array.isArray(input.env))
      for (const [key, value] of Object.entries(input.env)) {
        if (!/^[A-Z_][A-Z0-9_]*$/.test(key))
          throw new Error(`环境变量名不合法：${key}`);
        if (typeof value === "string" && value) env[key] = value.slice(0, 2000);
      }
    if (Object.keys(env).length) entry.env = env;
  } else {
    const target = String(input.url || "").trim().slice(0, 500);
    if (!/^https?:\/\//i.test(target)) throw new Error("MCP http URL must be http(s)");
    if (!/^https:\/\//i.test(target) && !isLoopbackUrl(target))
      throw new Error("MCP http URL must use https (or 127.0.0.1/localhost)");
    entry.url = target;
    const headers = {};
    if (input.headers && typeof input.headers === "object")
      for (const [key, value] of Object.entries(input.headers))
        if (/^[A-Za-z0-9-]+$/.test(key) && typeof value === "string" && value)
          headers[key] = value.slice(0, 1000);
    if (Object.keys(headers).length) entry.headers = headers;
  }
  return entry;
}
// CCDPH-FIX(LOW-11): 静态资源表提到模块作用域。原来它在 route() 里逐请求重建 ——
// 每个 API 调用（包括流式期间的轮询）都要重新分配这 12 条表项。
const assets = {
  "/": ["public/index.html", "text/html"],
  "/app.js": ["public/app.js", "text/javascript"],
  "/api-client.js": ["public/api-client.js", "text/javascript"],
  "/markdown-renderer.js": ["public/markdown-renderer.js", "text/javascript"],
  "/terminal-text.js": ["public/terminal-text.js", "text/javascript"],
  "/style.css": ["public/style.css", "text/css"],
  "/vendor/marked.js": [
    "node_modules/marked/lib/marked.esm.js",
    "text/javascript",
  ],
  "/vendor/purify.js": [
    "node_modules/dompurify/dist/purify.es.mjs",
    "text/javascript",
  ],
  "/vendor/icons.js": ["public/vendor/icons.js", "text/javascript"],
  "/vendor/highlight.min.js": [
    "public/vendor/highlight.min.js",
    "text/javascript",
  ],
  "/vendor/hljs-theme.css": ["public/vendor/hljs-theme.css", "text/css"],
  "/vendor/xterm.js": ["public/vendor/xterm.js", "text/javascript"],
  "/vendor/xterm-fit.js": ["public/vendor/xterm-fit.js", "text/javascript"],
  "/vendor/xterm.css": ["public/vendor/xterm.css", "text/css"],
};
const staticAssetCache = new Map();
async function loadStaticAssets() {
  const loaded = await Promise.all(
    Object.entries(assets).map(async ([pathname, [file, type]]) => [
      pathname,
      { content: await fs.readFile(path.join(ROOT, file)), type },
    ]),
  );
  staticAssetCache.clear();
  for (const [pathname, entry] of loaded) staticAssetCache.set(pathname, entry);
}
export function createTokenBucketLimiter(
  ratePerSecond = 100,
  burst = 200,
  { maxBuckets = 10_000, idleMs = 10 * 60_000, cleanupEvery = 256 } = {},
) {
  maxBuckets = Math.max(1, Math.floor(Number(maxBuckets) || 10_000));
  idleMs = Math.max(1_000, Number(idleMs) || 10 * 60_000);
  cleanupEvery = Math.max(1, Math.floor(Number(cleanupEvery) || 256));
  const buckets = new Map();
  let operations = 0;
  return (key, now = Date.now()) => {
    key = String(key ?? "");
    operations += 1;
    if (operations % cleanupEvery === 0) {
      for (const [storedKey, bucket] of buckets) {
        if (now - bucket.lastSeen >= idleMs) buckets.delete(storedKey);
      }
    }
    let previous = buckets.get(key);
    if (previous) {
      // Map 的插入顺序作为 LRU；命中后移到末尾。
      buckets.delete(key);
    } else {
      previous = { tokens: burst, at: now, lastSeen: now };
      if (buckets.size >= maxBuckets) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey !== undefined) buckets.delete(oldestKey);
      }
    }
    const elapsed = Math.max(0, now - previous.at) / 1000;
    const tokens = Math.min(burst, previous.tokens + elapsed * ratePerSecond);
    const allowed = tokens >= 1;
    buckets.set(key, {
      tokens: allowed ? tokens - 1 : tokens,
      at: now,
      lastSeen: now,
    });
    return allowed;
  };
}
// CCDPH-FIX(A10-02): 静态资源与 /api/* **分桶**。原实现共用一个令牌桶且限流先于鉴权，
// 任何本地未授权进程刷 GET /style.css 就能把用户自己的 /api/* 挤成 429（实测 232 次即可
// 打空、打空后带令牌的 /api/state 立刻 429）。现在各自独立配额，刷静态不再挤占 API。
// 容量/速率等设计参数保持不变；API 的认证与未认证请求使用不同桶，彼此不再挤占。
const allowApiRequest = createTokenBucketLimiter();
const allowStaticRequest = createTokenBucketLimiter();
// 未认证请求使用独立小桶，避免同机其它进程刷 /api/* 消耗用户界面的认证配额。
const allowUnauthenticatedApiRequest = createTokenBucketLimiter(20, 40);
export function normalizeRateLimitKey(remoteAddress) {
  const normalized = String(remoteAddress || "").toLowerCase();
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(normalized)
    ? "loopback"
    : normalized || "unknown";
}
const routeWorkspaceIoDomain = createWorkspaceIoRoute({
  FILE_EXCLUDES,
  body,
  boundedText,
  closeSseClients,
  findFiles,
  getChanges,
  getPathOpener: () => pathOpener,
  getProjectInfo,
  git,
  gitChangesFailure,
  json,
  killProcessTree,
  readStableBoundedFile,
  requireObject,
  safePath,
  ssePending,
  startTerminal,
  terminalBroadcast,
  terminalProcessRegistry,
  terminalStartQueue,
  terminals,
  within,
  writeSseInitialFrame,
  workspaceRoot,
  writeSseClients,
});
const browserLifecycleDeps = {
  dataDir: DATA,
  browserStatus,
  dedicatedEdgeState,
  detectBrowsers,
  launchDedicatedEdge,
  stopDedicatedEdge,
};
const reconcileBrowserRuntime = (settings) =>
  reconcileDedicatedBrowser(settings, browserLifecycleDeps);
async function commitBrowserSettings(nextBrowser) {
  const previousBrowser = db.settings.browser;
  return withBrowserSettingsTransition({
    previous: previousBrowser,
    next: nextBrowser,
    reconcile: reconcileBrowserRuntime,
    commit: async (next) => {
      db.settings.browser = next;
      await save();
    },
    rollback: async (previous) => {
      db.settings.browser = previous;
    },
    onRollbackError: (error) =>
      console.error(
        "[ccdph] 恢复专用浏览器运行状态失败:",
        error?.message || error,
      ),
  });
}
const routeIntegrationDomain = createIntegrationRoute({
  DATA,
  MAX_HOOKS_PER_EVENT,
  SUPPORTED_HOOK_EVENTS,
  body,
  browserStatus,
  cdpEndpointFromSettings,
  commitBrowserSettings,
  credentialEnvKeyPattern: CREDENTIAL_ENV_KEY_RE,
  detectBrowsers,
  getDb: () => db,
  getExternalOpener: () => externalOpener,
  hooksCount,
  hooksWriteQueue,
  isValidPort,
  json,
  mcpWriteQueue,
  readJsonFile,
  readProjectJsonFileNoSymlink,
  readMcpDoc,
  readSettingsJsonStrict,
  requireObject,
  restoreRedactedHookCommands,
  sanitizeMcpEntry,
  serializeHooks,
  settingsJsonPath,
  settingsWriteQueue,
  validateHookItem,
  validateHooksStructure,
  workspaceRoot,
  writeMcpDoc,
  writeSettingsJson,
});
const routeWorkspaceMutationDomain = createWorkspaceMutationRoute({
  MAX_PROJECTS,
  armUpdateInstallGateTimer,
  body,
  checkForUpdate,
  getChanges,
  getDb: () => db,
  getFilePicker: () => filePicker,
  getFolderPicker: () => folderPicker,
  getPathOpener: () => pathOpener,
  git,
  installUpdate,
  json,
  listWorktrees,
  markGlobalHistoryBytesDirty,
  matchWorktree,
  redetectClaude,
  removeWorktreeOf,
  resolveAuthorizedWorktreeTarget,
  repoRootFor,
  requireObject,
  sanitizeError,
  save,
  sessionWriteQueue,
  updateRuntime,
  workspaceRoot,
  worktreeBaseDir,
});
const ROUTE_DOMAIN_HANDLERS = createRouteDomainHandlers({
  integration: routeIntegrationDomain,
  workspaceMutation: routeWorkspaceMutationDomain,
  session: routeSessionDomain,
  workspaceIo: routeWorkspaceIoDomain,
});
export function buildPublicStateSnapshot() {
  return {
    projects: db.projects,
    settings: publicSettings(),
    sessions: db.sessions.map(({ events, messages, ...s }) => s),
    claude: {
      configured: Boolean(claudePath),
      version: claudeVersion,
      error: claudeError,
    },
    apiAuthConfigured: Boolean(apiTokens[db.settings.activeProfileId]),
    apiAuthPersistence,
    apiAuthWarning,
    version: APP_VERSION,
  };
}
async function routeSessionDomain(req, res, url, pathname) {
  if (req.method === "POST" && pathname === "/api/sessions") {
    const input = requireObject(await body(req));
    return await sessionWriteQueue(async () => {
      const p = project(input.projectId);
      const id = randomUUID();
      const environment = input.environment === "worktree" ? "worktree" : "local";
      const cwd =
        environment === "worktree" ? await createWorktree(p, id) : p.path;
      let evictIds;
      try {
        evictIds = selectSessionEvictionsForNewSession();
      } catch (error) {
        if (environment === "worktree") {
          const abandoned = { projectId: input.projectId, environment, cwd };
          await removeWorktreeOf(abandoned).catch(() => { });
        }
        throw error;
      }
      const s = {
        id,
        projectId: input.projectId,
        title: "新会话",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        events: [],
        running: false,
        pinned: false,
        archived: false,
        environment,
        cwd,
        permissionMode: db.settings.defaultPermissionMode,
        model: db.settings.defaultModel,
        effort: db.settings.defaultEffort,
        providerId: currentProviderId(),
        engine: "claude",
        messages: [],
      };
      const previousSessions = db.sessions;
      const evict = new Set(evictIds);
      db.sessions = previousSessions.filter((item) => !evict.has(item.id));
      db.sessions.push(s);
      markGlobalHistoryBytesDirty();
      try {
        await save();
      } catch (error) {
        db.sessions = previousSessions;
        markGlobalHistoryBytesDirty();
        if (environment === "worktree") await removeWorktreeOf(s).catch(() => { });
        throw error;
      }
      const evictedSessions = previousSessions.filter((item) => evict.has(item.id));
      let removedWorktrees = 0;
      let keptWorktrees = 0;
      for (const oldSession of evictedSessions) {
        const result = await removeWorktreeOf(oldSession).catch(() => ({
          removed: 0,
          kept: 1,
        }));
        removedWorktrees += result.removed;
        keptWorktrees += result.kept;
      }
      if (evict.size)
        console.warn(
          `[ccdph] 会话总数达到上限（${MAX_SESSIONS}），创建新会话前已回收最旧的 ${evict.size} 个已归档会话` +
            (removedWorktrees || keptWorktrees
              ? `（worktree 已清理 ${removedWorktrees}，因未提交改动保留 ${keptWorktrees}）`
              : ""),
        );
      return json(res, s);
    });
  }
  if (req.method === "GET" && pathname === "/api/session") {
    const s = session(url.searchParams.get("id"));
    // CCDPH-FIX(F15): historyTruncated 此前只写不读（死字段），事件被上限丢弃时界面
    // 没有任何提示。这里随会话一起回传，供界面给出提示。
    // CCDPH-FIX(P1-SESSION-SIZE): 响应还必须按**字节**封顶。原来把 s.events 整段内联，
    // 一个 101 条 × ~92KB 事件的会话 ≈ 9–12MB，而前端对 raw.length > 5MB 的响应直接
    // 判为「服务返回了无法解析的数据」（public/app.js:303）→ 该会话永久打不开。
    // 这里只保留**最近的**整条记录（绝不切开一条事件），并把裁剪情况如实回传：
    //   eventsTruncated / omittedEvents  = 本次响应因体积裁剪（新信号）
    //   historyTruncated                 = 服务端历史上限命中过（语义不变，F15）
    const eventTail = tailWithinBudget(s.events, SESSION_EVENTS_BYTES_MAX);
    const messageTail = Array.isArray(s.messages)
      ? tailWithinBudget(
          s.messages,
          Math.max(0, SESSION_EVENTS_BYTES_MAX - eventTail.bytes),
        )
      : { items: null, bytes: 0, omitted: 0 };
    // CCDPH-FIX(LOW-4): 切片后不能以 role:"tool" 起头。trimMessagesByVolume 明确禁止这件事
    //（tool 消息的 tool_calls 配对在更早的 assistant 消息里），而 tailWithinBudget 没有这条
    // 规则 —— 返回给渲染端（以及未来的「从服务端转录续聊」路径）的就会是一份自相矛盾的
    // 历史。这里用同一条规则修正，并把因此丢掉的消息数并入 omittedMessages。
    if (messageTail.items?.length) {
      let start = 0;
      while (
        start < messageTail.items.length &&
        messageTail.items[start]?.role === "tool"
      )
        start++;
      // 与 trimMessagesByVolume 一致：全是 tool 消息时至少保留最后一条，绝不返回空数组
      if (start >= messageTail.items.length) start = messageTail.items.length - 1;
      if (start > 0) {
        messageTail.omitted += start;
        messageTail.items = messageTail.items.slice(start);
      }
    }
    return json(res, {
      ...s,
      events: eventTail.items,
      ...(messageTail.items ? { messages: messageTail.items } : {}),
      historyTruncated: Boolean(s.historyTruncated),
      eventsTruncated: eventTail.omitted > 0,
      omittedEvents: eventTail.omitted,
      messagesTruncated: messageTail.omitted > 0,
      omittedMessages: messageTail.omitted,
    });
  }
  if (req.method === "POST" && pathname === "/api/session/update") {
    const input = requireObject(await body(req));
    return await sessionWriteQueue(async () => {
      const s = session(input.sessionId);
      if (
        s.running &&
        ["model", "effort", "permissionMode", "providerId"].some(
          (key) => input[key] !== undefined,
        )
      )
        throw new Error("任务运行中请使用实时控制接口修改模型、权限或思考强度");
    // CCDPH-FIX(P2-5): 先改内存再写盘，写盘失败必须能回滚（见下方 try/catch）。
    const beforeUpdate = {
      title: s.title,
      pinned: s.pinned,
      archived: s.archived,
      model: s.model,
      providerId: s.providerId,
      effort: s.effort,
      permissionMode: s.permissionMode,
      updatedAt: s.updatedAt,
    };
    if (typeof input.title === "string") {
      const title = input.title.trim().slice(0, 80);
      if (!title) throw new Error("会话名称不能为空");
      s.title = title;
    }
    if (typeof input.pinned === "boolean") s.pinned = input.pinned;
    if (typeof input.archived === "boolean") s.archived = input.archived;
    // model 放宽到任意短字符串：供应商模式下会话可绑定自定义模型。
    // CCDPH-FIX(HIGH-2): 改用统一的 normalizeModel()，与 /api/send 同一口径。
    const nextModel = normalizeModel(input.model);
    if (nextModel !== null) s.model = nextModel;
    if (
      input.providerId === "cc-switch" ||
      (typeof input.providerId === "string" &&
        (db.settings.apiProfiles || []).some((p) => p.id === input.providerId))
    )
      s.providerId = input.providerId;
    if (
      ["inherit", "low", "medium", "high", "xhigh", "max"].includes(
        input.effort,
      )
    )
      s.effort = input.effort;
    if (PERMISSION_MODES.includes(input.permissionMode))
      s.permissionMode = input.permissionMode;
    s.updatedAt = Date.now();
    try {
      invalidateGlobalHistoryOrder();
      await save();
    } catch (error) {
      // CCDPH-FIX(P2-5): 原来先改内存再 `await save()`，写盘失败时接口回 400 但会话**已经
      // 被改**（内存与磁盘不一致：重启后表现为"刚改的东西莫名其妙回退/出现"）。这里回滚。
      Object.assign(s, beforeUpdate);
      invalidateGlobalHistoryOrder();
      throw error;
    }
      return json(res, s);
    });
  }
  if (req.method === "POST" && pathname === "/api/session/control") {
    const input = requireObject(await body(req));
    return await sessionWriteQueue(async () => {
      const s = session(input.sessionId);
      const run = runs.get(s.id);
      if (!run || !s.running)
        throw new Error("当前会话没有正在运行的任务");
      if (!run.query)
        throw new Error("Claude 正在初始化或本轮已经结束，请稍后再试");
      if (
        PERMISSION_MODES.includes(input.permissionMode) &&
        !canApplyPermissionModeLive(
          run.initialPermissionMode,
          input.permissionMode,
        )
      )
        throw new Error(
          "自动模式任务运行中无法切换到需要宿主确认的权限模式；请先停止任务，再修改权限模式",
        );
      if (
        input.permissionMode === "auto" &&
        s.permissionMode !== "auto" &&
        input.confirmAutoEscalation !== true
      )
        throw new Error("运行中切换到自动模式需要明确确认");

      const previous = {
        model: s.model,
        effort: s.effort,
        permissionMode: s.permissionMode,
        updatedAt: s.updatedAt,
      };
      const applied = [];
      try {
        if (["", "sonnet", "opus", "haiku"].includes(input.model)) {
          await run.query.setModel(input.model || undefined);
          s.model = input.model;
          applied.push("model");
        }
        if (
          ["inherit", "low", "medium", "high", "xhigh", "max"].includes(
            input.effort,
          )
        ) {
          await run.query.applyFlagSettings({
            effortLevel: input.effort === "inherit" ? null : input.effort,
          });
          s.effort = input.effort;
          applied.push("effort");
        }
        if (PERMISSION_MODES.includes(input.permissionMode)) {
          await run.query.setPermissionMode(input.permissionMode);
          s.permissionMode = input.permissionMode;
          applied.push("permissionMode");
        }
        s.updatedAt = Date.now();
        await save();
      } catch (error) {
        Object.assign(s, previous);
        let rollbackFailed = false;
        for (const field of applied.reverse()) {
          try {
            if (field === "permissionMode")
              await run.query.setPermissionMode(previous.permissionMode);
            else if (field === "effort")
              await run.query.applyFlagSettings({
                effortLevel:
                  previous.effort === "inherit" ? null : previous.effort,
              });
            else if (field === "model")
              await run.query.setModel(previous.model || undefined);
          } catch (rollbackError) {
            rollbackFailed = true;
            console.error(
              `[ccdph] 实时会话控制回滚失败（${field}）:`,
              rollbackError?.message || rollbackError,
            );
          }
        }
        if (rollbackFailed) {
          run.abort.abort();
          forceSettleRun(s.id, run, "实时设置回滚失败，任务已安全停止");
        }
        throw error;
      }
      // CCDPH-FIX(P2-3): 明确请求、但不在白名单内因而**没有应用**的字段必须如实回报。
      // 原实现无论是否应用都返回 liveApplied:true，前端据此提示"已更新"，用户以为
      // 自定义供应商模型 / 思考强度已切换，实际并未生效（UI 与服务端状态背离）。
      const rejected = [];
      if (input.model !== undefined && !applied.includes("model"))
        rejected.push("model");
      if (input.effort !== undefined && !applied.includes("effort"))
        rejected.push("effort");
      if (input.permissionMode !== undefined && !applied.includes("permissionMode"))
        rejected.push("permissionMode");
      return json(res, { session: s, liveApplied: rejected.length === 0, rejected });
    });
  }
  if (req.method === "POST" && pathname === "/api/session/delete") {
    const input = requireObject(await body(req));
    return await sessionWriteQueue(async () => {
      const s = session(input.sessionId);
      if (s.running) throw new Error("请先停止正在运行的任务");
      // CCDPH-FIX(P2-6): 先把记录从库中移除并**落盘**，再删 worktree 目录。
      // 原顺序相反：先 `removeWorktreeOf()`（删目录，**不可逆**）再 `await save()`，一旦写盘
      // 失败就回 400 而目录已经没了。现在写盘失败可原样回滚（目录未动）；目录删除失败只是
      // 留下一个可人工清理的垃圾目录。
      db.sessions = db.sessions.filter((item) => item.id !== s.id);
      markGlobalHistoryBytesDirty();
      try {
        await save();
      } catch (error) {
        db.sessions.push(s);
        markGlobalHistoryBytesDirty();
        throw error;
      }
      const worktree = await removeWorktreeOf(s).catch((error) => {
        console.error(
          "[ccdph] 会话已删除，但清理其 worktree 目录失败（可能残留）:",
          error?.message || error,
        );
        return { removed: 0, kept: 1 };
      });
      return json(res, { ok: true, worktree });
    });
  }
  if (req.method === "GET" && pathname === "/api/export") {
    const s = session(url.searchParams.get("id"));
    // CCDPH-FIX(HIGH-3): 导出是唯一没有字节预算的历史接口。实测 200 条 × 100KB 事件的
    // 会话会构造并回传 6,703,276 字节，而前端 api() 对 >5MiB 的响应直接判为
    // 「服务响应过大，已拒绝解析」→ 长会话的「导出 Markdown 对话记录」100% 失败，
    // 而且是在服务端已经把整段历史同步 join 完、json() 又把每个换行转义一遍之后。
    // 这里沿用 /api/session 的 tailWithinBudget：只保留最近的**整条**事件，
    // 并用同一套词汇（eventsTruncated / omittedEvents）如实回传裁剪情况。
    const eventTail = tailWithinBudget(s.events, EXPORT_EVENTS_BYTES_MAX);
    const lines = [`# ${s.title}`, ""];
    if (eventTail.omitted > 0)
      lines.push(
        `> 会话内容过长，已省略最早的 ${eventTail.omitted} 条记录（仅导出最近部分）。`,
        "",
      );
    for (const event of eventTail.items) {
      // CCDPH-FIX(LOW-8): 用户发言的标题原来是字面量 "## ?"（占位符残留），导出文档里
      // 每条用户消息都是一个问号，看起来像数据损坏。
      if (event.type === "user") lines.push("## 用户", "", event.text, "");
      if (event.type === "text") lines.push("## Claude", "", event.text, "");
      if (event.type === "tool") lines.push(`> 工具：${event.tool}`, "");
      if (event.type === "error") lines.push("## 错误", "", event.text, "");
    }
    return json(res, {
      text: lines.join("\n"),
      eventsTruncated: eventTail.omitted > 0,
      omittedEvents: eventTail.omitted,
    });
  }
  if (req.method === "POST" && pathname === "/api/send") {
    const input = requireObject(await body(req, SEND_BODY_BYTES));
    return await sessionWriteQueue(async () => {
      const s = session(input.sessionId);
    if (s.running) throw new Error("当前会话正在运行");
    if (!canStartAnotherRun(runs.size))
      return json(
        res,
        {
          error: `同时运行的任务已达上限（${MAX_CONCURRENT_RUNS}），请等待现有任务结束后重试`,
          activeRuns: runs.size,
          maxConcurrentRuns: MAX_CONCURRENT_RUNS,
        },
        429,
      );
    if (
      typeof input.prompt !== "string" ||
      !input.prompt.trim() ||
      input.prompt.length > 100000
    )
      throw new Error("请输入有效消息（不超过 100000 字）");
    if (!claudePath) throw new Error(claudeError);
    const prompt = input.prompt.trim();
    // CCDPH-FIX(MED-11): 预览缩略图还要按**本次请求的总量**封顶。原来只有单张 90 万字符
    // 的上限、最多 4 张 → 一次 /api/send 就能往 s.events 里塞 3.6MB base64；而 EVENTS_MAX_BYTES
    // 是 8MB/会话，两次这样的请求就会触发字符预算裁剪，把用户刚发出的对话一起裁掉，
    // 界面上只有一个 historyTruncated 标志，看不出原因。
    const MAX_IMAGE_BATCH_BYTES = 12 * 1024 * 1024;
    let imageBatchBytes = 0;
    let previewBudget = 256 * 1024;
    const images = Array.isArray(input.images)
      ? input.images.slice(0, 4).map((image) => {
        if (
          !image ||
          !/^image\/(png|jpeg|gif|webp)$/.test(image.type) ||
          typeof image.data !== "string"
        )
          throw new Error("图片格式或大小无效");
        // CCDPH-FIX(F6): 原先按 base64 字符数直接与 8MB 比较，但 base64 每 3 字节膨胀为
        // 4 字符，等于实际只放行了 6MiB。改为按解码后字节数判定，与前端
        // public/app.js 的 file.size > 8*1024*1024 口径一致。
        if (image.data.length > 12 * 1024 * 1024) throw new Error("图片数据过大");
        const decodedBytes = Buffer.from(image.data, "base64").length;
        if (decodedBytes > 8 * 1024 * 1024)
          throw new Error("单张图片不能超过 8 MB");
        imageBatchBytes += decodedBytes;
        if (imageBatchBytes > MAX_IMAGE_BATCH_BYTES)
          throw new Error("图片总大小不能超过 12 MB");
        const preview =
          typeof image.preview === "string" &&
            image.preview.length <= 900_000 &&
            image.preview.length <= previewBudget
            ? image.preview
            : "";
        previewBudget -= preview.length;
        return {
          name:
            typeof image.name === "string"
              ? image.name.slice(0, 120)
              : "image",
          type: image.type,
          data: image.data,
          preview,
        };
      })
      : [];
    if (!s.events.length && db.settings.autoNameSessions)
      s.title = prompt.slice(0, 32);
    const permissionMode = normalizePermissionMode(
      input.permissionMode,
      s.permissionMode || db.settings.defaultPermissionMode,
    );
    s.permissionMode = permissionMode;
    // CCDPH-FIX(HIGH-2/HIGH-3): 原来这里既不校验长度/字符集（实测能把 200000
    // 字符的 model 落盘），又在字段缺省时把已选模型改写成 ""（静默清空 ——
    // 实测 update 设成 sonnet 后，一次不带 model 的 send 就变回 ""）。
    // 现在非法或缺省一律保持原值不动。
    const nextModel = normalizeModel(input.model);
    if (nextModel !== null) s.model = nextModel;
    if (
      ["inherit", "low", "medium", "high", "xhigh", "max"].includes(
        input.effort,
      )
    )
      s.effort = input.effort;
    s.running = true;
    const run = {
      abort: new AbortController(),
      clients: new Set(),
      pending: new Map(),
      initialPermissionMode: permissionMode,
    };
    runs.set(s.id, run);
    armRunDeadlineTimer(run, () => {
      console.warn(`[ccdph] 会话 ${s.id} 的轮次超过硬上限，已强制结束`);
      run.abort.abort();
      forceSettleRun(s.id, run, "任务运行时间过长，已强制结束");
    });
    try {
      publish(s, {
        type: "user",
        text:
          typeof input.displayPrompt === "string" && input.displayPrompt.trim()
            ? input.displayPrompt.trim().slice(0, 100000)
            : prompt,
        images: images.map(({ name, type, preview }) => ({
          name,
          type,
          preview,
        })),
      });
    } catch (error) {
      clearRunTimers(run);
      s.running = false;
      runs.delete(s.id);
      throw error;
    }
    json(res, { ok: true });
    // CCDPH-FIX(F-01): 这两个 promise 是 void 出去的，必须挂上终结 handler ——
    // 任何逃出 finally 的异常都不能变成 unhandledRejection（会杀掉整个进程）。
    const onTurnRejected = (error) => {
      console.error("[ccdph] 轮次任务异常退出:", error?.message || error);
      const failed = runs.get(s.id);
      if (!failed) return; // 已被停止/硬截止看门狗强制收尾，禁止重复 done 与写盘
      clearRunTimers(failed);
      s.running = false;
      runs.delete(s.id);
      // 兜底释放还挂着的审批/提问 promise，避免它们永久 pending（用户必须点停止才能恢复）
      for (const pending of [...(failed?.pending.values() || [])])
        pending.finish({ behavior: "deny", message: "任务异常结束" });
      // CCDPH-FIX(MED-13): 与正常收尾 finally 的尾部对齐。这个 handler 存在的意义正是
      // 「异常逃出了 finally」（例如 notifier 抛错），原来它只复位 running / 删 run：
      // SSE 客户端永不 end、也永不发 done，EventSource 靠 15s 心跳一直挂着，界面永远停在
      // 「工作中」（前端只在 onerror 时才纠正状态，而这条流永远不会 error）。
      // 注意顺序：先 publish(done)（它按 run.clients 扇出），再关客户端。
      publish(s, { type: "done" });
      for (const client of [...(failed?.clients || [])]) {
        try {
          client.end();
        } catch { }
      }
      // CCDPH-FIX(F-01) 同款：本 promise 已被 void，写盘失败绝不能变成 unhandledRejection
      save().catch((err) =>
        console.error("[ccdph] 轮次异常收尾写盘失败:", err?.message || err),
      );
    };
      runTurn(s, prompt, s.model, permissionMode, images).catch(onTurnRejected);
      return;
    });
  }
  if (req.method === "GET" && pathname === "/api/events") {
    const s = session(url.searchParams.get("id"));
    const run = runs.get(s.id);
    if (run && run.clients.size >= SSE_MAX_CLIENTS_PER_RUN)
      return json(
        res,
        { error: `同一会话最多允许 ${SSE_MAX_CLIENTS_PER_RUN} 个事件流连接` },
        429,
      );
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    const snapshotTail = tailWithinBudget(s.events, SESSION_EVENTS_BYTES_MAX);
    const snapshot = `data: ${JSON.stringify({
      type: "snapshot",
      events: snapshotTail.items,
      running: s.running,
      historyTruncated: Boolean(s.historyTruncated),
      eventsTruncated: snapshotTail.omitted > 0,
      omittedEvents: snapshotTail.omitted,
    })}\n\n`;
    // CCDPH-FIX(MED-12): 先注册客户端，再写快照。原来顺序相反：快照内容取自 s.events
    // 之后才 run.clients.add(res)，两步之间 publish/broadcast 出去的事件只发给已注册的
    // 客户端 → 这个新连接永久缺那几条事件（前端只按 event.id 去重，补不回来），两个窗口
    // 的消息列表就此分叉。注册在前，流的顺序恒为「快照 → 增量」。
    // 不会重复投递：publish/broadcast 只按 run.clients 扇出，没有第二条发送路径；
    // 且本段没有 await，中途不可能插入别的 publish。
    if (run) run.clients.add(res);
    writeSseInitialFrame(run?.clients || new Set(), res, snapshot, Boolean(run));
    if (!run) return;
    const timer = setInterval(() => {
      writeSseClients(run.clients, ": heartbeat\n\n");
    }, 15000);
    const cleanup = () => {
      clearInterval(timer);
      run.clients.delete(res);
      ssePending.delete(res);
    };
    res.on("close", cleanup);
    res.on("error", cleanup);
    return;
  }
  if (req.method === "POST" && pathname === "/api/stop") {
    const input = requireObject(await body(req));
    // CCDPH-FIX(P2-12): 与 /api/send 共用同一把串行队列。此前 stop 不入队，用户"发送后立刻
    // 停止"时 stop 有机会赶在 send 注册 runs 之前执行 → runs.get 取不到、仍回 {ok:true}，
    // 任务其实照常运行（"停止失败伪装成功"）。send 的队列块在注册 runs 后立即返回、不 await
    // 整轮，所以 stop 入队不会阻塞中断能力。
    return await sessionWriteQueue(async () => {
      const run = runs.get(input.sessionId);
      if (run) {
        run.abort.abort();
        // CCDPH-FIX(A10-04): 停止看门狗。SDK 0.3.268 在 provider 停滞（如 TCP 黑洞：
        // 连接建立后永不应答）时，abortController.abort() 无法解开 runTurn 主循环的
        // for await —— 实测轮次 75s+ 卡在 running=true、SSE 不 end、重复 stop 无效。
        // 上游传输层问题应用层无法根治，但必须保证「用户点停止，会话一定在有限时间内
        // 恢复可用」：5s 后仍未自然收尾（runs 里还是这条）就强制收尾。
        if (!run.settleWatchdog) {
          run.settleWatchdog = setTimeout(() => {
            forceSettleRun(input.sessionId, run, "任务已停止");
          }, 5000);
          run.settleWatchdog.unref?.();
        }
      }
      return json(res, { ok: true });
    });
  }
  if (req.method === "POST" && pathname === "/api/approve") {
    const input = requireObject(await body(req)),
      s = session(input.sessionId);
    const pending = runs.get(s.id)?.pending.get(input.requestId);
    if (!pending) throw new Error("这项确认已失效");
    const updatedInput = { ...pending.input };
    if (pending.tool === "AskUserQuestion" && input.allow === true) {
      updatedInput.answers = normalizeApprovalAnswers(input.answers);
    }
    publish(s, {
      type: "approval_result",
      requestId: input.requestId,
      allowed: input.allow === true,
    });
    pending.finish(
      input.allow === true
        ? { behavior: "allow", updatedInput }
        : { behavior: "deny", message: "用户拒绝了本次操作" },
    );
    return json(res, { ok: true });
  }
  return json(res, { error: "接口不存在" }, 404);
}




async function route(req, res) {
  // CCDPH-FIX(R3-P3-15): 旧实现只读 `req.headers.host`，而 Node 遇到**重复 Host 头**时只取
  // 第一个 —— 于是 `Host: 127.0.0.1:<port>\r\nHost: evil.example` 能通过来源校验（实测 200）。
  // 同样，**绝对形式请求行**（`GET http://evil.example/api/... HTTP/1.1`）会被 Node 原样塞进
  // req.url，旧代码的 `new URL(req.url, origin)` 取的是 URL 里的 authority，等于绕过了 Host 校验。
  // 浏览器都不会发这两种请求（Host 是禁止头、请求行恒为 origin-form），所以这属纵深防御 ——
  // 但既然来源校验是这套本地服务的唯一信任边界，就把这两个口子也堵上。
  const hostOccurrences = (req.rawHeaders || [])
    .map((value, index) => ({ value, index }))
    .filter(({ index }) => index % 2 === 0)
    .filter(({ value }) => value.toLowerCase() === "host").length;
  if (
    req.headers.host !== `127.0.0.1:${port}` ||
    hostOccurrences > 1 || // 重复 Host 头一律拒绝
    /^(https?:)?\/\//i.test(req.url) || // 绝对形式请求行一律拒绝
    (req.headers.origin && req.headers.origin !== origin)
  )
    return json(
      res,
      { error: `来源不受信任；请使用 http://127.0.0.1:${port}，不要使用 localhost` },
      403,
    );
  const url = new URL(req.url, origin);
  const pathname = url.pathname;
  const domain = classifyRouteDomain(pathname);
  if (req.method === "GET" && pathname === "/favicon.ico") {
    res.writeHead(204);
    return res.end();
  }
  const isApi = domain !== "static";
  const limiterKey = normalizeRateLimitKey(req.socket.remoteAddress);
  const safeEq = (a, b) => {
    const ab = Buffer.from(String(a || ""));
    const bb = Buffer.from(String(b || ""));
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  };
  const cookies = Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([name, value]) => name && value)
      .map(([name, ...value]) => [name, value.join("=")]),
  );
  const authenticated =
    !isApi ||
    safeEq(req.headers["x-workbench-token"], token) ||
    safeEq(cookies[STREAM_AUTH_COOKIE], streamAuthToken);
  if (!authenticated) {
    if (!allowUnauthenticatedApiRequest(limiterKey)) {
      res.setHeader("Retry-After", "1");
      return json(res, { error: "请求过于频繁，请稍后重试" }, 429);
    }
    return json(res, { error: "请从桌面启动器打开工作台" }, 401);
  }
  const rateLimiter = isApi ? allowApiRequest : allowStaticRequest;
  if (!rateLimiter(limiterKey)) {
    res.setHeader("Retry-After", "1");
    return json(res, { error: "请求过于频繁，请稍后重试" }, 429);
  }
  if (req.method === "POST" && pathname === "/api/auth/session") {
    res.setHeader(
      "Set-Cookie",
      `${STREAM_AUTH_COOKIE}=${streamAuthToken}; HttpOnly; SameSite=Strict; Path=/api`,
    );
    return json(res, { ok: true });
  }
  if (req.method === "GET" && pathname === "/api/state")
    return json(res, buildPublicStateSnapshot());
  if (req.method === "GET" && pathname === "/api/provider-usage")
    return json(
      res,
      await getCCSwitchUsage(url.searchParams.get("refresh") === "1"),
    );
  if (req.method === "GET" && pathname === "/api/integrations") {
    let root = "";
    try {
      if (url.searchParams.get("projectId"))
        root = workspaceRoot(
          url.searchParams.get("projectId"),
          url.searchParams.get("sessionId"),
        );
    } catch (error) {
      // CCDPH-FIX(P3-35): 原来静默吞掉 —— 传非法/越界 projectId 时会**静默回落到全局范围**
      //（root=""）并照常返回信息，调用方无错可查。
      console.warn(
        "[ccdph] 解析 integrations 的项目根失败，已回落为全局范围:",
        error?.message || error,
      );
    }
    return json(res, await getIntegrationInfo(root));
  }
  if (req.method === "GET" && pathname === "/api/skills") {
    let root = "";
    try {
      if (url.searchParams.get("projectId"))
        root = workspaceRoot(
          url.searchParams.get("projectId"),
          url.searchParams.get("sessionId"),
        );
    } catch { }
    return json(res, {
      skills: await listSkills(root, url.searchParams.get("q") || ""),
    });
  }
  if (req.method === "POST" && pathname === "/api/settings") {
    const input = requireObject(await body(req));
    return await settingsWriteQueue(async () => {
      const previousSettings = db.settings;
      // CCDPH-FIX(R3-P2-4): 这里构建的克隆只用于**与浏览器运行时协商**（reconcile 需要知道
      // 目标值），真正的提交发生在 commit 里、并会以提交时刻的 db.settings 为基底重建。
      const negotiated = buildNextSettings(input, previousSettings);
      const migrateToCcSwitch = input.apiMode === "cc-switch";
      const sessionMetadata = migrateToCcSwitch
        ? db.sessions.map((s) => ({
            session: s,
            providerId: s.providerId,
            model: s.model,
            updatedAt: s.updatedAt,
          }))
        : [];
      await withBrowserSettingsTransition({
        previous: previousSettings.browser,
        next: negotiated.browser,
        reconcile: reconcileBrowserRuntime,
        commit: async () => {
          // CCDPH-FIX(R3-P2-4): `await reconcileBrowserRuntime()` 可能启停 Edge（秒级 I/O）。
          // 在这段时间里仍然可以发生**不经过 settingsWriteQueue** 的写入 —— 最典型的是
          // recordDailyUsage（轮次结果消息里直接改 db.settings.usageDaily）。
          // 旧实现把 await 之前构建的克隆整体赋回 db.settings，于是那些并发更新被静默丢掉
          // （实测：用量图表少记一次；settings 保存越慢越容易丢）。
          // 现在以**提交时刻**的 db.settings 为基底重建，只把本次协商过的 browser 段覆盖回去；
          // 本次请求要改的字段仍由 buildNextSettings(input, ...) 从 input 取，语义不变。
          const committed = buildNextSettings(input, db.settings);
          committed.browser = negotiated.browser;
          db.settings = committed;
          if (migrateToCcSwitch) migrateSessionsTo("cc-switch", "");
          await save();
        },
        rollback: async () => {
          db.settings = previousSettings;
          for (const before of sessionMetadata) {
            before.session.providerId = before.providerId;
            before.session.model = before.model;
            before.session.updatedAt = before.updatedAt;
          }
        },
        onRollbackError: (error) =>
          console.error(
            "[ccdph] 设置回滚后恢复专用浏览器失败:",
            error?.message || error,
          ),
      });
      if (db.settings.apiMode !== previousSettings.apiMode)
        invalidateProviderUsageCache();
      if (db.settings.claudeExecutable !== previousSettings.claudeExecutable)
        setImmediate(() => void redetectClaude());
      return json(res, {
        ...publicSettings(),
        apiAuthConfigured: Boolean(apiTokens[db.settings.activeProfileId]),
        apiAuthPersistence,
        apiAuthWarning,
      });
    });
  }
  // ---- 多供应商配置 ----
  if (req.method === "GET" && pathname === "/api/api-profiles")
    return json(res, {
      mode: db.settings.apiMode,
      activeProfileId: db.settings.activeProfileId || "",
      currency: activeProfileCurrency(),
      persistence: apiAuthPersistence,
      warning: apiAuthWarning,
      // CCDPH-FIX(MED-1): 走与 publicSettings() 完全相同的凭据过滤
      profiles: (db.settings.apiProfiles || []).map((p) => ({
        ...publicProfile(p),
        hasKey: Boolean(apiTokens[p.id]),
      })),
    });
  if (req.method === "GET" && pathname === "/api/usage-daily") {
    const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 14, 7), 60);
    const bucket = db.settings.usageDaily || {};
    const list = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86400000);
      const key = date.toLocaleDateString("sv-SE");
      const entry = bucket[key] || {};
      list.push({
        date: key,
        requests: entry.requests || 0,
        cost: entry.cost || 0,
        costUsd: entry.costUsd || 0,
        costCny: entry.costCny || 0,
        inputTokens: entry.inputTokens || 0,
        outputTokens: entry.outputTokens || 0,
      });
    }
    return json(res, {
      days: list,
      // profile 模式带配置的货币；cc-switch 模式留空，由前端按余额 unit 推断
      currency: activeProfileCurrency(),
    });
  }
  if (req.method === "POST" && pathname === "/api/api-profiles/save") {
    const input = requireObject(await body(req));
    const name = String(input.name || "").trim().slice(0, 60);
    const baseUrl = String(input.baseUrl || "")
      .trim()
      .slice(0, 300)
      .replace(/\/+$/, "");
    if (!name) throw new Error("请填写供应商名称");
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl))
      throw new Error("API 地址必须是 http(s) 链接");
    try {
      new URL(baseUrl);
    } catch {
      throw new Error("API 地址格式不正确");
    }
    if (!/^https:\/\//i.test(baseUrl) && !isLoopbackUrl(baseUrl))
      throw new Error(
        "API 地址必须使用 https（本机测试源可用 127.0.0.1 / localhost）",
      );
    const env = {};
    if (input.env && typeof input.env === "object" && !Array.isArray(input.env)) {
      for (const [key, value] of Object.entries(input.env)) {
        if (!/^ANTHROPIC_[A-Z0-9_]+$/.test(key))
          throw new Error(
            `环境变量名不合法：${key}（仅允许 ANTHROPIC_ 前缀的大写变量）`,
          );
        // CCDPH-FIX(F-13): 凭据只能进 DATA/api-auth.json（见文件上方的不变量：
        // 「密钥按 profileId 存 api-auth.json，绝不放进 db.settings，也就绝不会回传给
        // 页面」）。profile.env 是**非密**透传通道，一旦接受 ANTHROPIC_AUTH_TOKEN /
        // ANTHROPIC_API_KEY，明文就会落进 state.json 并被 /api/state 原样回传。
        if (CREDENTIAL_ENV_KEY_RE.test(key))
          throw new Error(
            `${key} 属于密钥字段，请用「密钥」输入框保存（密钥存 api-auth.json，不会写进 state.json）`,
          );
        if (typeof value !== "string" || value.length > 500)
          throw new Error("环境变量值必须是 500 字以内的字符串");
        if (value) env[key] = value;
      }
    }
    // 计价货币：额度与成本按供应商实际计价货币显示（CNY 显示 ¥，USD 显示 $）
    const currency = input.currency === "USD" ? "USD" : "CNY";
    // CCDPH-FIX(LOW-10): 整段「读-改-写」进 profileWriteQueue 串行化。原来它带着
    // await save() 裸跑：两个并发请求（设置面板会背靠背发多个请求）会各自基于自己的
    // profiles 快照重建数组，后写的一方把对方的改动整段覆盖掉 —— 接口回 200，改动却丢了。
    // 与 MCP / hooks 路径同一把 makeSerialQueue 工具。
    const result = await profileWriteQueue(async () => {
      const list = db.settings.apiProfiles || [];
      let profile = input.id ? list.find((p) => p.id === input.id) : null;
      if (profile) {
        profile.name = name;
        profile.baseUrl = baseUrl;
        profile.env = env;
        profile.currency = currency;
      } else {
        if (list.length >= 20) throw new Error("供应商数量已达上限（20）");
        profile = { id: randomUUID(), name, baseUrl, env, currency };
        list.push(profile);
      }
      db.settings.apiProfiles = list;
      await save();
      invalidateProviderUsageCache();
      // CCDPH-FIX(MED-1): 回包里同样不允许带出 profile.env 里的历史凭据
      return { ...publicProfile(profile), hasKey: Boolean(apiTokens[profile.id]) };
    });
    return json(res, result);
  }
  if (req.method === "POST" && pathname === "/api/api-profiles/activate") {
    const input = requireObject(await body(req));
    return await profileWriteQueue(async () => {
      const profile = (db.settings.apiProfiles || []).find(
        (p) => p.id === input.id,
      );
      if (!profile) throw new Error("供应商配置不存在");
      // CCDPH-FIX(P2-7): 先记录可回滚快照。原实现改完 apiMode/activeProfileId、迁移完会话
      // 才 `await save()`，写盘失败时接口回 400，但本进程已经按新供应商发请求（内存与磁盘不一致）。
      const beforeActivate = {
        apiMode: db.settings.apiMode,
        activeProfileId: db.settings.activeProfileId,
        sessions: db.sessions.map((s) => ({
          session: s,
          providerId: s.providerId,
          model: s.model,
          updatedAt: s.updatedAt, // CCDPH-FIX(P3-17b): migrateSessionsTo 也会改 updatedAt
        })),
      };
      db.settings.apiMode = "profile";
      db.settings.activeProfileId = profile.id;
      const migrated = migrateSessionsTo(
        profile.id,
        profile.env?.ANTHROPIC_MODEL || "",
      );
      try {
        await save();
      } catch (error) {
        db.settings.apiMode = beforeActivate.apiMode;
        db.settings.activeProfileId = beforeActivate.activeProfileId;
        for (const item of beforeActivate.sessions) {
          item.session.providerId = item.providerId;
          item.session.model = item.model;
          item.session.updatedAt = item.updatedAt;
        }
        invalidateProviderUsageCache();
        throw error;
      }
      invalidateProviderUsageCache();
      return json(res, {
        ok: true,
        mode: "profile",
        activeProfileId: profile.id,
        migratedSessions: migrated,
      });
    });
  }
  if (req.method === "POST" && pathname === "/api/api-profiles/key") {
    const input = requireObject(await body(req));
    if (typeof input.token !== "string" || input.token.length > 2000)
      throw new Error("密钥格式不正确");
    // CCDPH-FIX(LOW-10): profile 的存在性判定与密钥写入必须在同一段串行区里 ——
    // 原来「先查 profile、再 await saveProfileToken」，中间并发的 delete 就能让它给一个
    // 已删除的 profile 写回密钥（api-auth.json 里留下孤儿凭据）。
    const result = await profileWriteQueue(async () => {
      const profile = (db.settings.apiProfiles || []).find(
        (p) => p.id === input.id,
      );
      if (!profile) throw new Error("供应商配置不存在");
      const storage = await saveProfileToken(profile.id, input.token.trim());
      invalidateProviderUsageCache();
      return {
        ok: true,
        hasKey: Boolean(apiTokens[profile.id]),
        persistent: storage?.persistent === true,
        warning: apiAuthWarning,
      };
    });
    return json(res, result);
  }
  if (req.method === "POST" && pathname === "/api/api-profiles/delete") {
    const input = requireObject(await body(req));
    // CCDPH-FIX(LOW-10): 删除同样是「读-改-写 + await」，进同一把串行队列
    const result = await profileWriteQueue(async () => {
      const before = db.settings.apiProfiles || [];
      const previousActiveProfileId = db.settings.activeProfileId;
      const previousApiMode = db.settings.apiMode;
      const profile = before.find((p) => p.id === input.id);
      if (!profile) throw new Error("供应商配置不存在");
      db.settings.apiProfiles = before.filter((p) => p.id !== input.id);
      // CCDPH-FIX(F-05): 删除密钥同样不能吞掉写盘失败 —— 否则接口回 {ok:true}，
      // 而 api-auth.json 里那份「已删除」的凭据其实还在（对凭据来说这是更糟的 fail-open）。
      const previousToken = apiTokens[profile.id];
      delete apiTokens[profile.id];
      let authWritten = false;
      try {
        await writeApiAuth();
        authWritten = true;
        if (db.settings.activeProfileId === profile.id) {
          db.settings.activeProfileId = "";
          db.settings.apiMode = "cc-switch";
        }
        await save();
      } catch (error) {
        db.settings.apiProfiles = before;
        db.settings.activeProfileId = previousActiveProfileId;
        db.settings.apiMode = previousApiMode;
        if (previousToken !== undefined) apiTokens[profile.id] = previousToken;
        if (authWritten)
          await writeApiAuth().catch((rollbackError) =>
            console.error(
              "[ccdph] 删除供应商失败后的密钥文件回滚失败:",
              rollbackError?.message || rollbackError,
            ),
          );
        throw authWritten ? error : apiAuthFailure(error, "密钥删除");
      }
      invalidateProviderUsageCache();
      return { ok: true };
    });
    return json(res, result);
  }
  if (req.method === "POST" && pathname === "/api/reveal-data") {
    if (!pathOpener) throw new Error("仅桌面版支持打开数据目录");
    await pathOpener(DATA);
    return json(res, { ok: true });
  }
  if (req.method === "POST" && pathname === "/api/reveal-claude-config") {
    if (!pathOpener) throw new Error("仅桌面版支持打开 Claude 配置目录");
    await fs.mkdir(CLAUDE_CONFIG_DIR, { recursive: true });
    await pathOpener(CLAUDE_CONFIG_DIR);
    return json(res, { ok: true });
  }
  const domainHandler = ROUTE_DOMAIN_HANDLERS[domain];
  if (domainHandler) return await domainHandler(req, res, url, pathname);
  if (domain !== "static")
    return json(res, { error: "接口不存在" }, 404);
  // CCDPH-FIX(LOW-2): 静态资源同时接受 HEAD（Node 会自动丢弃 HEAD 的响应体）。
  // 原来 HEAD 走不到这里，对一个存在的 GET 路由返回 404。
  if (req.method !== "GET" && req.method !== "HEAD")
    return json(res, { error: "接口不存在" }, 404);
  // CCDPH-FIX(LOW-11): assets 已提到模块作用域（原来逐请求重建这张 12 项的表）
  if (!assets[pathname]) return json(res, { error: "页面不存在" }, 404);
  const cached = staticAssetCache.get(pathname);
  if (!cached) throw new Error("静态资源缓存未就绪");
  const { content, type } = cached;
  res.writeHead(200, {
    "Content-Type": type + "; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    // CCDPH-FIX(P0-CSP): xterm.js 运行时会注入 3 个 <style> 元素，原来的
    // style-src 'self' 会把它们全部拦掉（sheet === null + 26 条 style-src-elem 违规），
    // 终端因此退化成比例字体。这里只放开 <style> **元素**：
    //   - style-src-elem 'self' 'unsafe-inline' 允许 xterm 注入的样式表；
    //   - 没有单独声明 style-src-attr，内联 style="..." **属性**仍回退到
    //     style-src 'self' 被拦截 —— XSS 真正依赖的正是属性向量；
    //   - 页面自身的 <style> 块已被 index.html 清空，脚本来源仍是 'self'，
    //     所以实际放开面只有「本站脚本能插入样式表」。
    // 其余指令一律不动。
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; style-src-elem 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  });
  res.end(content);
}
export async function start() {
  await fs.mkdir(DATA, { recursive: true });
  // 所有启动入口都必须先清扫异常退出残留的专用 Edge。清扫失败时拒绝启动，
  // 不能让状态显示 attach/disabled 而旧的无鉴权 CDP 端口仍在后台运行。
  await sweepStaleDedicatedEdge();
  foldedStateBackupPending = null;
  globalHistoryBytes = 0;
  globalHistoryBytesDirty = true;
  await terminalProcessRegistry.sweep().catch((error) =>
    console.warn("[ccdph] 清理异常退出终端失败:", error?.message || error),
  );
  const stateFile = path.join(DATA, "state.json");
  // CCDPH-FIX(P3-13): 启动时顺带清理过期的 .corrupt-* / .oversize-* 隔离备份
  //（必须放在 stateFile 定义之后，否则会命中 TDZ）。
  await cleanupStateQuarantineBackups(stateFile).catch((error) =>
    console.warn("[ccdph] 清理过期隔离备份失败:", error?.message || error),
  );
  db = { projects: [], sessions: [], settings: structuredClone(DEFAULT_SETTINGS) };
  // CCDPH-FIX(A10-19): 读路径的**字节前置门**。在任何全量载入/遍历/裁剪判定之前先取文件大小，
  // 便于记录并走「降级载入 + 裁剪」，而不是让超大文件在判定前把内存吃爆。
  //（原实现读路径完全没有字节门，只有写路径 :309 有 maxBytes。）
  let stateFileBytes = 0;
  let loadedStateFolded = false;
  try {
    stateFileBytes = (await fs.stat(stateFile)).size;
  } catch (error) {
    // CCDPH-FIX(P3-26): 只有 ENOENT 是"首次启动/没有数据档"的正常情况。其他错误
    //（EACCES/EBUSY/EIO）若静默吞掉，stateFileBytes 会保持 0 从而**绕过下面的字节前置门**，
    // 超大档会在没有体积门的情况下进入全量载入。这里至少留下可查的日志。
    if (error?.code !== "ENOENT")
      console.warn(
        "[ccdph] 读取 state.json 体积失败，本次跳过字节前置门:",
        error?.message || error,
      );
  }
  let oversizedBackup = null;
  if (stateFileBytes > MAX_STATE_BYTES) {
    oversizedBackup = await quarantineOversizedStateFile(
      stateFile,
      stateFileBytes,
      MAX_STATE_BYTES,
    );
    console.error(
      `[ccdph] state.json 体积 ${stateFileBytes} 字节，超过安全读取上限 ${MAX_STATE_BYTES}；` +
        `已在读取前原子隔离为 ${oversizedBackup}，本次以空白会话数据启动。`,
    );
  }
  if (!oversizedBackup) {
    try {
      // JSON.parse、深状态折叠和复杂度扫描都可能在满载状态库上持续数秒；移入独立 worker，
      // 避免 Electron 主进程在启动期间被同步 CPU 工作完全占住。
      const { parsed, foldedState, complexity } = await loadStateOffThread(stateFile);
      loadedStateFolded = foldedState.changed;
      if (foldedState.changed) {
        foldedStateBackupPending = {
          source: stateFile,
          target: `${stateFile}.folded-${Date.now()}`,
        };
        console.warn(
          `[ccdph] state.json 含 ${foldedState.folded} 个不可安全序列化的超深子树，已局部折叠。`,
        );
      }
      // CCDPH-FIX(A10-17): 复杂度只做**非致命诊断** ——「只是太大」≠「已损坏」。
    // 越界仅记录日志，随后由 enforceGlobalHistoryBudget（字节口径）裁剪；绝不并入下面的
    // 损坏备份/空白启动分支。原实现把 assertStateComplexity 当致命判据，导致合法重度库被误杀。
    if (
      complexity.nodes > STATE_MAX_NODES ||
      complexity.maxDepth > STATE_CONTENT_MAX_DEPTH
    )
      console.warn(
        `[ccdph] state.json 规模较大（对象/数组节点 ${complexity.nodes}，相对最大深度 ${complexity.maxDepth}），` +
          "已按非致命处理：仅按内容预算裁剪，不判损坏。",
      );
      db = parsed;
    } catch (error) {
      if (error.code === "ENOENT") {
        // 首次启动没有旧数据，直接用默认值
      } else if (error.code) {
        // CCDPH-FIX(R2-P2-3): 带 errno（EACCES/EBUSY/EAGAIN/ETIMEDOUT…）说明是**读取失败**，
        // 而不是内容损坏。旧实现把两者混在一起，会把一个**完好**的 state.json 改名成
        // .corrupt-* 并空白启动，用户以为丢档。现在：原文件不动、暂停写入、如实告知。
        stateWritesBlocked = true;
        const readFailureText =
          `会话数据读取失败：${error.message}（${error.code}）\n` +
          `原文件未被改动，仍保留在：${stateFile}\n` +
          "为避免用空白数据覆盖它，本次运行已暂停保存（读取与浏览仍可用）。\n" +
          "请关闭可能占用该文件的程序（杀毒 / 同步 / 索引器）后重启应用。\n";
        console.error(
          `[ccdph] 会话数据读取失败（${error.code}），原文件保持不动、已暂停保存。`,
        );
        await fs
          .writeFile(
            path.join(DATA, "state.json.corrupt-readme.txt"),
            readFailureText,
            "utf8",
          )
          .catch((readmeError) =>
            console.error(
              "[ccdph] 写入读取失败说明失败:",
              readmeError?.message || readmeError,
            ),
          );
      } else {
        // 内容损坏：改名隔离后以空白数据启动。隔离**失败**时绝不能继续写盘，
        // 否则之后任意一次 save() 都会覆盖掉恢复说明里承诺保留的原文件。
        const backup = `${stateFile}.corrupt-${Date.now()}`;
        let isolated = false;
        try {
          await fs.rename(stateFile, backup);
          isolated = true;
        } catch (backupError) {
          console.error(
            "[ccdph] 损坏会话数据无法原子隔离，原文件仍保留:",
            backupError?.message || backupError,
          );
        }
        // CCDPH-FIX(R2-P2-3): 隔离失败 = 原文件还在原地。此时若允许写盘，之后任意一次
        // save() 都会把它覆盖掉，恢复说明里「原文件仍保留」的承诺就成了空话。
        if (!isolated) stateWritesBlocked = true;
        const recoveryText = isolated
          ? `会话数据读取失败：${error.message}\n原文件已备份为：${backup}\n应用已用默认（空白）会话数据启动。\n`
          : `会话数据读取失败：${error.message}\n原文件未能改名隔离，仍保留在：${stateFile}\n应用已用默认（空白）会话数据启动；请先关闭占用该文件的程序后重试。\n`;
        console.error(
          `[ccdph] 会话数据读取失败（${error.message}），${isolated ? `已备份为 ${backup}` : "原文件未能隔离"}，本次以空白会话数据启动。`,
        );
        await fs
          .writeFile(
            path.join(DATA, "state.json.corrupt-readme.txt"),
            recoveryText,
            "utf8",
          )
          .catch((readmeError) =>
            console.error("[ccdph] 写入损坏数据恢复说明失败:", readmeError?.message || readmeError),
          );
      }
    }
  }
  db.projects = Array.isArray(db.projects) ? db.projects : [];
  db.sessions = Array.isArray(db.sessions) ? db.sessions : [];
  // CCDPH-FIX(LOW-3): 深拷贝默认值。原来是浅展开 `{ ...DEFAULT_SETTINGS, ...(db.settings || {}) }`
  // —— state.json 里缺 browser / apiProfiles / usageDaily / shortcuts 时，db.settings.X
  // 就是**模块级模板对象本身**，随后 migrateApiProfiles 的 push、recordDailyUsage 往
  // usageDaily 写桶、/api/settings 改 browser 都会永久污染模板：模块里的「默认值」从此
  // 等于「本进程已经改过的值」，任何重置/第二次 start() 都会把旧设置复活。
  db.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(db.settings || {}) };
  for (const key of [
    "dsApiKey",
    "dsProfiles",
    "dsActiveId",
    "dsBaseUrl",
    "dsModel",
    "dsPriceIn",
    "dsPriceOut",
    "dsHistoryLimit",
  ])
    delete db.settings[key];
  db.settings.browser = {
    ...structuredClone(DEFAULT_SETTINGS.browser),
    ...(db.settings.browser &&
    typeof db.settings.browser === "object" &&
    !Array.isArray(db.settings.browser)
      ? db.settings.browser
      : {}),
  };
  db.settings.apiProfiles = Array.isArray(db.settings.apiProfiles)
    ? db.settings.apiProfiles
    : [];
  db.settings.shortcuts =
    db.settings.shortcuts &&
    typeof db.settings.shortcuts === "object" &&
    !Array.isArray(db.settings.shortcuts)
      ? db.settings.shortcuts
      : {};
  db.settings.usageDaily =
    db.settings.usageDaily &&
    typeof db.settings.usageDaily === "object" &&
    !Array.isArray(db.settings.usageDaily)
      ? db.settings.usageDaily
      : {};
  normalizeLoadedSettings(db.settings);
  db.settings.engine = "claude";
  if (db.sessions.length > MAX_SESSIONS)
    console.warn(
      `[ccdph] 检测到 ${db.sessions.length} 个历史会话，超过当前上限 ${MAX_SESSIONS}；` +
        "为避免数据丢失，本次不会自动删除任何未归档会话。请先在界面中归档或删除旧会话。",
    );
  await loadApiAuth();
  const migratedApiProfiles = migrateApiProfiles();
  if (migratedApiProfiles || apiAuthNeedsRewrite) {
    try {
      await writeApiAuth();
    } catch (error) {
      console.error(
        "[ccdph] 旧版密钥迁移失败，正在降级为仅本次运行可用:",
        error?.message || error,
      );
      credentialProtector = null;
      apiAuthPersistence = "session";
      apiAuthWarning =
        "旧版密钥未能写入系统安全存储；本次运行仍可使用，退出后需要重新输入";
      apiAuthLockedError = "";
      apiAuthNeedsRewrite = false;
      try {
        await fs.rm(API_AUTH_FILE, { force: true });
      } catch (removeError) {
        apiTokens = {};
        apiAuthPersistence = "locked";
        apiAuthLockedError = "旧版明文密钥无法安全移除";
        apiAuthWarning =
          "旧版密钥迁移失败且原文件无法移除；密钥已从内存清空，请检查数据目录权限";
        console.error(
          "[ccdph] 无法移除旧版明文密钥文件:",
          removeError?.message || removeError,
        );
      }
    }
    if (migratedApiProfiles) {
      await save().catch((error) =>
        console.error(
          "[ccdph] 启动迁移结果暂未写回，仍将继续启动:",
          error?.message || error,
        ),
      );
      invalidateProviderUsageCache();
    }
  }
  db.settings.defaultPermissionMode = normalizePermissionMode(
    db.settings.defaultPermissionMode,
  );
  let normalizedSessionState = loadedStateFolded;
  for (let sessionIndex = 0; sessionIndex < db.sessions.length; sessionIndex += 1) {
    const s = db.sessions[sessionIndex];
    s.engine = "claude";
    // CCDPH-FIX(P3-14): 载入的 s.model 此前未过 normalizeModel()，被篡改的 state.json 可把
    // 任意长度/字符的模型名直接交给 SDK 并回写。这里与 /api/send、/api/session/update 同口径。
    {
      const normalizedLoadedModel = normalizeModel(s.model);
      if (normalizedLoadedModel !== null) s.model = normalizedLoadedModel;
    }
    s.environment ||= "local";
    let linkedProject = null;
    try {
      linkedProject = project(s.projectId);
    } catch { }
    if (s.environment === "worktree") {
      const expectedBase = linkedProject ? worktreeBaseDir(linkedProject.path) : "";
      const authorized = expectedBase
        ? await resolveAuthorizedWorktreeTarget(s.cwd, expectedBase)
        : null;
      if (!authorized) {
        console.warn(
          `[ccdph] 会话 ${String(s.id || "").slice(0, 80)} 的 worktree 路径越界或项目失效，已降级为 local`,
        );
        s.environment = "local";
        s.cwd = linkedProject?.path || "";
        if (!linkedProject) s.archived = true;
        normalizedSessionState = true;
      } else if (s.cwd !== authorized.target) {
        s.cwd = authorized.target;
        normalizedSessionState = true;
      }
    } else {
      // local 会话的工作目录只能来自已登记项目，不信任 state.json 中可被篡改的 cwd。
      const safeLocalCwd = linkedProject?.path || "";
      if (s.cwd !== safeLocalCwd) {
        s.cwd = safeLocalCwd;
        normalizedSessionState = true;
      }
      if (!linkedProject) s.archived = true;
    }
    s.permissionMode = normalizePermissionMode(
      s.permissionMode,
      db.settings.defaultPermissionMode,
    );
    s.model = typeof s.model === "string" ? s.model : db.settings.defaultModel;
    s.effort = ["inherit", "low", "medium", "high", "xhigh", "max"].includes(
      s.effort,
    )
      ? s.effort
      : db.settings.defaultEffort;
    s.pinned = Boolean(s.pinned);
    s.archived = Boolean(s.archived);
    const loadedEvents = Array.isArray(s.events) ? s.events : [];
    let eventsChanged = !Array.isArray(s.events);
    let loadedEventBytes = 0;
    const normalizedEvents = loadedEvents.map((item) => {
      const prepared = prepareEventForStorage(item);
      loadedEventBytes += prepared.bytes;
      eventBytesByItem.set(prepared.event, prepared.bytes);
      if (prepared.changed) eventsChanged = true;
      return prepared.event;
    });
    if (eventsChanged) normalizedSessionState = true;
    s.events = normalizedEvents;
    const wasRunning = Boolean(s.running);
    if (wasRunning) {
      s.running = false;
      s.events.push({
        id: randomUUID(),
        time: Date.now(),
        type: "stopped",
        text: "上次运行因工作台关闭而中断",
      });
    }
    // CCDPH-FIX(MED-9): 在这里就把「已用字符总量」种进 eventBytesBySession。它是 WeakMap，
    // 从 state.json 载入的会话没有条目，于是重启后对该会话的**第一条** publish 会把整段
    // 历史（最坏 ~8MB 字符）重新 stringify 一遍，正好卡在首轮回复的开头。
    // 必须在上面那条补偿事件 push 之后种，保证账目与 s.events 一致。
    // 正常载入事件只序列化一次；仅上方补写了“上次运行中断”事件时额外量这一条。
    if (wasRunning) {
      const interruptedEvent = s.events[s.events.length - 1];
      const interruptedBytes = eventSize(interruptedEvent);
      eventBytesByItem.set(interruptedEvent, interruptedBytes);
      loadedEventBytes += interruptedBytes;
    }
    setEventBytesForSession(s, loadedEventBytes);
    const loadedMessages = Array.isArray(s.messages) ? s.messages : [];
    s.messages = trimMessagesByVolume(loadedMessages);
    if (s.messages.length !== loadedMessages.length) normalizedSessionState = true;
    setMessageBytesForSession(
      s,
      s.messages.reduce((sum, item) => sum + messageSize(item), 0),
    );
    // 大状态库启动规范化按批次让出事件循环，避免数百会话的逐事件计量形成单次长任务。
    if (sessionIndex > 0 && sessionIndex % 8 === 0)
      await new Promise((resolve) => setImmediate(resolve));
  }
  globalHistoryBytesDirty = false;
  if (enforceGlobalHistoryBudget()) normalizedSessionState = true;
  if (normalizedSessionState)
    await save().catch((error) =>
      console.error(
        "[ccdph] 启动规范化结果暂未写回，仍将继续启动；原 state.json 保持不变:",
        error?.message || error,
      ),
    );
  // 静态资源在启动时一次读入，请求热路径不再反复触盘。
  await loadStaticAssets();
  await redetectClaude();
  // 启动时后台清理过期浏览器截图
  // 不 await —— 清理慢或失败都不能拖慢启动、更不能让启动报错。
  void cleanupScreenshots();
  // CCDPH-FIX(MED-8): 清理不能只在启动时跑一次。应用设计为常驻托盘（closeToTray: true），
  // 长期不重启的窗口期间截图目录会持续增长。这里改为每小时跑一次
  //（unref：定时器绝不拖住退出），清理失败永远不能影响主功能。
  const cleanupTimer = setInterval(() => {
    try {
      cleanupScreenshots(); // 同步实现（内部已 catch），这里再包一层防御
    } catch { }
  }, 60 * 60 * 1000);
  cleanupTimer.unref?.();
  terminalProcessRegistry.start();
  // Node 的 headersTimeout 由内部连接扫描器执行，在 Windows / Node 24 下实测设置为
  // 10 秒的半截请求头 20 秒后仍然存活。为初始请求和每次 keep-alive 后续请求增加
  // 真正的绝对截止时间。activeRequests 让 HTTP pipeline 中前一个响应 finish 时不会
  // 给仍在处理的后续请求误装请求头计时器。
  const headerDeadlineBySocket = new WeakMap();
  const activeRequestsBySocket = new WeakMap();
  const clearHeaderDeadline = (socket) => {
    const timer = headerDeadlineBySocket.get(socket);
    if (timer) clearTimeout(timer);
    headerDeadlineBySocket.delete(socket);
  };
  const armHeaderDeadline = (socket) => {
    clearHeaderDeadline(socket);
    if (socket.destroyed) return;
    const timer = setTimeout(() => socket.destroy(), HEADER_READ_TIMEOUT_MS);
    timer.unref?.();
    headerDeadlineBySocket.set(socket, timer);
  };
  const server = http.createServer((req, res) => {
    const socket = req.socket;
    clearHeaderDeadline(socket);
    activeRequestsBySocket.set(
      socket,
      (activeRequestsBySocket.get(socket) || 0) + 1,
    );
    let released = false;
    const releaseRequest = () => {
      if (released) return;
      released = true;
      const active = Math.max(
        0,
        (activeRequestsBySocket.get(socket) || 1) - 1,
      );
      activeRequestsBySocket.set(socket, active);
      if (active === 0) armHeaderDeadline(socket);
    };
    res.once("finish", releaseRequest);
    res.once("close", releaseRequest);
    route(req, res).catch((error) => {
      if (!res.headersSent) {
        // CCDPH-FIX(P3-33): 此前把**所有**异常都回 400，导致服务端自身的编程错误
        //（TypeError/ReferenceError/RangeError/SyntaxError）被伪装成"客户端请求有问题"。
        // 业务校验仍是普通 Error → 保持 400（前端契约不变）；内部错误改为 500 并写 stderr。
        const internal =
          error instanceof TypeError ||
          error instanceof ReferenceError ||
          error instanceof RangeError ||
          error instanceof SyntaxError;
        if (internal)
          console.error("[ccdph] 内部错误:", error?.stack || error);
        json(res, { error: sanitizeError(error) }, internal ? 500 : 400);
      } else res.end();
    });
  });
  server.on("connection", (socket) => {
    activeRequestsBySocket.set(socket, 0);
    armHeaderDeadline(socket);
    socket.once("close", () => {
      clearHeaderDeadline(socket);
      activeRequestsBySocket.delete(socket);
    });
  });
  // Bound incomplete/idle HTTP connections so a local client cannot hold request
  // slots indefinitely by declaring a huge Content-Length and sending no body.
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    // CCDPH-FIX(LOW-3): 显式调大 accept backlog。默认 511 在瞬时高并发下会直接
    // RST —— 实测 500 并发连接有 168 次 ECONNREFUSED、1000 并发有 512 次。
    server.listen({ port, host: "127.0.0.1", backlog: 2048 }, resolve);
  });
  const url = `${origin}/#${token}`;
  // CCDPH-FIX(HIGH-1): 绝不再把 API 令牌写进 <DATA>/runtime.json。
  // 该文件路径可预测（打包版是 <安装目录>\.data\runtime.json）、同用户的任意进程都能读，
  // 而令牌是**全部** /api/* 的唯一门槛（agent 自己的 shell 工具就能读到它，然后调
  // /api/session/control 把审批模式改成 auto，或对任意会话 /api/send）。实测：读该文件
  // 拿到 64 位十六进制令牌后可成功调用 /api/state。
  // 而且整个应用**没有任何地方读回这个文件**（desktop.cjs 用的是内存里的
  // engine.getRuntime()，见 desktop.cjs:169/379/482），所以它纯粹是负债。
  // 现在保留同名握手文件（README 与开发流程提到它），但只写 pid 与**不含令牌的**入口地址。
  await fs
    .writeFile(
      path.join(DATA, "runtime.json"),
      JSON.stringify({ pid: process.pid, url: origin }),
    )
    .catch((error) =>
      console.error(
        "[ccdph] runtime.json 暂未写入，服务仍将正常运行:",
        error?.message || error,
      ),
    );
  console.log(`CCDPH: ${origin}`);
  // 网页开发版（npm start）没有别的途径拿到本次启动的令牌：桌面版由 desktop.cjs 从内存
  // 取值，这里只在非桌面模式下把完整入口打进本进程终端（不落盘、不写进任何文件）。
  if (process.env.WORKBENCH_DESKTOP !== "1")
    console.log(`CCDPH: 本次启动令牌（仅本进程终端可见，不写入磁盘）: ${url}`);
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // CCDPH-FIX(MED-3): 整个收尾流程必须 error-contained。原来 body 是裸的
    // `await stopRuns()`，而 stopRuns 尾部 `await save()` 在磁盘错误（磁盘满 / .data
    // 只读 / ACL 被改坏）时会 reject → shutdown() 变成 rejected promise，被
    // `void shutdown()` 吞掉 → 后面**全部**不执行：定时器不清、最终 flush 不写、
    // server.close() 永不调用；而 shuttingDown 已经是 true，第二个 Ctrl+C / SIGTERM
    // 在第一行就早退 → 进程再也杀不掉，只能强杀。
    // 现在：每一步各自兜错，退出路径放在 finally 里保证一定执行；真出异常时把
    // shuttingDown 复位，后续信号还能再走一遍。
    try {
      if (!(await stopDedicatedEdge()))
        console.error("[ccdph] 退出时未能确认专用浏览器进程树已结束");
      await stopRuns().catch((error) =>
        console.error("[ccdph] 退出时收尾失败:", error?.message || error),
      );
      // CCDPH-FIX(PERF-2): 退出前把节流中待写盘的内容刷掉，否则最后几秒的改动会丢
      if (scheduleTimer) {
        clearTimeout(scheduleTimer);
        scheduleTimer = null;
      }
      await save().catch((error) =>
        console.error("[ccdph] 退出前写盘失败:", error?.message || error),
      );
    } catch (error) {
      console.error("[ccdph] 退出流程异常，仍将关闭服务:", error?.message || error);
      shuttingDown = false; // 允许后续信号重试
    } finally {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1500).unref();
    }
  };
  const onSigint = () => void shutdown();
  const onSigterm = () => void shutdown();
  const onSigbreak = () => void shutdown();
  let lifecycleDisposePromise = null;
  const disposeLifecycle = () => {
    if (lifecycleDisposePromise) return lifecycleDisposePromise;
    lifecycleDisposePromise = (async () => {
      clearInterval(cleanupTimer);
      clearTimeout(updateRuntime.installResetTimer);
      updateRuntime.installResetTimer = null;
      terminalProcessRegistry.dispose();
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      if (process.platform === "win32") process.off("SIGBREAK", onSigbreak);
      await disposeSerializerWorker();
    })();
    return lifecycleDisposePromise;
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  if (process.platform === "win32") process.on("SIGBREAK", onSigbreak);
  server.once("close", () => void disposeLifecycle());
  const closeServer = server.close.bind(server);
  server.close = (callback) =>
    closeServer((error) => {
      void disposeLifecycle().then(
        () => callback?.(error),
        () => callback?.(error),
      );
    });
  return server;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
