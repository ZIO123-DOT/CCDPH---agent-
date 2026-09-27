import assert from "node:assert/strict";
import { mergePendingTerminalRecords } from "../terminal-registry.mjs";

const valid = { pid: 42, name: "cmd.exe", started: "2026-09-27T10:00:00Z" };
const invalid = { pid: "not-a-pid", name: "bad.exe", started: "" };
assert.deepEqual(mergePendingTerminalRecords([invalid, valid], [invalid]), [valid]);
assert.deepEqual(
  mergePendingTerminalRecords([valid], [{ ...valid, name: "CMD.EXE" }]),
  [{ ...valid, name: "CMD.EXE" }],
);
console.log("terminal registry hardening ok: invalid PIDs are ignored and valid identities deduplicate");
