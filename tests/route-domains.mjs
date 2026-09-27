import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "ccdph-route-domains-"));
const port = 48950 + Math.floor(Math.random() * 40);
let child;
try {
  const started = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, ["server.mjs"], {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: {
        ...process.env,
        WORKBENCH_DATA_DIR: dataDir,
        WORKBENCH_PORT: String(port),
        WORKBENCH_DESKTOP: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    const timer = setTimeout(
      () => reject(new Error(`route domain server timeout: ${output}`)),
      20_000,
    );
    const onData = (chunk) => {
      output += chunk.toString();
      const token = output.match(/#([0-9a-f]{64})/)?.[1];
      if (!token) return;
      clearTimeout(timer);
      resolve({ token });
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (chunk) => (output += chunk.toString()));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`route domain server exited (${code}): ${output}`));
    });
  });

  for (const pathname of [
    "/api/browser/unknown",
    "/api/hooks/unknown",
    "/api/worktrees/unknown",
    "/api/update/unknown",
    "/api/terminal/unknown",
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      headers: { "x-workbench-token": started.token },
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, 404, `${pathname} must settle as 404`);
  }
  console.log("route domain behavior ok: unknown paths settle as 404");
} finally {
  if (child?.exitCode === null) child.kill();
  await new Promise((resolve) => setTimeout(resolve, 200));
  await rm(dataDir, { recursive: true, force: true, maxRetries: 10 });
}
