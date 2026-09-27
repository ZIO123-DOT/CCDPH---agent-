// CCDPH 本地浏览器服务：基于 Playwright 的 connectOverCDP 操控用户 Edge
// 设计依据：docs/browser-integration-design.md §5.2 / §7.2 / §13.3
// - 供 UI 的 /api/browser/status | tabs 使用
// 工具语义与 Playwright MCP 对齐（browser_*）。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { probeCdp, probeTabs } from "./detect.mjs";

// CCDPH-FIX(NIT-11): 原来的兜底目录是 process.cwd()/.data，而 server.mjs:13 的兜底是
// <app>/.data —— 在 WORKBENCH_DATA_DIR 未设置（例如 `node server.mjs` 直跑）时，截图会落到
// 一个跟 UI「打开数据目录」完全不同的目录里。这里与 server.mjs 的算法保持一致。
const DATA_DIR =
  process.env.WORKBENCH_DATA_DIR ||
  path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".data"));

let playwrightMod = null;
function pw() {
  if (!playwrightMod) {
    // 项目 dependencies 里的 playwright（channel=msedge 指向本机 Edge，无需下载自带浏览器）
    playwrightMod = import("playwright").then((m) => m.chromium ? m : m.default);
  }
  return playwrightMod;
}

const state = {
  connection: null, // { browser, cdpEndpoint, connectedAt }
};
const SCREENSHOT_TOTAL_MAX_BYTES = 256 * 1024 * 1024;


let _cachedCdpPort = { port: 0, mtime: 0 };
export async function cdpEndpointFromSettings(browserSettings) {
  if (!browserSettings || !browserSettings.enabled) return "";
  if ((browserSettings.mode || "attach") === "attach") {
    // attach 模式：读 Edge 的 DevToolsActivePort（edge://inspect 授权后存在）。
    // 缓存端口 + mtime 校验，避免每次工具调用都同步读盘阻塞事件循环。
    const file = path.join(
      process.env.LOCALAPPDATA || "",
      "Microsoft",
      "Edge",
      "User Data",
      "DevToolsActivePort",
    );
    try {
      const st = await fs.promises.stat(file);
      if (st.mtimeMs === _cachedCdpPort.mtime && _cachedCdpPort.port > 0)
        return `http://127.0.0.1:${_cachedCdpPort.port}`;
      const text = await fs.promises.readFile(file, "utf8");
      const port = Number.parseInt(text.trim().split(/\r?\n/)[0], 10);
      if (Number.isInteger(port) && port > 0) {
        _cachedCdpPort = { port, mtime: st.mtimeMs };
        return `http://127.0.0.1:${port}`;
      }
    } catch { }
    return "";
  }
  const port = Number(browserSettings.dedicatedPort) || 9223;
  return `http://127.0.0.1:${port}`;
}

// D-03 修复：CDP 连接此前只在心跳失败分支关闭，两条泄漏路径——①停用浏览器 /
// Edge 未授权时 `if (!cdp) return` 直接返回、从不关闭；②端口变化 / attach↔dedicated
// 切换时直接覆盖 state.connection，旧 browser 永不 close。抽出 dropConnection()
// 在两条路径各调用一次，消除与 UI「零残留」文案的矛盾。
async function dropConnection() {
  if (!state.connection) return;
  const browser = state.connection.browser;
  try { await browser?.close(); } catch { }
  state.connection = null;
}
async function ensureConnection(browserSettings) {
  const cdp = await cdpEndpointFromSettings(browserSettings);
  if (!cdp) {
    await dropConnection();
    return { ok: false, error: "浏览器能力未启用，或 Edge 尚未授权远程调试（请在 edge://inspect/#remote-debugging 勾选允许）" };
  }
  if (state.connection && state.connection.cdpEndpoint === cdp) {
    try {
      // 心跳：contexts() 访问失败则视为断开
      await state.connection.browser.contexts();
      return { ok: true, cdp };
    } catch {
      await dropConnection();
    }
  }
  await dropConnection();
  const chromium = (await pw()).chromium;
  const browser = await chromium.connectOverCDP(cdp, { timeout: 8000 });
  state.connection = { browser, cdpEndpoint: cdp, connectedAt: Date.now() };
  return { ok: true, cdp };
}

