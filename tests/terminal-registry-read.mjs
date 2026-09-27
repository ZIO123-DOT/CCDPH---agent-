import assert from "node:assert/strict";
import { readTerminalRegistryDocument } from "../terminal-registry.mjs";

const warnings = [];
const logger = { warn: (...args) => warnings.push(args.join(" ")) };
let removed = 0;
const removeFile = async () => {
  removed += 1;
};

const busy = Object.assign(new Error("busy"), { code: "EBUSY" });
assert.equal(
  await readTerminalRegistryDocument("registry.json", {
    readFile: async () => {
      throw busy;
    },
    removeFile,
    logger,
  }),
  null,
);
assert.equal(removed, 0, "transient read failures must preserve the registry");
assert(warnings.some((line) => /保留原文件/.test(line)));

assert.equal(
  await readTerminalRegistryDocument("registry.json", {
    readFile: async () => "{broken",
    removeFile,
    logger,
  }),
  null,
);
assert.equal(removed, 1, "invalid JSON should remove the corrupt registry");

const valid = { owner: null, records: [] };
assert.deepEqual(
  await readTerminalRegistryDocument("registry.json", {
    readFile: async () => JSON.stringify(valid),
    removeFile,
    logger,
  }),
  valid,
);
assert.equal(removed, 1);
console.log("terminal registry read ok: transient I/O errors preserve records and corrupt JSON is removed");
