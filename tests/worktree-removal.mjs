import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const dataDir = await mkdtemp(path.join(os.tmpdir(), "ccdph-worktree-data-"));
const repoDir = await mkdtemp(path.join(os.tmpdir(), "ccdph-worktree-repo-"));
process.env.WORKBENCH_DATA_DIR = dataDir;
process.env.WORKBENCH_PORT = String(48800 + Math.floor(Math.random() * 100));
process.env.WORKBENCH_DESKTOP = "0";

let server;
try {
  await exec("git", ["init"], { cwd: repoDir, windowsHide: true });
  await exec("git", ["config", "user.name", "CCDPH Test"], { cwd: repoDir, windowsHide: true });
  await exec("git", ["config", "user.email", "ccdph-test@example.invalid"], { cwd: repoDir, windowsHide: true });
  await writeFile(path.join(repoDir, "README.md"), "test\n", "utf8");
  await exec("git", ["add", "README.md"], { cwd: repoDir, windowsHide: true });
  await exec("git", ["commit", "-m", "test fixture"], { cwd: repoDir, windowsHide: true });

  const engine = await import(`../server.mjs?worktree-removal=${Date.now()}`);
  server = await engine.start();
  const runtimeUrl = new URL(engine.getRuntime().url);
  const headers = {
    "content-type": "application/json",
    "x-workbench-token": runtimeUrl.hash.slice(1),
  };
  const api = async (pathname, payload) => {
    const response = await fetch(`${runtimeUrl.origin}/api/${pathname}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const value = await response.json();
    assert(response.ok, `${pathname} failed: ${JSON.stringify(value)}`);
    return value;
  };
  const project = await api("projects", { path: repoDir });
  const session = await api("sessions", {
    projectId: project.id,
    environment: "worktree",
  });
  assert.equal((await stat(session.cwd)).isDirectory(), true);
  const result = await api("session/delete", { sessionId: session.id });
  assert.deepEqual(result.worktree, { removed: 1, kept: 0 });
  await assert.rejects(stat(session.cwd), /ENOENT/);
  const worktreeBase = path.dirname(session.cwd);
  const leftovers = await readdir(worktreeBase).catch(() => []);
  assert.equal(
    leftovers.some((name) => name.startsWith(".ccdph-remove-")),
    false,
    "successful removal must not leave tombstone directories",
  );
  console.log("worktree removal ok: clean tree captured, removed, and metadata pruned");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true, maxRetries: 10 });
  await rm(repoDir, { recursive: true, force: true, maxRetries: 10 });
}
