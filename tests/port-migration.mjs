// CCDPH-FIX(R6-P2-1): 旧默认专用端口 9223 的载入期迁移回归护栏。
// 升级前 state.json 里持久化的 dedicatedPort=9223（旧默认）必须被迁移为 0（未配置），
// 从而让下次启用专用模式时走随机分配，而不是永远停在可预测的 9223。
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const data = await mkdtemp(path.join(os.tmpdir(), "ccdph-port-migrate-"));
process.env.WORKBENCH_DATA_DIR = data;
process.env.WORKBENCH_PORT = String(47000 + Math.floor(Math.random() * 300));
process.env.WORKBENCH_DESKTOP = "0";
process.env.CLAUDE_CONFIG_DIR = path.join(data, ".claude");

const stateFile = path.join(data, "state.json");
await writeFile(
  stateFile,
  JSON.stringify({
    projects: [],
    sessions: [],
    settings: {
      browser: {
        enabled: true,
        mode: "dedicated",
        dedicatedPort: 9223, // 旧默认
        profileDir: "",
      },
    },
  }),
  "utf8",
);

const engine = await import("../server.mjs");
const server = await engine.start();

try {
  assert.equal(
    engine.getSettings().browser.dedicatedPort,
    0,
    "旧默认 9223 必须迁移为未配置(0)",
  );
  // 迁移结果必须写回 state.json（否则每次启动都重复迁移，且下次仍读到 9223）。
  const saved = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(
    saved.settings?.browser?.dedicatedPort,
    0,
    "迁移结果必须持久化到 state.json",
  );
  console.log("port migration ok: legacy dedicatedPort 9223 migrated to 0 and persisted");
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(data, { recursive: true, force: true }).catch(() => {});
}
