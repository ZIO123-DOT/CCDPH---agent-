// CCDPH-FIX(R3-P2-1 / R3-P2-2 / R3-P3-6 / R3-P3-7): markdown 渲染守卫回归。
// 在真实 Edge 里加载 /markdown-renderer.js（与生产同源），断言：
//   1) 病态定界符（散落 ` ~ 与成对链接）必须降级为纯文本，且守卫本身够快；
//   2) 合法高密度 markdown 不再被误降级（保真）；
//   3) 降级产物必须带可见提示，且截断时必须明确说明；
//   4) DOMParser 失败时 class 剥离必须"失败关闭"（不放行模型可控 class）。
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const data = await mkdtemp(path.join(os.tmpdir(), "ccdph-md-guard-"));
process.env.WORKBENCH_DATA_DIR = data;
process.env.WORKBENCH_PORT = String(48700 + Math.floor(Math.random() * 300));
process.env.WORKBENCH_DESKTOP = "0";
process.env.CLAUDE_CONFIG_DIR = path.join(data, ".claude");

const engine = await import("../server.mjs");
const server = await engine.start();
const { chromium } = await import("playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();

try {
  await page.goto(engine.getRuntime().url, { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const { markdown } = await import("/markdown-renderer.js");
    const report = {};

    // 1) 病态输入必须降级 + 守卫快
    const pathological = [
      ["backtick", "`a".repeat(60000)],
      ["tilde", "~a".repeat(60000)],
      ["link", "[a](x)".repeat(20000)],
    ];
    for (const [name, text] of pathological) {
      const t0 = performance.now();
      const html = markdown(text, true);
      report[name] = {
        ms: Number((performance.now() - t0).toFixed(1)),
        fellBack: html.includes('class="markdown-fallback"'),
        hasNote: html.includes("markdown-fallback-note"),
      };
    }

    // 2) 合法高密度文本不应被误降级（旧实现会在 ~1500 个 *_ 时误伤）
    const legit = "**bold** text and _emph_ with a [link](https://example.com)\n".repeat(300);
    report.legitMarkdown = {
      fellBack: markdown(legit, true).includes('class="markdown-fallback"'),
      delimiters: (legit.match(/[*_]/g) || []).length,
    };
    // 纯括号（无链接闭合）应当是线性、不降级
    report.bracketsOnly = {
      fellBack: markdown("[".repeat(120000), true).includes('class="markdown-fallback"'),
    };

    // 3) 截断提示
    const trunc = markdown("`a".repeat(60000), true); // 120k，触发降级且 > 100k
    report.truncation = {
      hasNote: trunc.includes("markdown-fallback-note"),
      mentionsCount: /100000/.test(trunc),
      mentionsTotal: /120000/.test(trunc),
      escapedContent: !trunc.includes("<script"),
    };

    // 4) class 失败关闭：把全局 DOMParser 换成抛错的桩，重跑带 class 的载荷
    const spoof = markdown('<div class="composer">x</div>', false);
    report.classStripNormal = {
      stripped: !spoof.includes('class="composer"'),
    };
    const RealDOMParser = window.DOMParser;
    window.DOMParser = class { parseFromString() { throw new Error("boom"); } };
    let failedClosed = null;
    try {
      const html = markdown('<div class="composer">y</div>', false);
      failedClosed = !html.includes('class="composer"') && html.includes("y");
    } finally {
      window.DOMParser = RealDOMParser;
    }
    report.classStripFailClosed = { noClassSurvives: failedClosed === true };

    return report;
  });

  assert.ok(result.backtick.fellBack, "散落反引号必须降级");
  assert.ok(result.backtick.hasNote, "降级必须带提示");
  assert.ok(result.backtick.ms < 400, `守卫应远快于解析：${result.backtick.ms}ms`);
  assert.ok(result.tilde.fellBack, "散落 ~ 必须降级");
  assert.ok(result.link.fellBack, "成对链接必须降级");
  assert.equal(result.legitMarkdown.fellBack, false, "合法高密度 markdown 不得误降级");
  assert.ok(result.legitMarkdown.delimiters > 1500, "预置样本应超过旧阈值（验证用例有效性）");
  assert.equal(result.bracketsOnly.fellBack, false, "纯括号是线性的，不应降级");
  assert.ok(result.truncation.hasNote, "截断降级必须带提示");
  assert.ok(result.truncation.mentionsCount, "截断提示必须说明显示上限");
  assert.ok(result.truncation.mentionsTotal, "截断提示必须说明总长度");
  assert.equal(result.truncation.escapedContent, true, "降级文本必须转义");
  assert.equal(result.classStripNormal.stripped, true, "正常路径应剥离 class");
  assert.equal(result.classStripFailClosed.noClassSurvives, true, "class 剥离失败必须失败关闭");

  console.log("markdown guard ok: pathological inputs degrade fast, legit markdown preserved, fallback visible, class strip fail-closed");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(data, { recursive: true, force: true }).catch(() => {});
}
