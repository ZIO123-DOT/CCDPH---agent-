import assert from "node:assert/strict";
import path from "node:path";
import {
  reconcileDedicatedBrowser,
  withBrowserSettingsTransition,
} from "../browser/lifecycle.mjs";

const calls = [];
let current = null;
const dataDir = path.resolve("D:/ccdph-test-data");
const deps = {
  dataDir,
  browserStatus: async () => ({ launchError: "launch failed" }),
  dedicatedEdgeState: () => (current ? { ...current } : null),
  detectBrowsers: async () => ({
    browsers: [{ kind: "edge", path: "C:/Program Files/Edge/msedge.exe" }],
  }),
  launchDedicatedEdge: (_executable, port, profileDir) => {
    calls.push(["launch", port, path.resolve(profileDir)]);
    current = { pid: 1234, port, profileDir: path.resolve(profileDir) };
    return { pid: 1234 };
  },
  stopDedicatedEdge: async () => {
    calls.push(["stop"]);
    current = null;
    return true;
  },
};

const dedicated = {
  enabled: true,
  mode: "dedicated",
  dedicatedPort: 9223,
  profileDir: path.join(dataDir, "browser-profile"),
};
await reconcileDedicatedBrowser(dedicated, deps);
assert.deepEqual(calls.map((call) => call[0]), ["launch"]);

await reconcileDedicatedBrowser({ ...dedicated }, deps);
assert.deepEqual(
  calls.map((call) => call[0]),
  ["launch"],
  "same dedicated settings must reuse the process",
);

await reconcileDedicatedBrowser({ ...dedicated, dedicatedPort: 9224 }, deps);
assert.deepEqual(calls.map((call) => call[0]), ["launch", "stop", "launch"]);
assert.equal(current.port, 9224);

await reconcileDedicatedBrowser({ ...dedicated, mode: "attach" }, deps);
assert.deepEqual(calls.at(-1), ["stop"]);
assert.equal(current, null);

calls.length = 0;
await reconcileDedicatedBrowser(dedicated, deps);
let stored = dedicated;
await assert.rejects(
  withBrowserSettingsTransition({
    previous: dedicated,
    next: { ...dedicated, mode: "attach" },
    reconcile: (settings) => reconcileDedicatedBrowser(settings, deps),
    commit: async (next) => {
      stored = next;
      throw new Error("disk full");
    },
    rollback: async (previous) => {
      stored = previous;
    },
  }),
  /disk full/,
);
assert.equal(stored.mode, "dedicated");
assert.equal(current?.port, 9223, "rollback must restore the dedicated process");
assert.deepEqual(
  calls.map((call) => call[0]),
  ["launch", "stop", "launch"],
);

console.log("browser lifecycle ok: transitions, restart, and rollback are consistent");
