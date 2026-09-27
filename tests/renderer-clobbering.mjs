import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "ccdph-clobbering-"));
process.env.WORKBENCH_DATA_DIR = dataDir;
process.env.WORKBENCH_PORT = String(48400 + Math.floor(Math.random() * 80));
process.env.WORKBENCH_DESKTOP = "0";

const engine = await import("../server.mjs");
const server = await engine.start();
const { chromium } = await import("playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });

try {
  const page = await browser.newPage();
  await page.goto(engine.getRuntime().url, { waitUntil: "networkidle" });
  const result = await page.evaluate(async () => {
    const ids = ["stop", "prompt", "composer", "settings-dialog", "toast"];
    for (const id of ids) document.getElementById(id).dataset.ccdphReal = "1";
    const { markdown } = await import("/markdown-renderer.js");
    const raw = ids
      .map((id) => `<a id="${id}" name="${id}">injected-${id}</a>`)
      .join("");
    const html = markdown(raw, false);
    const injected = document.createElement("div");
    injected.className = "markdown clobbering-probe";
    injected.innerHTML = html;
    document.querySelector("#messages").append(injected);
    return {
      html,
      controls: Object.fromEntries(
        ids.map((id) => [
          id,
          document.querySelector(`#${CSS.escape(id)}`)?.dataset.ccdphReal === "1",
        ]),
      ),
      injectedIds: [...injected.querySelectorAll("[id]")].map((node) => node.id),
      injectedNames: [...injected.querySelectorAll("[name]")].map(
        (node) => node.getAttribute("name"),
      ),
    };
  });
  assert(Object.values(result.controls).every(Boolean), JSON.stringify(result));
  assert(
    result.injectedIds.every((id) => id.startsWith("user-content-")),
    JSON.stringify(result),
  );
  assert(
    result.injectedNames.every((name) => name.startsWith("user-content-")),
    JSON.stringify(result),
  );
  console.log("renderer clobbering ok: model HTML cannot shadow application controls");
} finally {
  await browser.close();
  await engine.stopRuns().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
}
