import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendBoundedText,
  armRunDeadlineTimer,
  armUpdateInstallGateTimer,
  closeRunQuery,
  canStartAnotherRun,
  MAX_CONCURRENT_RUNS,
  MAX_PROJECTS,
  RUN_HARD_DEADLINE_MS,
  STATE_CONTENT_MAX_DEPTH,
  STATE_SAFE_SERIALIZATION_DEPTH,
  attachTerminalEncodingInitializer,
  assertSafeZipEntries,
  assertJsonDepth,
  assertJsonTextDepth,
  boundedText,
  browserRestrictions,
  canApplyPermissionModeLive,
  classifyRouteDomain,
  consumeTerminalStartupChunk,
  createTokenBucketLimiter,
  decodeJsonBuffer,
  equalSha256Hex,
  eventSize,
  fitsJsonBudget,
  foldDeepStateSubtrees,
  gitChangesFailure,
  isDirectChildPath,
  pickArchivedSessionEvictions,
  prepareEventForStorage,
  preview,
  quarantineOversizedStateFile,
  readJsonResponseBounded,
  readStableBoundedFile,
  removeWorktreeOf,
  normalizeApprovalAnswers,
  normalizeRateLimitKey,
  normalizeUsageDaily,
  sanitizeError,
  safeNotify,
  sha256File,
  setNotifier,
  validateZipArchivePaths,
} from "../server.mjs";
import { scanStateComplexity } from "../server-policies.mjs";
import { previewBounded } from "../state-safety.mjs";
import { stripAnsi } from "../public/terminal-text.js";
import {
  cleanupScreenshots,
  matchesDedicatedEdgeIdentity,
} from "../browser/service.mjs";
import {
  browserMcpEnabled,
  buildPlaywrightMcpConfig,
} from "../browser/mcp-config.mjs";
import { terminalRegistryPlatformStatus } from "../terminal-registry.mjs";
import { createMacKeychainProtector } from "../credential-protector.mjs";

const sessions = [
  { id: "live-old", archived: false, updatedAt: 1 },
  { id: "archived-old", archived: true, updatedAt: 2 },
  { id: "archived-pinned", archived: true, pinned: true, updatedAt: 0 },
  { id: "archived-new", archived: true, updatedAt: 3 },
];
assert.equal(canStartAnotherRun(0), true);
assert.equal(canStartAnotherRun(MAX_CONCURRENT_RUNS - 1), true);
assert.equal(canStartAnotherRun(MAX_CONCURRENT_RUNS), false);
assert(MAX_CONCURRENT_RUNS >= 1 && MAX_CONCURRENT_RUNS <= 32);
assert.equal(MAX_PROJECTS, 200);
assert.equal(fitsJsonBudget({ ok: "small" }, 1024), true);
assert.equal(fitsJsonBudget({ huge: "x".repeat(4096) }, 1024), false);
const cyclicComplexity = {};
cyclicComplexity.self = cyclicComplexity;
// R4-P3-3: scanStateComplexity 现额外返回 references（引用总数）。环引用：唯一节点 1 个，
// 但 self 引用被再次弹出计 1 次 → references=2，验证去重与引用计数分离。
assert.deepEqual(scanStateComplexity(cyclicComplexity), {
  nodes: 1,
  references: 2,
  maxDepth: 0,
});
let toJsonCalls = 0;
const chainedToJson = function () {
  toJsonCalls += 1;
  return { toJSON: chainedToJson };
};
assert.match(previewBounded({ toJSON: chainedToJson }), /嵌套过深|节点过多/);
assert(toJsonCalls <= 66, `toJSON depth budget bypassed: ${toJsonCalls}`);
assert.deepEqual(
  pickArchivedSessionEvictions(sessions, 2).map((item) => item.id),
  ["archived-old", "archived-new"],
  "session eviction must never select unarchived or pinned sessions",
);

const json = '{"sessions":[]}';
assert.equal(decodeJsonBuffer(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(json)])), json);
assert.equal(decodeJsonBuffer(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json, "utf16le")])), json);
const utf16be = Buffer.from(json, "utf16le");
for (let i = 0; i < utf16be.length; i += 2) {
  const first = utf16be[i];
  utf16be[i] = utf16be[i + 1];
  utf16be[i + 1] = first;
}
assert.equal(decodeJsonBuffer(Buffer.concat([Buffer.from([0xfe, 0xff]), utf16be])), json);

