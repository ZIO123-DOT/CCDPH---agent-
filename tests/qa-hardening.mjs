// QA 阶段3：高风险区极限补测（栈溢出 / 内存累积 / 更新命令注入 / 路径穿越 / 认证限流）
// 纯审查：只读源码 + 运行测试，不改动 src。
// 运行：node tests/qa-hardening.mjs
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from "node:fs/promises";
import {
  appendBoundedText,
  boundedText,
  assertJsonDepth,
  assertJsonTextDepth,
  assertSafeZipEntries,
  createTokenBucketLimiter,
  equalSha256Hex,
  foldDeepStateSubtrees,
  isDirectChildPath,
  prepareEventForStorage,
  preview,
  within,
  safePath,
  STATE_SAFE_SERIALIZATION_DEPTH,
} from "../server.mjs";
import { previewBounded } from "../state-safety.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(ROOT, "..");

// ---- 微型测试骨架：AAA + P0-P4 分级 + 耗时/内存采样 ----
const results = [];
let area = "";
async function test(id, severity, name, fn) {
  const before = process.memoryUsage().heapUsed;
  const start = performance.now();
  try {
    await fn();
    results.push({
      id,
      area,
      severity,
      name,
      status: "PASS",
      ms: Math.round((performance.now() - start) * 100) / 100,
      heapKB: Math.round((process.memoryUsage().heapUsed - before) / 1024),
    });
  } catch (error) {
    results.push({
      id,
      area,
      severity,
      name,
      status: "FAIL",
      ms: Math.round((performance.now() - start) * 100) / 100,
      error: error?.message || String(error),
    });
  }
}
const deepChain = (n) => {
  const root = { leaf: `marker-${n}` };
  let cursor = root;
  for (let i = 0; i < n; i += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  return root;
};

// ============================================================
// 区域 1：栈溢出防护（P0）
// ============================================================
area = "栈溢出";
await test("S-01", "P0", "assertJsonDepth 深度=50 不抛错（阈值内）", () => {
  assert.doesNotThrow(() => assertJsonDepth(deepChain(50)));
});
await test("S-02", "P0", "assertJsonDepth 深度=100 边界不抛错", () => {
  assert.doesNotThrow(() => assertJsonDepth(deepChain(100)));
});
await test("S-03", "P0", "assertJsonDepth 深度=101 边界抛错", () => {
  assert.throws(() => assertJsonDepth(deepChain(101)), /嵌套不能超过 100 层/);
});
for (const n of [200, 500, 10000, 100000]) {
  await test(
    `S-04-${n}`,
    "P0",
    `assertJsonDepth 深度=${n} 早退不爆栈（<100ms）`,
    () => {
      const start = performance.now();
      assert.throws(() => assertJsonDepth(deepChain(n)), /嵌套不能超过 100 层/);
      const ms = performance.now() - start;
      assert(ms < 100, `深度 ${n} 判定耗时 ${ms}ms，疑似未短路`);
    },
  );
}
await test("S-05", "P0", "foldDeepStateSubtrees 深度=256 边界不折叠", () => {
  const r = foldDeepStateSubtrees(deepChain(256));
  assert.equal(r.changed, false);
});
await test("S-06", "P0", "foldDeepStateSubtrees 深度=257 折叠一层", () => {
  const v = deepChain(257);
  const r = foldDeepStateSubtrees(v);
  assert.equal(r.changed, true);
  assert.equal(r.folded, 1);
  assert.doesNotThrow(() => JSON.stringify(v));
});
for (const n of [5000, 50000]) {
  await test(
    `S-07-${n}`,
    "P0",
    `foldDeepStateSubtrees 深度=${n} 不爆栈且折叠后可序列化`,
    () => {
      const v = deepChain(n);
      const r = foldDeepStateSubtrees(v);
      assert.equal(r.changed, true);
      assert.doesNotThrow(() => structuredClone(v));
      assert.doesNotThrow(() => JSON.stringify(v));
    },
  );
}
await test("S-08", "P0", "foldDeepStateSubtrees 循环引用不死循环", () => {
  const v = { a: 1 };
  v.self = v;
  const r = foldDeepStateSubtrees(v);
  assert.equal(r.changed, false);
});
await test("S-09", "P0", "assertJsonTextDepth 深度=100 边界不抛错", () => {
  const text = '{"a":'.repeat(100) + "0" + "}".repeat(100);
  assert.doesNotThrow(() => assertJsonTextDepth(text));
});
await test("S-10", "P0", "assertJsonTextDepth 深度=101 不抛错（+1 余量内）", () => {
  const text = '{"a":'.repeat(101) + "0" + "}".repeat(101);
  assert.doesNotThrow(() => assertJsonTextDepth(text));
});
await test("S-10b", "P0", "assertJsonTextDepth 深度=102 抛错", () => {
  const text = '{"a":'.repeat(102) + "0" + "}".repeat(102);
  assert.throws(() => assertJsonTextDepth(text), /嵌套不能超过 100 层/);
});
for (const n of [500, 10000]) {
  await test(
    `S-11-${n}`,
    "P0",
    `assertJsonTextDepth 深度=${n} 文本早退不爆栈`,
    () => {
      const text = '{"a":'.repeat(n) + "0" + "}".repeat(n);
      const start = performance.now();
      assert.throws(() => assertJsonTextDepth(text), /嵌套不能超过 100 层/);
      assert(performance.now() - start < 200, "深度文本判定疑似未短路");
    },
  );
}
await test("S-12", "P0", "previewBounded 深度=10000 对象不爆栈返回占位", () => {
  const out = previewBounded(deepChain(10000));
  assert.match(out, /内容嵌套过深|无法预览/);
});
await test("S-13", "P0", "previewBounded 1MB 浅层文本不爆栈且封顶", () => {
  const out = previewBounded("x".repeat(1_000_000));
  assert.equal(out.length, 40_000);
});

// ============================================================
// 区域 2：内存累积 / 预算封顶（P1）
// ============================================================
area = "内存累积";
await test("M-01", "P1", "appendBoundedText 5MB 单块封顶 200k", () => {
  const t = {};
  appendBoundedText(t, "x".repeat(5_000_000), 200_000);
  assert.equal(t.outputChars, 200_000);
  assert.equal(t.outputChunks.length, 1);
  assert.equal(boundedText(t).length, 200_000);
});
await test("M-02", "P1", "appendBoundedText 10000 块累积始终 ≤ 上限", () => {
  const t = {};
  for (let i = 0; i < 10_000; i += 1) appendBoundedText(t, "y".repeat(1000), 200_000);
  assert(t.outputChars <= 200_000, `outputChars=${t.outputChars} 超上限`);
  assert.equal(boundedText(t).length, 200_000);
  assert(t.outputChunks.length < 1000, `chunks=${t.outputChunks.length} 未合并封顶`);
});
await test("M-03", "P1", "appendBoundedText 空串/极限 limit=1 不崩", () => {
  const t = {};
  appendBoundedText(t, "", 1);
  appendBoundedText(t, "abc", 1);
  assert(t.outputChars <= 1);
  assert.equal(boundedText(t).length, 1);
});
await test("M-04", "P1", "previewBounded 超大字符串字段截断", () => {
  const out = previewBounded({ big: "z".repeat(1_000_000) });
  assert.match(out, /已截断|内容预算已用尽|内容过长/);
  assert(out.length < 50_000, `结果长度 ${out.length} 未封顶`);
});
await test("M-05", "P1", "previewBounded 10 万元素数组仅预览前 100", () => {
  const out = previewBounded(Array.from({ length: 100_000 }, (_, i) => i));
  assert.match(out, /仅预览前 100 项/);
  assert(out.length < 50_000);
});
await test("M-06", "P1", "previewBounded 10 万字段对象仅预览前 100 字段", () => {
  const obj = {};
  for (let i = 0; i < 100_000; i += 1) obj[`k${i}`] = i;
  const out = previewBounded(obj);
  assert.match(out, /仅预览前 100 个字段/);
});
await test("M-07", "P1", "previewBounded 节点预算 2101 节点触发截断", () => {
  const root = {};
  for (let i = 0; i < 100; i += 1) {
    const child = {};
    for (let j = 0; j < 20; j += 1) child[`f${j}`] = {};
    root[`k${i}`] = child;
  }
  assert.match(previewBounded(root), /内容节点过多/);
});
await test("M-08", "P1", "previewBounded 循环引用返回占位不死循环", () => {
  const v = {};
  v.self = v;
  assert.match(previewBounded(v), /循环引用/);
});
await test("M-09", "P1", "prepareEventForStorage 超大 input 折叠且字节封顶", () => {
  const event = { id: "e", type: "tool", input: { huge: "x".repeat(2_000_000) } };
  const r = prepareEventForStorage(event);
  assert.equal(r.changed, true);
  assert(r.bytes <= 512_000 + 4096, `折叠后字节 ${r.bytes} 未封顶`);
});

// ============================================================
// 区域 3：更新命令注入（P0，静态+可测部分）
// ============================================================
area = "命令注入";
await test("C-01", "P0", "更新 sha256 完整性门（equalSha256Hex）全分支", () => {
  const digest = Buffer.alloc(32, 0xcd);
  assert.equal(equalSha256Hex("cd".repeat(32), digest), true);
  assert.equal(equalSha256Hex("CD".repeat(32), digest), true);
  assert.equal(equalSha256Hex("ce".repeat(32), digest), false);
  assert.equal(equalSha256Hex("cd".repeat(31), digest), false);
  assert.equal(equalSha256Hex("cd".repeat(33), digest), false);
  assert.equal(equalSha256Hex("", digest), false);
  assert.equal(equalSha256Hex("g".repeat(64), digest), false);
});
await test("C-02", "P0", "更新 .bat 正文不内联任何用户路径（静态不变量）", async () => {
  // installUpdate 依赖打包 exe 无法单测；改为验证「.bat 生成只插值 process.pid、
  // 其余动态路径全部经环境变量传入」这一安全不变量。
  const src = await readFile(path.join(APP_ROOT, "server.mjs"), "utf8");
  const start = src.indexOf('const bat = [');
  assert(start > 0, "未定位到 .bat 生成代码");
  const end = src.indexOf('].join("\\r\\n")', start);
  const batBody = src.slice(start, end);
  for (const forbidden of ["${appDir}", "${installDir}", "${stageDir}", "${exeName}"])
    assert(!batBody.includes(forbidden), `.bat 正文非法内联 ${forbidden}`);
  assert(batBody.includes("${process.pid}"), ".bat 仅允许插值 process.pid");
  assert.match(batBody, /%CCDPH_(SRC|DST|STAGE|EXE)%/);
  // 字符闸门（.bat 引号/换行；PowerShell 引号/$/反引号/换行）必须存在
  assert.match(src, /\/\["\\r\\n\]\//, "缺少 .bat 引号/换行字符闸门");
  assert.match(src, /\/\["\$`\\r\\n\]\//, "缺少 PowerShell 危险字符闸门");
});
await test("C-03", "P0", "更新包路径穿越门（assertSafeZipEntries 回归样本）", () => {
  const extractDir = path.join(os.tmpdir(), "ccdph-extract");
  assert.doesNotThrow(() => assertSafeZipEntries(extractDir, ["CCDPH.exe", "resources/app/server.mjs"]));
  for (const unsafe of ["../escape.txt", "C:/abs.txt", "folder/x.txt:secret", "folder/CON.txt"])
    assert.throws(() => assertSafeZipEntries(extractDir, [unsafe]), /更新包/);
  assert.throws(
    () => assertSafeZipEntries(extractDir, [`${"a".repeat(256)}.txt`]),
    /255 字节/,
  );
});

// ============================================================
// 区域 4：路径穿越（P0）
// ============================================================
area = "路径穿越";
await test("P-01", "P0", "within() 子路径/自身/兄弟/越界", () => {
  const root = path.resolve(os.tmpdir(), "ccdph-within-root");
  assert.equal(within(root, path.join(root, "a", "b")), true);
  assert.equal(within(root, root), true);
  assert.equal(within(root, path.join(root, "..", "sibling")), false);
  assert.equal(within(root, path.resolve(root, "..")), false);
});
await test("P-02", "P0", "safePath() 合法子路径解析成功", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ccdph-safepath-"));
  await mkdir(path.join(dir, "sub"));
  await writeFile(path.join(dir, "sub", "a.txt"), "ok");
  const target = await safePath(dir, "sub/a.txt");
  assert.equal(target, await realpath(path.join(dir, "sub", "a.txt")));
  await rm(dir, { recursive: true, force: true });
});
await test("P-03", "P0", "safePath() 越界 ../ 拒绝", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ccdph-safepath-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "ccdph-outside-"));
  await writeFile(path.join(outside, "x"), "secret");
  await assert.rejects(
    safePath(dir, path.relative(dir, path.join(outside, "x"))),
    /只能查看当前项目内的文件/,
  );
  await rm(dir, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});
await test("P-04", "P0", "safePath() NTFS ADS/冒号拒绝", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ccdph-safepath-"));
  await writeFile(path.join(dir, "normal.txt"), "data");
  if (process.platform === "win32") {
    await assert.rejects(safePath(dir, "normal.txt:secret"), /非法字符 ':'/);
  } else {
    await writeFile(path.join(dir, "normal.txt:secret"), "posix-name");
    assert.equal(
      await safePath(dir, "normal.txt:secret"),
      await realpath(path.join(dir, "normal.txt:secret")),
    );
  }
  await rm(dir, { recursive: true, force: true });
});
await test("P-05", "P1", "isDirectChildPath 边界（自身/深层/junction 语义）", () => {
  const base = path.join("C:", "safe", "worktrees");
  assert.equal(isDirectChildPath(base, path.join(base, "one")), true);
  assert.equal(isDirectChildPath(base, base), false);
  assert.equal(isDirectChildPath(base, path.join(base, "one", "deep")), false);
  assert.equal(isDirectChildPath(base, path.join("C:", "safe", "elsewhere")), false);
});

// ============================================================
// 区域 5：认证 / 限流（P0）
// ============================================================
area = "认证限流";
await test("A-01", "P0", "令牌桶 burst 打空与拒绝", () => {
  const allow = createTokenBucketLimiter(2, 2);
  assert.equal(allow("k", 1000), true);
  assert.equal(allow("k", 1000), true);
  assert.equal(allow("k", 1000), false);
});
await test("A-02", "P0", "令牌桶按速率线性回填", () => {
  const allow = createTokenBucketLimiter(1, 1);
  assert.equal(allow("k", 0), true);
  assert.equal(allow("k", 0), false);
  assert.equal(allow("k", 1000), true, "1s 后应回填 1 枚令牌");
});
await test("A-03", "P0", "令牌桶 burst 上限不回超", () => {
  const allow = createTokenBucketLimiter(1000, 5);
  for (let i = 0; i < 5; i += 1) assert.equal(allow("k", 0), true);
  assert.equal(allow("k", 0), false);
  assert.equal(allow("k", 60_000), true, "长时间后仍应回填但受 burst 上限");
  for (let i = 0; i < 4; i += 1) assert.equal(allow("k", 60_000), true);
  assert.equal(allow("k", 60_000), false, "burst=5 不得超额放行");
});
await test("A-04", "P0", "令牌桶 0 速率永不回填", () => {
  const allow = createTokenBucketLimiter(0, 2);
  assert.equal(allow("k", 0), true);
  assert.equal(allow("k", 0), true);
  assert.equal(allow("k", 0), false);
  assert.equal(allow("k", 1_000_000), false);
});
await test("A-05", "P1", "令牌桶 0.5/s 小数速率", () => {
  const allow = createTokenBucketLimiter(0.5, 1);
  assert.equal(allow("k", 0), true);
  assert.equal(allow("k", 0), false);
  assert.equal(allow("k", 2000), true, "2s × 0.5/s = 1 枚");
});
await test("A-06", "P1", "令牌桶时钟回拨不产生负值/崩溃", () => {
  const allow = createTokenBucketLimiter(1, 1);
  assert.equal(allow("k", 1000), true);
  assert.equal(allow("k", 0), false);
});
await test("A-07", "P1", "令牌桶 maxBuckets LRU 淘汰", () => {
  const allow = createTokenBucketLimiter(1, 1, { maxBuckets: 2, idleMs: 60_000, cleanupEvery: 1000 });
  assert.equal(allow("a", 0), true);
  assert.equal(allow("b", 0), true);
  assert.equal(allow("c", 0), true); // 淘汰最久未用 a
  assert.equal(allow("a", 0), true, "a 应已被淘汰、按新桶放行");
});
await test("A-08", "P1", "令牌桶 idle 清理", () => {
  const allow = createTokenBucketLimiter(0, 1, { maxBuckets: 3, idleMs: 1000, cleanupEvery: 1 });
  assert.equal(allow("x", 0), true);
  assert.equal(allow("trigger", 2000), true); // 触发 cleanup，删除 idle 的 x
  assert.equal(allow("x", 2000), true, "x 应已被 idle 清理、按新桶放行");
});

// ============================================================
// 防御性：previewBounded 对 toJSON 递归链的兜底（P3，子进程隔离）
// ============================================================
area = "防御性";
await test("D-01", "P3", "previewBounded 无限 toJSON 链不崩溃进程（子进程验证）", async () => {
  const stateSafetyUrl = pathToFileURL(path.join(APP_ROOT, "state-safety.mjs")).href;
  const code = `
    import { previewBounded } from ${JSON.stringify(stateSafetyUrl)};
    let calls = 0;
    const fn = function () { calls += 1; return { toJSON: fn }; };
    const out = previewBounded({ toJSON: fn });
    console.log(JSON.stringify({ out, calls }));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    cwd: APP_ROOT,
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (c) => (output += c));
  child.stderr.on("data", (c) => (output += c));
  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(exitCode, 0, `子进程退出码 ${exitCode}（疑似未兜底）: ${output}`);
  const parsed = JSON.parse(output);
  assert.match(parsed.out, /无法预览|循环引用|嵌套过深/, `兜底结果异常: ${parsed.out}`);
});

// ============================================================
// 汇总
// ============================================================
const total = results.length;
const passed = results.filter((r) => r.status === "PASS").length;
const failed = results.filter((r) => r.status === "FAIL").length;
const bySeverity = {};
for (const r of results) bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;

console.log("\n===== QA 阶段3 高风险极限补测结果 =====");
for (const r of results) {
  const tag = r.status === "PASS" ? "✓" : "✗";
  const extra = r.status === "PASS" ? `${r.ms}ms heapΔ${r.heapKB}KB` : `ERROR: ${r.error}`;
  console.log(`[${r.severity}] ${tag} ${r.id} ${r.name} — ${extra}`);
}
console.log("\n===== 汇总 =====");
console.log(`总计 ${total} | 通过 ${passed} | 失败 ${failed} | 通过率 ${((passed / total) * 100).toFixed(1)}%`);
console.log(`分级分布: ${JSON.stringify(bySeverity)}`);
console.log(`P0 失败数: ${results.filter((r) => r.status === "FAIL" && r.severity === "P0").length}`);
console.log(`P1 失败数: ${results.filter((r) => r.status === "FAIL" && r.severity === "P1").length}`);
console.log(`峰值 RSS: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`);

if (failed > 0) process.exitCode = 1;