export async function browserStatus(browserSettings) {
  const conn = await ensureConnection(browserSettings).catch((e) => ({ ok: false, error: e.message }));
  const info = { connected: Boolean(conn.ok), browser: "", version: "", port: 0, tabs: [] };
  // CCDPH-FIX(BR-6): 专用 Edge 启动失败（spawn ENOENT/EACCES、被残留实例顶掉、profileDir 被拒）
  // 不能让调用方只看到一句「未连接」。launchError 是**新增的附加字段**（不影响既有字段），
  // /api/browser/enable 会把整个 status 原样返回给设置页。
  if (dedicatedLaunchError) info.launchError = dedicatedLaunchError;
  if (!conn.ok) return info;
  try {
    const cdp = state.connection.cdpEndpoint;
    const port = Number(new URL(cdp).port) || 80;
    info.port = port;
    const tabs = await probeTabs(port);
    info.tabs = tabs.tabs || [];
    const version = await probeCdp(port);
    info.browser = version.browser || "";
  } catch { }
  return info;
}

export { probeCdp, probeTabs };

// dedicated 模式：拉起独立 Edge（非默认 user-data-dir，规避 136 限制）
let dedicatedEdgeProc = null;
// CCDPH-FIX(BR-6): 最近一次「专用浏览器」启动失败 / 被拒绝的原因。由 browserStatus() 带出
// （见上面 launchError），这样 /api/browser/enable 能把它交给设置页，而不是静默失败。
let dedicatedLaunchError = "";
// CCDPH-FIX(BR-5): 我们拉起的专用 Edge 的 pid 标记文件。应用异常退出（崩溃 / 被强杀 / 关机）
// 时收尾代码不会执行，这个文件就是下次启动唯一能定位「残留实例」的线索 —— 残留实例带着
// 登录态和一个**无鉴权**的 --remote-debugging-port 一直留在机器上。
const DEDICATED_PID_FILE = () => path.join(DATA_DIR, "browser", "dedicated-edge.json");
// CCDPH-FIX(BR-10): 只有带这个标记文件的目录才被认作 CCDPH 自己的浏览器配置目录。
const PROFILE_MARKER = ".ccdph-browser-profile";

// CCDPH-FIX(BR-5): 整棵进程树强杀。Edge 会派生渲染/GPU/utility 子进程，单独 kill()
// 只杀掉浏览器主进程，子进程会继续挂在后台（与本模块「零残留」的目标矛盾）。
// 返回 Promise 便于调用方等待，且永不 reject（server.mjs 里有多处不 await 的调用）。
function killProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      resolve(value);
    };
    const guard = setTimeout(() => finish(false), 8000);
    let killer;
    try {
      killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } catch {
      return finish(false);
    }
    killer.on("error", () => finish(false));
    killer.on("close", () => finish(true));
  });
}

// ---- CCDPH-FIX(BR-5)(BR-10): 专用浏览器进程的 pid 标记 / 配置目录包含性校验 ----
function writeDedicatedPidMarker(pid, profileDir, port) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    fs.mkdirSync(path.dirname(DEDICATED_PID_FILE()), { recursive: true });
    fs.writeFileSync(
      DEDICATED_PID_FILE(),
      JSON.stringify({ pid, profileDir: String(profileDir || ""), port: Number(port) || 0, ts: Date.now() }),
    );
  } catch { }
}
// 只清理「属于这个 pid」的标记：pid 可能已被系统复用给别的进程，不能误删别人的记录
function clearDedicatedPidMarker(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    const saved = JSON.parse(fs.readFileSync(DEDICATED_PID_FILE(), "utf8"));
    if (saved && Number(saved.pid) !== pid) return;
    fs.rmSync(DEDICATED_PID_FILE(), { force: true });
  } catch { }
}
function removeDedicatedPidMarker() {
  try {
    fs.rmSync(DEDICATED_PID_FILE(), { force: true });
  } catch { }
}

function captureWindowsCommand(command, args, timeout = 4000, maxBytes = 1024 * 1024) {
  return new Promise((resolve) => {
    let child;
    let done = false;
    let outputBytes = 0;
    const outputChunks = [];
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      resolve({ ok, out: Buffer.concat(outputChunks).toString("utf8") });
    };
    const guard = setTimeout(() => {
      try { child?.kill(); } catch { }
      finish(false);
    }, timeout);
    try {
      child = spawn(command, args, { windowsHide: true });
    } catch {
      return finish(false);
    }
    child.stdout?.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(String(chunk), "utf8");
      const remaining = Math.max(0, maxBytes - outputBytes);
      if (!remaining) return;
      const kept = buffer.subarray(0, remaining);
      outputChunks.push(kept);
      outputBytes += kept.length;
    });
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
  });
}

