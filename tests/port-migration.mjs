// CCDPH-FIX(R6-P2-1/R7-P2-1): 旧默认专用端口 9223 的一次性迁移回归护栏。
// 1) 旧默认 9223（无 dedicatedPortMigrated 标记）→ 迁移为 0 + 标记 true；
// 2) 用户显式重设 9223（已带标记）→ 保留 9223，不被再次迁移。
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

async function cycle(portValue, migratedFlag, cacheKey) {
  await writeFile(
    stateFile,
    JSON.stringify({
      projects: [],
      sessions: [],
      settings: {
        browser: {
          enabled: true,
          mode: "dedicated",
          dedicatedPort: portValue,
          ...(migratedFlag === undefined ? {} : { dedicatedPortMigrated: migratedFlag }),
          profileDir: "",
        },
      },
    }),
    "utf8",
  );
  const engine = await import(`../server.mjs?t=${cacheKey}`);
  const server = await engine.start();
  const memPort = engine.getSettings().browser.dedicatedPort;
  const memFlag = engine.getSettings().browser.dedicatedPortMigrated;
  await new Promise((resolve) => server.close(resolve));
  const saved = JSON.parse(await readFile(stateFile, "utf8"));
  return {
    memPort,
    memFlag,
    savedPort: saved.settings?.browser?.dedicatedPort,
    savedFlag: saved.settings?.browser?.dedicatedPortMigrated,
  };
}

try {
  // 1) 旧默认 9223（无标记）→ 迁移为 0 + 标记 true
  const first = await cycle(9223, undefined, "legacy");
  assert.equal(first.memPort, 0, "旧默认 9223 必须迁移为未配置(0)");
  assert.equal(first.memFlag, true, "迁移后必须置标记");
  assert.equal(first.savedPort, 0, "迁移结果必须持久化");
  assert.equal(first.savedFlag, true, "迁移标记必须持久化");

  // 2) 显式重设 9223（已带标记）→ 保留 9223，不被再次迁移
  const second = await cycle(9223, true, "explicit");
  assert.equal(second.memPort, 9223, "显式 9223（已迁移过）必须保留");
  assert.equal(second.savedPort, 9223, "显式 9223 必须持久化，不得被再次迁移");

  console.log("port migration ok: legacy 9223 migrated once, explicit 9223 preserved");
} finally {
  await rm(data, { recursive: true, force: true }).catch(() => {});
}