const sanitized = sanitizeError(
  Object.assign(
    new Error(
      "Command failed: git -c safe.directory=D:\\Users\\alice\\repo remote set-url origin https://user:pass@example.com/repo?access_token=secret",
    ),
    { code: 128 },
  ),
);
assert(!sanitized.includes("D:\\Users\\alice"));
assert(!sanitized.includes("user:pass"));
assert(!sanitized.includes("access_token=secret"));
const sanitizedSpacedPath = sanitizeError(
  new Error("Command failed at C:\\Program Files\\CCDPH\\secret.txt followed by details"),
);
assert(!sanitizedSpacedPath.includes("Program Files"));
assert(!sanitizedSpacedPath.includes("secret.txt"));
const sanitizedPosixPath = sanitizeError(
  new Error("read failed at /home/alice/project/secret.txt while loading"),
);
assert(!sanitizedPosixPath.includes("/home/alice"));
assert(!sanitizedPosixPath.includes("secret.txt"));
assert.equal(
  sanitizeError(Object.assign(new Error("rename failed"), { code: "EPERM" })),
  "文件写入权限不足，请检查目录权限或安全软件拦截",
);
assert.equal(
  sanitizeError(Object.assign(new Error("write failed"), { code: "ENOSPC" })),
  "磁盘空间不足，无法保存数据",
);
const knownDigest = Buffer.alloc(32, 0xab);
assert.equal(equalSha256Hex("ab".repeat(32), knownDigest), true);
assert.equal(equalSha256Hex("ac".repeat(32), knownDigest), false);
assert.equal(equalSha256Hex("bad", knownDigest), false);
assert.equal(equalSha256Hex(`${"ab".repeat(32)}0`, knownDigest), false);
const originalConsoleError = console.error;
console.error = () => { };
try {
  assert.equal(
    sanitizeError(new RangeError("Maximum call stack size exceeded")),
    "操作失败，详情见服务端日志",
  );
} finally {
  console.error = originalConsoleError;
}

const preparedEvent = prepareEventForStorage({ id: "e1", type: "text", text: "ok" });
assert.equal(preparedEvent.event.text, "ok");
assert.equal(preparedEvent.changed, false);
assert(preparedEvent.bytes > 0);
const oversizedEvent = prepareEventForStorage({
  id: "e2",
  type: "text",
  text: "x".repeat(120_100),
});
assert.equal(oversizedEvent.changed, true);
assert(oversizedEvent.event.text.length < 120_100);
const circularEvent = { id: "e3", type: "tool", input: {} };
circularEvent.input.self = circularEvent.input;
assert.equal(prepareEventForStorage(circularEvent).changed, true);
let eventSerializationCalls = 0;
const cachedEvent = {
  toJSON() {
    eventSerializationCalls += 1;
    return { type: "text", text: "cached" };
  },
};
const cachedEventBytes = eventSize(cachedEvent);
assert(cachedEventBytes > 0);
assert.equal(eventSize(cachedEvent), cachedEventBytes);
assert.equal(eventSerializationCalls, 1, "stored event size must be serialized once");

const output = {};
appendBoundedText(output, "12345", 8);
appendBoundedText(output, "67890", 8);
assert.equal(boundedText(output), "34567890");
appendBoundedText(output, "abcdefghijk", 8);
assert.equal(boundedText(output), "defghijk");

const fakeChild = new EventEmitter();
const writes = [];
fakeChild.stdin = {
  destroyed: false,
  writableEnded: false,
  write: (value) => writes.push(value),
};
attachTerminalEncodingInitializer(fakeChild, { stdinClosed: false }, "system", "win32");
assert.equal(writes.length, 0, "encoding initialization must wait for spawn success");
fakeChild.emit("spawn");
assert.equal(writes.length, 1);
const failedChild = new EventEmitter();
failedChild.stdin = {
  destroyed: true,
  writableEnded: true,
  write: () => assert.fail("must not write to closed terminal stdin"),
};
attachTerminalEncodingInitializer(
  failedChild,
  { stdinClosed: true },
  "system",
  "win32",
);
failedChild.emit("spawn");

