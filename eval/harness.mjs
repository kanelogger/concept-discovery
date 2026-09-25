import { parseRecommendationRequest } from "../server/recommendation-contract.mjs";

const ratio = (numerator, denominator) => ({ numerator, denominator, value: denominator ? numerator / denominator : null });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function validateDataset(dataset) {
  if (!dataset || dataset.schema_version !== 1 || !["synthetic", "maintainer"].includes(dataset.dataset_kind) || !Array.isArray(dataset.cases) || !dataset.cases.length) throw new Error("Eval dataset needs schema_version 1, dataset_kind, and cases");
  const seen = new Set();
  return dataset.cases.map((item) => {
    if (!item || typeof item.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) || seen.has(item.id)) throw new Error("Eval case IDs must be unique lowercase slugs");
    seen.add(item.id);
    if (!["cn", "en"].includes(item.locale) || !item.input || Object.hasOwn(item.input, "locale")) throw new Error(`${item.id}: explicit case locale and input without locale are required`);
    const input = parseRecommendationRequest({ ...item.input, locale: item.locale });
    if (!Array.isArray(item.expected_ids) || item.expected_ids.length > 3 || item.expected_ids.some((id) => typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) || new Set(item.expected_ids).size !== item.expected_ids.length) throw new Error(`${item.id}: expected_ids must contain 0 to 3 unique Concept IDs`);
    return { id: item.id, locale: item.locale, input, expected_ids: item.expected_ids };
  });
}

function localBaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Eval API must be a local HTTP origin");
  return url.origin;
}

export async function evaluateDataset(dataset, { baseUrl = "http://127.0.0.1:4173", fetchImpl = fetch } = {}) {
  const cases = validateDataset(dataset);
  const origin = localBaseUrl(baseUrl);
  const conceptCache = new Map();
  const results = [];
  for (const item of cases) {
    let response;
    try {
      response = await fetchImpl(`${origin}/api/recommendations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item.input) });
    } catch {
      results.push({ id: item.id, locale: item.locale, expected_ids: item.expected_ids, status: "error", error: "network_error", http_status: 0 });
      continue;
    }
    let body;
    try { body = await response.json(); } catch { body = null; }
    if (!response.ok) {
      results.push({ id: item.id, locale: item.locale, expected_ids: item.expected_ids, status: "error", error: typeof body?.error === "string" ? body.error : "http_error", http_status: response.status });
      continue;
    }
    if (!body || body.locale !== item.locale || !Array.isArray(body.diagnosis) || body.diagnosis.some((value) => typeof value !== "string") || !Array.isArray(body.recommendations) || body.recommendations.length > item.input.limit || body.recommendations.some((value) => !value || typeof value.id !== "string" || typeof value.reason !== "string")) {
      results.push({ id: item.id, locale: item.locale, expected_ids: item.expected_ids, status: "error", error: "invalid_api_response", http_status: response.status });
      continue;
    }
    let cardLocaleMatch = true;
    for (const recommendation of body.recommendations) {
      if (typeof recommendation.id !== "string") { cardLocaleMatch = false; continue; }
      if (!conceptCache.has(recommendation.id)) {
        try {
          const conceptResponse = await fetchImpl(`${origin}/api/concepts/${encodeURIComponent(recommendation.id)}`);
          conceptCache.set(recommendation.id, conceptResponse.ok ? await conceptResponse.json() : null);
        } catch { conceptCache.set(recommendation.id, null); }
      }
      const concept = conceptCache.get(recommendation.id);
      const local = concept?.locales?.[item.locale];
      if (!local || !concept?.readiness?.[item.locale]?.recommendable || recommendation.name !== local.name || !same(recommendation.card, {
        description: local.description,
        tags: local.tags,
        cover_image: local.cover_image,
        interaction_type: concept.interaction_type,
        epistemic_type: concept.epistemic_type,
      })) cardLocaleMatch = false;
    }
    results.push({
      id: item.id, locale: item.locale, expected_ids: item.expected_ids, status: "ok",
      output_ids: body.recommendations.map((recommendation) => recommendation.id),
      concept_versions: Object.fromEntries(body.recommendations.map((recommendation) => [recommendation.id, conceptCache.get(recommendation.id)?.version ?? null])),
      model: { provider: response.headers.get("x-model-provider") || "unspecified", name: response.headers.get("x-model-name") || "unspecified" },
      checks: {
        diagnosis_present: body.diagnosis.length > 0 && body.diagnosis.every((value) => typeof value === "string" && value.trim()),
        why_now_present: body.recommendations.every((value) => typeof value.reason === "string" && value.reason.trim()),
        card_locale_match: cardLocaleMatch,
      },
    });
  }
  const evaluated = results.filter((item) => item.status === "ok");
  const positive = evaluated.filter((item) => item.expected_ids.length > 0);
  const outputs = evaluated.flatMap((item) => item.output_ids.map((id) => ({ id, expected: item.expected_ids })));
  const predictedNone = evaluated.filter((item) => item.output_ids.length === 0);
  return {
    schema_version: 1, dataset_kind: dataset.dataset_kind, generated_at: new Date().toISOString(),
    case_count: cases.length, evaluated_count: evaluated.length, error_count: cases.length - evaluated.length,
    models: [...new Map(evaluated.map((item) => [JSON.stringify(item.model), item.model])).values()],
    metrics: {
      top1_hit: ratio(positive.filter((item) => item.expected_ids.includes(item.output_ids[0])).length, positive.length),
      recommendation_precision: ratio(outputs.filter((item) => item.expected.includes(item.id)).length, outputs.length),
      none_precision: ratio(predictedNone.filter((item) => item.expected_ids.length === 0).length, predictedNone.length),
      over_recommendation: ratio(evaluated.filter((item) => item.output_ids.some((id) => !item.expected_ids.includes(id))).length, evaluated.length),
    },
    cases: results,
  };
}
