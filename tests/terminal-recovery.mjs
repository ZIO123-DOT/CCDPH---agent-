import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (process.platform !== "win32") {
  console.log("terminal recovery skipped: Windows only");
  process.exit(0);
}

const data = await mkdtemp(path.join(os.tmpdir(), "ccdph-terminal-recovery-"));
const projectDir = await mkdtemp(path.join(os.tmpdir(), "ccdph-terminal-project-"));
await writeFile(path.join(projectDir, "keep.txt"), "keep");
const port = 48800 + Math.floor(Math.random() * 150);

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["server.mjs"], {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: {
        ...process.env,
        WORKBENCH_DATA_DIR: data,
        WORKBENCH_PORT: String(port),
        WORKBENCH_DESKTOP: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    const timer = setTimeout(() => reject(new Error(`server start timeout: ${output}`)), 20000);
    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/#([0-9a-f]{64})/);
      if (!match) return;
      clearTimeout(timer);
      resolve({ child, token: match[1], output: () => output });
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (chunk) => (output += chunk.toString()));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (${code}): ${output}`));
    });
  });
}

async function api(token, pathname, body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-workbench-token": token,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function waitForRegistryPing(serverInfo) {
  const file = path.join(data, "terminal-processes.json");
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const doc = JSON.parse(await readFile(file, "utf8"));
      const ping = doc.records?.find((item) => /^ping\.exe$/i.test(item.name));
      if (ping) return ping;
    } catch { }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  let registry = "missing";
  try {
    registry = await readFile(file, "utf8");
  } catch { }
  throw new Error(
    `terminal process registry did not capture PING.EXE; registry=${registry}; server=${serverInfo.output()}`,
  );
}

let first;
let second;
try {
  first = await startServer();
  const publicState = (await api(first.token, "/api/state")).body;
  assert.equal("home" in publicState, false);
  assert.equal("dataDir" in publicState, false);
  assert.equal("path" in (publicState.claude || {}), false);
  const project = (await api(first.token, "/api/projects", { path: projectDir })).body;
  const session = (
    await api(first.token, "/api/sessions", { projectId: project.id })
  ).body;
  const terminal = (
    await api(first.token, "/api/terminal/start", {
      projectId: project.id,
      sessionId: session.id,
    })
  ).body;
  await api(first.token, "/api/terminal/input", {
    id: terminal.id,
    text: "ping -n 120 127.0.0.1\n",
  });
  const ping = await waitForRegistryPing(first);
  const firstExited = new Promise((resolve) => first.child.once("exit", resolve));
  first.child.kill("SIGINT"); // Windows: forced termination; cleanup handlers do not run.
  await firstExited;

  second = await startServer(); // startup sweep must remove the recorded descendant.
  await new Promise((resolve) => setTimeout(resolve, 800));
  let alive = true;
  try {
    process.kill(Number(ping.pid), 0);
  } catch {
    alive = false;
  }
  assert.equal(alive, false, "startup sweep must remove terminal descendants after a crash");
  console.log("terminal recovery ok: stale descendant removed on restart");
} finally {
  const stopChild = (child) => {
    if (!child || child.exitCode !== null || child.signalCode !== null)
      return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      let timer;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.off("exit", done);
        resolve();
      };
      child.once("exit", done);
      try {
        if (!child.kill()) done();
      } catch {
        done();
      }
      timer = setTimeout(done, 5000);
    });
  };
  const exits = [];
  for (const item of [first, second]) {
    exits.push(stopChild(item?.child));
  }
  await Promise.all(exits);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const cleanup = (target) =>
    rm(target, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    }).catch((error) =>
      console.warn(`terminal recovery cleanup deferred for ${target}: ${error.code}`),
    );
  await cleanup(data);
  await cleanup(projectDir);
}
