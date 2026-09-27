import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

const executable = process.env.CCDPH_PACKAGED_EXE;
if (!executable) {
  console.log("packaged signature fallback skipped: CCDPH_PACKAGED_EXE not set");
  process.exit(0);
}

const portableRoot = path.dirname(executable);
const runtimeFile = path.join(portableRoot, ".data", "runtime.json");
const warningFile = path.join(portableRoot, ".data", "startup-warnings.log");
const taskkill = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "taskkill.exe",
);
const beforeRuntime = await stat(runtimeFile).then((value) => value.mtimeMs).catch(() => 0);
const beforeWarning = await stat(warningFile).then((value) => value.size).catch(() => 0);
const child = spawn(executable, [], {
  cwd: portableRoot,
  env: {
    ...process.env,
    CCDPH_SIGNATURE_POWERSHELL: "Z:\\ccdph-missing-powershell.exe",
  },
  windowsHide: true,
  stdio: "ignore",
});

try {
  const deadline = Date.now() + 20_000;
  let runtimeUpdated = false;
  while (Date.now() < deadline && child.exitCode === null) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    runtimeUpdated =
      (await stat(runtimeFile).then((value) => value.mtimeMs).catch(() => 0)) >
      beforeRuntime;
    if (runtimeUpdated) break;
  }
  assert(runtimeUpdated, "signature verifier failure must not block packaged startup");
  const warningDeadline = Date.now() + 5000;
  let warningGrew = false;
  while (Date.now() < warningDeadline) {
    warningGrew =
      (await stat(warningFile).then((value) => value.size).catch(() => 0)) >
      beforeWarning;
    if (warningGrew) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert(warningGrew, "signature verifier failure must be recorded in startup-warnings.log");
  console.log("packaged signature fallback ok: verifier failure warns and continues startup");
} finally {
  await new Promise((resolve) => {
    const killer = spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("close", resolve);
    killer.on("error", resolve);
  });
}
