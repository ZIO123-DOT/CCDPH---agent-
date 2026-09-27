import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "ccdph-credential-session-"));
process.env.WORKBENCH_DATA_DIR = dataDir;
process.env.WORKBENCH_PORT = String(48830 + Math.floor(Math.random() * 30));

const engine = await import("../server.mjs");
engine.setCredentialProtector(null);
let server;
try {
  server = await engine.start();
  const runtimeUrl = new URL(engine.getRuntime().url);
  const headers = {
    "content-type": "application/json",
    "x-workbench-token": runtimeUrl.hash.slice(1),
  };
  const post = async (route, body) => {
    const response = await fetch(`${runtimeUrl.origin}/api/${route}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  const profile = await post("api-profiles/save", {
    name: "Session provider",
    baseUrl: "https://api.example.com",
    model: "test-model",
  });
  const saved = await post("api-profiles/key", {
    id: profile.id,
    token: "sk-session-only-secret",
  });
  assert.equal(saved.hasKey, true);
  assert.equal(saved.persistent, false);
  assert.match(saved.warning, /本次运行|重新输入/);
  await assert.rejects(access(path.join(dataDir, "api-auth.json")), {
    code: "ENOENT",
  });
  console.log("credential session-only ok: key remains in memory and never reaches disk");
} finally {
  await engine.stopRuns().catch(() => {});
  await new Promise((resolve) => server?.close(resolve) ?? resolve());
  await rm(dataDir, { recursive: true, force: true });
}
