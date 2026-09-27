// CCDPH-FIX(R3-P3-1 / R3-P3-2): 完整性清单覆盖回归。
// 断言 runtime-integrity.json 覆盖了运行期会加载的第三方代码（playwright / @playwright/mcp）
// 以及新增的 preload-approval.cjs。符号链接"拒绝生成"的行为在生成器内实现，此处不重演
//（避免在仓库 public/ 下造符号链接）；可在需要时单独验证。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  await readFile(path.join(root, "runtime-integrity.json"), "utf8"),
);
assert.equal(manifest.algorithm, "sha256");
assert.equal(manifest.purpose, "corruption-detection");
const paths = new Set(manifest.files.map((f) => f.path.replaceAll("\\", "/")));

// 运行期会加载的第三方代码必须被覆盖
for (const required of [
  "node_modules/playwright/index.mjs",
  "node_modules/playwright-core/index.mjs",
  "node_modules/@playwright/mcp/package.json",
  "node_modules/@playwright/mcp/cli.js",
  "preload-approval.cjs",
  "preload.cjs",
  "server.mjs",
  "desktop.cjs",
  "node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs",
  "node_modules/ajv/dist/runtime/equal.js",
]) {
  assert.ok(paths.has(required), `清单必须覆盖 ${required}`);
}

// playwright / playwright-core / @playwright 的可执行文件面应整体入列
const playwrightCount = [...paths].filter(
  (p) => p.startsWith("node_modules/playwright") || p.startsWith("node_modules/@playwright"),
).length;
assert.ok(playwrightCount >= 100, `清单应覆盖 playwright/@playwright 主体（当前 ${playwrightCount}）`);

console.log("integrity manifest ok: playwright/@playwright/mcp and preload-approval covered");
