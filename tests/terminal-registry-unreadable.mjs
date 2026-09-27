import assert from "node:assert/strict";
import { recoverUnreadableTerminalRecords } from "../terminal-registry.mjs";

const stale = { pid: 77, name: "cmd.exe", started: "2026-09-27T11:00:00Z" };
const active = { pid: 88, name: "ping.exe", started: "2026-09-27T11:01:00Z" };

const unreadable = await recoverUnreadableTerminalRecords("registry.json", [stale], {
  readDocument: async (_file, options) => {
    options.onReadError(Object.assign(new Error("busy"), { code: "EBUSY" }));
    return null;
  },
});
assert.equal(unreadable.unreadable, true);
assert.deepEqual(unreadable.records, [stale]);

const recovered = await recoverUnreadableTerminalRecords("registry.json", [stale], {
  readDocument: async () => ({ owner: null, records: [active] }),
});
assert.equal(recovered.unreadable, false);
assert.deepEqual(recovered.records, [stale, active]);
console.log("terminal registry unreadable ok: snapshots wait for recovery and merge disk records before overwrite");
