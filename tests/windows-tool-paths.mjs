import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const registry = await readFile(
  new URL("../terminal-registry.mjs", import.meta.url),
  "utf8",
);

for (const [file, source, pattern] of [
  ["server.mjs", server, /exec\(["']where\.exe["']/],
  ["server.mjs", server, /spawn\(["']cmd\.exe["']/],
  ["terminal-registry.mjs", registry, /spawn\(["']powershell\.exe["']/],
])
  assert.equal(pattern.test(source), false, `${file} contains a bare Windows tool lookup`);

assert.match(server, /WINDOWS_WHERE_EXE/);
assert.match(server, /WINDOWS_CMD_EXE/);
assert.match(registry, /WINDOWS_POWERSHELL_EXE/);
console.log("windows tool paths ok: security-sensitive helpers use System32 absolute paths");
