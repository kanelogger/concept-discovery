import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { assessOfflineEval, datasetDigest } from "../eval/assess-offline.mjs";

const policy = {
  formal_dataset_requirements: { case_count_min: 4, locales: { cn: 2, en: 2 }, none_cases_min: { cn: 1, en: 1 }, source_mix_for_50: { real_task_anonymized: 2, maintainer_authored_typical_scenarios: 2 } },
  offline: { error_count_max: 0, top1_hit_min: 0.8, recommendation_precision_min: 0.85, none_precision_min: 0.9, over_recommendation_max: 0.1, none_recall_min: 0.8, per_locale: { top1_hit_min: 0.75, recommendation_precision_min: 0.8, over_recommendation_max: 0.12, none_recall_min: 0.8 } },
};
const dataset = { schema_version: 1, dataset_kind: "maintainer", cases: [
  { id: "cn-positive", locale: "cn", input: { task: "分析一个决策", limit: 1 }, expected_ids: ["inversion"], source: { kind: "real_task_anonymized", ref: "case-a" } },
  { id: "cn-none", locale: "cn", input: { task: "翻译一句话", limit: 1 }, expected_ids: [], source: { kind: "maintainer_authored", ref: "case-b" } },
  { id: "en-positive", locale: "en", input: { task: "Analyze a decision", limit: 1 }, expected_ids: ["inversion"], source: { kind: "real_task_anonymized", ref: "case-c" } },
  { id: "en-none", locale: "en", input: { task: "Translate one sentence", limit: 1 }, expected_ids: [], source: { kind: "maintainer_authored", ref: "case-d" } },
] };
const review = { schema_version: 1, reviewer_ref: "maintainer-one", reviewed_at: "2026-09-25T12:00:00Z", dataset_digest: datasetDigest(dataset), reviewed_case_ids: dataset.cases.map((item) => item.id) };
const report = {
  schema_version: 1, dataset_kind: "maintainer", case_count: 4, evaluated_count: 4, error_count: 0,
  models: [{ provider: "deepseek", name: "deepseek-flash" }],
  metrics: {
    top1_hit: { numerator: 2, denominator: 2, value: 1 }, recommendation_precision: { numerator: 2, denominator: 2, value: 1 },
    none_precision: { numerator: 2, denominator: 2, value: 1 }, over_recommendation: { numerator: 0, denominator: 4, value: 0 },
  },
  cases: dataset.cases.map((item) => ({ id: item.id, locale: item.locale, expected_ids: item.expected_ids, source: item.source, status: "ok", output_ids: item.expected_ids, concept_versions: Object.fromEntries(item.expected_ids.map((id) => [id, 1])), model: { provider: "deepseek", name: "deepseek-flash" }, checks: { diagnosis_present: true, why_now_present: true, card_locale_match: true } })),
};

test("formal offline assessment derives NONE recall and checks every locale", () => {
  const result = assessOfflineEval(dataset, report, review, policy);
  assert.equal(result.status, "numeric_passed");
  assert.deepEqual(result.metrics.overall.none_recall, { numerator: 2, denominator: 2, value: 1 });
  assert.equal(result.output_review_required, true);
});

test("synthetic, stale human review, and partial reports cannot pass", () => {
  assert.equal(assessOfflineEval({ ...dataset, dataset_kind: "synthetic" }, report, review, policy).status, "not_evaluable");
  assert.ok(assessOfflineEval(dataset, report, { ...review, dataset_digest: "stale" }, policy).reasons.includes("human_label_review_missing_or_stale"));
  assert.ok(assessOfflineEval(dataset, { ...report, evaluated_count: 3, error_count: 1 }, review, policy).reasons.includes("report_missing_or_incomplete"));
});

test("false recommendation fails the frozen metrics and NONE recall", () => {
  const changed = structuredClone(report);
  changed.cases[3].output_ids = ["inversion"];
  changed.cases[3].concept_versions = { inversion: 1 };
  changed.metrics = {
    top1_hit: { numerator: 2, denominator: 2, value: 1 }, recommendation_precision: { numerator: 2, denominator: 3, value: 2 / 3 },
    none_precision: { numerator: 1, denominator: 1, value: 1 }, over_recommendation: { numerator: 1, denominator: 4, value: 0.25 },
  };
  const result = assessOfflineEval(dataset, changed, review, policy);
  assert.equal(result.status, "numeric_failed");
  assert.ok(result.failures.includes("en.none_recall"));
  assert.ok(result.failures.includes("over_recommendation"));
});

test("changed labels and false report metrics cannot be accepted", () => {
  const changed = structuredClone(dataset);
  changed.cases[0].expected_ids = ["other-concept"];
  assert.ok(assessOfflineEval(changed, report, review, policy).reasons.includes("human_label_review_missing_or_stale"));
  assert.ok(assessOfflineEval(dataset, { ...report, metrics: { ...report.metrics, none_precision: { numerator: 2, denominator: 2, value: 0.5 } } }, review, policy).reasons.includes("report_metric_mismatch:none_precision"));
  const repeatedSource = structuredClone(dataset);
  repeatedSource.cases[2].source.ref = "case-a";
  assert.ok(assessOfflineEval(repeatedSource, report, { ...review, dataset_digest: datasetDigest(repeatedSource) }, policy).reasons.includes("real_task_anonymized_too_few_distinct_sources"));
});

test("assessment CLI writes a private result without copying task text", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "eval-assess-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const paths = Object.fromEntries(["cases", "report", "review", "policy", "output"].map((name) => [name, join(dir, `${name}.json`)]));
  for (const [name, value] of [["cases", dataset], ["report", report], ["review", review], ["policy", policy]]) writeFileSync(paths[name], JSON.stringify(value));
  const run = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/assess-offline-eval.mjs", import.meta.url)), "--cases", paths.cases, "--report", paths.report, "--review", paths.review, "--policy", paths.policy, "--output", paths.output], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const output = readFileSync(paths.output, "utf8");
  assert.equal(JSON.parse(output).status, "numeric_passed");
  assert.equal(output.includes("Analyze a decision"), false);
  assert.equal(statSync(paths.output).mode & 0o777, 0o600);
});
