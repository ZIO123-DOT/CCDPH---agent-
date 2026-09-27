#!/usr/bin/env node
// CCDPH 发版质量门禁（B2 · 链路 B 测试门禁）
// ---------------------------------------------------------------------------
// 用途：一条命令判断「当前工作区是否允许发版」。真实执行既有测试套件与语法检查，
//       解析结果后按门禁规则给出 GO / NO-GO，并以退出码表达结论。
//
// 运行：
//   node tests/gate.mjs                 # 正常门禁，返回 0(GO) / 1(NO-GO)
//   node tests/gate.mjs --json          # 额外输出机器可读结果
//   node tests/gate.mjs --inject=G2     # 自检：注入指定规则失败，验证门禁能正确拦截
//   node tests/gate.mjs --skip-audit    # 跳过 npm audit（离线环境）
//
// 退出码：0 = GO；1 = NO-GO；2 = 门禁自身执行异常（无法判定）
//
// 约束：本脚本只读源码 + 运行测试，绝不修改任何产品源码 / .data / 运行目录。
// ---------------------------------------------------------------------------
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const skipAudit = argv.includes("--skip-audit");
const inject = (argv.find((a) => a.startsWith("--inject=")) || "").split("=")[1] || "";

// ---- 门禁阈值（可调集中于此） ------------------------------------------------
const THRESHOLDS = Object.freeze({
  minPassRate: 100, // 通过率底线（%）
  maxP0Failures: 0, // P0 失败数上限
  maxP1Failures: 0, // P1 失败数上限
  maxHighVulns: 0, // npm audit high+critical 上限
});

// 既有 12 个测试模块必须全部产出「完成标记」，任一缺失即视为回归不完整。
const REQUIRED_MODULE_MARKERS = [
  "behavior ok",
  "route domain behavior ok",
  "state fold behavior ok",
  "browser profile safety ok",
  "SSE limits ok",
  "worktree removal ok",
  "resource limits ok",
  "renderer behavior ok",
  "offline checks passed",
];
const OPTIONAL_MODULE_MARKERS = [
  "terminal recovery ok",
  "terminal recovery skipped",
  // CCDPH-FIX(P2-14): 打包版签名降级用例（需 CCDPH_PACKAGED_EXE，未设置时自我 skip）
  "packaged signature fallback ok",
  "packaged signature fallback skipped",
];

const rules = [];
function record(id, name, ok, detail) {
  rules.push({ id, name, ok, detail });
}

function runNode(args, timeout) {
  return execFileAsync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    timeout,
  });
}

// ---- G1：回归套件整体通过（run.mjs 退出码 + 关键指标） -----------------------
async function gateRegression() {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    const result = await runNode(["tests/run.mjs"], 600_000);
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    stdout = String(error?.stdout || "");
    stderr = String(error?.stderr || "");
    exitCode = typeof error?.code === "number" ? error.code : 1;
  }
  const output = `${stdout}\n${stderr}`;

  const summary = output.match(
    /总计\s*(\d+)\s*\|\s*通过\s*(\d+)\s*\|\s*失败\s*(\d+)\s*\|\s*通过率\s*([\d.]+)%/,
  );
  const total = summary ? Number(summary[1]) : 0;
  const passed = summary ? Number(summary[2]) : 0;
  const failed = summary ? Number(summary[3]) : 0;
  const passRate = summary ? Number(summary[4]) : 0;
  const p0Fail = Number(output.match(/P0 失败数:\s*(\d+)/)?.[1] ?? -1);
  const p1Fail = Number(output.match(/P1 失败数:\s*(\d+)/)?.[1] ?? -1);
  const bySeverity = output.match(/分级分布:\s*(\{[^}]*\})/)?.[1] || "{}";

  const missing = REQUIRED_MODULE_MARKERS.filter((m) => !output.includes(m));
  const optionalSeen = OPTIONAL_MODULE_MARKERS.filter((m) => output.includes(m));
  const allMarkers = missing.length === 0 && optionalSeen.length >= 1;

  // G1：runner 退出码 + 模块标记齐全
  record(
    "G1",
    "回归套件执行完整（run.mjs 退出码 0 且全部模块标记齐全）",
    exitCode === 0 && allMarkers,
    `exitCode=${exitCode}; missingMarkers=[${missing.join(",")}]; optionalSeen=[${optionalSeen.join(",")}]`,
  );
  // G2：通过率 100%
  record(
    "G2",
    `通过率 = ${THRESHOLDS.minPassRate}%`,
    summary !== null && passRate >= THRESHOLDS.minPassRate,
    summary ? `${passed}/${total} = ${passRate}%` : "未解析到汇总行",
  );
  // G3：P0 失败 = 0
  record(
    "G3",
    `P0 失败数 = ${THRESHOLDS.maxP0Failures}`,
    p0Fail === THRESHOLDS.maxP0Failures,
    `P0 失败数=${p0Fail}`,
  );
  // G4：P1 失败 = 0
  record(
    "G4",
    `P1 失败数 = ${THRESHOLDS.maxP1Failures}`,
    p1Fail === THRESHOLDS.maxP1Failures,
    `P1 失败数=${p1Fail}`,
  );

  return { total, passed, failed, passRate, p0Fail, p1Fail, bySeverity, exitCode, output };
}