const startupTerminal = { startup: true, startupOutput: "banner" };
assert.deepEqual(consumeTerminalStartupChunk(startupTerminal, "more", 1024), {
  waiting: true,
  text: "",
});
const promptChunk = consumeTerminalStartupChunk(startupTerminal, ">ready", 1024);
assert.equal(promptChunk.waiting, false);
assert.equal(promptChunk.text, "ready");
const noisyStartupTerminal = { startup: true, startupOutput: "a".repeat(900) };
const noisyChunk = consumeTerminalStartupChunk(
  noisyStartupTerminal,
  "b".repeat(400),
  1024,
);
assert.equal(noisyChunk.waiting, false);
assert.match(noisyChunk.text, /启动输出超过 1024 字符/);
assert(noisyChunk.text.length < 1200);

const deadlineRun = {};
let deadlineFired = 0;
armRunDeadlineTimer(deadlineRun, () => deadlineFired++, 10);
await new Promise((resolve) => setTimeout(resolve, 30));
assert.equal(deadlineFired, 1);
assert(RUN_HARD_DEADLINE_MS >= 2 * 60 * 60 * 1000);
assert(STATE_CONTENT_MAX_DEPTH <= STATE_SAFE_SERIALIZATION_DEPTH);

let queryClosed = 0;
let queryReturned = 0;
const queryRun = {
  query: {
    close() {
      queryClosed += 1;
    },
    async return() {
      queryReturned += 1;
    },
  },
};
await closeRunQuery(queryRun);
assert.equal(queryClosed, 1);
assert.equal(queryReturned, 1);
await closeRunQuery(queryRun);
assert.equal(queryClosed, 1, "query cleanup must be idempotent");
let updateGateFired = 0;
armUpdateInstallGateTimer(() => updateGateFired++, 10);
await new Promise((resolve) => setTimeout(resolve, 30));
assert.equal(updateGateFired, 1);
assert.equal(classifyRouteDomain("/api/state"), "api");
assert.equal(classifyRouteDomain("/api/session"), "session");
assert.equal(classifyRouteDomain("/api/terminal/start"), "workspaceIo");
assert.equal(classifyRouteDomain("/api/browser/status"), "integration");
assert.equal(classifyRouteDomain("/style.css"), "static");

assert.equal(isDirectChildPath("C:\\safe\\worktrees", "C:\\safe\\worktrees\\one"), true);
assert.equal(isDirectChildPath("C:\\safe\\worktrees", "C:\\safe\\worktrees"), false);
assert.equal(isDirectChildPath("C:\\safe\\worktrees", "C:\\safe\\worktrees\\one\\nested"), false);
assert.equal(isDirectChildPath("C:\\safe\\worktrees", "C:\\safe\\outside"), false);

assert.deepEqual(browserRestrictions("auto", true).disallowedTools, [
  "mcp__browser__browser_evaluate",
  "mcp__browser__browser_run_code",
  "mcp__browser__browser_file_upload",
]);
assert.deepEqual(browserRestrictions("default", true), {});
assert.deepEqual(browserRestrictions("auto", false), {});
assert.equal(canApplyPermissionModeLive("auto", "default"), false);
assert.equal(canApplyPermissionModeLive("auto", "auto"), true);
assert.equal(canApplyPermissionModeLive("default", "auto"), true);
assert.equal(canApplyPermissionModeLive("default", "plan"), true);
assert.equal(browserMcpEnabled({ enabled: true }), true);
assert.equal(browserMcpEnabled({ enabled: false }), false);
assert.equal(terminalRegistryPlatformStatus("win32").supported, true);
assert.equal(terminalRegistryPlatformStatus("darwin").supported, true);
assert.equal(terminalRegistryPlatformStatus("linux").supported, false);
assert.match(terminalRegistryPlatformStatus("linux").reason, /不支持/);
assert.equal(
  matchesDedicatedEdgeIdentity(
    '"msedge.exe","4321","Console","1","100,000 K"',
    "TCP    127.0.0.1:9223    0.0.0.0:0    LISTENING    4321",
    4321,
    9223,
  ),
  true,
);
assert.equal(
  matchesDedicatedEdgeIdentity(
    '"msedge.exe","4321","Console","1","100,000 K"',
    "TCP    127.0.0.1:9223    0.0.0.0:0    LISTENING    9999",
    4321,
    9223,
  ),
  false,
);
assert.equal(
  matchesDedicatedEdgeIdentity(
    '"msedge.exe","9999","Console","1","100,000 K"',
    "TCP    127.0.0.1:9223    0.0.0.0:0    LISTENING    4321",
    4321,
    9223,
  ),
  false,
);
assert.equal(
  matchesDedicatedEdgeIdentity(
    '"notepad.exe","4321","Console","1","10,000 K"',
    "TCP    127.0.0.1:9223    0.0.0.0:0    LISTENING    4321",
    4321,
    9223,
  ),
  false,
);
const mcpConfig = buildPlaywrightMcpConfig({
  enabled: true,
  mode: "attach",
  imageResponses: "omit",
  allowOrigins: ["example.com"],
  blockOrigins: [],
});
assert.equal(typeof mcpConfig.command, "string");
assert(mcpConfig.args.includes("--cdp-endpoint=msedge"));
assert(mcpConfig.args.includes("--allowed-origins"));

