import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const data = await mkdtemp(path.join(os.tmpdir(), "ccdph-renderer-test-"));
process.env.WORKBENCH_DATA_DIR = data;
process.env.WORKBENCH_PORT = String(48500 + Math.floor(Math.random() * 300));
process.env.WORKBENCH_DESKTOP = "0";

const engine = await import("../server.mjs");
const server = await engine.start();
const { chromium } = await import("playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
const pageErrors = [];
const diagnostics = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("console", (message) => diagnostics.push(`console:${message.type()}:${message.text()}`));
page.on("requestfailed", (request) =>
  diagnostics.push(`requestfailed:${request.url()}:${request.failure()?.errorText || ""}`),
);
page.on("response", (response) => {
  if (response.status() >= 400)
    diagnostics.push(`response:${response.status()}:${response.url()}`);
});

await page.addInitScript(() => {
  window.__eventSources = [];
  window.__beacons = [];
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      window.__eventSources.push(this);
    }
    close() {
      this.readyState = 2;
    }
    emit(value) {
      this.onmessage?.({ data: JSON.stringify(value) });
    }
  }
  window.EventSource = FakeEventSource;
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: (url) => {
      window.__beacons.push(url);
      return true;
    },
  });
});

const project = { id: "p1", name: "E2E", path: "C:\\e2e" };
const session = {
  id: "s1",
  projectId: "p1",
  title: "Renderer behavior",
  running: true,
  archived: false,
  pinned: false,
  updatedAt: Date.now(),
  environment: "local",
};
const state = {
  projects: [project],
  sessions: [session],
  settings: {
    restoreLastSession: true,
    defaultEnvironment: "local",
    defaultPermissionMode: "default",
    usageAutoRefresh: false,
    apiProfiles: [],
    browser: {},
  },
  claude: { path: "claude.exe", version: "1.0.0", error: "" },
  apiAuthConfigured: false,
};
let authAttempts = 0;
let stateRaceMode = false;
let stateRaceRequests = 0;

await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url());
  let payload = {};
  if (url.pathname === "/api/auth/session") {
    authAttempts += 1;
    if (authAttempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "temporary auth failure" }),
      });
      return;
    }
  } else if (url.pathname === "/api/state") {
    if (stateRaceMode) {
      stateRaceRequests += 1;
      const requestNumber = stateRaceRequests;
      if (requestNumber === 1)
        await new Promise((resolve) => setTimeout(resolve, 180));
      payload = {
        ...state,
        sessions: [
          {
            ...session,
            title: requestNumber === 1 ? "stale-state-title" : "latest-state-title",
          },
        ],
      };
    } else payload = state;
  }
  else if (url.pathname === "/api/session")
    payload = { ...session, events: [], running: true };
  else if (url.pathname === "/api/project-info")
    payload = { root: project.path, branch: "main", remote: "", files: [] };
  else if (url.pathname === "/api/files") payload = [];
  else if (url.pathname === "/api/provider-usage")
    payload = { available: false, reason: "test" };
  else if (url.pathname === "/api/integrations")
    payload = { mcpCount: 0, skillCount: 0, hookCount: 0, pluginCount: 0 };
  else if (url.pathname === "/api/terminal/start")
    payload = { id: "terminal-1", output: "", exited: false };
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
});

