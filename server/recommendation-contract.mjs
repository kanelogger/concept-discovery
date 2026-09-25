export class RecommendationError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const invalidRequest = (message) => { throw new RecommendationError(400, "invalid_recommendation_request", message); };
const invalidDecision = (message) => { throw new RecommendationError(502, "invalid_model_decision", message); };
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value, field) => Object.prototype.hasOwnProperty.call(value, field);

function optionalText(input, field) {
  if (!own(input, field)) return "";
  if (typeof input[field] !== "string") invalidRequest(`${field} must be text`);
  return input[field].trim();
}

export function parseRecommendationRequest(input) {
  if (!record(input)) invalidRequest("Recommendation request must be an object");
  if (Object.keys(input).some((field) => !["task", "context", "response", "user_intent", "locale", "limit"].includes(field))) invalidRequest("Unknown recommendation request field");
  const task = optionalText(input, "task");
  if (!task) invalidRequest("task is required");
  if (!["cn", "en"].includes(input.locale)) invalidRequest("locale must be cn or en");
  const limit = own(input, "limit") ? input.limit : 1;
  if (!Number.isInteger(limit) || limit < 1 || limit > 3) invalidRequest("limit must be an integer from 1 to 3");
  return { task, context: optionalText(input, "context"), response: optionalText(input, "response"), user_intent: optionalText(input, "user_intent"), locale: input.locale, limit };
}

export function compactCandidateCards(concepts, locale) {
  if (!["cn", "en"].includes(locale) || !Array.isArray(concepts)) invalidRequest("locale and candidates are required");
  return concepts.filter((concept) => concept.lifecycle_status === "active" && concept.readiness?.[locale]?.recommendable).map((concept) => {
    const local = concept.locales[locale];
    return {
      id: concept.id,
      name: local.name,
      description: local.description,
      trigger: local.trigger,
      avoid_when: local.avoid_when,
      domains: concept.domains,
      intents: concept.intents,
      interaction_type: concept.interaction_type,
      epistemic_type: concept.epistemic_type,
    };
  });
}

export function assembleRecommendationResult(request, decision, candidates) {
  if (!record(request) || !["cn", "en"].includes(request.locale) || !Number.isInteger(request.limit) || request.limit < 1 || request.limit > 3) invalidRequest("Normalized request is required");
  if (!record(decision) || !Array.isArray(decision.diagnosis) || !Array.isArray(decision.recommendations)) invalidDecision("Model decision needs diagnosis and recommendations");
  if (Object.keys(decision).some((field) => !["diagnosis", "recommendations"].includes(field))) invalidDecision("Unknown model decision field");
  const diagnosis = decision.diagnosis.map((item) => {
    if (typeof item !== "string" || !item.trim()) invalidDecision("Diagnosis items must be nonempty text");
    return item.trim();
  });
  if (decision.recommendations.length > request.limit || decision.recommendations.length > 3) invalidDecision("Too many recommendations");
  const eligible = new Map(compactCandidateCards(candidates, request.locale).map((card) => [card.id, card]));
  const seen = new Set();
  const recommendations = decision.recommendations.map((item) => {
    if (!record(item) || Object.keys(item).some((field) => !["id", "reason", "confidence"].includes(field))) invalidDecision("Invalid recommendation fields");
    if (typeof item.id !== "string" || !eligible.has(item.id) || seen.has(item.id)) invalidDecision("Recommendation ID is unknown, ineligible, or repeated");
    if (typeof item.reason !== "string" || !item.reason.trim()) invalidDecision("Why Now reason is required");
    if (typeof item.confidence !== "number" || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) invalidDecision("confidence must be between 0 and 1");
    seen.add(item.id);
    return { id: item.id, name: eligible.get(item.id).name, reason: item.reason.trim(), confidence: item.confidence };
  });
  return { locale: request.locale, diagnosis, recommendations };
}

export function unavailableModel() {
  throw new RecommendationError(503, "model_unavailable", "Configure a local model or explicitly choose a remote model before recommending");
}

export async function runRecommendation(input, concepts, adapter, { timeoutMs = 30_000 } = {}) {
  const request = parseRecommendationRequest(input);
  if (!adapter || typeof adapter.decide !== "function") unavailableModel();
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError("timeoutMs must be a positive integer");
  const candidates = compactCandidateCards(concepts, request.locale);
  const controller = new AbortController();
  let timer;
  try {
    const decision = await Promise.race([
      Promise.resolve().then(() => adapter.decide({ request, candidates }, { signal: controller.signal })),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new RecommendationError(504, "model_timeout", "Model decision timed out"));
        }, timeoutMs);
      }),
    ]);
    return assembleRecommendationResult(request, decision, concepts);
  } catch (error) {
    if (error instanceof RecommendationError) throw error;
    throw new RecommendationError(502, "model_failed", "Model decision failed");
  } finally {
    clearTimeout(timer);
  }
}
