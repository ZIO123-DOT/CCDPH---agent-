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
//   node tests/gate.mjs --allow-blind-spots
//                                       # CCDPH-FIX(R2-P2-11): 显式承认本次门禁存在安全盲区
//                                       # （安全用例自我 skip / audit 不可用）。不加这个开关时
//                                       # 盲区会让门禁 NO-GO，避免"不发光的绿灯"。
//
// 退出码：0 = GO；1 = NO-GO；2 = 门禁自身执行异常（无法判定）
//
// 约束：本脚本只读源码 + 运行测试，绝不修改任何产品源码 / .data / 运行目录。
// ---------------------------------------------------------------------------
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const skipAudit = argv.includes("--skip-audit");
const allowBlindSpots = argv.includes("--allow-blind-spots");
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
  // CCDPH-FIX(R3): 独立复审第二轮修复的回归护栏
  "markdown guard ok",
  "settings load validation ok",
  "symlink guards ok",
  "request gate hardening ok",
  "integrity manifest ok",
  "a11y ok",
];
// 安全用例：必须**真的跑过**才算通过。自我 skip 只记录为「盲区」，绝不再当成满足条件。
// CCDPH-FIX(R2-P2-11): 原来这两条被塞进 OPTIONAL_MODULE_MARKERS 并只要求
// `optionalSeen.length >= 1` —— 只要用例打印一句 "…skipped" 就算通过，于是最常见的
// 运行环境下这两条安全规则都是"不发光的绿灯"。
const SECURITY_CASE_MARKERS = [
  {
    id: "terminal-recovery",
    ok: "terminal recovery ok",
    skip: "terminal recovery skipped",
    // 该用例本身只在 Windows 上有意义（PTY 后代清扫），非 Windows 的 skip 是环境限制，
    // 属于"平台不适用"而不是"这次没验证"。
    skipIsBlindSpot: process.platform === "win32",
  },
  {
    id: "packaged-signature-fallback",
    ok: "packaged signature fallback ok",
    skip: "packaged signature fallback skipped",
    // 需要 CCDPH_PACKAGED_EXE；未设置时必然 skip —— 这正是必须显式承认的盲区。
    skipIsBlindSpot: true,
  },
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
  const securityCases = SECURITY_CASE_MARKERS.map((item) => ({
    id: item.id,
    state: output.includes(item.ok)
      ? "passed"
      : output.includes(item.skip)
        ? "skipped"
        : "missing",
    blindSpot: item.skipIsBlindSpot,
  }));
  const missingSecurity = securityCases.filter((c) => c.state === "missing");
  const markersOk = missing.length === 0 && missingSecurity.length === 0;

  // G1：runner 退出码 + 模块标记齐全
  record(
    "G1",
    "回归套件执行完整（run.mjs 退出码 0 且全部模块标记齐全）",
    exitCode === 0 && markersOk,
    `exitCode=${exitCode}; missingMarkers=[${missing.join(",")}]; missingSecurityCases=[${missingSecurity.map((c) => c.id).join(",")}]`,
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

  return { total, passed, failed, passRate, p0Fail, p1Fail, bySeverity, exitCode, output, securityCases };
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
// CCDPH-FIX(R2-P2-11): 原来 `--skip-audit`、stdout 为空、输出非 JSON 三种失败模式**全部 PASS**。
// 于是"离线/无锁文件/审计器输出异常"这些最常见的环境都会得到一条不发光的绿灯。
// 现在这三种都记为「盲区」：不加 --allow-blind-spots 时门禁 NO-GO，加了也要把盲区印在报告里。
// 另外每次都显式报出 npm audit 的**覆盖盲区**（Electron/Chromium 运行时不在依赖树内）。
async function auditCoverageNote() {
  const electronInTree = await readFile(path.join(ROOT, "package-lock.json"), "utf8")
    .then((text) => /"node_modules\/electron"/.test(text))
    .catch(() => false);
  return electronInTree
    ? ""
    : "；覆盖盲区：Electron/Chromium 运行时不在 npm 依赖树内，CVE 扫描不覆盖";
}
async function gateAudit() {
  const name = `npm audit high+critical = ${THRESHOLDS.maxHighVulns}`;
  const coverage = await auditCoverageNote();
  const blindDetail = (reason) =>
    `盲区：${reason}${coverage}${allowBlindSpots ? "（已用 --allow-blind-spots 显式承认）" : "；加 --allow-blind-spots 可显式承认后继续"}`;
  if (skipAudit) {
    record("G6", name, allowBlindSpots, blindDetail("--skip-audit 显式跳过了漏洞扫描"));
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
      name,
      allowBlindSpots,
      blindDetail(
        `无法取得审计结果，疑似离线/无锁文件: ${raw.slice(0, 200) || "empty"}`,
      ),
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
    record("G6", name, allowBlindSpots, blindDetail("审计输出非 JSON，无法判定"));
    return;
  }
  record(
    "G6",
    name,
    high + critical <= THRESHOLDS.maxHighVulns,
    `high=${high}, critical=${critical}${coverage}`,
  );
}

// ---- G8：安全用例无盲区（自我 skip 不算通过） --------------------------------
// CCDPH-FIX(R2-P2-11): 新增独立规则，把「这次到底有没有真的验证过安全用例」变成一条
// 会失败的门禁，而不是藏在 G1 的标记计数里。
function gateSecurityCases(securityCases) {
  const skipped = securityCases.filter((c) => c.state === "skipped");
  const blind = skipped.filter((c) => c.blindSpot);
  const inapplicable = skipped.filter((c) => !c.blindSpot);
  const ok = blind.length === 0 || allowBlindSpots;
  record(
    "G8",
    "安全用例无盲区（自我 skip 不当作通过）",
    ok,
    `passed=[${securityCases.filter((c) => c.state === "passed").map((c) => c.id).join(",")}]; ` +
      `盲区=[${blind.map((c) => c.id).join(",")}]` +
      `${allowBlindSpots && blind.length ? "（已用 --allow-blind-spots 显式承认）" : ""}; ` +
      `平台不适用=[${inapplicable.map((c) => c.id).join(",")}]`,
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
gateSecurityCases(regression.securityCases);

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
        securityCases: regression.securityCases,
        thresholds: THRESHOLDS,
      },
      null,
      2,
    ),
  );
}

process.exit(allPass ? 0 : 1);
