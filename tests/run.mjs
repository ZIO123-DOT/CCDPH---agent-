import "./syntax-check.mjs";
await import("./macos-release-config.mjs");
await import("./api-client-auth.mjs");
await import("./update-install-success.mjs");
await import("./worktree-create-safety.mjs");
await import("./windows-tool-paths.mjs");
await import("./terminal-registry-pending.mjs");
await import("./terminal-registry-hardening.mjs");
await import("./terminal-registry-read.mjs");
await import("./terminal-registry-unreadable.mjs");
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
const browserLifecycle = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./browser-lifecycle.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(browserLifecycle.stdout);
process.stderr.write(browserLifecycle.stderr);
const browserStaleMarker = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./browser-stale-marker.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(browserStaleMarker.stdout);
process.stderr.write(browserStaleMarker.stderr);
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
const credentialStorage = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./credential-storage.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(credentialStorage.stdout);
process.stderr.write(credentialStorage.stderr);
const credentialLock = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./credential-lock.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(credentialLock.stdout);
process.stderr.write(credentialLock.stderr);
const credentialMigrationFailure = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./credential-migration-failure.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(credentialMigrationFailure.stdout);
process.stderr.write(credentialMigrationFailure.stderr);
const credentialSessionOnly = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./credential-session-only.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(credentialSessionOnly.stdout);
process.stderr.write(credentialSessionOnly.stderr);
const renderer = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./renderer-behavior.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(renderer.stdout);
process.stderr.write(renderer.stderr);
const rendererClobbering = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./renderer-clobbering.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(rendererClobbering.stdout);
process.stderr.write(rendererClobbering.stderr);
const terminalRecovery = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./terminal-recovery.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(terminalRecovery.stdout);
process.stderr.write(terminalRecovery.stderr);
// CCDPH-FIX(P2-14): 该用例此前**只被 syntax-check 做语法检查、从不执行**（孤儿测试），
// 于是"签名不可验证时必须告警并继续启动"这条行为没有任何门禁在守。
// 它需要 CCDPH_PACKAGED_EXE 指向打包版可执行文件，未设置时自我 skip（退出码 0），
// 因此接入 run.mjs 是安全的：有环境就跑，没环境就跳过。
const packagedSignature = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./packaged-signature-fallback.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(packagedSignature.stdout);
process.stderr.write(packagedSignature.stderr);
// 本轮修复的回归护栏：导出/导入一致性（P1-1 同类）与 MCP 名校验（P2-1）
const exportCoverage = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./frontend-export-coverage.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(exportCoverage.stdout);
process.stderr.write(exportCoverage.stderr);
const mcpSaveName = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./mcp-save-name.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(mcpSaveName.stdout);
process.stderr.write(mcpSaveName.stderr);
// ---- R3（独立复审第二轮）修复回归 ----
const markdownGuard = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./markdown-guard.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(markdownGuard.stdout);
process.stderr.write(markdownGuard.stderr);
const settingsLoadValidation = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./settings-load-validation.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(settingsLoadValidation.stdout);
process.stderr.write(settingsLoadValidation.stderr);
const symlinkGuards = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./symlink-guards.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(symlinkGuards.stdout);
process.stderr.write(symlinkGuards.stderr);
// CCDPH-FIX(R6-P2-1): 旧默认专用端口 9223 迁移的回归护栏。
const portMigration = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./port-migration.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(portMigration.stdout);
process.stderr.write(portMigration.stderr);
const requestGateHardening = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./request-gate-hardening.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(requestGateHardening.stdout);
process.stderr.write(requestGateHardening.stderr);
const integrityManifest = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./integrity-manifest.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(integrityManifest.stdout);
process.stderr.write(integrityManifest.stderr);
const packagedRuntimeIntegrity = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./packaged-runtime-integrity.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(packagedRuntimeIntegrity.stdout);
process.stderr.write(packagedRuntimeIntegrity.stderr);
const a11yDom = await runFile(
  process.execPath,
  [fileURLToPath(new URL("./a11y-dom.mjs", import.meta.url))],
  { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
);
process.stdout.write(a11yDom.stdout);
process.stderr.write(a11yDom.stderr);
console.log("offline checks passed");
