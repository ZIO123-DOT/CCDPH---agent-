import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "ccdph-credential-lock-"));
const authFile = path.join(dataDir, "api-auth.json");
const original = `${JSON.stringify({
  version: 2,
  protection: "unavailable-protector",
  payload: "do-not-overwrite",
}, null, 2)}\n`;
await writeFile(authFile, original, "utf8");
process.env.WORKBENCH_DATA_DIR = dataDir;
process.env.WORKBENCH_PORT = String(48910 + Math.floor(Math.random() * 30));
process.env.WORKBENCH_DESKTOP = "0";

const engine = await import("../server.mjs");
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
    return { response, body: await response.json() };
  };
  const profile = await post("api-profiles/save", {
    name: "Locked provider",
    baseUrl: "https://api.example.com",
    model: "test-model",
  });
  assert.equal(profile.response.status, 200);
  const keyWrite = await post("api-profiles/key", {
    id: profile.body.id,
    token: "sk-test-must-not-overwrite-locked-store",
  });
  assert.equal(keyWrite.response.status, 400);
  assert.match(keyWrite.body.error, /密钥保存失败|锁定/);
  assert.equal(await readFile(authFile, "utf8"), original);
  const deleteAttempt = await post("api-profiles/delete", { id: profile.body.id });
  assert.equal(deleteAttempt.response.status, 400);
  const profilesResponse = await fetch(`${runtimeUrl.origin}/api/api-profiles`, {
    headers: { "x-workbench-token": runtimeUrl.hash.slice(1) },
  });
  const profiles = await profilesResponse.json();
  assert(
    profiles.profiles.some((item) => item.id === profile.body.id),
    "failed credential deletion must restore the profile in memory",
  );
  assert.equal(await readFile(authFile, "utf8"), original);
  console.log("credential lock ok: unreadable protected store cannot be overwritten");
} finally {
  await engine.stopRuns().catch(() => {});
  await new Promise((resolve) => server?.close(resolve) ?? resolve());
  await rm(dataDir, { recursive: true, force: true });
}
