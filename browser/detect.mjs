// CCDPH 浏览器探测：本机浏览器安装情况 + Edge 远程调试授权状态
// 设计依据：docs/browser-integration-design.md §5.2 / §7.1
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";

const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft\\Edge\\Application\\msedge.exe"),
  path.join(process.env["ProgramFiles"] || "", "Microsoft\\Edge\\Application\\msedge.exe"),
];
const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  path.join(process.env["ProgramFiles"] || "", "Google\\Chrome\\Application\\chrome.exe"),
  path.join(process.env["ProgramFiles(x86)"] || "", "Google\\Chrome\\Application\\chrome.exe"),
  path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
];

function firstExisting(paths) {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {}
  }
  return "";
}

// 从 Edge 的 User Data 目录读 DevToolsActivePort 文件（edge://inspect 授权后写入）
function edgeDevToolsActivePort() {
  const userDataDir = path.join(
    process.env.LOCALAPPDATA || "",
    "Microsoft",
    "Edge",
    "User Data",
  );
  const file = path.join(userDataDir, "DevToolsActivePort");
  try {
    const raw = fs.readFileSync(file, "utf8").trim();
    const port = Number.parseInt(raw.split(/\r?\n/)[0], 10);
    if (Number.isInteger(port) && port > 0) return { enabled: true, port, file };
  } catch {}
  return { enabled: false, port: 0, file };
}

// CCDPH-FIX(DET-1): 探针响应体上限。socket 的 timeout 只在**空闲**时触发，一个不停发数据的
// 本地监听进程可以让 data 无限增长（虽然端口只在回环上，但那个进程不是我们的）。
const PROBE_MAX_BYTES = 64 * 1024;
const boundedTimeout = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 100 && parsed <= 30_000
    ? Math.trunc(parsed)
    : fallback;
};
export const CDP_PROBE_TIMEOUT_MS = boundedTimeout(
  process.env.CCDPH_CDP_PROBE_TIMEOUT_MS,
  1200,
);
export const CDP_TABS_TIMEOUT_MS = boundedTimeout(
  process.env.CCDPH_CDP_TABS_TIMEOUT_MS,
  1500,
);

// 探测指定端口上的 CDP 服务（/json/version）
function probeCdp(port, timeoutMs = CDP_PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const req = net.connect({ host: "127.0.0.1", port, timeout: timeoutMs }, () => {
      req.write(`GET /json/version HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    });
    let data = "";
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      try {
        req.destroy();
      } catch {}
      resolve(result);
    };
    req.on("data", (chunk) => {
      if (done) return;
      data += chunk.toString("utf8");
      // CCDPH-FIX(DET-1): 到上限就收尾，别让失控的本地进程把主进程内存吃光
      if (data.length > PROBE_MAX_BYTES) finish({ connected: false, port, oversized: true });
    });
    req.on("end", () => {
      // CCDPH-FIX(DET-1): 头部结束标记不存在时 indexOf 返回 -1，原来的 slice(-1 + 4) 会静默
      // 吃掉前 3 个字符再交给 JSON.parse —— 畸形响应于是变成难以解释的「未连接 / 空浏览器」。
      const split = data.indexOf("\r\n\r\n");
      if (split < 0) return finish({ connected: false, port });
      const body = data.slice(split + 4);
      try {
        const json = JSON.parse(body);
        finish({ connected: true, port, browser: json.Browser || "", webSocket: json.webSocketDebuggerUrl || "" });
      } catch {
        finish({ connected: false, port });
      }
    });
    req.on("timeout", () => finish({ connected: false, port, timeout: true }));
    req.on("error", () => finish({ connected: false, port }));
  });
}

// 探测 CDP 上已打开的标签（/json/list）
function probeTabs(port, timeoutMs = CDP_TABS_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const req = net.connect({ host: "127.0.0.1", port, timeout: timeoutMs }, () => {
      req.write(`GET /json/list HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    });
    let data = "";
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      try {
        req.destroy();
      } catch {}
      resolve(result);
    };
    req.on("data", (chunk) => {
      if (done) return;
      data += chunk.toString("utf8");
      // CCDPH-FIX(DET-1): 同 probeCdp：超上限立即收尾
      if (data.length > PROBE_MAX_BYTES) finish({ ok: false, tabs: [], oversized: true });
    });
    req.on("end", () => {
      // CCDPH-FIX(DET-1): 没有头部结束标记就直接判定失败，不再 slice(-1 + 4) 造垃圾 body
      const split = data.indexOf("\r\n\r\n");
      if (split < 0) return finish({ ok: false, tabs: [] });
      const body = data.slice(split + 4);
      try {
        const tabs = JSON.parse(body)
          .filter((t) => t.type === "page")
          .map((t) => ({ id: t.id, title: t.title || "", url: t.url || "", type: t.type }));
        finish({ ok: true, tabs });
      } catch {
        finish({ ok: false, tabs: [] });
      }
    });
    req.on("timeout", () => finish({ ok: false, tabs: [] }));
    req.on("error", () => finish({ ok: false, tabs: [] }));
  });
}

export async function detectBrowsers() {
  const edgePath = firstExisting(EDGE_PATHS);
  const chromePath = firstExisting(CHROME_PATHS);
  // 版本号在 CDP /json/version 的 Browser 字段里取更准确（Edg/153.x），这里先给通道占位
  const edgeVersion = edgePath ? "Edge" : "";
  const chromeVersion = chromePath ? "Chrome" : "";
  const edgeRemote = edgeDevToolsActivePort();
  let edgeRemoteConnected = null;
  if (edgeRemote.enabled) {
    edgeRemoteConnected = await probeCdp(edgeRemote.port);
  }
  return {
    os: `${os.type()} ${os.release()}`,
    browsers: [
      { kind: "edge", path: edgePath, version: edgeVersion, installed: Boolean(edgePath) },
      { kind: "chrome", path: chromePath, version: chromeVersion, installed: Boolean(chromePath) },
    ],
    edgeRemoteDebug: {
      ...edgeRemote,
      connected: edgeRemoteConnected?.connected || false,
      browser: edgeRemoteConnected?.browser || "",
    },
  };
}

export { probeCdp, probeTabs };
