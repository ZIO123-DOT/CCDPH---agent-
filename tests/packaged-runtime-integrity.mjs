import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import asar from "@electron/asar";

const appPath = String(process.env.CCDPH_PACKAGED_APP || "").trim();
if (!appPath) {
  console.log("packaged runtime integrity skipped: CCDPH_PACKAGED_APP not set");
  process.exit(0);
}

const resources = path.join(appPath, "Contents", "Resources");
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
