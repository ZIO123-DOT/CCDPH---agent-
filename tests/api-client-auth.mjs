import assert from "node:assert/strict";
import { createApiClient } from "../public/api-client.js";

const originalFetch = globalThis.fetch;
try {
  let requests = 0;
  let recoveries = 0;
  globalThis.fetch = async () => {
    requests += 1;
    if (requests === 1)
      return new Response(JSON.stringify({ error: "expired" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const api = createApiClient(() => "", {
    onUnauthorized: async () => {
      recoveries += 1;
      return true;
    },
  });
  assert.deepEqual(await api("state"), { ok: true });
  assert.equal(requests, 2);
  assert.equal(recoveries, 1);

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "expired" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  const unavailable = createApiClient(() => "", {
    onUnauthorized: async () => false,
  });
  await assert.rejects(unavailable("state"), /expired/);
  console.log("api client auth ok: 401 recovery retries once and reports unrecoverable sessions");
} finally {
  globalThis.fetch = originalFetch;
}
