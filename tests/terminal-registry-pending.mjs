import assert from "node:assert/strict";
import { mergePendingTerminalRecords } from "../terminal-registry.mjs";

const stale = { pid: 101, name: "ping.exe", started: "2026-09-27T10:00:00Z" };
const active = { pid: 202, name: "cmd.exe", started: "2026-09-27T10:01:00Z" };
assert.deepEqual(mergePendingTerminalRecords([stale], []), [stale]);
assert.deepEqual(mergePendingTerminalRecords([stale], [active]), [stale, active]);
assert.deepEqual(
  mergePendingTerminalRecords([stale], [{ ...stale, name: "PING.EXE" }]),
  [{ ...stale, name: "PING.EXE" }],
  "current record with the same PID/start identity replaces stale metadata",
);
console.log("terminal pending registry ok: failed cleanup records survive later snapshots");
