#!/usr/bin/env node
// CCDPH 接口自动化用例（B3 · api-test-script-gen）
// ---------------------------------------------------------------------------
// 真启动 node server.mjs（独立数据目录 / 独立端口 / 独立 CLAUDE_CONFIG_DIR），
// 用 Node 原生 fetch + http 对高风险 HTTP 接口做正常/必填缺失/边界/异常/鉴权/路径穿越/
// 超大 payload/并发 覆盖，断言到「状态码 + 错误关键词 + 数据不变量」。
//
// 运行：node tests/api-tests.mjs
// 退出码：0 全通过；1 有失败
//
// 安全边界（对齐 api-test-script-gen 红线）：
//   - 只测本项目自有/已授权接口；不硬编码任何真实令牌（令牌由服务启动时动态打印）。
//   - MCP 写入路径指向真实 ~/.claude.json，故本套用例**只做非写入的拒绝分支**（读 + 400），
//     不做成功的 MCP 写操作；hooks 写入通过 CLAUDE_CONFIG_DIR 指向临时目录完全隔离。
//   - 全程临时目录在 finally 中清理，子进程必杀。
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 49300 + Math.floor(Math.random() * 250);
const ORIGIN = `http://127.0.0.1:${PORT}`;

const dataDir = await mkdtemp(path.join(os.tmpdir(), "ccdph-api-data-"));
const projectDir = await mkdtemp(path.join(os.tmpdir(), "ccdph-api-project-"));
const outsideDir = await mkdtemp(path.join(os.tmpdir(), "ccdph-api-outside-"));
// CCDPH-FIX(R2-P2-12b): 用户级 MCP 配置（.claude.json）跟随 CLAUDE_CONFIG_DIR 的**父目录**
// （见 server.mjs 的 MCP_FILE）。所以这里把配置目录建成 <root>/.claude，
// 让 MCP 配置落进本用例自己的临时根目录，而不是 %TEMP% 根或真实用户目录。
const claudeRoot = await mkdtemp(path.join(os.tmpdir(), "ccdph-api-claude-"));
const claudeDir = path.join(claudeRoot, ".claude");
await mkdir(claudeDir, { recursive: true });

await writeFile(path.join(projectDir, "normal.txt"), "hello-ccdph", "utf8");
await writeFile(path.join(outsideDir, "secret.txt"), "SECRET-OUTSIDE", "utf8");

