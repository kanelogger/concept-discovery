import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApiServer } from "../server/http.mjs";
import { RecommendationError } from "../server/recommendation-contract.mjs";

const image = readFileSync(new URL("./fixtures/red.webp", import.meta.url)).toString("base64");
const locales = (id, bilingual = false) => ({
  cn: { name: `中文 ${id}`, description: `中文描述 ${id}`, source_text: "中文出处", trigger: ["需要选择"], avoid_when: ["缺少事实"], agent_instruction: "只供应用的中文指引" },
  en: bilingual ? { name: `English ${id}`, description: `English description ${id}`, source_text: "English source", trigger: ["Choosing"], avoid_when: ["Missing facts"], agent_instruction: "Private English instruction" } : {},
});

async function withApi(factory, work) {
  const directory = mkdtempSync(join(tmpdir(), "concept-recommend-api-"));
  const app = createApiServer({ dbPath: join(directory, "registry.sqlite"), modelAdapterFactory: factory });
  try {
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    const post = async (body) => {
      const response = await fetch(`${origin}/api/recommendations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, value: await response.json() };
    };
    await work({ registry: app.registry, post });
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function publish(registry, id, bilingual = false) {
  registry.create({ id, domains: ["reasoning"], intents: ["simplify"], locales: locales(id, bilingual) });
  registry.update(id, { expected_version: 1, changes: {}, media: { cn: { action: "set", data: image }, ...(bilingual ? { en: { action: "set", data: image } } : {}) } });
}

test("Recommendation API uses the live Registry and sends only eligible same-locale compact cards", async () => {
  let decision = { diagnosis: ["中文诊断"], recommendations: [{ id: "one", reason: "现在适用", confidence: 0.8 }] };
  const seen = [];
  await withApi(() => ({ decide: async (payload) => { seen.push(payload); return decision; } }), async ({ registry, post }) => {
    publish(registry, "one", true);
    publish(registry, "two");
    publish(registry, "three");
    publish(registry, "archived");
    registry.archive("archived", { expected_version: 2 });
    registry.create({ id: "draft", locales: { cn: { name: "仅草稿" } } });

    const one = await post({ task: "如何选择", locale: "cn" });
    assert.equal(one.status, 200);
    assert.deepEqual(one.value.recommendations, [{ id: "one", concept_version: 2, name: "中文 one", reason: "现在适用", confidence: 0.8, card: { description: "中文描述 one", tags: [], cover_image: registry.get("one").locales.cn.cover_image, interaction_type: null, epistemic_type: null } }]);
    assert.equal(seen[0].request.limit, 1);
    assert.deepEqual(seen[0].candidates.map((candidate) => candidate.id).sort(), ["one", "three", "two"]);
    assert.deepEqual(seen[0].candidates[0].avoid_when, ["缺少事实"]);
    assert.equal(JSON.stringify(seen[0]).includes("只供应用的中文指引"), false);
    assert.equal(JSON.stringify(seen[0]).includes("English description"), false);

    decision = { diagnosis: ["English diagnosis"], recommendations: [{ id: "one", reason: "Useful now", confidence: 0.7 }] };
    const english = await post({ task: "Choose", locale: "en" });
    assert.equal(english.status, 200);
    assert.equal(english.value.recommendations[0].name, "English one");
    assert.equal(english.value.recommendations[0].card.description, "English description one");
    assert.equal(english.value.recommendations[0].card.cover_image, registry.get("one").locales.en.cover_image);
    assert.deepEqual(seen[1].candidates.map((candidate) => candidate.id), ["one"]);
    assert.equal(JSON.stringify(seen[1]).includes("中文描述"), false);

    decision = { diagnosis: ["缺少比较"], recommendations: ["one", "two", "three"].map((id) => ({ id, reason: `${id} 互补`, confidence: 0.6 })) };
    const three = await post({ task: "多视角比较", locale: "cn", limit: 3 });
    assert.equal(three.status, 200);
    assert.equal(three.value.recommendations.length, 3);

    decision = { diagnosis: ["当前无需方法"], recommendations: [] };
    assert.deepEqual((await post({ task: "简单事实", locale: "cn" })).value.recommendations, []);
    assert.equal((await post({ task: "Choose" })).status, 400);
    assert.equal((await post({ task: "Choose", locale: "auto" })).status, 400);
  });
});

test("Recommendation API includes a Concept without an uploaded cover", async () => {
  const seen = [];
  await withApi(() => ({ decide: async (payload) => {
    seen.push(payload);
    return { diagnosis: ["需要比较"], recommendations: [{ id: "no-cover", reason: "现在可用", confidence: 0.8 }] };
  } }), async ({ registry, post }) => {
    registry.create({ id: "no-cover", locales: locales("no-cover") });
    assert.equal(registry.get("no-cover").readiness.cn.recommendable, true);
    const withCover = registry.update("no-cover", { expected_version: 1, changes: {}, media: { cn: { action: "set", data: image } } });
    assert.equal(withCover.readiness.cn.recommendable, true);
    const removedCover = registry.update("no-cover", { expected_version: 2, changes: {}, media: { cn: { action: "remove" } } });
    assert.equal(removedCover.readiness.cn.recommendable, true);
    assert.equal(removedCover.locales.cn.cover_image, "");
    const result = await post({ task: "如何选择", locale: "cn" });
    assert.equal(result.status, 200);
    assert.deepEqual(seen[0].candidates.map((candidate) => candidate.id), ["no-cover"]);
    assert.equal(result.value.recommendations[0].card.cover_image, "");
  });
});

test("Recommendation API separates unavailable model, provider error, invalid decision, and true NONE", async () => {
  const input = { task: "Decision", locale: "en" };
  await withApi(() => { throw new RecommendationError(503, "model_unavailable", "Configure model"); }, async ({ post }) => {
    assert.deepEqual(await post(input), { status: 503, value: { error: "model_unavailable", message: "Configure model" } });
  });
  await withApi(() => ({ decide: async () => { throw new Error("provider detail"); } }), async ({ post }) => {
    assert.deepEqual(await post(input), { status: 502, value: { error: "model_failed", message: "Model decision failed" } });
  });
  await withApi(() => ({ decide: async () => ({ diagnosis: [], recommendations: [{ id: "fake", reason: "Wrong", confidence: 0.9 }] }) }), async ({ post }) => {
    const invalid = await post(input);
    assert.equal(invalid.status, 502);
    assert.equal(invalid.value.error, "invalid_model_decision");
  });
  await withApi(() => ({ decide: async () => ({ diagnosis: [], recommendations: [] }) }), async ({ post }) => {
    assert.deepEqual(await post(input), { status: 200, value: { locale: "en", diagnosis: [], recommendations: [] } });
  });
});

test("Relation breaks only model-confirmed complementary ties without adding or reviving Concepts", async () => {
  let decision = { diagnosis: ["多个视角"], recommendations: [
    { id: "one", reason: "主视角", confidence: 0.9 },
    { id: "two", reason: "第二视角", confidence: 0.7 },
    { id: "three", reason: "互补视角", confidence: 0.7, complementary_to: ["one"] },
  ] };
  await withApi(() => ({ decide: async () => decision }), async ({ registry, post }) => {
    for (const id of ["one", "two", "three"]) publish(registry, id);
    const input = { task: "需要比较互补方案", locale: "cn", limit: 3 };
    const ids = async () => (await post(input)).value.recommendations.map((item) => item.id);
    assert.deepEqual(await ids(), ["one", "two", "three"]);
    const directed = registry.createRelation({ source_concept_id: "one", target_concept_id: "three", relation_type: "extends" });
    assert.deepEqual(await ids(), ["one", "two", "three"]);
    registry.updateRelation(directed.id, { expected_version: 1, changes: { relation_type: "part_of" } });
    assert.deepEqual(await ids(), ["one", "two", "three"]);
    registry.updateRelation(directed.id, { expected_version: 2, changes: { relation_type: "often_used_with" } });
    assert.deepEqual(await ids(), ["one", "three", "two"]);
    registry.createRelation({ source_concept_id: "two", target_concept_id: "three", relation_type: "often_used_with" });
    decision.recommendations[2].complementary_to = ["two"];
    assert.deepEqual(await ids(), ["one", "two", "three"]);
    decision = { diagnosis: ["多个视角"], recommendations: [
      { id: "one", reason: "主视角", confidence: 0.9 },
      { id: "two", reason: "第二视角", confidence: 0.7 },
      { id: "three", reason: "仍需判断互补", confidence: 0.7 },
    ] };
    assert.deepEqual(await ids(), ["one", "two", "three"]);
    decision.recommendations[2].complementary_to = ["one"];
    decision.recommendations[2].confidence = 0.6;
    assert.deepEqual(await ids(), ["one", "two", "three"]);
    decision.recommendations = decision.recommendations.slice(0, 2);
    assert.deepEqual(await ids(), ["one", "two"]);
    registry.archive("three", { expected_version: 2 });
    decision.recommendations.push({ id: "three", reason: "不得复活", confidence: 0.7, complementary_to: ["one"] });
    const rejected = await post(input);
    assert.equal(rejected.status, 502);
    assert.equal(rejected.value.error, "invalid_model_decision");
  });
});
