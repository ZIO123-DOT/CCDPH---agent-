import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "ccdph-sse-limits-"));
const projectDir = await mkdtemp(path.join(os.tmpdir(), "ccdph-sse-project-"));
process.env.WORKBENCH_DATA_DIR = dataDir;
process.env.WORKBENCH_PORT = String(48600 + Math.floor(Math.random() * 200));
process.env.WORKBENCH_DESKTOP = "0";

const engine = await import(`../server.mjs?sse-limits=${Date.now()}`);
const server = await engine.start();
const runtime = engine.getRuntime();
const runtimeUrl = new URL(runtime.url);
const token = runtimeUrl.hash.slice(1);
const origin = runtimeUrl.origin;
const headers = {
  "content-type": "application/json",
  "x-workbench-token": token,
};
const api = async (pathname, payload) => {
  const response = await fetch(`${origin}/api/${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  });
  const value = await response.json();
  assert(response.ok, `${pathname} failed: ${JSON.stringify(value)}`);
  return value;
};
const controllers = [];
try {
  const project = await api("projects", { path: projectDir });
  const session = await api("sessions", {
    projectId: project.id,
    environment: "local",
  });
  const terminal = await api("terminal/start", {
    projectId: project.id,
    sessionId: session.id,
  });
  const streamUrl = `${origin}/api/terminal/events?id=${encodeURIComponent(terminal.id)}&token=${token}`;
  for (let index = 0; index < 8; index += 1) {
    const controller = new AbortController();
    controllers.push(controller);
    const response = await fetch(streamUrl, { signal: controller.signal });
    assert.equal(response.status, 200);
    await response.body.getReader().read();
  }
  const rejected = await fetch(streamUrl, { signal: AbortSignal.timeout(5000) });
  assert.equal(rejected.status, 429);
  controllers.shift().abort();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const replacementController = new AbortController();
  controllers.push(replacementController);
  const replacement = await fetch(streamUrl, { signal: replacementController.signal });
  assert.equal(replacement.status, 200, "closing a stream must restore one connection slot");
  await replacement.body.getReader().read();
  await api("terminal/stop", { id: terminal.id });
  console.log("SSE limits ok: terminal cap rejects excess clients and restores slots");
} finally {
  for (const controller of controllers) controller.abort();
  await new Promise((resolve) => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true, maxRetries: 10 });
  await rm(projectDir, { recursive: true, force: true, maxRetries: 10 });
}
