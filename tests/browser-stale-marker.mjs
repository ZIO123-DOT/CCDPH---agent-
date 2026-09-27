import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "ccdph-browser-marker-"));
const browserDir = path.join(dataDir, "browser");
const marker = path.join(browserDir, "dedicated-edge.json");
await mkdir(browserDir, { recursive: true });
await writeFile(marker, '{"pid":', "utf8");
process.env.WORKBENCH_DATA_DIR = dataDir;

const { sweepStaleDedicatedEdge } = await import("../browser/service.mjs");
try {
  await assert.rejects(sweepStaleDedicatedEdge(), (error) => {
    assert.match(error.message, /PID 标记无法解析.*拒绝启动/);
    assert(error.message.includes(marker), "recovery error must include marker path");
    assert.match(error.message, /不要只删除标记/);
    return true;
  });
  assert.equal(await readFile(marker, "utf8"), '{"pid":');
  console.log("browser stale marker ok: corrupt recovery marker fails closed and is preserved");
} finally {
  await rm(dataDir, { recursive: true, force: true });
}
