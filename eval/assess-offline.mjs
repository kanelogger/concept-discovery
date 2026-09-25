import { createHash } from "node:crypto";
import { validateDataset } from "./harness.mjs";

const ratio = (n, d) => ({ numerator: n, denominator: d, value: d ? n / d : null });
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function datasetDigest(dataset) { return digest(dataset); }

function metrics(cases) {
  const positive = cases.filter((item) => item.expected_ids.length > 0);
  const predictedNone = cases.filter((item) => item.output_ids.length === 0);
  const expectedNone = cases.filter((item) => item.expected_ids.length === 0);
  const outputs = cases.flatMap((item) => item.output_ids.map((id) => ({ id, expected: item.expected_ids })));
  return {
    top1_hit: ratio(positive.filter((item) => item.expected_ids.includes(item.output_ids[0])).length, positive.length),
    recommendation_precision: ratio(outputs.filter((item) => item.expected.includes(item.id)).length, outputs.length),
    none_precision: ratio(predictedNone.filter((item) => item.expected_ids.length === 0).length, predictedNone.length),
    over_recommendation: ratio(cases.filter((item) => item.output_ids.some((id) => !item.expected_ids.includes(id))).length, cases.length),
    none_recall: ratio(expectedNone.filter((item) => item.output_ids.length === 0).length, expectedNone.length),
  };
}

export function assessOfflineEval(dataset, report, review, policy) {
  const cases = validateDataset(dataset);
  const reasons = [];
  const requirement = policy.formal_dataset_requirements;
  const limits = policy.offline;
  if (!requirement || !limits || !limits.per_locale || !requirement.locales || !requirement.none_cases_min || !requirement.source_mix_for_50) throw new Error("Offline acceptance policy is incomplete");
  for (const value of [requirement.case_count_min, ...Object.values(requirement.locales), ...Object.values(requirement.none_cases_min), ...Object.values(requirement.source_mix_for_50), limits.error_count_max]) if (!Number.isInteger(value) || value < 0) throw new Error("Offline acceptance policy has an invalid count");
  for (const value of [limits.top1_hit_min, limits.recommendation_precision_min, limits.none_precision_min, limits.over_recommendation_max, limits.none_recall_min, limits.per_locale.top1_hit_min, limits.per_locale.recommendation_precision_min, limits.per_locale.over_recommendation_max, limits.per_locale.none_recall_min]) if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error("Offline acceptance policy has an invalid threshold");
  const add = (condition, reason) => { if (!condition) reasons.push(reason); };
  add(dataset.dataset_kind === "maintainer", "dataset_must_be_maintainer");
  add(cases.length >= requirement.case_count_min, "too_few_cases");
  for (const locale of ["cn", "en"]) {
    const local = cases.filter((item) => item.locale === locale);
    add(local.length >= requirement.locales[locale], `${locale}_too_few_cases`);
    add(local.filter((item) => item.expected_ids.length === 0).length >= requirement.none_cases_min[locale], `${locale}_too_few_none_cases`);
  }
  for (const [kind, minimum] of Object.entries(requirement.source_mix_for_50)) {
    const sourceKind = kind === "maintainer_authored_typical_scenarios" ? "maintainer_authored" : kind;
    add(new Set(cases.filter((item) => item.source?.kind === sourceKind).map((item) => item.source.ref)).size >= minimum, `${sourceKind}_too_few_distinct_sources`);
  }
  const ids = cases.map((item) => item.id);
  add(Boolean(review && review.schema_version === 1 && typeof review.reviewer_ref === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(review.reviewer_ref) && !Number.isNaN(Date.parse(review.reviewed_at)) && review.dataset_digest === datasetDigest(dataset) && Array.isArray(review.reviewed_case_ids) && review.reviewed_case_ids.length === ids.length && new Set(review.reviewed_case_ids).size === ids.length && ids.every((id) => review.reviewed_case_ids.includes(id))), "human_label_review_missing_or_stale");
  add(Boolean(report && report.schema_version === 1 && report.dataset_kind === dataset.dataset_kind && report.case_count === cases.length && report.evaluated_count === cases.length && report.error_count <= limits.error_count_max && report.error_count === 0 && Array.isArray(report.cases) && report.cases.length === cases.length), "report_missing_or_incomplete");
  if (reasons.length) return { status: "not_evaluable", reasons, case_count: cases.length, dataset_digest: datasetDigest(dataset) };

  const evaluated = report.cases;
  const versions = new Map();
  for (let i = 0; i < cases.length; i++) {
    const expected = cases[i];
    const observed = evaluated[i];
    add(observed?.status === "ok" && observed.id === expected.id && observed.locale === expected.locale && equal(observed.expected_ids, expected.expected_ids) && equal(observed.source, expected.source) && Array.isArray(observed.output_ids) && observed.output_ids.length <= expected.input.limit && observed.output_ids.every((id) => typeof id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) && new Set(observed.output_ids).size === observed.output_ids.length && observed.concept_versions && equal(Object.keys(observed.concept_versions).sort(), [...observed.output_ids].sort()) && Object.values(observed.concept_versions).every((version) => Number.isInteger(version) && version > 0), `case_mismatch:${expected.id}`);
    add(Boolean(observed?.checks && Object.values(observed.checks).length === 3 && Object.values(observed.checks).every((value) => value === true)), `structural_check_failed:${expected.id}`);
    add(equal(observed?.model, report.models?.[0]), `model_mismatch:${expected.id}`);
    for (const [id, version] of Object.entries(observed?.concept_versions || {})) {
      if (versions.has(id) && versions.get(id) !== version) reasons.push(`catalog_changed:${id}`);
      versions.set(id, version);
    }
  }
  add(Array.isArray(report.models) && report.models.length === 1 && report.models.every((item) => item && item.provider && item.provider !== "unspecified" && item.name && item.name !== "unspecified"), "model_identity_missing_or_mixed");
  if (reasons.length) return { status: "not_evaluable", reasons, case_count: cases.length, dataset_digest: datasetDigest(dataset) };

  const overall = metrics(evaluated);
  const by_locale = Object.fromEntries(["cn", "en"].map((locale) => [locale, metrics(evaluated.filter((item) => item.locale === locale))]));
  for (const key of ["top1_hit", "recommendation_precision", "none_precision", "over_recommendation"]) add(equal(report.metrics?.[key], overall[key]), `report_metric_mismatch:${key}`);
  if (reasons.length) return { status: "not_evaluable", reasons, case_count: cases.length, dataset_digest: datasetDigest(dataset) };

  const failures = [];
  const meet = (metric, threshold, direction, name) => {
    if (metric.value === null || (direction === "min" ? metric.value < threshold : metric.value > threshold)) failures.push(name);
  };
  for (const [name, direction] of [["top1_hit", "min"], ["recommendation_precision", "min"], ["none_precision", "min"], ["over_recommendation", "max"], ["none_recall", "min"]]) meet(overall[name], limits[`${name}_${direction}`], direction, name);
  for (const locale of ["cn", "en"]) for (const [name, direction] of [["top1_hit", "min"], ["recommendation_precision", "min"], ["over_recommendation", "max"], ["none_recall", "min"]]) meet(by_locale[locale][name], limits.per_locale[`${name}_${direction}`], direction, `${locale}.${name}`);
  return { status: failures.length ? "numeric_failed" : "numeric_passed", failures, case_count: cases.length, dataset_digest: datasetDigest(dataset), policy_digest: digest(policy), model: report.models[0], metrics: { overall, by_locale }, output_review_required: true };
}