// P1-4：auto 模式默认并入 SSRF 阻断（回环 + 云元数据）
{
  const autoCfg = buildPlaywrightMcpConfig(
    { enabled: true, mode: "dedicated", dedicatedPort: 9223, allowOrigins: [], blockOrigins: [] },
    "auto",
  );
  const bi = autoCfg.args.indexOf("--blocked-origins");
  assert(bi >= 0, "auto 模式应带 --blocked-origins");
  const blockedValue = autoCfg.args[bi + 1];
  for (const host of ["localhost", "127.0.0.1", "169.254.169.254"])
    assert(blockedValue.split(";").includes(host), `默认阻断应含 ${host}`);
  // 用户显式 allow 的主机不重复默认阻断
  const allowCfg = buildPlaywrightMcpConfig(
    { enabled: true, mode: "dedicated", dedicatedPort: 9223, allowOrigins: ["localhost"], blockOrigins: [] },
    "auto",
  );
  const abi = allowCfg.args.indexOf("--blocked-origins");
  assert(!allowCfg.args[abi + 1].split(";").includes("localhost"), "显式 allow 的主机不应被默认阻断");
  // 非 auto 模式不带默认阻断
  const defaultCfg = buildPlaywrightMcpConfig(
    { enabled: true, mode: "dedicated", dedicatedPort: 9223, allowOrigins: [], blockOrigins: [] },
  );
  assert(!defaultCfg.args.includes("--blocked-origins"), "非 auto 模式不应带默认阻断");
}

assert.deepEqual(gitChangesFailure({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }), {
  files: [],
  additions: 0,
  deletions: 0,
  tooLarge: true,
  error:
    "仓库变更过多，无法一次列出（已超出读取上限）；请缩小范围、清理未跟踪文件，或使用命令行 git",
});
assert.equal(gitChangesFailure(new Error("not a repository")).notGit, true);
assert.equal(
  gitChangesFailure(Object.assign(new Error("fatal: permission denied"), { stderr: "fatal: permission denied" })).error,
  "Git 变更查询失败，请检查仓库权限、safe.directory 设置或 Git 安装状态",
);
assert.equal(stripAnsi("a\u001b[200~b\u001b[201~c"), "abc");
assert.equal(stripAnsi("a\u001b[?25lb\u001b[?25hc"), "abc");

const allow = createTokenBucketLimiter(2, 2);
assert.equal(allow("loopback", 1000), true);
assert.equal(allow("loopback", 1000), true);
assert.equal(allow("loopback", 1000), false);
assert.equal(allow("loopback", 1500), true);

const boundedAllow = createTokenBucketLimiter(1, 1, {
  maxBuckets: 2,
  idleMs: 60_000,
  cleanupEvery: 1,
});
assert.equal(boundedAllow("a", 1000), true);
assert.equal(boundedAllow("a", 1000), false);
assert.equal(boundedAllow("b", 1000), true);
assert.equal(boundedAllow("c", 1000), true);
assert.equal(
  boundedAllow("a", 1000),
  true,
  "rate limiter must evict the least-recently-used bucket at capacity",
);
const idleAllow = createTokenBucketLimiter(0, 1, {
  maxBuckets: 3,
  idleMs: 1000,
  cleanupEvery: 1,
});
assert.equal(idleAllow("idle", 0), true);
assert.equal(idleAllow("idle", 0), false);
assert.equal(idleAllow("trigger-cleanup", 1001), true);
assert.equal(
  idleAllow("idle", 1001),
  true,
  "rate limiter must discard idle buckets",
);

