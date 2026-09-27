import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "ccdph-state-fold-"));
const state = { projects: [], sessions: [], settings: { deep: {} } };
let cursor = state.settings.deep;
for (let index = 0; index < 400; index += 1)
  cursor = cursor.child = {};
cursor.leaf = "preserved";
await writeFile(path.join(dataDir, "state.json"), JSON.stringify(state), "utf8");
for (let index = 1; index <= 5; index += 1)
  await writeFile(
    path.join(dataDir, `state.json.folded-${Date.now() - index * 1000}`),
    `old-backup-${index}`,
    "utf8",
  );

const port = 49000 + Math.floor(Math.random() * 40);
let child;
try {
  await new Promise((resolve, reject) => {
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
      () => reject(new Error(`state fold server timeout: ${output}`)),
      20_000,
    );
    const onData = (chunk) => {
      output += chunk.toString();
      if (!output.match(/#([0-9a-f]{64})/)) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (chunk) => (output += chunk.toString()));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`state fold server exited (${code}): ${output}`));
    });
  });

  const names = await readdir(dataDir);
  const backupNames = names
    .filter((name) => /^state\.json\.folded-\d+$/.test(name))
    .sort((a, b) => Number(b.split("-").at(-1)) - Number(a.split("-").at(-1)));
  assert(backupNames.length <= 3, "folded-state backups must stay within the retention cap");
  const backupName = backupNames[0];
  assert(backupName, "deep-state normalization must preserve the original file");
  assert.match(await readFile(path.join(dataDir, backupName), "utf8"), /"leaf":"preserved"/);
  assert.match(await readFile(path.join(dataDir, "state.json"), "utf8"), /已折叠/);
  console.log("state fold behavior ok: original deep state preserved before writeback");
} finally {
  if (child?.exitCode === null) child.kill();
  await new Promise((resolve) => setTimeout(resolve, 200));
  await rm(dataDir, { recursive: true, force: true, maxRetries: 10 });
}
