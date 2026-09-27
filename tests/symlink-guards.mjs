// CCDPH-FIX(R3-P3-3 / R3-P3-4): /api/skills 与项目 .mcp.json 必须拒绝符号链接。
// 复现原始漏洞：项目里放一个指向项目外文件的符号链接，旧实现会把外部文件内容当描述回传。
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const data = await mkdtemp(path.join(os.tmpdir(), "ccdph-symlink-guard-"));
process.env.WORKBENCH_DATA_DIR = data;
process.env.WORKBENCH_PORT = String(49300 + Math.floor(Math.random() * 300));
process.env.WORKBENCH_DESKTOP = "0";
process.env.CLAUDE_CONFIG_DIR = path.join(data, ".claude");

const victim = await mkdtemp(path.join(os.tmpdir(), "ccdph-symlink-victim-"));
const project = await mkdtemp(path.join(os.tmpdir(), "ccdph-symlink-proj-"));
const secret = path.join(victim, "secret.env");
await writeFile(secret, "# TOP-SECRET-KEY-abcdef\ndescription: leaked-please\n", "utf8");

const engine = await import("../server.mjs");
const server = await engine.start();

try {
  const token = engine.getRuntime().url.split("#")[1];
  const api = async (route) => {
    const res = await fetch(`http://127.0.0.1:${process.env.WORKBENCH_PORT}/api/${route}`, {
      headers: { "x-workbench-token": token },
    });
    return { status: res.status, text: await res.text() };
  };

  // 建项目
  const projRes = await fetch(`http://127.0.0.1:${process.env.WORKBENCH_PORT}/api/projects`, {
    method: "POST",
    headers: { "x-workbench-token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ path: project }),
  });
  const projectId = (await projRes.json()).id;
  assert.ok(projectId, "应能创建项目");

  // 项目里放符号链接 SKILL.md -> 项目外文件
  const skillDir = path.join(project, ".claude", "skills", "leak");
  await mkdir(skillDir, { recursive: true });
  await symlink(secret, path.join(skillDir, "SKILL.md"), "file");

  const skills = await api(`skills?projectId=${projectId}`);
  assert.equal(skills.status, 200);
  assert.ok(!skills.text.includes("leaked-please"), "符号链接 SKILL.md 不得泄漏外部文件内容");

  // 项目里放符号链接 .mcp.json -> 项目外文件
  const outsideMcp = path.join(victim, "outside-mcp.json");
  await writeFile(
    outsideMcp,
    JSON.stringify({ mcpServers: { leaked: { command: "/bin/echo", env: { SECRET: "1" } } } }),
    "utf8",
  );
  await symlink(outsideMcp, path.join(project, ".mcp.json"), "file");
  const mcp = await api(`mcp-servers?projectId=${projectId}`);
  assert.equal(mcp.status, 200);
  assert.ok(!mcp.text.includes("leaked"), "符号链接 .mcp.json 不得泄漏外部 MCP 配置");

  console.log("symlink guards ok: skills & project .mcp.json refuse symlinked files");
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(data, { recursive: true, force: true }).catch(() => {});
  await rm(victim, { recursive: true, force: true }).catch(() => {});
  await rm(project, { recursive: true, force: true }).catch(() => {});
}