try {
  await page.goto(engine.getRuntime().url, { waitUntil: "networkidle" });
  assert(authAttempts >= 2, "auth/session failure should be retried before opening SSE");
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("workbench-token")),
    null,
    "startup token must not be stored in sessionStorage",
  );
  try {
    await page.waitForFunction(() => window.__eventSources.length === 1);
  } catch (error) {
    throw new Error(
      `${error.message}; pageErrors=${JSON.stringify(pageErrors)}; diagnostics=${JSON.stringify(diagnostics.slice(-20))}`,
    );
  }
  const emit = (value) =>
    page.evaluate((payload) => window.__eventSources.at(-1).emit(payload), value);

  await emit({ type: "snapshot", events: [], running: true });
  for (let index = 1; index <= 3; index += 1) {
    await emit({
      id: `approval-${index}`,
      type: "approval",
      requestId: `request-${index}`,
      tool: "Bash",
      input: { command: `echo ${index}` },
    });
    await emit({
      id: `approval-result-${index}`,
      type: "approval_result",
      requestId: `request-${index}`,
      allowed: true,
    });
  }
  try {
    await page.waitForFunction(
      () => document.querySelectorAll("#messages .approval").length === 3,
    );
  } catch (error) {
    const messagesHtml = await page.locator("#messages").innerHTML().catch(() => "");
    throw new Error(
      `${error.message}; approvals=${await page.locator("#messages .approval").count()}; messages=${messagesHtml.slice(0, 2000)}; pageErrors=${JSON.stringify(pageErrors)}; diagnostics=${JSON.stringify(diagnostics.slice(-20))}`,
    );
  }

  await emit({
    id: "tool-1",
    type: "tool",
    tool: "Read",
    toolId: "tool-use-1",
    input: { file_path: "README.md" },
  });
  const result = {
    id: "tool-result-1",
    type: "tool_result",
    toolId: "tool-use-1",
    text: "once",
    error: false,
  };
  await emit(result);
  await emit(result);
  assert.equal(await page.locator("#messages .tool-card pre").count(), 2);

  const longEvents = Array.from({ length: 1205 }, (_, index) => ({
    id: `long-${index}`,
    type: "stopped",
    text: `window-row-${index}`,
  }));
  await emit({ type: "snapshot", events: longEvents, running: true });
  await page.waitForTimeout(250);
  const longMessagesText = await page.locator("#messages").innerText();
  assert(
    longMessagesText.includes("window-row-1204"),
    `long-session tail missing; diagnostics=${JSON.stringify(diagnostics.slice(-10))}`,
  );
  assert.equal(await page.locator("#messages").getByText("window-row-0", { exact: true }).count(), 0);
  assert.match(
    await page.locator("#messages").innerText(),
    /仅渲染最近 1000 条事件/,
  );
  assert(
    (await page.locator("#messages .result-line").count()) <= 1001,
    "rendered event DOM must stay inside the window plus one notice",
  );
  await emit({ id: "long-0", type: "stopped", text: "duplicate-old-event-must-not-render" });
  await page.waitForTimeout(50);
  assert.equal(await page.getByText("duplicate-old-event-must-not-render", { exact: true }).count(), 0);

  await emit({ id: "text-1", type: "text", text: "**bold-final**" });
  await emit({ type: "done" });
  await page.waitForSelector("#messages strong:text('bold-final')");

  stateRaceMode = true;
  stateRaceRequests = 0;
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await page.waitForFunction(() => document.body.innerText.includes("latest-state-title"));
  await page.waitForTimeout(250);
  assert.equal(
    await page.getByText("stale-state-title", { exact: true }).count(),
    0,
    "older refreshState response must not overwrite the latest state",
  );
  stateRaceMode = false;

  await page.click("#open-terminal");
  await page.waitForFunction(() => window.__eventSources.length >= 2);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.dispatchEvent(new Event("beforeunload"));
  });
  assert.equal(await page.evaluate(() => window.__beacons.length), 1);
  const streamsBeforeHiddenRestore = await page.evaluate(
    () => window.__eventSources.length,
  );
  await page.evaluate(() => {
    window.__testDocumentHidden = true;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => window.__testDocumentHidden,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (window.__testDocumentHidden ? "hidden" : "visible"),
    });
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await page.waitForTimeout(50);
  assert.equal(
    await page.evaluate(() => window.__eventSources.length),
    streamsBeforeHiddenRestore,
    "hidden bfcache restore must defer SSE reconnect",
  );
  await page.evaluate(() => {
    window.__testDocumentHidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForFunction(
    (before) => window.__eventSources.length > before,
    streamsBeforeHiddenRestore,
  );
  await page.click("#open-terminal");
  await page.waitForTimeout(50);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
  );
  assert.equal(await page.evaluate(() => window.__beacons.length), 2);
  assert.deepEqual(pageErrors, []);
  console.log("renderer behavior ok: stream updates and idempotent disposal");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(data, { recursive: true, force: true });
}
