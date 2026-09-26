import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDeepseekAdapter, DEEPSEEK_ENDPOINT, DEEPSEEK_MODEL } from "../server/deepseek-model.mjs";
import { configuredModelAdapter, readModelSettings, saveDeepseekConfig } from "../server/model-config.mjs";
import { runRecommendation } from "../server/recommendation-contract.mjs";

const fakeKey = "sk-abcdefghijklmnop";
const concept = {
  id: "inversion", lifecycle_status: "active", domains: ["reasoning"], intents: [], interaction_type: "lens", epistemic_type: "heuristic",
  readiness: { cn: { recommendable: true }, en: { recommendable: false } },
  locales: { cn: { name: "逆向思维", description: "倒推风险", trigger: ["选择"], avoid_when: [], agent_instruction: "Never send the full instruction", cover_image: "private-image" } },
};

test("first-use configuration requires explicit remote selection and keeps the key in a private ignored file", async () => {
  const directory = mkdtempSync(join(tmpdir(), "concept-model-config-"));
  const path = join(directory, ".env");
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error("Unexpected network call"); };
  try {
    assert.throws(() => configuredModelAdapter({ path, env: {}, fetchImpl }), { code: "model_unavailable", status: 503 });
    assert.throws(() => configuredModelAdapter({ path, env: { CONCEPT_MODEL_PROVIDER: "local" }, fetchImpl }), { code: "local_model_unavailable", status: 503 });
    writeFileSync(path, `CONCEPT_MODEL_PROVIDER=deepseek\nDEEPSEEK_API_KEY=${fakeKey}\n`);
    assert.throws(() => configuredModelAdapter({ path, env: {}, fetchImpl }), { code: "model_consent_required", status: 503 });
    saveDeepseekConfig(fakeKey, { path });
    assert.deepEqual(readModelSettings({ path, env: {} }), { provider: "deepseek", consent: "deepseek", apiKey: fakeKey });
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(readFileSync(path, "utf8").split("DEEPSEEK_API_KEY=").length - 1, 1);
    assert.equal(typeof configuredModelAdapter({ path, env: {}, fetchImpl }).decide, "function");
    assert.equal(calls, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("DeepSeek adapter sends only the permitted payload and checks a complete JSON decision", async () => {
  let calls = 0;
  const adapter = createDeepseekAdapter(fakeKey, { fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, DEEPSEEK_ENDPOINT);
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, `Bearer ${fakeKey}`);
    const body = JSON.parse(options.body);
    assert.equal(body.model, DEEPSEEK_MODEL);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.ok(body.messages[0].content.includes("JSON"));
    const input = JSON.parse(body.messages[1].content);
    assert.equal(input.request.locale, "cn");
    assert.deepEqual(input.candidates.map((candidate) => candidate.id), ["inversion"]);
    assert.equal(options.body.includes("Never send the full instruction"), false);
    assert.equal(options.body.includes("private-image"), false);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ diagnosis: ["检查风险"], recommendations: [{ id: "inversion", reason: "可倒推失败", confidence: 0.8 }] }) } }] }), { status: 200 });
  } });
  const result = await runRecommendation({ task: "如何选择", locale: "cn" }, [concept], adapter);
  assert.equal(calls, 1);
  assert.equal(result.recommendations[0].name, "逆向思维");
});

test("DeepSeek authentication and malformed output remain distinct from normal NONE", async () => {
  const input = { task: "Choose", locale: "cn" };
  const response = (body, status = 200) => async () => new Response(body, { status });
  await assert.rejects(runRecommendation(input, [concept], createDeepseekAdapter(fakeKey, { fetchImpl: response("{}", 401) })), { code: "model_credentials_invalid", status: 503 });
  await assert.rejects(runRecommendation(input, [concept], createDeepseekAdapter(fakeKey, { fetchImpl: response("{}", 500) })), { code: "model_provider_error", status: 502 });
  await assert.rejects(runRecommendation(input, [concept], createDeepseekAdapter(fakeKey, { fetchImpl: response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{}" } }] })) })), { code: "invalid_model_decision", status: 502 });
  const none = await runRecommendation(input, [concept], createDeepseekAdapter(fakeKey, { fetchImpl: response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"diagnosis":[],"recommendations":[]}' } }] })) }));
  assert.deepEqual(none.recommendations, []);
});
