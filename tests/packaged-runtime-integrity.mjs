import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const appPath = String(process.env.CCDPH_PACKAGED_APP || "").trim();
if (!appPath) {
  console.log("packaged runtime integrity skipped: CCDPH_PACKAGED_APP not set");
  process.exit(0);
}

// `@electron/asar` 是 electron-builder 的传递依赖，未在 package.json 显式声明；
// 本地开发机的 node_modules 只链接生产依赖，静态 import 会在自检 skip 之前就抛
// MODULE_NOT_FOUND。改成懒加载：仅当真的要对打包产物校验时才解析该依赖。
const { default: asar } = await import("@electron/asar");

// CCDPH_PACKAGED_APP 既可以是 macOS 的 .app 包（校验 Contents/Resources/app.asar），
// 也可以是 Windows/Linux 的未打包目录（*-unpacked/resources，直接含 app.asar）。
const resources = appPath.toLowerCase().endsWith(".app")
  ? path.join(appPath, "Contents", "Resources")
  : appPath;
const archive = path.join(resources, "app.asar");
const unpacked = path.join(resources, "app.asar.unpacked");
const manifest = JSON.parse(
  asar.extractFile(archive, "runtime-integrity.json").toString("utf8"),
);

for (const item of manifest.files) {
  const relative = String(item.path || "").replaceAll("\\", "/");
  assert(relative && !relative.split("/").includes(".."));
  let content;
  try {
    content = await readFile(path.join(unpacked, relative));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    content = asar.extractFile(archive, relative);
  }
  const actual = createHash("sha256").update(content).digest("hex");
  assert.equal(actual, item.sha256, `打包后完整性哈希不匹配：${relative}`);
}

console.log(`packaged runtime integrity ok: ${manifest.files.length} files match app.asar`);
