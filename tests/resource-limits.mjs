import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "ccdph-resource-data-"));
const projectDir = await mkdtemp(path.join(os.tmpdir(), "ccdph-resource-project-"));
const limitProbeDir = await mkdtemp(path.join(os.tmpdir(), "ccdph-project-limit-"));
process.env.WORKBENCH_DATA_DIR = dataDir;
process.env.WORKBENCH_PORT = String(48700 + Math.floor(Math.random() * 80));
process.env.WORKBENCH_DESKTOP = "0";

let server;
try {
  for (let start = 0; start < 2005; start += 100) {
    await Promise.all(
      Array.from({ length: Math.min(100, 2005 - start) }, (_, offset) =>
        writeFile(path.join(projectDir, `file-${start + offset}.txt`), "x"),
      ),
    );
  }
  const seededProjects = Array.from({ length: 200 }, (_, index) => ({
    id: index === 0 ? "seed-project" : `seed-project-${index}`,
    name: `seed-${index}`,
    path: index === 0 ? projectDir : path.join(projectDir, `unused-${index}`),
  }));
  await writeFile(
    path.join(dataDir, "state.json"),
    JSON.stringify({ projects: seededProjects, sessions: [], settings: {} }),
  );
  const engine = await import(`../server.mjs?resource-limits=${Date.now()}`);
  server = await engine.start();
  const runtimeUrl = new URL(engine.getRuntime().url);
  const token = runtimeUrl.hash.slice(1);
  const headers = {
    "content-type": "application/json",
    "x-workbench-token": token,
  };
  const createProject = await fetch(`${runtimeUrl.origin}/api/projects`, {
    method: "POST",
    headers,
    body: JSON.stringify({ path: limitProbeDir }),
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(createProject.status, 400);
  assert.match((await createProject.json()).error, /项目数量已达上限/);
  const response = await fetch(
    `${runtimeUrl.origin}/api/files?projectId=seed-project&path=`,
    {
      headers: { "x-workbench-token": token },
      signal: AbortSignal.timeout(10_000),
    },
  );
  assert.equal(response.status, 200);
  const listing = await response.json();
  assert.equal(listing.files.length, 2000);
  assert.equal(listing.truncated, true);
  assert.match(listing.truncationReason, /2000/);

  const wrapperDir = await mkdtemp(path.join(os.tmpdir(), "ccdph-claude-wrapper-"));
  const safeExe = path.join(wrapperDir, "claude.exe");
  const wrongExe = path.join(wrapperDir, "other.exe");
  const wrapper = path.join(wrapperDir, "claude.cmd");
  await writeFile(safeExe, "safe");
  await writeFile(wrongExe, "wrong");
  await writeFile(wrapper, `@"${wrongExe}" %*\n@"${safeExe}" %*\n`);
  assert.equal(await engine.resolveNativeClaudeExecutable(wrapper), safeExe);
  await rm(wrapperDir, { recursive: true, force: true });
  console.log("resource limits ok: directory/project caps and Claude wrapper validation");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true, maxRetries: 10 });
  await rm(projectDir, { recursive: true, force: true, maxRetries: 10 });
  await rm(limitProbeDir, { recursive: true, force: true, maxRetries: 10 });
}
