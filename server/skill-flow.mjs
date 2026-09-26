import { openRegistry } from "./registry.mjs";
import { parseRecommendationRequest } from "./recommendation-contract.mjs";
import { composePrompt } from "./prompt-composer.mjs";

export class SkillFlowError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function localApiOrigin(value = "http://127.0.0.1:4173") {
  let url;
  try { url = new URL(value); } catch { throw new SkillFlowError("invalid_api_origin", "Use a local HTTP API origin"); }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new SkillFlowError("invalid_api_origin", "Use a local HTTP API origin");
  }
  return url.origin;
}

export async function recommendForSkill(input, { origin, fetchImpl = fetch, registry, dbPath = process.env.CONCEPT_DB_PATH } = {}) {
  if (!input || !["command", "direct_request"].includes(input.invocation)) throw new SkillFlowError("explicit_invocation_required", "Run only after a command or direct user request");
  const request = parseRecommendationRequest(input.request);
  const response = await fetchImpl(`${localApiOrigin(origin)}/api/recommendations`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input.request),
  });
  const result = await response.json();
  if (!response.ok) throw new SkillFlowError(result.error || "recommendation_failed", result.message || "Recommendation failed");
  if (result.locale !== request.locale || !Array.isArray(result.recommendations) || result.recommendations.length > request.limit || result.recommendations.some((item) => typeof item.id !== "string" || !item.id || !Number.isInteger(item.concept_version))) {
    throw new SkillFlowError("invalid_recommendation_result", "Local API returned an invalid recommendation");
  }
  const store = registry || openRegistry(dbPath);
  try { return { ...result, ...store.createSkillRun({ locale: request.locale, recommendations: result.recommendations }) }; }
  finally { if (!registry) store.close(); }
}

export function composeForSkill(input, registry) {
  if (!input || typeof input !== "object" || typeof input.selected_id !== "string" || typeof input.run_id !== "string") {
    throw new SkillFlowError("selection_required", "Choose one of the shown recommendations before composing");
  }
  const request = parseRecommendationRequest(input.request);
  const run = registry.skillRun(input.run_id);
  if (run.locale !== request.locale || !run.recommendations.some((item) => item.concept_id === input.selected_id)) throw new SkillFlowError("selection_required", "Choose one of the shown recommendations before composing");
  const composed = composePrompt({ concept_id: input.selected_id, locale: request.locale, task: input.request.task, context: input.request.context ?? "", response: input.request.response ?? "" }, registry);
  registry.prepareSkillSelection(input.run_id, input.selected_id, request.locale, composed.concept_version);
  return { ...composed, run_id: input.run_id, task_id: run.task_id };
}

export function feedbackForSkill(input, registry) {
  if (!input || typeof input !== "object" || typeof input.run_id !== "string" || typeof input.concept_id !== "string" || typeof input.event !== "string") throw new SkillFlowError("invalid_feedback", "run_id, concept_id and event are required");
  return registry.recordSkillEvent(input.run_id, input.concept_id, input.event);
}

export function composeWithLocalRegistry(input, { dbPath = process.env.CONCEPT_DB_PATH } = {}) {
  const registry = openRegistry(dbPath);
  try { return composeForSkill(input, registry); }
  finally { registry.close(); }
}

export function feedbackWithLocalRegistry(input, { dbPath = process.env.CONCEPT_DB_PATH } = {}) {
  const registry = openRegistry(dbPath);
  try { return feedbackForSkill(input, registry); }
  finally { registry.close(); }
}
