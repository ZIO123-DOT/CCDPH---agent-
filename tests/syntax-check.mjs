import { readdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const root = path.resolve(import.meta.dirname, "..");
const files = [
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
  "preload.cjs",
  "public/app.js",
  "public/api-client.js",
  "public/markdown-renderer.js",
  "public/terminal-text.js",
  "tests/qa-hardening.mjs",
  "tests/route-domains.mjs",
  "tests/state-fold-backup.mjs",
  "tests/browser-profile-safety.mjs",
  "tests/sse-limits.mjs",
  "tests/worktree-removal.mjs",
  "tests/resource-limits.mjs",
  ...(
    await readdir(path.join(root, "browser"), { withFileTypes: true })
  ).filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => path.join("browser", entry.name)),
];
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
