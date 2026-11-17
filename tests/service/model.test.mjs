import test from "node:test";
import assert from "node:assert/strict";
import { loadModelConfig, chatCompletions } from "../../server/model.mjs";
import { createDraftRunner } from "../../server/draft.mjs";

const config = { url: "https://model.invalid/v1/chat/completions", model: "fixture", apiKey: "private-fixture-key", maxTokenField: "max_tokens" };
const completion = (content, finish_reason = "stop", extras = {}) => Response.json({ choices: [{ finish_reason, message: { content, ...extras } }], usage: { prompt_tokens: 13, completion_tokens: 8 } });

test("model configuration reads secrets only for HTTPS or loopback destinations", () => {
  const profile = { baseUrl: "https://model.invalid/v1/", model: "demo", apiKeyFile: "key" };
  assert.equal(loadModelConfig(profile, () => "fixture-key").url, config.url);
  assert.equal(loadModelConfig({ ...profile, baseUrl: "http://127.0.0.1:9142/v1", maxTokenField: "max_tokens" }, () => "fixture-key").maxTokenField, "max_tokens");
  for (const baseUrl of ["http://remote.invalid/v1", "https://model.invalid/v1?secret=x", "https://key@model.invalid/"])
    assert.equal(loadModelConfig({ ...profile, baseUrl }, () => assert.fail("unsafe profile must not read a secret")), null);
  assert.equal(loadModelConfig(profile, () => { throw new Error("missing"); }), null);
});

test("blank, truncated and invalid-JSON responses regenerate at most once from the original data", async () => {
  for (const first of [() => completion(" "), () => completion("{", "length"), () => completion("{bad")]) {
    const sends = [], diagnostics = [];
    const complete = chatCompletions(config, async (_url, request) => { sends.push(JSON.parse(request.body)); return sends.length === 1 ? first() : completion('{"body":"valid"}'); });
    const result = await complete({ prompt: "Only source data", data: { source: "original" }, maxTokens: 3000, onDiagnostic: value => diagnostics.push(value) });
    assert.deepEqual(result.value, { body: "valid" }); assert.equal(result.attempts, 2);
    assert.equal(result.promptTokens, 26); assert.equal(sends[0].messages[1].content, sends[1].messages[1].content);
    assert.ok(sends[1].max_tokens <= 8192);
    assert.doesNotMatch(JSON.stringify(diagnostics), /private-fixture-key|original|Only source data/);
  }
});

test("invalid draft references regenerate using only original source; a second bad candidate and refusals fail", async () => {
  const sends = [];
  const complete = chatCompletions(config, async (_url, request) => { sends.push(JSON.parse(request.body)); return completion('{"quote":"invented"}'); });
  const request = { prompt: "draft", data: { source: "original" }, maxTokens: 30, validate() { throw Object.assign(new Error("bad quote"), { code: "draft_invalid_output", diagnostic: "draft_references" }); } };
  await assert.rejects(complete(request), { code: "draft_invalid_output" }); assert.equal(sends.length, 2);
  assert.equal(sends[0].messages[1].content, sends[1].messages[1].content);
  assert.doesNotMatch(sends[1].messages[0].content, /invented/);
  let calls = 0;
  await assert.rejects(chatCompletions(config, async () => { calls++; return completion("", "stop", { refusal: "refused" }); })({ prompt: "draft", data: {}, maxTokens: 30 }), { code: "draft_invalid_output" });
  assert.equal(calls, 1);
});

test("DeepSeek structured drafts disable default reasoning without sending provider options elsewhere", async () => {
  for (const hostname of ["api.deepseek.com", "other.example"]) {
    let sent;
    await chatCompletions({ ...config, url: `https://${hostname}/chat/completions`, model: "deepseek-chat" }, async (_url, request) => { sent = JSON.parse(request.body); return completion("{}"); })({ prompt: "draft", data: {}, maxTokens: 30 });
    assert.deepEqual(sent.thinking, hostname === "api.deepseek.com" ? { type: "disabled" } : undefined);
  }
});

test("draft runner bounds timeout, session revocation and concurrency without logging content or secrets", async () => {
  const logs = [], runner = createDraftRunner({ timeoutMs: 15, log: value => logs.push(value) });
  const model = () => new Promise(() => {});
  const pending = runner.run({ session: "one", model }, ({ complete }) => complete({ data: { source: "private source" } }));
  await assert.rejects(runner.run({ model }, async () => ({})), { code: "draft_busy" });
  await assert.rejects(pending, { code: "draft_timeout" });
  const revoked = runner.run({ session: "two", model }, ({ complete }) => complete({ data: {} }));
  runner.revoke("two"); await assert.rejects(revoked, { code: "draft_session_expired" });
  assert.deepEqual(await runner.run({ model: async () => ({ value: { done: true } }) }, ({ complete }) => complete({ data: {} })), { done: true });
  await assert.rejects(runner.run({ model }, async () => { throw new Error("private-fixture-key source"); }), { code: "draft_read_failed" });
  assert.doesNotMatch(JSON.stringify(logs), /private source|private-fixture-key/);
});