let child;
let token = "";
let streamCookie = "";
const results = [];
let area = "";
const test = async (id, severity, name, fn) => {
  try {
    await fn();
    results.push({ id, area, severity, name, status: "PASS" });
  } catch (error) {
    results.push({ id, area, severity, name, status: "FAIL", error: error?.message || String(error) });
  }
};
function startServer() {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, ["server.mjs"], {
      cwd: ROOT,
      env: {
        ...process.env,
        WORKBENCH_DATA_DIR: dataDir,
        WORKBENCH_PORT: String(PORT),
        WORKBENCH_DESKTOP: "0",
        CCDPH_DEV_PRINT_TOKEN: "1",
        CLAUDE_CONFIG_DIR: claudeDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    const timer = setTimeout(() => reject(new Error(`server start timeout: ${output}`)), 25_000);
    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/#([0-9a-f]{64})/);
      if (!match) return;
      clearTimeout(timer);
      token = match[1];
      resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (chunk) => (output += chunk.toString()));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (${code}): ${output}`));
    });
  });
}

// 标准 JSON 请求
async function api(method, pathname, { body, useToken = true, tokenOverride, timeout = 8000 } = {}) {
  const headers = {};
  if (useToken) headers["x-workbench-token"] = tokenOverride ?? token;
  const init = { method, headers, signal: AbortSignal.timeout(timeout) };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const response = await fetch(`${ORIGIN}${pathname}`, init);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON（SSE / 静态）保留 text */
  }
  return { status: response.status, headers: response.headers, text, json };
}

// 原始 http 请求（用于伪造 Host / Origin，Node fetch 不允许改这两个头）
function raw(method, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: PORT, method, path: pathname, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, text: data }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

try {
  await startServer();
  // CCDPH-FIX(R5-P3-4): 启动令牌换取 Cookie 后会作废，auth 需跟随 token 更新（A-09 里重赋值）。
  let auth = { "x-workbench-token": token };

  // ==== 准备：创建项目 & 会话（后续用例复用） ================================
  const createdProject = await api("POST", "/api/projects", { body: { path: projectDir } });
  assert.equal(createdProject.status, 200, `项目创建失败: ${createdProject.text}`);
  const projectId = createdProject.json.id;
  const createdSession = await api("POST", "/api/sessions", { body: { projectId, environment: "local" } });
  assert.equal(createdSession.status, 200, `会话创建失败: ${createdSession.text}`);
  const sessionId = createdSession.json.id;

  // =====================================================================
  area = "D1 启动鉴权 & 来源校验";
  // =====================================================================
  await test("A-01", "P0", "无令牌 GET /api/state → 401", async () => {
    const r = await api("GET", "/api/state", { useToken: false });
    assert.equal(r.status, 401);
    assert.match(r.json.error, /桌面启动器|令牌|请从/);
  });
  await test("A-02", "P0", "错误令牌 GET /api/state → 401", async () => {
    const r = await api("GET", "/api/state", { tokenOverride: "0".repeat(64) });
    assert.equal(r.status, 401);
  });
  await test("A-03", "P0", "正确令牌 GET /api/state → 200 且不泄漏敏感字段", async () => {
    const r = await api("GET", "/api/state");
    assert.equal(r.status, 200);
    assert.equal(typeof r.json.version, "string");
    assert(Array.isArray(r.json.sessions));
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("referrer-policy"), "no-referrer");
    for (const leaky of ["home", "dataDir", "root", "path"]) assert.equal(leaky in r.json, false, `泄漏字段 ${leaky}`);
    assert.equal("path" in (r.json.claude || {}), false);
  });
  await test("A-04", "P0", "查询串令牌对非白名单端点无效（/api/state?token=）→ 401", async () => {
    const r = await api("GET", `/api/state?token=${token}`, { useToken: false });
    assert.equal(r.status, 401);
  });
  await test("A-05", "P1", "静态资源免鉴权 GET /style.css → 200", async () => {
    const r = await api("GET", "/style.css", { useToken: false });
    assert.equal(r.status, 200);
    assert.match(r.text, /body|:root|\{/);
  });
  await test("A-06", "P1", "静态资源携带安全头（nosniff / CSP / no-store）", async () => {
    const r = await api("GET", "/style.css", { useToken: false });
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.match(r.headers.get("content-security-policy") || "", /default-src 'self'/);
    assert.equal(r.headers.get("cache-control"), "no-store");
  });
  await test("A-07", "P0", "Origin 不符 → 403", async () => {
    const r = await raw("GET", "/api/state", { ...auth, Origin: "http://evil.example" });
    assert.equal(r.status, 403);
  });
  await test("A-08", "P0", "Host 不符（localhost 而非 127.0.0.1）→ 403", async () => {
    const r = await raw("GET", "/api/state", { ...auth, Host: `localhost:${PORT}` });
    assert.equal(r.status, 403);
  });
  // 保存换取 Cookie 前的启动令牌，供 A-09b 验证「单次使用后作废」。
  const bootstrapTokenBeforeExchange = token;
  await test("A-09", "P1", "流式接口换取 HttpOnly 会话 Cookie", async () => {
    const r = await api("POST", "/api/auth/session", { body: {} });
    assert.equal(r.status, 200);
    streamCookie = String(r.headers.get("set-cookie") || "").split(";", 1)[0];
    assert.match(streamCookie, /^ccdph_stream_auth=[0-9a-f]{64}$/);
    assert.match(r.headers.get("set-cookie") || "", /HttpOnly/i);
    assert.match(r.headers.get("set-cookie") || "", /SameSite=Strict/i);
    // CCDPH-FIX(R5-P3-4): 换取 Cookie 后启动令牌（token）已作废，后续用例改用主进程令牌
    // streamAuthToken（从 Cookie 值提取，命中服务端 x-workbench-token=streamAuthToken 校验分支）。
    token = streamCookie.slice("ccdph_stream_auth=".length);
    auth = { "x-workbench-token": token };
  });
  await test("A-09b", "P0", "启动令牌换取 Cookie 后即作废（单次使用）", async () => {
    // 用「已作废」的启动令牌再访问应 401；此处用 A-09 之前保存的启动令牌值验证单次性。
    const r = await api("GET", "/api/state", {
      tokenOverride: bootstrapTokenBeforeExchange,
    });
    assert.equal(r.status, 401);
  });
  await test("A-10", "P1", "HttpOnly 会话 Cookie 可鉴权普通 API", async () => {
    const response = await fetch(`${ORIGIN}/api/state`, {
      headers: { cookie: streamCookie },
    });
    assert.equal(response.status, 200);
    const state = await response.json();
    // CCDPH-FIX(NIT): 原来硬编码 "0.3.2"，每次升版本都会让门禁误报失败。
    // 改为从 package.json 读取真实版本。
    assert.equal(
      state.version,
      JSON.parse(
        await readFile(new URL("../package.json", import.meta.url), "utf8"),
      ).version,
    );
  });

  // =====================================================================
  area = "D2 路由分发";
  // =====================================================================
  await test("R-01", "P1", "未知 /api/nope → 404", async () => {
    const r = await api("GET", "/api/nope");
    assert.equal(r.status, 404);
  });
  await test("R-02", "P1", "方法不匹配 GET /api/projects → 404", async () => {
    const r = await api("GET", "/api/projects");
    assert.equal(r.status, 404);
  });
  await test("R-03", "P1", "方法不匹配 POST /api/state → 404", async () => {
    const r = await api("POST", "/api/state", { body: {} });
    assert.equal(r.status, 404);
  });
  await test("R-04", "P1", "HEAD 静态资源 → 200 且无体", async () => {
    const r = await raw("HEAD", "/style.css");
    assert.equal(r.status, 200);
    assert.equal(r.text.length, 0);
  });

  // =====================================================================
  area = "D5/D6 路径安全（HTTP 行为）";
  // =====================================================================
  await test("P-01", "P0", "GET /api/file 越界 ../ → 400 且不泄漏路径", async () => {
    const rel = path.relative(projectDir, path.join(outsideDir, "secret.txt")).replaceAll("\\", "/");
    const r = await api("GET", `/api/file?projectId=${projectId}&path=${encodeURIComponent(rel)}`);
    assert.equal(r.status, 400);
    assert.match(r.json.error, /当前项目内|无效|不存在/);
    assert(!r.text.includes("SECRET-OUTSIDE"), "越界内容泄漏");
  });
  await test("P-02", "P0", "GET /api/file ADS 冒号 → 400", async () => {
    const r = await api("GET", `/api/file?projectId=${projectId}&path=${encodeURIComponent("normal.txt:secret")}`);
    assert.equal(r.status, 400);
    assert.match(r.json.error, /非法字符|:/);
  });
  await test("P-03", "P0", "GET /api/files 目录越界 → 400", async () => {
    const rel = path.relative(projectDir, outsideDir).replaceAll("\\", "/");
    const r = await api("GET", `/api/files?projectId=${projectId}&path=${encodeURIComponent(rel)}`);
    assert.equal(r.status, 400);
  });
  await test("P-04", "P1", "GET /api/file 合法文本 → 200 内容一致", async () => {
    const r = await api("GET", `/api/file?projectId=${projectId}&path=normal.txt`);
    assert.equal(r.status, 200);
    assert.equal(r.json.text, "hello-ccdph");
  });
  await test("P-05", "P1", "GET /api/diff 绝对路径 → 400", async () => {
    const r = await api("GET", `/api/diff?projectId=${projectId}&path=${encodeURIComponent("C:/Windows/win.ini")}`);
    assert.equal(r.status, 400);
  });

  // =====================================================================
  area = "D13/D16 请求体闸门";
  // =====================================================================
  await test("B-01", "P1", "非 JSON Content-Type → 400", async () => {
    const response = await fetch(`${ORIGIN}/api/projects`, {
      method: "POST",
      headers: { ...auth, "content-type": "text/plain" },
      body: "path=x",
      signal: AbortSignal.timeout(8000),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Content-Type/);
  });
  await test("B-02", "P1", "数组正文（非对象）→ 400", async () => {
    const r = await api("POST", "/api/projects", { body: [1, 2, 3] });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /JSON 对象/);
  });
  await test("B-03", "P1", "非法 JSON → 400 且文案不含解析器内部信息", async () => {
    const r = await api("POST", "/api/projects", { body: "{not-json" });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /合法 JSON/);
    assert(!/position|line \d/.test(r.json.error));
  });
  await test("B-04", "P1", "超大 payload（~17MB > 16MB 单请求上限）→ 400", async () => {
    const huge = JSON.stringify({ path: "C:\\x", pad: "a".repeat(17 * 1024 * 1024) });
    const r = await api("POST", "/api/projects", { body: huge, timeout: 30_000 });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /过大|过多请求/);
  });
  await test("B-05", "P1", "JSON 嵌套超 100 层 → 400", async () => {
    const r = await api("POST", "/api/projects", { body: '{"a":'.repeat(120) + "0" + "}".repeat(120) });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /嵌套|JSON/);
  });

  // =====================================================================
  area = "D8 会话与事件";
  // =====================================================================
  await test("S-01", "P0", "POST /api/sessions 缺 projectId → 400", async () => {
    const r = await api("POST", "/api/sessions", { body: {} });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /项目/);
  });
  await test("S-02", "P0", "POST /api/sessions 未知 projectId → 400", async () => {
    const r = await api("POST", "/api/sessions", { body: { projectId: "no-such" } });
    assert.equal(r.status, 400);
  });
  await test("S-03", "P1", "GET /api/session 未知 id → 400", async () => {
    const r = await api("GET", "/api/session?id=nope");
    assert.equal(r.status, 400);
    assert.match(r.json.error, /会话不存在/);
  });
  await test("S-04", "P1", "GET /api/session 合法 → 200", async () => {
    const r = await api("GET", `/api/session?id=${sessionId}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.id, sessionId);
  });
  await test("S-05", "P1", "POST /api/session/update 空标题 → 400", async () => {
    const r = await api("POST", "/api/session/update", { body: { sessionId, title: "   " } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /名称不能为空/);
  });
  await test("S-06", "P1", "POST /api/session/update 合法标题 → 200", async () => {
    const r = await api("POST", "/api/session/update", { body: { sessionId, title: "改名成功-QA" } });
    assert.equal(r.status, 200);
    assert.equal(r.json.title, "改名成功-QA");
  });
  await test("S-07", "P1", "POST /api/session/control 未运行会话 → 400", async () => {
    const r = await api("POST", "/api/session/control", { body: { sessionId, model: "sonnet" } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /没有正在运行/);
  });
  await test("S-08", "P1", "POST /api/send 缺 prompt → 400", async () => {
    const r = await api("POST", "/api/send", { body: { sessionId } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /有效消息/);
  });
  await test("S-09", "P1", "POST /api/send prompt 超 100000 → 400", async () => {
    const r = await api("POST", "/api/send", { body: { sessionId, prompt: "x".repeat(100001) } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /100000|有效消息/);
  });
  await test("S-10", "P1", "POST /api/send 非法图片格式 → 400", async () => {
    const r = await api("POST", "/api/send", {
      body: { sessionId, prompt: "hi", images: [{ type: "text/plain", data: "AAAA" }] },
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /图片/);
  });
  await test("S-11", "P1", "POST /api/approve 失效 requestId → 400", async () => {
    const r = await api("POST", "/api/approve", { body: { sessionId, requestId: "stale", allow: true } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /失效/);
  });
  await test("S-12", "P1", "GET /api/export 合法 → 200 含 text", async () => {
    const r = await api("GET", `/api/export?id=${sessionId}`);
    assert.equal(r.status, 200);
    assert.equal(typeof r.json.text, "string");
  });
  await test("S-13", "P1", "GET /api/events 非运行会话 → 200 SSE 快照", async () => {
    const r = await api("GET", `/api/events?id=${sessionId}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") || "", /text\/event-stream/);
    assert.match(r.text, /"type":"snapshot"/);
  });

  // =====================================================================
  area = "D3 终端生命周期";
  // =====================================================================
  let terminalId = "";
  await test("T-01", "P1", "POST /api/terminal/start → 200 含 id", async () => {
    const r = await api("POST", "/api/terminal/start", { body: { projectId, sessionId } });
    assert.equal(r.status, 200);
    assert.equal(typeof r.json.id, "string");
    terminalId = r.json.id;
  });
  await test("T-02", "P1", "POST /api/terminal/input 未知终端 → 400", async () => {
    const r = await api("POST", "/api/terminal/input", { body: { id: "ghost", text: "x" } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /终端不存在/);
  });
  await test("T-03", "P1", "POST /api/terminal/input 合法 → 200", async () => {
    const r = await api("POST", "/api/terminal/input", { body: { id: terminalId, text: "echo hi\r\n" } });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
  });
  await test("T-04", "P1", "GET /api/terminal/events HttpOnly 会话 Cookie 可用 → 200", async () => {
    const controller = new AbortController();
    try {
      const response = await fetch(
        `${ORIGIN}/api/terminal/events?id=${encodeURIComponent(terminalId)}`,
        {
          headers: { cookie: streamCookie },
          signal: controller.signal,
        },
      );
      assert.equal(response.status, 200);
      const { value } = await response.body.getReader().read();
      assert(value && value.length > 0, "SSE 首帧为空");
    } finally {
      controller.abort();
    }
  });
  await test("T-05", "P1", "POST /api/terminal/stop → 200", async () => {
    const r = await api("POST", "/api/terminal/stop", { body: { id: terminalId } });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    // CCDPH-FIX(R3-P3-8): 停止一个真实在跑的终端必须如实回 stopped:true。
    assert.equal(r.json.stopped, true);
  });
  await test("T-06", "P1", "POST /api/terminal/stop 幂等（重复 → 200）", async () => {
    const r = await api("POST", "/api/terminal/stop", { body: { id: terminalId } });
    assert.equal(r.status, 200);
    // CCDPH-FIX(R3-P3-8): 重复停止（或对未知 id）必须如实回 stopped:false + reason，
    // 而不是裸 {ok:true} 谎称"停掉了"。
    assert.equal(r.json.ok, true);
    assert.equal(r.json.stopped, false);
    assert.ok(r.json.reason, "必须给出未停止的原因");
  });
  await test("T-07", "P1", "POST /api/terminal/start 缺 projectId → 400", async () => {
    const r = await api("POST", "/api/terminal/start", { body: {} });
    assert.equal(r.status, 400);
  });

  // =====================================================================
  area = "D11 供应商配置 & 设置";
  // =====================================================================
  await test("C-01", "P1", "GET /api/api-profiles → 200 结构", async () => {
    const r = await api("GET", "/api/api-profiles");
    assert.equal(r.status, 200);
    assert(Array.isArray(r.json.profiles));
  });
  await test("C-02", "P1", "POST /api/api-profiles/save 缺 name → 400", async () => {
    const r = await api("POST", "/api/api-profiles/save", { body: { baseUrl: "https://a.example" } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /名称/);
  });
  await test("C-03", "P1", "baseUrl 非 http → 400", async () => {
    const r = await api("POST", "/api/api-profiles/save", { body: { name: "n", baseUrl: "ftp://x" } });
    assert.equal(r.status, 400);
  });
  await test("C-04", "P1", "baseUrl 明文 http 非 loopback → 400（强制 https）", async () => {
    const r = await api("POST", "/api/api-profiles/save", { body: { name: "n", baseUrl: "http://api.example.com" } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /https/);
  });
  await test("C-05", "P1", "env 携带凭据字段 → 400（禁止落 state.json）", async () => {
    const r = await api("POST", "/api/api-profiles/save", {
      body: { name: "n", baseUrl: "https://a.example", env: { ANTHROPIC_API_KEY: "sk-secret" } },
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /密钥/);
  });
  await test("C-06", "P1", "env 非法变量名 → 400", async () => {
    const r = await api("POST", "/api/api-profiles/save", {
      body: { name: "n", baseUrl: "https://a.example", env: { NOT_ANTHROPIC: "x" } },
    });
    assert.equal(r.status, 400);
  });
  await test("C-07", "P1", "合法保存 → 200 含 id；activate/key/delete 未知 id → 400", async () => {
    const saved = await api("POST", "/api/api-profiles/save", {
      body: { name: "QA-供应商", baseUrl: "https://api.example.com", env: { ANTHROPIC_MODEL: "claude-3" } },
    });
    assert.equal(saved.status, 200);
    const id = saved.json.id;
    assert.equal(typeof id, "string");
    assert.equal(saved.json.hasKey, false);
    const activate = await api("POST", "/api/api-profiles/activate", { body: { id: "missing" } });
    assert.equal(activate.status, 400);
    const key = await api("POST", "/api/api-profiles/key", { body: { id: "missing", token: "t" } });
    assert.equal(key.status, 400);
    const del = await api("POST", "/api/api-profiles/delete", { body: { id } });
    assert.equal(del.status, 200);
    assert.equal(del.json.ok, true);
  });
  await test("C-08", "P1", "并发保存 6 个供应商不丢更新（profileWriteQueue）", async () => {
    const names = Array.from({ length: 6 }, (_, i) => `并发-${i}`);
    const responses = await Promise.all(
      names.map((name, i) =>
        api("POST", "/api/api-profiles/save", { body: { name, baseUrl: `https://c${i}.example.com` } }),
      ),
    );
    for (const r of responses) assert.equal(r.status, 200, `并发保存失败: ${r.text}`);
    const list = await api("GET", "/api/api-profiles");
    const present = new Set(list.json.profiles.map((p) => p.name));
    for (const name of names) assert(present.has(name), `并发丢更新：缺少 ${name}`);
    // 清理，避免占用后续上限
    for (const r of responses) await api("POST", "/api/api-profiles/delete", { body: { id: r.json.id } });
  });
  await test("C-09", "P2", "POST /api/settings 非法端口被静默忽略（不落库、不回特权端口）", async () => {
    // buildNextSettings 是「白名单清洗器」：非法值不报错、直接丢弃，故按设计断言其**净效果**——
    // 特权端口 80 绝不进入持久化设置（安全属性成立），而非断言 400。
    const before = await api("GET", "/api/state");
    const beforePort = before.json.settings?.browser?.dedicatedPort;
    const r = await api("POST", "/api/settings", { body: { browser: { dedicatedPort: 80 } } });
    assert.equal(r.status, 200);
    assert.notEqual(r.json.browser.dedicatedPort, 80, "特权端口不得被接受");
    assert.equal(r.json.browser.dedicatedPort, beforePort, "非法端口应保持原值");
  });
  await test("C-09b", "P2", "POST /api/settings 显式写端口会置 dedicatedPortMigrated（避免 9223 被再次迁移）", async () => {
    const r = await api("POST", "/api/settings", { body: { browser: { dedicatedPort: 30000 } } });
    assert.equal(r.status, 200);
    assert.equal(r.json.browser.dedicatedPort, 30000, "合法端口应被接受");
    assert.equal(r.json.browser.dedicatedPortMigrated, true, "显式写端口必须置迁移标记");
  });
  await test("C-10", "P1", "POST /api/browser/enable 特权端口 → 400 且不落盘 enabled（事务原子性）", async () => {
    const r = await api("POST", "/api/browser/enable", { body: { mode: "attach", dedicatedPort: 80 } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /端口/);
    const status = await api("GET", "/api/browser/status");
    assert.equal(status.status, 200);
    assert.equal(status.json.enabled, false, "被拒绝的启用意图不得落盘（RK-11 回归）");
  });
  await test("C-10b", "P1", "POST /api/browser/enable 专用模式未确认风险 → 400（P1-3 默认禁用）", async () => {
    const r = await api("POST", "/api/browser/enable", { body: { mode: "dedicated" } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /确认安全风险/);
    const status = await api("GET", "/api/browser/status");
    assert.equal(status.status, 200);
    assert.notEqual(status.json.mode, "dedicated", "未确认风险不得切到专用模式");
  });

  // =====================================================================
  area = "D10 集成 MCP / Hooks";
  // =====================================================================
  await test("I-01", "P1", "GET /api/mcp-servers（项目上下文）→ 200 含 servers 数组", async () => {
    const r = await api("GET", `/api/mcp-servers?projectId=${projectId}&sessionId=${sessionId}`);
    assert.equal(r.status, 200);
    assert(Array.isArray(r.json.servers));
  });
  await test("I-01b", "P2", "GET /api/mcp-servers（无项目）→ 用户级列表 200", async () => {
    const r = await api("GET", "/api/mcp-servers?projectId=");
    assert.equal(r.status, 200, `实际 ${r.status}: ${r.text}`);
    assert(Array.isArray(r.json.servers));
  });
  await test("I-02", "P1", "MCP 删除原型污染名 valueOf → 400（非假成功）", async () => {
    const r = await api("POST", "/api/mcp-servers/delete", { body: { name: "valueOf" } });
    assert.equal(r.status, 400);
    assert.equal(r.json.ok, undefined);
  });
  await test("I-03", "P1", "MCP 删除非法名 → 400（字符集闸门）", async () => {
    const r = await api("POST", "/api/mcp-servers/delete", { body: { name: "bad name!" } });
    assert.equal(r.status, 400);
  });
  await test("I-04", "P1", "GET /api/hooks → 200 结构（events/hooks/count）", async () => {
    const r = await api("GET", "/api/hooks");
    assert.equal(r.status, 200);
    assert(Array.isArray(r.json.events));
    assert.equal(typeof r.json.count, "number");
  });
  const events = (await api("GET", "/api/hooks")).json.events || [];
  const firstEvent = events[0];
  await test("I-05", "P1", "hooks add 不支持的事件名 → 400", async () => {
    const r = await api("POST", "/api/hooks/save", { body: { action: "add", event: "NotARealEvent", command: "echo x" } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /不支持的事件名/);
  });
  await test("I-06", "P1", "hooks set 缺 hooks 内容 → 400", async () => {
    const r = await api("POST", "/api/hooks/save", { body: { action: "set" } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /缺少 hooks/);
  });
  await test("I-07", "P1", "hooks 不支持的操作 → 400", async () => {
    const r = await api("POST", "/api/hooks/save", { body: { action: "bogus", event: firstEvent } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /不支持的操作/);
  });
  await test("I-08", "P1", "hooks update 的数组分支恢复脱敏命令", async () => {
    assert(firstEvent, "无可用事件名");
    const secretCommand = "echo sk-hook-secret-123456";
    const added = await api("POST", "/api/hooks/save", {
      body: { action: "add", event: firstEvent, command: secretCommand },
    });
    assert.equal(added.status, 200);
    const listed = await api("GET", "/api/hooks");
    const index = listed.json.hooks[firstEvent].length - 1;
    const redactedHooks = listed.json.hooks[firstEvent][index].hooks;
    assert.match(redactedHooks[0].command, /…/);
    const updated = await api("POST", "/api/hooks/save", {
      body: {
        action: "update",
        event: firstEvent,
        index,
        matcher: "updated-matcher",
        command: "advanced-array-update",
        hooks: redactedHooks,
      },
    });
    assert.equal(updated.status, 200, updated.text);
    const settingsDoc = JSON.parse(
      await readFile(path.join(claudeDir, "settings.json"), "utf8"),
    );
    assert.equal(
      settingsDoc.hooks[firstEvent][index].hooks[0].command,
      secretCommand,
    );
    const removed = await api("POST", "/api/hooks/save", {
      body: { action: "delete", event: firstEvent, index },
    });
    assert.equal(removed.status, 200);
  });
  await test("I-09", "P1", "hooks update 的单命令分支恢复脱敏命令", async () => {
    const secretCommand = "echo Bearer hook-secret-token-987654";
    const added = await api("POST", "/api/hooks/save", {
      body: { action: "add", event: firstEvent, command: secretCommand },
    });
    assert.equal(added.status, 200);
    const listed = await api("GET", "/api/hooks");
    const index = listed.json.hooks[firstEvent].length - 1;
    const redactedCommand = listed.json.hooks[firstEvent][index].hooks[0].command;
    assert.match(redactedCommand, /…/);
    const updated = await api("POST", "/api/hooks/save", {
      body: {
        action: "update",
        event: firstEvent,
        index,
        matcher: "single-command-update",
        command: redactedCommand,
      },
    });
    assert.equal(updated.status, 200, updated.text);
    const settingsDoc = JSON.parse(
      await readFile(path.join(claudeDir, "settings.json"), "utf8"),
    );
    assert.equal(
      settingsDoc.hooks[firstEvent][index].hooks[0].command,
      secretCommand,
    );
    const removed = await api("POST", "/api/hooks/save", {
      body: { action: "delete", event: firstEvent, index },
    });
    assert.equal(removed.status, 200);
  });
  await test("I-10", "P1", "hooks add 单事件上限 50：第 51 条 → 400", async () => {
    assert(firstEvent, "无可用事件名");
    let last = null;
    for (let i = 0; i < 50; i += 1)
      last = await api("POST", "/api/hooks/save", { body: { action: "add", event: firstEvent, command: `echo ${i}` } });
    assert.equal(last.status, 200, `第 50 条应成功: ${last.text}`);
    const over = await api("POST", "/api/hooks/save", { body: { action: "add", event: firstEvent, command: "echo over" } });
    assert.equal(over.status, 400);
    assert.match(over.json.error, /上限/);
  });

  // =====================================================================
  area = "D12 更新与安装";
  // =====================================================================
  await test("U-01", "P1", "GET /api/update/status → 200", async () => {
    const r = await api("GET", "/api/update/status");
    assert.equal(r.status, 200);
  });
  await test("U-02", "P1", "POST /api/update/install 非桌面版 → 400", async () => {
    const r = await api("POST", "/api/update/install", { body: {} });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /桌面版|手动下载/);
  });

  // =====================================================================
  area = "D13 并发 / 限流分桶";
  // =====================================================================
  await test("N-01", "P1", "20 并发 GET /api/state 全部 200", async () => {
    const rs = await Promise.all(Array.from({ length: 20 }, () => api("GET", "/api/state")));
    assert(rs.every((r) => r.status === 200), `并发状态查询异常: ${JSON.stringify(rs.map((r) => r.status))}`);
  });
  await test("N-02", "P1", "未认证高频请求触发限流（最终出现 429）", async () => {
    let unauthorized = 0;
    let limited = 0;
    for (let i = 0; i < 80; i += 1) {
      const r = await api("GET", "/api/state", { useToken: false });
      if (r.status === 401) unauthorized += 1;
      else if (r.status === 429) limited += 1;
    }
    assert(unauthorized >= 1, "未出现未认证 401");
    assert(limited >= 1, `未认证桶未触发限流（401=${unauthorized}, 429=${limited}）`);
  });
} finally {
  if (child && child.exitCode === null) child.kill();
  await new Promise((resolve) => setTimeout(resolve, 250));
  for (const dir of [dataDir, projectDir, outsideDir, claudeRoot])
    await rm(dir, { recursive: true, force: true, maxRetries: 10 }).catch(() => {});
}

// ---- 汇总 --------------------------------------------------------------------
const total = results.length;
const passed = results.filter((r) => r.status === "PASS").length;
const failed = results.filter((r) => r.status === "FAIL").length;
const known = results.filter((r) => r.status === "KNOWN").length;
const knownFixed = results.filter((r) => r.status === "KNOWN-FIXED").length;
const executed = passed + failed;
const bySeverity = {};
for (const r of results) bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;
const byArea = {};
for (const r of results) {
  byArea[r.area] ||= { total: 0, failed: 0 };
  byArea[r.area].total += 1;
  if (r.status === "FAIL") byArea[r.area].failed += 1;
}

console.log("\n===== CCDPH 接口自动化用例结果（B3） =====");
for (const r of results) {
  const tag =
    r.status === "PASS" ? "✓" : r.status === "FAIL" ? "✗" : r.status === "KNOWN" ? "!" : "○";
  const suffix =
    r.status === "FAIL"
      ? ` — ERROR: ${r.error}`
      : r.status === "KNOWN"
        ? ` — ${r.note}`
        : r.status === "KNOWN-FIXED"
          ? ` — ${r.note}`
          : "";
  console.log(`[${r.severity}] ${tag} ${r.id} ${r.name}${suffix}`);
}
console.log("\n===== 汇总 =====");
console.log(`区域细分: ${Object.entries(byArea).map(([k, v]) => `${k}(${v.total - v.failed}/${v.total})`).join(" | ")}`);
console.log(`总计 ${total} | 通过 ${passed} | 失败 ${failed} | 已知缺陷隔离 ${known} | 已修复待复核 ${knownFixed}`);
console.log(`通过率（不含隔离项）: ${executed ? ((passed / executed) * 100).toFixed(1) : "0.0"}%（${passed}/${executed}）`);
console.log(`分级分布: ${JSON.stringify(bySeverity)}`);
console.log(`P0 失败数: ${results.filter((r) => r.status === "FAIL" && r.severity === "P0").length}`);
for (const r of results.filter((x) => x.status === "KNOWN"))
  console.log(`已知缺陷: ${r.note}（用例 ${r.id}）`);

if (failed > 0) process.exitCode = 1;
