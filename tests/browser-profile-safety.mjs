import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const sandbox = await mkdtemp(path.join(os.tmpdir(), "ccdph-profile-safety-"));
const dataDir = path.join(sandbox, "data");
const outsideDir = path.join(sandbox, "outside");
process.env.WORKBENCH_DATA_DIR = dataDir;

try {
  const { resolveDedicatedProfileDir } = await import(
    `../browser/service.mjs?profile-safety=${Date.now()}`
  );
  const safe = path.join(dataDir, "safe-profile");
  assert.equal(resolveDedicatedProfileDir(safe), path.resolve(safe));

  await rm(path.join(safe, ".ccdph-browser-profile"), { force: true });
  await rm(safe, { recursive: true, force: true });
  await mkdir(outsideDir, { recursive: true });
  await symlink(outsideDir, safe, process.platform === "win32" ? "junction" : "dir");
  assert.equal(
    resolveDedicatedProfileDir(safe),
    "",
    "profile directory junction/symlink must not escape WORKBENCH_DATA_DIR",
  );
  console.log("browser profile safety ok: realpath escape rejected");
} finally {
  await rm(sandbox, { recursive: true, force: true, maxRetries: 10 });
}
