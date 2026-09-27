// CCDPH-FIX(R3-P3-15): 来源校验加固 —— 重复 Host 头与绝对形式请求行都必须 403。
// 用原始套接字发（浏览器/undici 都会拒绝这两类请求，所以必须绕过 HTTP 客户端）。
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const data = await mkdtemp(path.join(os.tmpdir(), "ccdph-gate-hard-"));
process.env.WORKBENCH_DATA_DIR = data;
process.env.WORKBENCH_PORT = String(49600 + Math.floor(Math.random() * 300));
process.env.WORKBENCH_DESKTOP = "0";
process.env.CLAUDE_CONFIG_DIR = path.join(data, ".claude");

const engine = await import("../server.mjs");
const server = await engine.start();
const port = Number(process.env.WORKBENCH_PORT);
const token = engine.getRuntime().url.split("#")[1];

function raw(text, waitMs = 3000) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(text));
    let data = "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const status = (data.match(/HTTP\/1\.1 (\d+)/) || [])[1];
      resolve({ status: status ? Number(status) : null, head: data.split("\r\n")[0] });
      socket.destroy();
    };
    socket.on("data", (chunk) => {
      data += chunk.toString();
      if (/HTTP\/1\.1 \d+/.test(data)) finish();
    });
    socket.on("close", finish);
    socket.on("error", finish);
    setTimeout(finish, waitMs);
  });
}

try {
  // 基线：正确 Host + token → 200
  const baseline = await raw(
    `GET /api/state HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nx-workbench-token: ${token}\r\n\r\n`,
  );
  assert.equal(baseline.status, 200, "正确 Host 应 200");

  // 重复 Host 头 → 403
  const dupHost = await raw(
    `GET /api/state HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nx-workbench-token: ${token}\r\nHost: evil.example\r\n\r\n`,
  );
  assert.equal(dupHost.status, 403, "重复 Host 头必须 403");

  // 绝对形式请求行 → 403
  const absolute = await raw(
    `GET http://evil.example/api/state HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nx-workbench-token: ${token}\r\n\r\n`,
  );
  assert.equal(absolute.status, 403, "绝对形式请求行必须 403");

  // 绝对形式 + loopback 也一样要 403（不能只放行"看起来安全"的 authority）
  const absoluteLoopback = await raw(
    `GET http://127.0.0.1:${port}/api/state HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nx-workbench-token: ${token}\r\n\r\n`,
  );
  assert.equal(absoluteLoopback.status, 403, "绝对形式请求行必须一律 403");

  console.log("request gate hardening ok: duplicate Host and absolute-form URIs rejected");
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(data, { recursive: true, force: true }).catch(() => {});
}
