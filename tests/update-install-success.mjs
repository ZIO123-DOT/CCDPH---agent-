import assert from "node:assert/strict";
import { createWorkspaceMutationRoute } from "../routes/workspace-mutation.mjs";

const previousDesktop = process.env.WORKBENCH_DESKTOP;
process.env.WORKBENCH_DESKTOP = "1";
const updateRuntime = {
  installRunning: false,
  installResetTimer: null,
  job: { running: false, stage: "", startedAt: 0, finishedAt: 0, error: "" },
};
const gateCalls = [];
const route = createWorkspaceMutationRoute({
  getDb: () => ({ projects: [], sessions: [], settings: {} }),
  getFilePicker: () => null,
  getFolderPicker: () => null,
  getPathOpener: () => null,
  installUpdate: async (onStage) => {
    onStage("写入");
    return { version: "0.3.3" };
  },
  armUpdateInstallGateTimer: (callback, ms) => {
    gateCalls.push({ callback, ms });
    return { unref() {} };
  },
  json: (_res, value) => value,
  sanitizeError: (error) => String(error?.message || error),
  updateRuntime,
});

try {
  const url = new URL("http://127.0.0.1/api/update/install");
  const response = await route(
    { method: "POST" },
    {},
    url,
    url.pathname,
  );
  assert.equal(response.started, true);
  const deadline = Date.now() + 2000;
  while (updateRuntime.job.running && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(updateRuntime.job.stage, "完成");
  assert.equal(updateRuntime.job.error, "");
  assert.equal(updateRuntime.installRunning, true, "success must keep the install gate closed");
  assert.equal(gateCalls.length, 1);
  assert.equal(gateCalls[0].ms, undefined, "timer helper default must own the timeout");
  console.log("update install success ok: completion stays successful and keeps the gate closed");
} finally {
  if (previousDesktop === undefined) delete process.env.WORKBENCH_DESKTOP;
  else process.env.WORKBENCH_DESKTOP = previousDesktop;
}
