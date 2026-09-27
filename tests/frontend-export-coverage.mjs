// CCDPH-FIX(P1-1 回归): 防止再出现"app.js 用了某个导出，但 markdown-renderer 没导出 /
// app.js 没导入"这类缺陷 —— 该缺陷会让降级分支在运行时抛 ReferenceError，
// 而普通测试（不触发该分支）发现不了。这里做纯静态的"导出/导入一致性"断言。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const appSrc = await readFile(new URL("public/app.js", ROOT), "utf8");
const modSrc = await readFile(new URL("public/markdown-renderer.js", ROOT), "utf8");

// 1) app.js 从 /markdown-renderer.js 导入的名字
const importBlock = appSrc.match(
  /import\s*\{([\s\S]*?)\}\s*from\s*"\/markdown-renderer\.js";/,
);
assert(importBlock, "app.js 必须从 /markdown-renderer.js 导入");
const imported = new Set(
  importBlock[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean),
);

// 2) markdown-renderer.js 的导出清单（源码解析，避免在 Node 里加载浏览器专属依赖）
const exported = new Set(
  [...modSrc.matchAll(/export\s+(?:const|let|var|function|class)\s+([A-Za-z0-9_$]+)/g)].map(
    (m) => m[1],
  ),
);
for (const m of modSrc.matchAll(/export\s*\{([^}]*)\}/g))
  for (const part of m[1].split(",")) {
    const name = part.trim().split(/\s+as\s+/).pop();
    if (name) exported.add(name);
  }
assert(exported.size > 0, "未解析到任何导出，断言本身失效");

// 3) app.js 正文（import 段之后）引用的导出名必须都已导入
const body = appSrc.slice(appSrc.lastIndexOf('"/markdown-renderer.js";') + 1);
const missing = [...exported].filter(
  (name) =>
    new RegExp(`(^|[^\\w.$])${name}\\b`).test(body) && !imported.has(name),
);
assert.deepEqual(missing, [], `app.js 使用了未导入的导出：${missing.join(",")}`);

// 4) 反向：导入的名字必须真实存在（防拼错）
const ghosts = [...imported].filter((name) => !exported.has(name));
assert.deepEqual(ghosts, [], `app.js 导入了不存在的导出：${ghosts.join(",")}`);

console.log(
  "frontend export coverage ok: every markdown-renderer export used by app.js is imported",
);