const depth100 = {};
let depthCursor = depth100;
for (let i = 0; i < 100; i++) depthCursor = depthCursor.child = {};
assert.equal(assertJsonDepth(depth100), depth100);
depthCursor.child = {};
assert.throws(() => assertJsonDepth(depth100), /嵌套不能超过 100 层/);
const trap = {};
Object.defineProperty(trap, "explode", {
  enumerable: true,
  get() {
    throw new Error("depth traversal did not short-circuit");
  },
});
const deepFirst = {};
let deepFirstCursor = deepFirst;
for (let i = 0; i < 101; i++) deepFirstCursor = deepFirstCursor.child = {};
assert.throws(
  () => assertJsonDepth([trap, deepFirst]),
  /嵌套不能超过 100 层/,
  "depth validation must return before visiting unrelated branches",
);
assert.equal(
  assertJsonTextDepth('{"text":"[[[[{{{{","value":{}}}'),
  '{"text":"[[[[{{{{","value":{}}}',
);
assert.throws(
  () => assertJsonTextDepth('{"a":'.repeat(102) + "0" + "}".repeat(102)),
  /嵌套不能超过 100 层/,
);

const deepLoadedState = { safe: "kept", nested: {} };
let loadedCursor = deepLoadedState.nested;
for (let index = 0; index < 400; index += 1)
  loadedCursor = loadedCursor.child = {};
const foldedLoadedState = foldDeepStateSubtrees(deepLoadedState);
assert.equal(foldedLoadedState.changed, true);
assert.equal(deepLoadedState.safe, "kept");
assert.doesNotThrow(() => structuredClone(deepLoadedState));
assert.doesNotThrow(() => JSON.stringify(deepLoadedState));
const negativeLimitState = { child: {} };
assert.doesNotThrow(() => foldDeepStateSubtrees(negativeLimitState, -1));
assert.equal(typeof negativeLimitState.child, "string");

const hugePreviewArray = Array.from({ length: 10_000 }, (_, index) => index);
Object.defineProperty(hugePreviewArray, 500, {
  enumerable: true,
  get() {
    throw new Error("preview walked beyond its item budget");
  },
});
assert.match(preview(hugePreviewArray), /仅预览前 100 项/);
const widePreviewObject = {};
for (let index = 0; index < 500; index += 1)
  widePreviewObject[`field-${index}`] = "x".repeat(40_000);
const boundedWidePreview = preview(widePreviewObject);
assert.match(
  boundedWidePreview,
  /仅预览前 100 个字段|内容过长|内容预算已用尽/,
);
assert(
  boundedWidePreview.length < 50_000,
  "preview must cap its serialized result before returning",
);
const sharedPreviewValue = { hello: "world" };
const sharedPreview = preview({ a: sharedPreviewValue, b: sharedPreviewValue });
assert.equal((sharedPreview.match(/"hello": "world"/g) || []).length, 2);
assert(!sharedPreview.includes("[循环引用]"));
const cyclicPreviewValue = { hello: "world" };
cyclicPreviewValue.self = cyclicPreviewValue;
assert(preview(cyclicPreviewValue).includes("[循环引用]"));
const cyclicToJsonValue = {
  toJSON() {
    return { self: cyclicToJsonValue };
  },
};
assert(preview(cyclicToJsonValue).includes("[循环引用]"));