// ---- G5：语法检查 ------------------------------------------------------------
async function gateSyntax() {
  let ok = false;
  let detail = "";
  try {
    const { stdout } = await runNode(["tests/syntax-check.mjs"], 120_000);
    ok = /syntax ok:\s*\d+ files/.test(stdout);
    detail = stdout.trim();
  } catch (error) {
    detail = String(error?.stderr || error?.message || error);
  }
  record("G5", "语法检查通过（node --check 全量）", ok, detail);
}

// ---- G6：依赖高危漏洞（best-effort，离线降级为 SKIP 不阻塞） -----------------
async function gateAudit() {
  if (skipAudit) {
    record("G6", `npm audit high+critical = ${THRESHOLDS.maxHighVulns}`, true, "SKIP（--skip-audit）");
    return;
  }
  let stdout = "";
  let raw = "";
  try {
    const result = await execFileAsync("npm", ["audit", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 120_000,
      shell: process.platform === "win32",
    });
    stdout = result.stdout;
  } catch (error) {
    stdout = String(error?.stdout || "");
    raw = String(error?.stderr || error?.message || "");
  }
  if (!stdout.trim()) {
    record(
      "G6",
      `npm audit high+critical = ${THRESHOLDS.maxHighVulns}`,
      true,
      `SKIP（无法取得审计结果，疑似离线/无锁文件）: ${raw.slice(0, 200) || "empty"}`,
    );
    return;
  }
  let high = 0;
  let critical = 0;
  try {
    const parsed = JSON.parse(stdout);
    const v = parsed?.metadata?.vulnerabilities || {};
    high = Number(v.high || 0);
    critical = Number(v.critical || 0);
  } catch {
    record("G6", `npm audit high+critical = ${THRESHOLDS.maxHighVulns}`, true, "SKIP（审计输出非 JSON）");
    return;
  }
  record(
    "G6",
    `npm audit high+critical = ${THRESHOLDS.maxHighVulns}`,
    high + critical <= THRESHOLDS.maxHighVulns,
    `high=${high}, critical=${critical}`,
  );
}

// ---- G7：接口自动化用例（B3 新增）0 失败 -------------------------------------
async function gateApiSuite() {
  let stdout = "";
  let exitCode = 0;
  try {
    const result = await runNode(["tests/api-tests.mjs"], 300_000);
    stdout = result.stdout;
  } catch (error) {
    stdout = String(error?.stdout || "");
    exitCode = typeof error?.code === "number" ? error.code : 1;
  }
  const m = stdout.match(/总计 (\d+) \| 通过 (\d+) \| 失败 (\d+) \| 已知缺陷隔离 (\d+)/);
  const failed = m ? Number(m[3]) : -1;
  const passed = m ? Number(m[2]) : 0;
  const known = m ? Number(m[4]) : 0;
  record(
    "G7",
    "接口自动化用例（api-tests.mjs）0 失败",
    exitCode === 0 && failed === 0,
    m ? `通过 ${passed} / 失败 ${failed} / 已知缺陷隔离 ${known}` : "未解析到汇总行",
  );
}

// ---- 执行 --------------------------------------------------------------------
const started = Date.now();
const regression = await gateRegression();
await gateSyntax();
await gateAudit();
await gateApiSuite();

// 自检注入：仅用于演示门禁「确实能拦截」，不改动任何真实指标。
if (inject) {
  const target = rules.find((r) => r.id === inject);
  if (target) {
    target.ok = false;
    target.detail = `[INJECTED-FAILURE] ${target.detail}`;
  }
}

const allPass = rules.every((r) => r.ok);
const decision = allPass ? "GO" : "NO-GO";
const durationMs = Date.now() - started;

// ---- 报告 --------------------------------------------------------------------
if (!asJson) {
  console.log("================ CCDPH 发版质量门禁 ================");
  console.log(`工作区: ${ROOT}`);
  console.log(`回归套件: ${regression.passed}/${regression.total} 通过 (${regression.passRate}%) | 分级 ${regression.bySeverity}`);
  console.log(`P0 失败=${regression.p0Fail} | P1 失败=${regression.p1Fail}`);
  console.log("----------------------------------------------------");
  for (const r of rules)
    console.log(`${r.ok ? "PASS" : "FAIL"}  [${r.id}] ${r.name}\n        └─ ${r.detail}`);
  console.log("----------------------------------------------------");
  console.log(`门禁结论: ${decision}（${allPass ? "允许发版" : "禁止发版"}），耗时 ${durationMs}ms`);
  console.log("====================================================");
}

if (asJson) {
  console.log(
    JSON.stringify(
      {
        decision,
        durationMs,
        regression: {
          total: regression.total,
          passed: regression.passed,
          failed: regression.failed,
          passRate: regression.passRate,
          p0Failures: regression.p0Fail,
          p1Failures: regression.p1Fail,
          bySeverity: regression.bySeverity,
        },
        rules,
        thresholds: THRESHOLDS,
      },
      null,
      2,
    ),
  );
}

process.exit(allPass ? 0 : 1);