export function matchesDedicatedEdgeIdentity(tasklistOutput, netstatOutput, pid, port) {
  const expectedPid = String(Number(pid));
  const expectedPort = String(Number(port));
  const taskLine = String(tasklistOutput || "")
    .split(/\r?\n/)
    .find((line) => line.trim());
  const taskMatch = taskLine?.match(/^\s*"?([^",]+)"?\s*,\s*"?(\d+)"?/);
  if (
    !taskMatch ||
    !/^msedge\.exe$/i.test(taskMatch[1]) ||
    taskMatch[2] !== expectedPid
  )
    return false;
  return String(netstatOutput || "")
    .split(/\r?\n/)
    .some((line) => {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 5 || columns[0].toUpperCase() !== "TCP") return false;
      const [protocol, local, , state, ownerPid] = columns;
      return (
        protocol.toUpperCase() === "TCP" &&
        local.endsWith(`:${expectedPort}`) &&
        state.toUpperCase() === "LISTENING" &&
        ownerPid === expectedPid
      );
    });
}

// 名称只能证明「现在是 Edge」，还不足以证明是 CCDPH 拉起的那一棵。再核对标记中的
// 专用调试端口确实由同一个 PID 监听，避免 PID 被另一个普通 Edge 复用时误杀。
async function isDedicatedEdgeProcess(pid, port) {
  if (!Number.isInteger(Number(port)) || Number(port) <= 0) return false;
  const [tasklist, netstat] = await Promise.all([
    captureWindowsCommand("tasklist", [
      "/FI",
      `PID eq ${pid}`,
      "/FO",
      "CSV",
      "/NH",
    ]),
    captureWindowsCommand("netstat", ["-ano", "-p", "tcp"], 5000),
  ]);
  return (
    tasklist.ok &&
    netstat.ok &&
    matchesDedicatedEdgeIdentity(tasklist.out, netstat.out, pid, port)
  );
}

// CCDPH-FIX(BR-10): profileDir 来自设置，而 server.mjs 只对它做了 trim + 长度截断就直接
// mkdirSync 并交给 Edge 当 --user-data-dir —— 它可以指到用户**真实的** Edge 配置目录
// （写坏真实 profile / 真实 Cookie 库，放在同步目录里还会被同步出去），或在任意位置建目录。
// 这里做包含性校验：必须是绝对路径、必须落在应用数据目录内、已存在的外来目录一律拒绝。
export function resolveDedicatedProfileDir(profileDir) {
  const fallback = path.join(DATA_DIR, "browser-profile");
  const raw = typeof profileDir === "string" && profileDir.trim() ? profileDir.trim() : fallback;
  const dataRoot = path.resolve(DATA_DIR);
  let resolved = "";
  try {
    resolved = path.resolve(raw);
  } catch { }
  const relative = resolved ? path.relative(dataRoot, resolved) : "..";
  const inside =
    Boolean(relative) &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative);
  if (!resolved || !path.isAbsolute(raw) || !inside) {
    dedicatedLaunchError = `浏览器配置目录被拒绝：必须是应用数据目录（${dataRoot}）内的绝对路径，当前是「${String(profileDir).slice(0, 200)}」。请在 设置 → 浏览器 里改回默认目录。`;
    console.error("[ccdph]", dedicatedLaunchError);
    return "";
  }
  try {
    fs.mkdirSync(dataRoot, { recursive: true });
    const existing = fs.existsSync(resolved) ? fs.statSync(resolved) : null;
    if (existing && !existing.isDirectory()) {
      dedicatedLaunchError = `浏览器配置目录被拒绝：${resolved} 不是目录。`;
      console.error("[ccdph]", dedicatedLaunchError);
      return "";
    }
    // 默认目录（DATA/browser-profile）是历史版本就在用的，允许没有标记文件；
    // 其它已存在的非空目录必须带上我们的标记，否则视为别人的配置目录（例如 .data 根目录）。
    if (existing && resolved !== path.resolve(fallback)) {
      const names = fs.readdirSync(resolved);
      if (names.length && !names.includes(PROFILE_MARKER)) {
        dedicatedLaunchError = `浏览器配置目录被拒绝：${resolved} 非空且不是 CCDPH 创建的配置目录（缺少 ${PROFILE_MARKER} 标记）。`;
        console.error("[ccdph]", dedicatedLaunchError);
        return "";
      }
    }
    fs.mkdirSync(resolved, { recursive: true });
    // mkdir 之后必须再做真实路径校验：父目录可能是 junction/symlink，词法上位于
    // DATA_DIR 内，真实落点却可能是用户的 Edge profile、.ssh 或同步目录。
    const realDataRoot = fs.realpathSync(dataRoot);
    const realResolved = fs.realpathSync(resolved);
    const realRelative = path.relative(realDataRoot, realResolved);
    if (
      !realRelative ||
      realRelative === ".." ||
      realRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(realRelative)
    ) {
      dedicatedLaunchError = `浏览器配置目录被拒绝：真实路径 ${realResolved} 已越过应用数据目录 ${realDataRoot}`;
      console.error("[ccdph]", dedicatedLaunchError);
      return "";
    }
    const marker = path.join(realResolved, PROFILE_MARKER);
    if (!fs.existsSync(marker))
      fs.writeFileSync(marker, "CCDPH 专用浏览器配置目录：删除本文件会让 CCDPH 拒绝再使用这个目录。\n");
    return realResolved;
  } catch (error) {
    dedicatedLaunchError = `浏览器配置目录不可用：${String(error?.message || error).slice(0, 200)}`;
    console.error("[ccdph]", dedicatedLaunchError);
    return "";
  }
}