assert.deepEqual(normalizeApprovalAnswers({ question: "answer" }), {
  question: "answer",
});
assert.throws(() => normalizeApprovalAnswers({ question: { nested: true } }), /字符串/);
assert.throws(() => normalizeApprovalAnswers({ __proto__: "bad" }), /回答数量|问题标识/);
assert.equal(normalizeRateLimitKey("127.0.0.1"), "loopback");
assert.equal(normalizeRateLimitKey("::1"), "loopback");
assert.equal(normalizeRateLimitKey("::ffff:127.0.0.1"), "loopback");
const usageFixture = Object.fromEntries(
  Array.from({ length: 100 }, (_, index) => [
    `2026-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
    { requests: index },
  ]),
);
assert.equal(Object.keys(normalizeUsageDaily(usageFixture)).length, 60);

const notifierWarnings = [];
const originalWarn = console.warn;
console.warn = (...args) => notifierWarnings.push(args);
try {
  setNotifier(() => {
    throw new Error("sync notifier failure");
  });
  assert.doesNotThrow(() => safeNotify({ title: "sync" }));
  setNotifier(async () => {
    throw new Error("async notifier failure");
  });
  safeNotify({ title: "async" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notifierWarnings.length, 2);
} finally {
  setNotifier(undefined);
  console.warn = originalWarn;
}

assert.deepEqual(
  await readJsonResponseBounded(new Response('{"ok":true}'), 64),
  { ok: true },
);
await assert.rejects(
  readJsonResponseBounded(
    new Response('{"ok":true}', { headers: { "content-length": "1000" } }),
    64,
  ),
  /过大/,
);

const temp = await mkdtemp(path.join(os.tmpdir(), "ccdph-behavior-"));
try {
  const small = path.join(temp, "small.txt");
  const large = path.join(temp, "large.txt");
  await writeFile(small, "hello");
  await writeFile(large, "x".repeat(32));
  assert.equal((await readStableBoundedFile(small, 16)).toString("utf8"), "hello");
  await assert.rejects(readStableBoundedFile(large, 16), /上限/);

  const oversizedState = path.join(temp, "state.json");
  await writeFile(oversizedState, "oversized-state");
  const oversizedBackup = await quarantineOversizedStateFile(
    oversizedState,
    15,
    8,
  );
  assert.equal(await readFile(oversizedBackup, "utf8"), "oversized-state");
  await assert.rejects(stat(oversizedState), /ENOENT/);
  assert.match(
    await readFile(`${oversizedState}.oversize-readme.txt`, "utf8"),
    /原始数据仍完整保留/,
  );

  assert.doesNotThrow(() =>
    assertSafeZipEntries(path.join(temp, "extract"), [
      "CCDPH.exe",
      "resources/app/server.mjs",
    ]),
  );
  for (const unsafeName of [
    "../escape.txt",
    ".. /escape.txt",
    "/absolute.txt",
    "C:/escape.txt",
    "folder/file.txt:secret",
    "folder/CON.txt",
    "folder/file.txt.",
    "folder/file.txt ",
  ])
    assert.throws(
      () => assertSafeZipEntries(path.join(temp, "extract"), [unsafeName]),
      /更新包/,
    );
  assert.throws(
    () =>
      assertSafeZipEntries(path.join(temp, "extract"), [
        "folder/file.txt",
        "folder/file.txt. ",
      ]),
    /尾随点或空格|重复路径/,
  );
  assert.throws(
    () =>
      assertSafeZipEntries(path.join(temp, "extract"), [
        `${"a".repeat(256)}.txt`,
      ]),
    /255 字节/,
  );
  const digestFile = path.join(temp, "digest.bin");
  await writeFile(digestFile, "hash-me");
  assert.equal(
    (await sha256File(digestFile)).toString("hex"),
    createHash("sha256").update("hash-me").digest("hex"),
  );

  const fakeZip = (
    names,
    { symlink = false, encrypted = false, uncompressedSize = 0 } = {},
  ) => {
    const central = names.map((name) => {
      const encoded = Buffer.from(name, "utf8");
      const entry = Buffer.alloc(46 + encoded.length);
      entry.writeUInt32LE(0x02014b50, 0);
      entry.writeUInt16LE(symlink ? 0x0314 : 20, 4);
      entry.writeUInt16LE(20, 6);
      entry.writeUInt16LE(0x0800 | (encrypted ? 1 : 0), 8);
      entry.writeUInt32LE(uncompressedSize, 24);
      entry.writeUInt16LE(encoded.length, 28);
      if (symlink) entry.writeUInt32LE(0xa0000000, 38);
      encoded.copy(entry, 46);
      return entry;
    });
    const directory = Buffer.concat(central);
    const localPrefix = Buffer.alloc(1);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(names.length, 8);
    eocd.writeUInt16LE(names.length, 10);
    eocd.writeUInt32LE(directory.length, 12);
    eocd.writeUInt32LE(localPrefix.length, 16);
    return Buffer.concat([localPrefix, directory, eocd]);
  };
  const safeZip = path.join(temp, "safe.zip");
  await writeFile(safeZip, fakeZip(["CCDPH.exe", "resources/app.js"]));
  assert.deepEqual(
    await validateZipArchivePaths(safeZip, path.join(temp, "extract")),
    ["CCDPH.exe", "resources/app.js"],
  );
  const unsafeZip = path.join(temp, "unsafe.zip");
  await writeFile(unsafeZip, fakeZip(["../escape.txt"]));
  await assert.rejects(
    validateZipArchivePaths(unsafeZip, path.join(temp, "extract")),
    /路径穿越/,
  );
  const symlinkZip = path.join(temp, "symlink.zip");
  await writeFile(symlinkZip, fakeZip(["link"], { symlink: true }));
  await assert.rejects(
    validateZipArchivePaths(symlinkZip, path.join(temp, "extract")),
    /符号链接/,
  );
  const encryptedZip = path.join(temp, "encrypted.zip");
  await writeFile(encryptedZip, fakeZip(["secret"], { encrypted: true }));
  await assert.rejects(
    validateZipArchivePaths(encryptedZip, path.join(temp, "extract")),
    /加密条目/,
  );
  const bombZip = path.join(temp, "bomb.zip");
  await writeFile(
    bombZip,
    fakeZip(["a", "b"], { uncompressedSize: 600 * 1024 * 1024 }),
  );
  await assert.rejects(
    validateZipArchivePaths(bombZip, path.join(temp, "extract")),
    /1 GiB/,
  );

  const shots = path.join(temp, "shots");
  await mkdir(shots);
  const shotFiles = [
    "shot_1000_aaaaaaaa.png",
    "shot_2000_bbbbbbbb.png",
    "shot_3000_cccccccc.png",
  ];
  for (let i = 0; i < shotFiles.length; i++) {
    const file = path.join(shots, shotFiles[i]);
    await writeFile(file, Buffer.alloc(8, i));
    const time = new Date(Date.now() - (shotFiles.length - i) * 1000);
    await utimes(file, time, time);
  }
  await writeFile(path.join(shots, "keep-user-file.png"), Buffer.alloc(8, 9));
  cleanupScreenshots(60_000, 10, 16, shots);
  const survivors = await readdir(shots);
  assert(survivors.includes("keep-user-file.png"), "cleanup must ignore non-CCDPH files");
  const survivingShots = survivors.filter((name) => name.startsWith("shot_"));
  assert.equal(survivingShots.length, 2, "screenshot cleanup must enforce total byte budget");
  assert.equal(
    (await Promise.all(survivingShots.map((name) => stat(path.join(shots, name))))).reduce(
      (sum, item) => sum + item.size,
      0,
    ),
    16,
  );

  const outsideCanary = path.join(temp, "outside-canary");
  await mkdir(outsideCanary);
  await writeFile(path.join(outsideCanary, "keep.txt"), "keep");
  assert.deepEqual(
    await removeWorktreeOf({ environment: "worktree", cwd: outsideCanary }),
    { removed: 0, kept: 1 },
  );
  assert.equal((await stat(path.join(outsideCanary, "keep.txt"))).isFile(), true);

  const allowedRoot = path.join(os.tmpdir(), "ccdph-worktrees");
  const nonGitCanary = path.join(allowedRoot, `non-git-${Date.now()}-${process.pid}`);
  await mkdir(nonGitCanary, { recursive: true });
  await writeFile(path.join(nonGitCanary, "keep.txt"), "keep");
  try {
    assert.deepEqual(
      await removeWorktreeOf({ environment: "worktree", cwd: nonGitCanary }),
      { removed: 0, kept: 1 },
    );
    assert.equal((await stat(path.join(nonGitCanary, "keep.txt"))).isFile(), true);
  } finally {
    await rm(nonGitCanary, { recursive: true, force: true });
  }
  assert.deepEqual(
    await removeWorktreeOf({
      environment: "worktree",
      cwd: path.join(allowedRoot, `missing-${Date.now()}`),
    }),
    { removed: 0, kept: 1 },
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}

// macOS Keychain 保护器（注入假 safeStorage 验证往返 + 降级）
{
  const fakeSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext) => Buffer.from("enc:" + plaintext, "utf8"),
    decryptString: (buffer) => {
      const s = buffer.toString("utf8");
      if (!s.startsWith("enc:")) throw new Error("invalid payload");
      return s.slice(4);
    },
  };
  const mac = createMacKeychainProtector(fakeSafeStorage);
  assert.equal(mac.name, "macos-keychain");
  const payload = await mac.encrypt("sk-macos-secret");
  assert(!payload.includes("sk-macos-secret"), "密文不得包含明文");
  assert.equal(await mac.decrypt(payload), "sk-macos-secret", "解密往返一致");
  assert.equal(createMacKeychainProtector(null), null, "无 safeStorage 应降级为 null");
}

console.log("behavior ok: session safety, JSON BOM, redaction, bounded I/O, rate limits");
