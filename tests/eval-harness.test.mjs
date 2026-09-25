import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { evaluateDataset, validateDataset } from "../eval/harness.mjs";
import { createApiServer } from "../server/http.mjs";
import { RecommendationError } from "../server/recommendation-contract.mjs";

const sample = JSON.parse(readFileSync(new URL("../eval/cases.synthetic.json", import.meta.url), "utf8"));
const image = readFileSync(new URL("./fixtures/red.webp", import.meta.url)).toString("base64");

async function withServer(modelAdapterFactory, work) {
  const directory = mkdtempSync(join(tmpdir(), "concept-eval-test-"));
  const app = createApiServer({ dbPath: join(directory, "registry.sqlite"), modelAdapterFactory });
  try {
    app.registry.create({ id: "inversion", locales: {
      cn: { name: "逆向思维", description: "倒推风险", source_text: "测试出处", trigger: ["选择"], agent_instruction: "中文私有指引" },
      en: { name: "Inversion", description: "Work backward", source_text: "Test source", trigger: ["Decision"], agent_instruction: "Private English instruction" },
    } });
    app.registry.update("inversion", { expected_version: 1, changes: {}, media: { cn: { action: "set", data: image }, en: { action: "set", data: image } } });
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    await work({ app, directory, baseUrl: `http://127.0.0.1:${app.server.address().port}` });
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("synthetic bilingual cases run through the real HTTP API and produce traceable metrics without raw inputs", async () => {
  const paths = [];
  const adapter = { metadata: { provider: "fake", model: "case-switch" }, decide: async ({ request }) => ({
    diagnosis: [request.locale === "cn" ? "检查风险" : "Inspect risks"],
    recommendations: /2\s*(加|plus)\s*2/i.test(request.task) ? [] : [{ id: "inversion", reason: request.locale === "cn" ? "现在倒推风险" : "Work backward now", confidence: 0.8 }],
  }) };
  await withServer(() => adapter, async ({ app, baseUrl, directory }) => {
    const revisionCount = app.registry.revisions("inversion").length;
    const report = await evaluateDataset(sample, { baseUrl, fetchImpl: async (url, options) => { paths.push([new URL(url).pathname, options?.method || "GET"]); return fetch(url, options); } });
    assert.equal(report.case_count, 4);
    assert.equal(report.evaluated_count, 4);
    assert.equal(report.error_count, 0);
    assert.deepEqual(report.models, [{ provider: "fake", name: "case-switch" }]);
    assert.equal(report.cases[0].concept_versions.inversion, 2);
    assert.deepEqual(report.metrics, {
      top1_hit: { numerator: 2, denominator: 2, value: 1 },
      recommendation_precision: { numerator: 2, denominator: 2, value: 1 },
      none_precision: { numerator: 2, denominator: 2, value: 1 },
      over_recommendation: { numerator: 0, denominator: 4, value: 0 },
    });
    assert.ok(report.cases.every((item) => item.status === "ok" && Object.values(item.checks).every(Boolean)));
    assert.equal(JSON.stringify(report).includes("两个具体方案"), false);
    assert.deepEqual(new Set(paths.map(([path]) => path)), new Set(["/api/recommendations", "/api/concepts/inversion"]));
    assert.equal(app.registry.revisions("inversion").length, revisionCount);
    const reportPath = join(directory, "report.json");
    const cli = await new Promise((resolve) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/evaluate.mjs", import.meta.url)), "--cases", fileURLToPath(new URL("../eval/cases.synthetic.json", import.meta.url)), "--baseUrl", baseUrl, "--output", reportPath]);
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.on("data", (chunk) => { output += chunk; });
      child.on("close", (code) => resolve({ code, output }));
    });
    assert.equal(cli.code, 0, cli.output);
    assert.equal(JSON.parse(readFileSync(reportPath, "utf8")).metrics.top1_hit.value, 1);
    assert.equal(statSync(reportPath).mode & 0o777, 0o600);
    assert.equal(readFileSync(reportPath, "utf8").includes("两个具体方案"), false);
  });
});

test("Eval reports the recommendation-time version and detects a later Registry edit", async () => {
  const adapter = { decide: async () => ({ diagnosis: ["检查风险"], recommendations: [{ id: "inversion", reason: "倒推失败", confidence: 0.8 }] }) };
  await withServer(() => adapter, async ({ baseUrl }) => {
    const report = await evaluateDataset({ ...sample, cases: [sample.cases[0]] }, { baseUrl, fetchImpl: async (url, options) => {
      const response = await fetch(url, options);
      if (!new URL(url).pathname.startsWith("/api/concepts/")) return response;
      const concept = await response.json();
      return new Response(JSON.stringify({ ...concept, version: concept.version + 1 }), { status: 200 });
    } });
    assert.equal(report.cases[0].concept_versions.inversion, 2);
    assert.equal(report.cases[0].checks.card_locale_match, false);
  });
});

test("Eval refreshes the same Concept for each case after a Registry edit", async () => {
  const adapter = { decide: async () => ({ diagnosis: ["检查风险"], recommendations: [{ id: "inversion", reason: "倒推失败", confidence: 0.8 }] }) };
  await withServer(() => adapter, async ({ app, baseUrl }) => {
    let conceptGets = 0;
    const dataset = { ...sample, cases: [sample.cases[0], { ...sample.cases[0], id: "cn-second" }] };
    const report = await evaluateDataset(dataset, { baseUrl, fetchImpl: async (url, options) => {
      const response = await fetch(url, options);
      if (new URL(url).pathname !== "/api/concepts/inversion") return response;
      conceptGets += 1;
      if (conceptGets !== 1) return response;
      const firstVersion = await response.json();
      app.registry.update("inversion", { expected_version: 2, changes: { "locales.cn.description": "修订后描述" } });
      return new Response(JSON.stringify(firstVersion), { status: 200 });
    } });
    assert.equal(conceptGets, 2);
    assert.deepEqual(report.cases.map((item) => item.concept_versions.inversion), [2, 3]);
    assert.ok(report.cases.every((item) => item.checks.card_locale_match));
  });
});

test("configuration errors are reported separately and do not inflate evaluation denominators", async () => {
  await withServer(() => { throw new RecommendationError(503, "model_unavailable", "Configure model"); }, async ({ baseUrl }) => {
    const report = await evaluateDataset({ ...sample, cases: [sample.cases[0]] }, { baseUrl });
    assert.equal(report.error_count, 1);
    assert.deepEqual(report.cases[0], { id: "cn-failure-risk", locale: "cn", expected_ids: ["inversion"], status: "error", error: "model_unavailable", http_status: 503 });
    assert.equal(report.metrics.top1_hit.value, null);
    assert.deepEqual(report.models, []);
  });
});

test("missed recommendation and forced trivia recommendation lower the appropriate metrics", async () => {
  const adapter = { metadata: { provider: "fake", model: "wrong" }, decide: async ({ request }) => ({
    diagnosis: ["错误判断"], recommendations: request.task.includes("2 加 2") ? [{ id: "inversion", reason: "误荐", confidence: 0.5 }] : [],
  }) };
  await withServer(() => adapter, async ({ baseUrl }) => {
    const report = await evaluateDataset({ ...sample, cases: [sample.cases[0], sample.cases[2]] }, { baseUrl });
    assert.deepEqual(report.metrics, {
      top1_hit: { numerator: 0, denominator: 1, value: 0 },
      recommendation_precision: { numerator: 0, denominator: 1, value: 0 },
      none_precision: { numerator: 0, denominator: 1, value: 0 },
      over_recommendation: { numerator: 1, denominator: 2, value: 0.5 },
    });
  });
});

test("a three-Concept case uses the requested limit and counts all complementary hits", async () => {
  const ids = ["inversion", "opportunity-cost", "second-order"];
  const adapter = { metadata: { provider: "fake", model: "three" }, decide: async ({ request }) => {
    assert.equal(request.limit, 3);
    return { diagnosis: ["需要多个互补视角"], recommendations: ids.map((id) => ({ id, reason: `${id} 的作用`, confidence: 0.7 })) };
  } };
  await withServer(() => adapter, async ({ app, baseUrl }) => {
    for (const id of ids.slice(1)) {
      app.registry.create({ id, locales: { cn: { name: id, description: `${id} 的描述`, source_text: "测试出处", trigger: ["选择"], agent_instruction: "测试指引" } } });
      app.registry.update(id, { expected_version: 1, changes: {}, media: { cn: { action: "set", data: image } } });
    }
    const report = await evaluateDataset({ schema_version: 1, dataset_kind: "synthetic", cases: [{ id: "cn-three", locale: "cn", input: { task: "比较三个互补视角", limit: 3 }, expected_ids: ids }] }, { baseUrl });
    assert.deepEqual(report.cases[0].output_ids, ids);
    assert.deepEqual(report.metrics.recommendation_precision, { numerator: 3, denominator: 3, value: 1 });
    assert.equal(report.cases[0].checks.card_locale_match, true);
  });
});

test("case validation rejects ambiguous locales and nonlocal API targets", async () => {
  assert.equal(validateDataset(sample).length, 4);
  assert.throws(() => validateDataset({ ...sample, cases: [{ ...sample.cases[0], locale: undefined }] }));
  assert.throws(() => validateDataset({ ...sample, cases: [sample.cases[0], sample.cases[0]] }));
  assert.throws(() => validateDataset({ ...sample, cases: [{ ...sample.cases[0], input: { task: "x", locale: "en" } }] }));
  await assert.rejects(evaluateDataset(sample, { baseUrl: "https://example.com" }), /local HTTP origin/);
  const invalid = await evaluateDataset({ ...sample, cases: [sample.cases[0]] }, { fetchImpl: async () => new Response(JSON.stringify({ locale: "cn", diagnosis: [], recommendations: [null] }), { status: 200 }) });
  assert.equal(invalid.cases[0].error, "invalid_api_response");
});

test("maintainer cases require traceable opaque source metadata in the report", async () => {
  const draft = { ...sample, dataset_kind: "maintainer", cases: [sample.cases[0]] };
  assert.throws(() => validateDataset(draft), /source kind and ref/);
  const source = { kind: "maintainer_authored", ref: "review-set-01" };
  const dataset = { ...draft, cases: [{ ...draft.cases[0], source }] };
  assert.deepEqual(validateDataset(dataset)[0].source, source);
  assert.throws(() => validateDataset({ ...dataset, cases: [{ ...dataset.cases[0], source: { ...source, ref: "private task text" } }] }), /source kind and ref/);
  const report = await evaluateDataset(dataset, { fetchImpl: async () => new Response(JSON.stringify({ locale: "cn", diagnosis: ["无需方法"], recommendations: [] }), { status: 200 }) });
  assert.deepEqual(report.cases[0].source, source);
  assert.equal(report.dataset_kind, "maintainer");
});
