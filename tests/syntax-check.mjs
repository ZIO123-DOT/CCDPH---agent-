import { readdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const root = path.resolve(import.meta.dirname, "..");
// CCDPH-FIX(R2-P3-14): 这份清单原来是**手写**的，实测漏掉 4 个 tests/*.mjs —— 包括 24KB 的
// tests/behavior.mjs、tests/run.mjs、tests/terminal-recovery.mjs 与它自己。也就是说这些文件
// 里的语法错误不会被门禁拦下。现在改为「显式应用文件 + 自动扫描 tests/ 与 browser/」，
// 以后新增用例不必再记得改这份清单。
const explicitFiles = [
  "server.mjs",
  "route-registry.mjs",
  "server-policies.mjs",
  "routes/workspace-io.mjs",
  "routes/integration.mjs",
  "routes/workspace-mutation.mjs",
  "state-safety.mjs",
  "state-load-worker.mjs",
  "terminal-registry.mjs",
  "desktop.cjs",
  "credential-protector.mjs",
  "preload.cjs",
  "preload-approval.cjs",
  "scripts/generate-runtime-integrity.mjs",
  "public/app.js",
  "public/api-client.js",
  "public/markdown-renderer.js",
  "public/terminal-text.js",
];
const scannedFiles = (
  await Promise.all(
    ["tests", "browser"].map(async (dir) =>
      (await readdir(path.join(root, dir), { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
        .map((entry) => path.join(dir, entry.name)),
    ),
  )
).flat();
const files = [...new Set([...explicitFiles, ...scannedFiles])].sort();
for (const relative of files) {
  const file = path.join(root, relative);
  try {
    await execFileAsync(process.execPath, ["--check", file], {
      encoding: "utf8",
      windowsHide: true,
    });
  } catch (error) {
    process.stderr.write(
      error?.stderr ||
        error?.stdout ||
        `syntax checker failed for ${relative}: ${error?.code || error?.message || error}\n`,
    );
    process.exit(typeof error?.code === "number" ? error.code : 1);
  }
}
console.log(`syntax ok: ${files.length} files`);
