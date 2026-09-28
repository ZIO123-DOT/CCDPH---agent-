// 依据 db.settings.browser 生成 Claude 引擎的 MCP 注入配置
// 设计依据：docs/browser-integration-design.md §8（不写用户全局配置，仅运行时注入）
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// 解析本地 @playwright/mcp 的 CLI 入口（优先本地依赖，避免 npx 联网抖动）
function resolveMcpEntry() {
  try {
    const pkgDir = path.dirname(require.resolve("@playwright/mcp/package.json"));
    const pkg = JSON.parse(fsRead(pkgDir + "/package.json"));
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["mcp-server"] || Object.values(pkg.bin || {})[0];
    if (bin) return path.join(pkgDir, bin);
  } catch {}
  return "";
}
function fsRead(p) {
  // 延迟引入，避免顶层 require 语义混乱
  return require("node:fs").readFileSync(p, "utf8");
}
let cachedMcpEntry;
function getMcpEntry() {
  if (cachedMcpEntry === undefined) cachedMcpEntry = resolveMcpEntry();
  return cachedMcpEntry;
}

export function buildPlaywrightMcpConfig(browser) {
  const args = [];
  const mode = browser.mode || "attach";
  if (mode === "attach") {
    // 通道名连接（走 edge://inspect 授权开关），Playwright MCP 原生支持
    args.push("--cdp-endpoint=msedge");
  } else {
    // 专用授权 Profile：后端已用调试端口拉起独立 Edge
    // CCDPH-FIX(R5-P2-4): 端口未配置（0）时不生成 MCP 注入（端口在启用专用模式时随机分配并持久化，
    // 正常路径此处恒为有效端口；0 只会出现在被篡改的状态）。
    const port = Number(browser.dedicatedPort) || 0;
    if (!port) return null;
    args.push(`--cdp-endpoint=http://127.0.0.1:${port}`);
  }
  if (browser.imageResponses && browser.imageResponses !== "allow") {
    args.push("--image-responses=omit");
  }
  // CCDPH-FIX: 原实现在此追加 "--no-usage-statistics"，但 @playwright/mcp@0.0.80
  // （含其内置的 playwright-core 1.63）没有这个选项，会直接
  // `error: unknown option '--no-usage-statistics'` 退出，导致浏览器 MCP 永远起不来。
  // 已实测确认依赖里不存在该选项，故不再传递（对应的 settings 字段也已移除）。
  const blocked = (browser.blockOrigins || []).filter(Boolean);
  if (blocked.length) args.push("--blocked-origins", blocked.join(";"));
  const allowed = (browser.allowOrigins || []).filter(Boolean);
  if (allowed.length) args.push("--allowed-origins", allowed.join(";"));
  // CCDPH-FIX(BR-11): 这里传入的裸域名（example.com）被 @playwright/mcp 展开成
  // `*://example.com/**` —— 只匹配该主机本身，子域必须显式写 `*.example.com`。
  // service.mjs 的直接浏览器执行路径也使用同一语义，改动时需同步确认。
  // CCDPH-FIX(NIT-10): 本地包解析失败时会回退到 npx（需要联网，且 Windows 上依赖 .cmd
  // shim）。原来这条回退路径完全静默，出问题只会表现为「浏览器 MCP 起不来」，这里显式提示。
  const entry = getMcpEntry();
  if (entry) {
    // 用本地包跑 MCP（离线可用）。process.execPath 在打包版是 CCDPH.exe，
    // 但 Electron 会以「主进程」身份执行该脚本，而 cli.js 是纯 Node CLI，
    // 实测能正常完成 MCP initialize 握手（repro/probe-mcp-stdio2.mjs），故直接用。
    return { command: process.execPath, args: [entry, ...args] };
  }
  // 回退：npx（联网，固定版本）
  console.warn(
    "[ccdph] 未能解析本地的 @playwright/mcp，浏览器 MCP 回退到 npx（需要联网，且首次会下载依赖）",
  );
  return { command: "npx", args: ["-y", "@playwright/mcp@0.0.80", ...args] };
}

export function browserMcpEnabled(browser) {
  // CCDPH-FIX(R5-P2-4): 专用模式还需端口已配置（>0），否则不注入 MCP——端口在启用专用模式时
  // 随机分配并持久化，0 只会出现在被篡改的状态；此时 fail-closed 不注入，而不是带着 :0 或
  // 可预测端口去连。
  if (!browser || !browser.enabled) return false;
  if ((browser.mode || "attach") === "dedicated" && !(Number(browser.dedicatedPort) > 0))
    return false;
  return true;
}
