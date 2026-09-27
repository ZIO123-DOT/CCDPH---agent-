import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const runtimeRoots = ["browser", "build", "public", "routes", "scripts"];
const rootFiles = [
  "desktop.cjs",
  "credential-protector.mjs",
  "package.json",
  "package-lock.json",
  "preload.cjs",
  "route-registry.mjs",
  "server.mjs",
  "server-policies.mjs",
  "state-load-worker.mjs",
  "state-safety.mjs",
  "terminal-registry.mjs",
];
const criticalDependencies = [
  "node_modules/@anthropic-ai/claude-agent-sdk/package.json",
  "node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs",
  "node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe",
  // CCDPH-FIX(P2-13): 这两个库由 server.mjs 的静态资源表映射为 /vendor/marked.js 与
  // /vendor/purify.js **直接发给渲染层**，是"模型输出 → DOM"之间的解析器与净化器。
  // 此前它们不在清单内，被替换（例如把 DOMPurify 换成直通实现）不会被完整性校验发现。
  "node_modules/marked/lib/marked.esm.js",
  "node_modules/dompurify/dist/purify.es.mjs",
];

async function walk(relative) {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.posix.join(relative.replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

const paths = [
  ...rootFiles,
  ...(await Promise.all(runtimeRoots.map(walk))).flat(),
  ...criticalDependencies,
].sort();
const files = [];
for (const relative of paths) {
  const content = await readFile(path.join(root, relative));
  files.push({
    path: relative,
    sha256: createHash("sha256").update(content).digest("hex"),
  });
}
await writeFile(
  path.join(root, "runtime-integrity.json"),
  `${JSON.stringify({ algorithm: "sha256", purpose: "corruption-detection", files }, null, 2)}\n`,
  "utf8",
);
console.log(`runtime integrity manifest: ${files.length} files`);
