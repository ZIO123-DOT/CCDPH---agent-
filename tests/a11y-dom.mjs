// CCDPH-FIX(R3-P3-9): 可访问性收口回归（真实 DOM）。
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const data = await mkdtemp(path.join(os.tmpdir(), "ccdph-a11y-"));
process.env.WORKBENCH_DATA_DIR = data;
process.env.WORKBENCH_PORT = String(49900 + Math.floor(Math.random() * 300));
process.env.WORKBENCH_DESKTOP = "0";
process.env.CLAUDE_CONFIG_DIR = path.join(data, ".claude");

const engine = await import("../server.mjs");
const server = await engine.start();
const { chromium } = await import("playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();

try {
  await page.goto(engine.getRuntime().url, { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(() => {
    // 仅图标按钮必须有名称
    const iconOnly = [...document.querySelectorAll("button")]
      .filter((b) => !b.textContent.trim() && !b.getAttribute("aria-label") && !b.getAttribute("title"))
      .map((b) => b.id || b.className);
    // 隐藏的原生 select 必须在 tab 序之外
    const hiddenSelects = [...document.querySelectorAll("select.native-select-source")].map((s) => ({
      id: s.id,
      tabIndex: s.getAttribute("tabindex"),
    }));
    // 菜单必须有名称
    const menu = document.querySelector("#session-context-menu");
    return {
      iconOnlyUnnamed: iconOnly,
      hiddenSelects,
      menuLabel: menu?.getAttribute("aria-label") || null,
      stopLabel: document.querySelector("#stop")?.getAttribute("aria-label") || null,
    };
  });

  assert.deepEqual(result.iconOnlyUnnamed, [], "仅图标按钮必须有可访问名称");
  assert.equal(result.stopLabel, "停止生成", "#stop 必须有名称");
  assert.ok(result.menuLabel, "role=menu 必须有可访问名称");
  for (const select of result.hiddenSelects)
    assert.equal(select.tabIndex, "-1", `隐藏的 ${select.id} 必须 tabindex=-1`);

  console.log("a11y ok: icon-only buttons named, hidden selects out of tab order, menu labeled");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(data, { recursive: true, force: true }).catch(() => {});
}
