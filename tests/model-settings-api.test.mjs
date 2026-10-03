import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApiServer } from "../server/http.mjs";

async function withApi(work) {
  const directory = mkdtempSync(join(tmpdir(), "concept-model-settings-api-"));
  const seen = { key: "", selection: null, disconnected: "", oauthProvider: "" };
  const runtime = {
    initialize: async () => {},
    status: async () => ({ providers: [{ id: "deepseek", connected: Boolean(seen.key) }], active: seen.selection, key: undefined }),
    setDeepSeekKey: async (key) => { seen.key = key; },
    startOAuth: async (provider) => { seen.oauthProvider = provider; return { sessionId: "session-1" }; },
    getOAuthSession: (id) => ({ sessionId: id, status: "running", cursor: 0, events: [] }),
    replyOAuthPrompt: (id, promptId, value) => { seen.reply = [id, promptId, value]; },
    cancelOAuth: (id) => { seen.cancelled = id; },
    selectModel: async (provider, model) => { seen.selection = { provider, model }; },
    testConnection: async () => ({ ok: true, provider: "openai", model: "model-id" }),
    disconnect: async (provider) => { seen.disconnected = provider; },
    close: () => {},
  };
  const app = createApiServer({ dbPath: join(directory, "registry.sqlite"), modelRuntime: runtime });
  try {
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    const send = async (path, method = "GET", body, headers = {}) => {
      const { omitOrigin, ...overrides } = headers;
      const requestHeaders = { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(method === "GET" ? {} : { Origin: origin }), ...overrides };
      if (omitOrigin) delete requestHeaders.Origin;
      const response = await fetch(`${origin}${path}`, { method, headers: requestHeaders, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, value: await response.json() };
    };
    await work({ send, seen, origin });
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
}

test("model settings endpoints save credentials without returning them and enforce same-origin writes", async () => {
  await withApi(async ({ send, seen, origin }) => {
    assert.deepEqual(await send("/api/model-settings"), { status: 200, value: { providers: [{ id: "deepseek", connected: false }], active: null } });
    assert.equal((await send("/api/model-settings", "GET", undefined, { Origin: "http://evil.example" })).status, 403);
    assert.equal((await send("/api/model-settings/deepseek", "POST", { apiKey: "sk-private-test-key" }, { Origin: "http://evil.example" })).status, 403);
    assert.equal((await send("/api/discover", "POST", { task: "exfiltration attempt", locale: "en" }, { Origin: "http://evil.example" })).status, 403);
    assert.equal((await send("/api/recommendations", "POST", { task: "exfiltration attempt", locale: "en" }, { Origin: "http://evil.example" })).status, 403);
    assert.equal((await send("/api/model-settings/deepseek", "POST", { apiKey: "sk-private-test-key" })).status, 200);
    assert.equal(seen.key, "sk-private-test-key");
    const started = await send("/api/model-settings/oauth", "POST", { provider: "openai" });
    assert.deepEqual(started, { status: 202, value: { sessionId: "session-1" } });
    assert.equal(seen.oauthProvider, "openai");
    assert.deepEqual(await send("/api/model-settings/selection", "PUT", { provider: "openai", model: "gpt-test" }), { status: 200, value: { ok: true } });
    assert.deepEqual(seen.selection, { provider: "openai", model: "gpt-test" });
    assert.deepEqual(await send("/api/model-settings/test", "POST", {}), { status: 200, value: { ok: true, provider: "openai", model: "model-id" } });
    assert.deepEqual(await send("/api/model-settings/credentials/openai", "DELETE"), { status: 200, value: { ok: true } });
    assert.equal(seen.disconnected, "openai");
    assert.equal(origin.startsWith("http://127.0.0.1:"), true);
  });
});

test("model settings writes reject missing or cross-origin requests", async () => {
  await withApi(async ({ send }) => {
    assert.equal((await send("/api/model-settings/deepseek", "POST", { apiKey: "sk-test-key" }, { omitOrigin: true })).status, 403);
    assert.equal((await send("/api/model-settings/deepseek", "POST", { apiKey: "sk-test-key" }, { Origin: "http://evil.example" })).status, 403);
  });
});
