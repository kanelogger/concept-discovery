import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApiServer } from "../server/http.mjs";
import { RecommendationError } from "../server/recommendation-contract.mjs";
import { composeForSkill, recommendForSkill } from "../server/skill-flow.mjs";

const image = readFileSync(new URL("./fixtures/red.webp", import.meta.url)).toString("base64");

function publish(registry) {
  registry.create({ id: "inversion", locales: {
    cn: { name: "逆向思维", description: "倒推失败", source_text: "出处", trigger: ["风险"], avoid_when: ["只需事实"], transform: ["列出失败路径"], agent_instruction: "从失败倒推" },
    en: { name: "Inversion", description: "Work backward", source_text: "Source", trigger: ["Risk"], avoid_when: ["Simple fact"], transform: ["List failure paths"], agent_instruction: "Work backward from failure" },
  } });
  registry.update("inversion", { expected_version: 1, changes: {}, media: { cn: { action: "set", data: image }, en: { action: "set", data: image } } });
}

async function withApi(factory, work) {
  const directory = mkdtempSync(join(tmpdir(), "concept-skill-flow-"));
  const dbPath = join(directory, "registry.sqlite");
  const app = createApiServer({ dbPath, modelAdapterFactory: factory });
  try {
    publish(app.registry);
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    await work({ registry: app.registry, origin: `http://127.0.0.1:${app.server.address().port}`, dbPath });
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function cli(mode, input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/skill-discovery.mjs", mode], { cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, ...env } });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

test("explicit Skill call recommends through formal API and composes only an elected same-locale Concept", async () => {
  let calls = 0;
  await withApi(() => ({ decide: async ({ request }) => {
    calls++;
    return request.task.includes("2 + 2") || request.task.includes("just a fact")
      ? { diagnosis: ["无需方法"], recommendations: [] }
      : { diagnosis: [request.locale === "cn" ? "需要倒推" : "Work backward"], recommendations: [{ id: "inversion", reason: request.locale === "cn" ? "可检验失败" : "Checks failure", confidence: 0.8 }] };
  } }), async ({ registry, origin, dbPath }) => {
    const request = { task: "  比较 A 和 B  ", context: "原始上下文\n第二行", response: "当前回复", locale: "cn" };
    await assert.rejects(recommendForSkill({ request }, { origin }), { code: "explicit_invocation_required" });
    assert.equal(calls, 0);
    const recommended = await recommendForSkill({ invocation: "command", request }, { origin });
    assert.equal(recommended.recommendations[0].id, "inversion");
    assert.equal(calls, 1);
    assert.throws(() => composeForSkill({ request, recommended_ids: ["inversion"] }, registry), { code: "selection_required" });
    assert.throws(() => composeForSkill({ request, recommended_ids: ["inversion"], selected_id: "other" }, registry), { code: "selection_required" });
    const composed = composeForSkill({ request, recommended_ids: ["inversion"], selected_id: "inversion" }, registry);
    assert.equal(composed.locale, "cn");
    assert.ok(composed.prompt.includes(JSON.stringify({ task: request.task, context: request.context, response: request.response })));
    assert.equal(composed.prompt.includes("Work backward from failure"), false);

    const english = { task: "Compare options", locale: "en" };
    const cliRecommended = await cli("recommend", { invocation: "direct_request", request: english }, { CONCEPT_API_URL: origin, CONCEPT_DB_PATH: dbPath });
    assert.equal(cliRecommended.code, 0, cliRecommended.stderr);
    assert.equal(JSON.parse(cliRecommended.stdout).recommendations[0].name, "Inversion");
    const cliComposed = await cli("compose", { request: english, recommended_ids: ["inversion"], selected_id: "inversion" }, { CONCEPT_API_URL: origin, CONCEPT_DB_PATH: dbPath });
    assert.equal(cliComposed.code, 0, cliComposed.stderr);
    assert.match(JSON.parse(cliComposed.stdout).prompt, /Work backward from failure/);
    assert.equal(JSON.parse(cliComposed.stdout).prompt.includes("从失败倒推"), false);

    const none = await recommendForSkill({ invocation: "command", request: { task: "2 + 2", locale: "cn" } }, { origin });
    assert.deepEqual(none.recommendations, []);
    const avoid = await recommendForSkill({ invocation: "direct_request", request: { task: "just a fact", locale: "en" } }, { origin });
    assert.deepEqual(avoid.recommendations, []);
    registry.archive("inversion", { expected_version: 2 });
    assert.throws(() => composeForSkill({ request, recommended_ids: ["inversion"], selected_id: "inversion" }, registry), { code: "concept_not_recommendable" });
  });
});

test("Skill preserves model-unavailable and rejects nonlocal API origins before sending context", async () => {
  await withApi(() => { throw new RecommendationError(503, "model_consent_required", "Run npm run model:configure"); }, async ({ origin }) => {
    const input = { invocation: "command", request: { task: "Need a method", locale: "en" } };
    await assert.rejects(recommendForSkill(input, { origin }), { code: "model_consent_required" });
    let sent = false;
    await assert.rejects(recommendForSkill(input, { origin: "https://example.com", fetchImpl: async () => { sent = true; } }), { code: "invalid_api_origin" });
    assert.equal(sent, false);
  });
});
