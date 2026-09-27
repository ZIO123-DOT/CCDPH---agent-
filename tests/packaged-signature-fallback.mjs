import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const executable = process.env.CCDPH_PACKAGED_EXE;
if (!executable) {
  console.log("packaged signature fallback skipped: CCDPH_PACKAGED_EXE not set");
  process.exit(0);
}

// CCDPH-FIX(R2-P2-12): 这个用例原来以部署目录为 cwd 启动 exe，并观察部署目录下的
// `.data/runtime.json` 与 `.data/startup-warnings.log` —— 也就是**改写部署版真实数据目录**，
// 正是此前明确要求"绝不触碰"的地方（README/约定：离线套件全程使用临时数据目录）。
// 现在把 WORKBENCH_DATA_DIR 指向一个临时目录（desktop.cjs 会优先采用显式传入的值），
// 观测点随之改到临时目录，部署目录不再被写入。
const dataRoot = await mkdtemp(path.join(os.tmpdir(), "ccdph-packaged-smoke-"));
const portableRoot = path.dirname(executable);
const runtimeFile = path.join(dataRoot, "runtime.json");
const warningFile = path.join(dataRoot, "startup-warnings.log");
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
    WORKBENCH_DATA_DIR: dataRoot,
    // CCDPH-FIX(R2-P2-5): 覆盖验签解释器现在需要第二个显式开关（避免单个环境变量就能把
    // "签名验证"指向桩程序）。
    CCDPH_ALLOW_SIGNATURE_OVERRIDE: "1",
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
  // CCDPH-FIX(R2-P2-12): 临时数据目录属于本用例自己，结束时清理，不在 %TEMP% 里留垃圾。
  await rm(dataRoot, { recursive: true, force: true }).catch(() => { });
}
