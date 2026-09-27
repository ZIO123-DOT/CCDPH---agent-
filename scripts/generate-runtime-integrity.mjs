import { createHash } from "node:crypto";
import { builtinModules, createRequire } from "node:module";
import { readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const runtimeRoots = ["browser", "build", "public", "routes", "scripts"];
const SDK_ENTRY = "node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs";
const rootFiles = [
  "desktop.cjs",
  "credential-protector.mjs",
  "package.json",
  "package-lock.json",
  "preload.cjs",
  "preload-approval.cjs",
  "route-registry.mjs",
  "server.mjs",
  "server-policies.mjs",
  "state-load-worker.mjs",
  "state-safety.mjs",
  "terminal-registry.mjs",
];
const criticalDependencies = [
  "node_modules/@anthropic-ai/claude-agent-sdk/package.json",
  SDK_ENTRY,
  "node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe",
  // CCDPH-FIX(P2-13): 这两个库由 server.mjs 的静态资源表映射为 /vendor/marked.js 与
  // /vendor/purify.js **直接发给渲染层**，是"模型输出 → DOM"之间的解析器与净化器。
  // 此前它们不在清单内，被替换（例如把 DOMPurify 换成直通实现）不会被完整性校验发现。
  "node_modules/marked/lib/marked.esm.js",
  "node_modules/dompurify/dist/purify.es.mjs",
];

// CCDPH-FIX(R2-P2-4): sdk.mjs 会在**运行期**用 createRequire 拉取依赖
// （require("ajv/dist/runtime/equal")、require("ajv-formats/dist/formats") 等）。清单此前
// 只固定列了几个文件，于是"已被验签的 sdk.mjs 仍会加载未纳入清单的第三方代码"：
// 替换 node_modules/ajv/dist/runtime/*.js 后启动完整性校验全绿（实测 ajv 命中数 = 0）。
// 现在改为**扫描** sdk.mjs 里实际 require 的裸模块说明符并解析到真实文件，自动纳入清单 ——
// 解析失败直接抛错，绝不让清单静默漏掉一个会被加载的文件。
async function sdkRuntimeDependencyPaths() {
  const sdkAbs = path.join(root, SDK_ENTRY);
  const source = await readFile(sdkAbs, "utf8");
  const requireFromSdk = createRequire(sdkAbs);
  // 本仓的 node_modules 是指向部署目录的**符号链接**，而 require.resolve 默认会跟随
  // 符号链接返回真实路径。这里把真实路径映射回清单使用的逻辑路径（<root>/node_modules/…），
  // 否则 source 与 runtime 不是同一棵树时会被误判成"落在运行时目录之外"。
  const nodeModulesReal = await realpath(path.join(root, "node_modules"));
  const toLogical = (resolved) => {
    if (resolved.startsWith(nodeModulesReal + path.sep))
      return path.posix.join(
        "node_modules",
        path.relative(nodeModulesReal, resolved).replaceAll("\\", "/"),
      );
    return path.relative(root, resolved).replaceAll("\\", "/");
  };
  const collect = (specifier) => {
    if (specifier.startsWith(".") || specifier.startsWith("node:")) return null;
    const bare = specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier.split("/")[0];
    if (builtinModules.includes(bare)) return null;
    let resolved;
    try {
      resolved = requireFromSdk.resolve(specifier);
    } catch (error) {
      throw new Error(
        `sdk.mjs 运行期依赖 ${specifier} 无法解析，拒绝生成不完整的完整性清单：${error?.message || error}`,
      );
    }
    const relative = toLogical(resolved);
    if (relative.startsWith(".."))
      throw new Error(
        `sdk.mjs 运行期依赖 ${specifier} 落在运行时目录之外（${resolved}），拒绝生成清单`,
      );
    return relative;
  };
  const found = new Set();
  for (const match of source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
    const relative = collect(match[1]);
    if (relative && (relative.endsWith(".js") || relative.endsWith(".json")))
      found.add(relative);
  }
  return [...found].sort();
}

// CCDPH-FIX(R3-P3-1): `browser/service.mjs` 会 `import("playwright")`（在**主进程内**执行），
// `browser/mcp-config.mjs` 会把本地 `@playwright/mcp` 的 CLI 作为子进程启动。这两个包在旧
// 清单里**一个文件都没有** —— 替换其中的任何 JS 都能通过启动完整性校验（实测 364 个文件 /
// 约 36 MiB 全部未覆盖）。现在把它们的**可执行文件面**（.js/.cjs/.mjs/.json/.wasm）整体纳入
// 清单；.d.ts/.map/README/LICENSE 等不参与运行的文件不入清单。
const RUNTIME_DEPS = [
  "node_modules/playwright",
  "node_modules/playwright-core",
  "node_modules/@playwright",
];
const CODE_EXTS = new Set([".js", ".cjs", ".mjs", ".json", ".wasm"]);
async function runtimeDependencyCodeFiles() {
  const out = [];
  for (const dep of RUNTIME_DEPS) {
    const collect = async (abs, rel) => {
      const entries = await readdir(abs, { withFileTypes: true });
      for (const entry of entries) {
        const childAbs = path.join(abs, entry.name);
        const childRel = path.posix.join(rel.replaceAll("\\", "/"), entry.name);
        if (entry.isDirectory()) {
          await collect(childAbs, childRel);
          continue;
        }
        if (entry.isSymbolicLink())
          throw new Error(
            `依赖目录里存在符号链接，拒绝生成不完整的完整性清单：${childRel}`,
          );
        if (entry.isFile() && CODE_EXTS.has(path.extname(entry.name).toLowerCase()))
          out.push(childRel);
      }
    };
    await collect(path.join(root, dep), dep);
  }
  return out.sort();
}

async function walk(relative) {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.posix.join(relative.replaceAll("\\", "/"), entry.name);
    // CCDPH-FIX(R3-P3-2): 符号链接/联接点既不是 isDirectory 也不是 isFile，旧实现会**静默
    // 跳过** —— 于是把某个运行时文件替换成符号链接（指向任意内容）就能让清单漏掉它且不报错
    //（校验方只核对"清单里有的文件"，缺项不报错）。现在遇到链接直接抛错，拒绝生成不完整的清单。
    if (entry.isSymbolicLink())
      throw new Error(`运行时目录里存在符号链接，拒绝生成清单：${child}`);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

const paths = [
  ...rootFiles,
  ...(await Promise.all(runtimeRoots.map(walk))).flat(),
  ...criticalDependencies,
  ...(await sdkRuntimeDependencyPaths()),
  ...(await runtimeDependencyCodeFiles()),
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
