import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (process.platform !== "win32") {
  console.log("credential migration failure skipped: Windows DPAPI only");
  process.exit(0);
}

const dataDir = await mkdtemp(path.join(os.tmpdir(), "ccdph-credential-migrate-"));
const authFile = path.join(dataDir, "api-auth.json");
const secret = "sk-legacy-plaintext-must-not-remain-usable";
const original = `${JSON.stringify({ version: 1, tokens: { legacy: secret } }, null, 2)}\n`;
await writeFile(authFile, original, "utf8");
process.env.WORKBENCH_DATA_DIR = dataDir;
process.env.WORKBENCH_PORT = String(48870 + Math.floor(Math.random() * 30));
process.env.SystemRoot = path.join(dataDir, "missing-windows");

let engine;
let server;
try {
  engine = await import("../server.mjs");
  server = await engine.start();
  await assert.rejects(access(authFile), { code: "ENOENT" });
  const state = engine.buildPublicStateSnapshot();
  assert.equal(state.apiAuthPersistence, "session");
  assert.match(state.apiAuthWarning, /本次运行|重新输入/);
  console.log("credential migration failure ok: startup continues in session-only mode and removes plaintext file");
} finally {
  await engine?.stopRuns().catch(() => {});
  await new Promise((resolve) => server?.close(resolve) ?? resolve());
  await rm(dataDir, { recursive: true, force: true });
}
