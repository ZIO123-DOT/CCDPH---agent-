import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "ccdph-credentials-"));
process.env.WORKBENCH_DATA_DIR = dataDir;
process.env.WORKBENCH_PORT = String(48950 + Math.floor(Math.random() * 40));
process.env.WORKBENCH_DESKTOP = "1";

const engine = await import("../server.mjs");
let expectedProtection = "windows-dpapi";
if (process.platform !== "win32") {
  expectedProtection = "test-protector";
  engine.setCredentialProtector({
    name: expectedProtection,
    encrypt: (plaintext) =>
      Buffer.from(`protected:${plaintext}`, "utf8").toString("base64"),
    decrypt: (payload) => {
      const decoded = Buffer.from(payload, "base64").toString("utf8");
      if (!decoded.startsWith("protected:"))
        throw new Error("invalid protected payload");
      return decoded.slice("protected:".length);
    },
  });
}

let server;
try {
  server = await engine.start();
  const runtime = engine.getRuntime();
  const runtimeUrl = new URL(runtime.url);
  const headers = {
    "content-type": "application/json",
    "x-workbench-token": runtimeUrl.hash.slice(1),
  };
  const post = async (route, body) => {
    const response = await fetch(`${runtimeUrl.origin}/api/${route}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  const profile = await post("api-profiles/save", {
    name: "Encrypted provider",
    baseUrl: "https://api.example.com",
    model: "test-model",
  });
  const secret = "sk-test-credential-must-not-be-plaintext";
  await post("api-profiles/key", { id: profile.id, token: secret });

  const text = await readFile(path.join(dataDir, "api-auth.json"), "utf8");
  const stored = JSON.parse(text);
  assert.equal(stored.version, 2);
  assert.equal(stored.protection, expectedProtection);
  assert.equal(typeof stored.payload, "string");
  assert(!text.includes(secret), "credential file must not contain the plaintext key");
  assert(!("tokens" in stored), "protected format must not expose a tokens object");
  console.log("credential storage ok: protected adapter format contains no plaintext key");
} finally {
  await engine.stopRuns().catch(() => {});
  await new Promise((resolve) => server?.close(resolve) ?? resolve());
  await rm(dataDir, { recursive: true, force: true });
}