// CCDPH-FIX(BR-6): 拉起后确认调试端口真的起来了（最多 8 秒，纯后台，不阻塞调用方）。
// 端口没起来只记录原因，不改状态 —— 目的是不让「已经启动」这种假象继续存在。
async function verifyDedicatedLaunch(proc, port) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (dedicatedEdgeProc !== proc) return; // 进程已退出 / 已被替换
    const info = await probeCdp(port, 1000);
    if (info?.connected) return;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 700);
      timer.unref?.();
    });
  }
  if (dedicatedEdgeProc !== proc) return;
  dedicatedLaunchError = `专用浏览器已启动，但调试端口 ${port} 在 8 秒内没有就绪（可能被占用，或被安全软件/策略拦截）。`;
  console.error("[ccdph]", dedicatedLaunchError);
}

export function launchDedicatedEdge(msedgePath, port, profileDir) {
  if (dedicatedEdgeProc && !dedicatedEdgeProc.killed) return dedicatedEdgeProc;
  dedicatedLaunchError = "";
  // CCDPH-FIX(BR-10): 先过包含性校验，不通过就直接拒绝启动（不再 mkdir 任意路径）
  const resolvedProfile = resolveDedicatedProfileDir(profileDir);
  if (!resolvedProfile) return null;
  let proc;
  try {
    proc = spawn(msedgePath, [
      `--remote-debugging-port=${port}`,
      // CCDPH-FIX(BR-5): 显式限定只监听回环地址，避免调试端口意外暴露到局域网
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${resolvedProfile}`,
      "--no-first-run",
      "--no-default-browser-check",
    ], {
      // CCDPH-FIX(BR-5): 去掉 detached 是对的，但原来的理由写错了 —— Node/Electron 都**不会**
      // 把子进程放进 Job Object，父进程退出后 Edge 会继续跑（这正是 BR-5 的成因）。
      // 所以「不残留」只能靠 desktop.cjs 的退出流程显式调用 stopDedicatedEdge()，
      // 不能指望系统回收。unref() 保留，避免这个句柄拖住事件循环。
      stdio: "ignore",
      windowsHide: true,
    });
  } catch (error) {
    dedicatedLaunchError = `无法启动专用浏览器（${error?.code || "spawn 失败"}）：${String(error?.message || error).slice(0, 200)}`;
    console.error("[ccdph]", dedicatedLaunchError);
    return null;
  }
  dedicatedEdgeProc = proc;
  const launchedAt = Date.now();
  writeDedicatedPidMarker(proc.pid, resolvedProfile, port);
  // CCDPH-FIX(BR-6): spawn 的失败（ENOENT/EACCES，Edge 被删/改名/被安全软件拦）是**异步**通过
  // 'error' 事件报出来的。原来只挂了 'exit'，没有 'error' 监听 → 未捕获异常直接打死整个
  // Electron 主进程（server.mjs 就跑在里面，所有会话一起没）。这里与 killProcessTree 的
  // killer.on("error") 保持一致，并把原因记下来交给 browserStatus()。
  proc.on("error", (error) => {
    if (dedicatedEdgeProc === proc) dedicatedEdgeProc = null;
    dedicatedLaunchError = `无法启动专用浏览器（${error?.code || "spawn 失败"}）：${String(error?.message || "").slice(0, 200)}`;
    console.error("[ccdph]", dedicatedLaunchError);
    clearDedicatedPidMarker(proc.pid);
  });
  proc.on("exit", () => {
    if (dedicatedEdgeProc === proc) dedicatedEdgeProc = null;
    clearDedicatedPidMarker(proc.pid);
    // CCDPH-FIX(BR-6): 启动后立刻退出，通常意味着「已经有一个使用同一 profileDir 的实例在跑，
    // 这次 spawn 只是把命令行转发给旧实例然后自己退出」。旧实例监听的是**旧端口**，
    // 于是状态页只会显示「未连接」而没有任何解释 —— 这里显式说明，不再静默。
    if (Date.now() - launchedAt < 5000)
      dedicatedLaunchError =
        "专用浏览器启动后立即退出：可能已存在使用同一配置目录的残留实例（它的调试端口可能与当前设置不一致）。请先结束该实例，或换一个配置目录。";
  });
  proc.unref();
  // CCDPH-FIX(BR-6): 后台确认端口真的可用（不 await，避免拖住 server 的请求线程）
  void verifyDedicatedLaunch(proc, port).catch(() => { });
  return proc;
}
export function stopDedicatedEdge() {
  const proc = dedicatedEdgeProc;
  dedicatedEdgeProc = null;
  if (!proc || proc.killed) return Promise.resolve(false);
  const pid = proc.pid;
  try { proc.kill(); } catch { }
  // CCDPH-FIX(BR-5): 单进程 kill() 之后再用 taskkill /T /F 清掉它的子进程
  clearDedicatedPidMarker(pid);
  return killProcessTree(pid);
}

// CCDPH-FIX(BR-5): 启动时的残留清扫。上一次运行如果是崩溃 / 被任务管理器强杀 / 关机，
// 退出流程没机会执行，专有 Edge（带着登录态的 profile + 无鉴权的调试端口）会一直活着。
// 这里按 pid 标记文件把它整棵进程树收掉；确认过 pid 现在还确实是 msedge.exe 才会动手。
// 永不 reject：调用方（desktop.cjs 启动流程）只 await，不需要处理异常。
export async function sweepStaleDedicatedEdge() {
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(DEDICATED_PID_FILE(), "utf8"));
  } catch {
    // 损坏标记若不删除，每次启动都会永远重复走失败分支。
    removeDedicatedPidMarker();
    return false;
  }
  const pid = Number(saved?.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    removeDedicatedPidMarker();
    return false;
  }
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch (error) {
    // EPERM：进程存在但不属于我们，仍然需要 tasklist 复核后再决定
    alive = error?.code === "EPERM";
  }
  if (!alive || !(await isDedicatedEdgeProcess(pid, Number(saved?.port)))) {
    clearDedicatedPidMarker(pid);
    return false;
  }
  console.warn(`[ccdph] 发现上次退出残留的专用浏览器（pid ${pid}），正在结束它`);
  dedicatedEdgeProc = null;
  const killed = await killProcessTree(pid);
  clearDedicatedPidMarker(pid);
  return killed;
}

// CCDPH-FIX(BUG-4): 截图目录清理（启动时由 server.mjs 调用一次）。
// 超过 maxAgeMs 的截图直接删；总数超过 maxCount 时从最旧开始删到上限内。
// 截图没有“仍被引用”的概念（AI 只被告知文件路径），用 TTL + 数量上限回收即可。
// 任何失败静默 —— 清理永远不能影响浏览器工具本身。
export function cleanupScreenshots(
  maxAgeMs = 30 * 86_400_000,
  maxCount = 500,
  maxTotalBytes = SCREENSHOT_TOTAL_MAX_BYTES,
  directory = path.join(DATA_DIR, "browser", "screenshots"),
) {
  const dir = directory;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const cutoff = Date.now() - maxAgeMs;
  const survivors = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // 该目录可能被用户用于取回其它文件；只回收本模块自己生成的截图。
    if (!/^shot_\d+_[0-9a-f]{8}\.png$/i.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    try {
      const st = fs.statSync(full);
      if (st.mtimeMs < cutoff) {
        fs.rmSync(full, { force: true });
        continue;
      }
      survivors.push({ full, mtime: st.mtimeMs, size: st.size });
    } catch { }
  }
  survivors.sort((a, b) => a.mtime - b.mtime);
  let totalBytes = survivors.reduce((sum, item) => sum + item.size, 0);
  let remainingCount = survivors.length;
  for (const item of survivors) {
    if (remainingCount <= maxCount && totalBytes <= maxTotalBytes) break;
    try {
      fs.rmSync(item.full, { force: true });
      remainingCount--;
      totalBytes -= item.size;
    } catch { }
  }
}

// 截图后即时回收；周期回收由 server.start() 统一拥有并在 server.close 时释放。
// browser/service.mjs 本身不再 import 即创建定时器，保持模块可测试、可独立复用。
function sweepScreenshots() {
  try {
    cleanupScreenshots();
  } catch { }
}
