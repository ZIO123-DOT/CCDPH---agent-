// CCDPH-FIX(R3-P3-5): 载入 state.json 时对 settings.browser 做与写入路径一致的校验。
// 直接改 state.json 塞进 dedicatedPort:80 / 非法 mode / 非布尔 enabled / 含 ; 的 origin，
// 启动后必须被归一化回安全默认。
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const data = await mkdtemp(path.join(os.tmpdir(), "ccdph-load-val-"));
process.env.WORKBENCH_DATA_DIR = data;
process.env.WORKBENCH_PORT = String(49000 + Math.floor(Math.random() * 300));
process.env.WORKBENCH_DESKTOP = "0";
process.env.CLAUDE_CONFIG_DIR = path.join(data, ".claude");

// 预置一份被篡改的 state.json（结构与服务端持久化格式一致）
const tampered = {
  projects: [],
  sessions: [],
  settings: {
    browser: {
      enabled: "yes", // 非布尔
      mode: "attch", // 非法枚举（拼写错误）
      dedicatedPort: 80, // 非法端口
      profileDir: "",
      imageResponses: "explode", // 非法枚举
      allowOrigins: ["ok.example", "bad;x\r\n", "-evil", "<img>", "a".repeat(300)],
      blockOrigins: ["fine.example"],
    },
  },
};
await writeFile(path.join(data, "state.json"), JSON.stringify(tampered), "utf8");

const engine = await import("../server.mjs");
const server = await engine.start();

try {
  const settings = engine.getSettings();
  const browser = settings.browser;
  assert.ok(typeof browser.enabled === "boolean", "enabled 必须是布尔");
  assert.ok(["attach", "dedicated"].includes(browser.mode), "mode 必须是合法枚举");
  assert.equal(browser.dedicatedPort, 9223, "非法端口应回退默认 9223");
  assert.equal(browser.imageResponses, "omit", "非法 imageResponses 应回退默认");
  // 含 ; / CRLF / < > / 前导 - 的条目必须被过滤；合法域名保留；每条 ≤200 字符。
  assert.ok(browser.allowOrigins.includes("ok.example"), "合法 origin 应保留");
  for (const bad of ["bad;x", "-evil", "<img>"]) {
    assert.ok(
      !browser.allowOrigins.some((value) => value.includes(bad)),
      `非法 origin「${bad}」必须被过滤`,
    );
  }
  for (const value of browser.allowOrigins)
    assert.ok(value.length <= 200, "origin 条目长度必须 ≤200");
  assert.deepEqual(browser.blockOrigins, ["fine.example"], "合法 origin 应保留");
  console.log("settings load validation ok: tampered browser.* normalized to safe defaults");
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(data, { recursive: true, force: true }).catch(() => {});
}
