import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PiModelRuntime } from "../server/pi-model-runtime.mjs";

const withRuntime = async (work, env = "") => {
  const directory = mkdtempSync(join(tmpdir(), "concept-pi-model-"));
  const legacyEnvPath = join(directory, ".env");
  if (env) writeFileSync(legacyEnvPath, env, { mode: 0o600 });
  const runtime = new PiModelRuntime({ dataPath: join(directory, "private", "auth.sqlite"), legacyEnvPath });
  try { await runtime.initialize(); await work({ directory, legacyEnvPath, runtime }); }
  finally { runtime.close(); rmSync(directory, { recursive: true, force: true }); }
};

test("legacy DeepSeek configuration migrates once to private pi credentials and removes only old model fields", async () => {
  const key = "sk-this-test-key-must-not-be-returned";
  await withRuntime(async ({ directory, legacyEnvPath, runtime }) => {
    const status = await runtime.status();
    assert.deepEqual(status.active, { provider: "deepseek", model: "deepseek-flash" });
    assert.equal(status.providers.find((provider) => provider.id === "deepseek").connected, true);
    assert.equal(existsSync(legacyEnvPath), true);
    assert.equal(readFileSync(legacyEnvPath, "utf8"), "OTHER_SETTING=keep-me\n");
    const backup = readdirSync(join(directory, "private")).find((name) => name.endsWith(".bak"));
    assert.ok(backup);
    assert.equal(statSync(join(directory, "private", backup)).mode & 0o777, 0o600);
    assert.equal(JSON.stringify(status).includes(key), false);
    assert.equal(await runtime.credentials.read("deepseek").then((credential) => credential.key), key);
    runtime.close();
    const restarted = new PiModelRuntime({ dataPath: join(directory, "private", "auth.sqlite"), legacyEnvPath });
    try {
      await restarted.initialize();
      assert.equal(readdirSync(join(directory, "private")).filter((name) => name.endsWith(".bak")).length, 1);
      assert.deepEqual((await restarted.status()).active, { provider: "deepseek", model: "deepseek-flash" });
    } finally { restarted.close(); }
  }, `OTHER_SETTING=keep-me\nCONCEPT_MODEL_PROVIDER=deepseek\nCONCEPT_MODEL_REMOTE_CONSENT=deepseek\nDEEPSEEK_API_KEY=${key}\n`);
});

test("model settings expose provider catalogs without credential values and explicit selection is checked", async () => {
  await withRuntime(async ({ runtime }) => {
    const key = "sk-test-model-key-123456";
    await runtime.setDeepSeekKey(key);
    const models = runtime.models.getModels("deepseek");
    assert.ok(models.length > 0);
    await assert.rejects(runtime.selectModel("deepseek", "not-in-catalog"), { code: "invalid_model_selection" });
    await runtime.selectModel("deepseek", models[0].id);
    const settings = await runtime.status();
    assert.deepEqual(settings.active, { provider: "deepseek", model: models[0].id });
    assert.equal(JSON.stringify(settings).includes(key), false);
    assert.equal((await runtime.adapter()).metadata.model, models[0].id);
    await runtime.disconnect("deepseek");
    assert.equal((await runtime.status()).active, null);
  });
});

test("pi adapter returns structured decisions and keeps provider failures private", async () => {
  await withRuntime(async ({ runtime }) => {
    await runtime.setDeepSeekKey("sk-test-model-key-123456");
    const modelId = runtime.models.getModels("deepseek")[0].id;
    await runtime.selectModel("deepseek", modelId);
    const originalComplete = runtime.models.completeSimple.bind(runtime.models);
    let received;
    runtime.models.completeSimple = async (model, context, options) => {
      received = { model, context, options };
      return { content: [{ type: "text", text: '{"diagnosis":["check"],"recommendations":[]}' }] };
    };
    const adapter = await runtime.adapter();
    assert.deepEqual(await adapter.decide({ request: { task: "synthetic", locale: "en", limit: 1 }, candidates: [] }, { signal: new AbortController().signal }), { diagnosis: ["check"], recommendations: [] });
    assert.equal(received.model.id, modelId);
    assert.ok(received.context.systemPrompt.includes("JSON object"));
    assert.equal(JSON.parse(received.context.messages[0].content).request.task, "synthetic");
    assert.ok(received.options.signal instanceof AbortSignal);
    runtime.models.completeSimple = async () => { throw new Error("private provider response"); };
    await assert.rejects(adapter.decide({ request: {}, candidates: [] }, { signal: new AbortController().signal }), { code: "model_failed", message: "Model decision failed" });
    runtime.models.completeSimple = originalComplete;
  });
});

test("OAuth browser bridge relays provider events and prompts without persisting prompt values", async () => {
  await withRuntime(async ({ runtime }) => {
    const original = runtime.models;
    runtime.models = {
      getProvider: (id) => original.getProvider(id),
      login: async (providerId, type, interaction) => {
        assert.equal(providerId, "openai");
        assert.equal(type, "oauth");
        interaction.notify({ type: "auth_url", url: "https://example.test/authorize" });
        const code = await interaction.prompt({ type: "secret", message: "Enter one-time code" });
        assert.equal(code, "private-code");
      },
    };
    const { sessionId } = await runtime.startOAuth("openai");
    let state;
    for (let attempt = 0; attempt < 30; attempt++) {
      state = runtime.getOAuthSession(sessionId);
      if (state.events.some((event) => event.type === "prompt")) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const prompt = state.events.find((event) => event.type === "prompt").prompt;
    runtime.replyOAuthPrompt(sessionId, prompt.id, "private-code");
    for (let attempt = 0; attempt < 30 && runtime.getOAuthSession(sessionId).status === "running"; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
    state = runtime.getOAuthSession(sessionId);
    assert.equal(state.status, "completed");
    assert.equal(JSON.stringify(state).includes("private-code"), false);
    assert.equal(state.events.some((event) => event.type === "auth_url"), true);
  });
});
