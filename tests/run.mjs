import "./syntax-check.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

await import("./behavior.mjs");
const runFile = promisify(execFile);
const hardening = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./qa-hardening.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
);
process.stdout.write(hardening.stdout);
process.stderr.write(hardening.stderr);
const routeDomains = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./route-domains.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(routeDomains.stdout);
process.stderr.write(routeDomains.stderr);
const stateFoldBackup = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./state-fold-backup.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(stateFoldBackup.stdout);
process.stderr.write(stateFoldBackup.stderr);
const browserProfileSafety = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./browser-profile-safety.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(browserProfileSafety.stdout);
process.stderr.write(browserProfileSafety.stderr);
const sseLimits = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./sse-limits.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(sseLimits.stdout);
process.stderr.write(sseLimits.stderr);
const worktreeRemoval = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./worktree-removal.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(worktreeRemoval.stdout);
process.stderr.write(worktreeRemoval.stderr);
const resourceLimits = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./resource-limits.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(resourceLimits.stdout);
process.stderr.write(resourceLimits.stderr);
const renderer = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./renderer-behavior.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(renderer.stdout);
process.stderr.write(renderer.stderr);
const terminalRecovery = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./terminal-recovery.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(terminalRecovery.stdout);
process.stderr.write(terminalRecovery.stderr);
console.log("offline checks passed");
