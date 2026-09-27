// CCDPH-FIX(P2-1 回归): /api/mcp-servers/save 必须对名称施加与 delete 相同的正则。
// 此前 name:"__proto__" 会走 `doc.mcpServers["__proto__"] = entry` 的原型 setter ——
// 条目不落盘却返回 {ok:true}，并临时改写该对象的原型。
// 本用例只用桩依赖，**不读写任何真实 MCP 配置**。
import assert from "node:assert/strict";
import { createIntegrationRoute } from "../routes/integration.mjs";

const makeRoute = (doc, name) =>
  createIntegrationRoute({
    getDb: () => ({ settings: {} }),
    getExternalOpener: () => null,
    body: async () => ({ name, type: "stdio", command: "calc" }),
    json: (_res, value) => value,
    requireObject: (value) => value,
    sanitizeMcpEntry: () => ({ type: "stdio", command: "calc" }),
    mcpWriteQueue: (fn) => fn(),
    readMcpDoc: async () => doc,
    writeMcpDoc: async () => {},
  });

const call = (route) =>
  route(
    { method: "POST" },
    {},
    new URL("http://127.0.0.1/api/mcp-servers/save"),
    "/api/mcp-servers/save",
  );

// 1) 原型相关名一律拒绝，且不得污染原型
const polluted = { mcpServers: {} };
await assert.rejects(call(makeRoute(polluted, "__proto__")), /MCP 名称/);
assert.equal(Object.hasOwn(polluted.mcpServers, "__proto__"), false);
assert.equal(
  Object.getPrototypeOf(polluted.mcpServers),
  Object.prototype,
  "mcpServers 的原型不得被 entry 改写",
);
assert.deepEqual(Object.keys(polluted.mcpServers), []);

// 2) 以 "constructor" 这类**命中正则**、但会在原型链上查到继承值的名字：
//    允许保存（正则首字符必须是字母数字，故不会拼出 __proto__），
//    关键是不能把继承值当既有条目（Object.hasOwn 已处理），且必须落成自有属性。
const inherited = { mcpServers: {} };
const inheritedResult = await call(makeRoute(inherited, "constructor"));
assert.equal(inheritedResult.ok, true);
assert.equal(
  Object.hasOwn(inherited.mcpServers, "constructor"),
  true,
  "constructor 必须落成自有属性，而不是沿原型链读写",
);

// 3) 合法名可以通过（确保不是"一刀切禁用"）
const ok = { mcpServers: {} };
const result = await call(makeRoute(ok, "my-mcp.server_1"));
assert.equal(result.ok, true);
assert.equal(Object.hasOwn(ok.mcpServers, "my-mcp.server_1"), true);

console.log(
  "mcp save name ok: prototype-polluting names are rejected before any write",
);
