import { createHash } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import policy from "./thresholds.initial.json" with { type: "json" };

const fail = (message) => { throw new Error(message); };
const slug = (value) => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const timestamp = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN;
const pairKey = (runId, conceptId) => `${runId}\0${conceptId}`;

export function summarizePilotUsage(dbPath, manifest, { asOf = new Date().toISOString() } = {}) {
  if (!existsSync(dbPath) || !lstatSync(dbPath).isFile()) fail("Pilot database must be an existing regular file");
  const observedAt = timestamp(asOf);
  const startedAt = timestamp(manifest?.started_at);
  if (!Number.isFinite(observedAt) || !Number.isFinite(startedAt) || startedAt > observedAt || manifest?.schema_version !== 1 || !slug(manifest.pilot_id) || !slug(manifest.operator_ref) || !Array.isArray(manifest.runs)) fail("Pilot manifest or observation time is invalid");
  const declared = new Map();
  for (const item of manifest.runs) {
    if (!item || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(item.run_id) || !["cn", "en"].includes(item.locale) || !slug(item.session_ref) || item.user_initiated !== true || item.actual_task !== true || typeof item.eval_reuse_opt_in !== "boolean" || Object.keys(item).some((key) => !["run_id", "locale", "session_ref", "user_initiated", "actual_task", "eval_reuse_opt_in"].includes(key)) || declared.has(item.run_id)) fail("Pilot manifest contains an invalid or duplicate run");
    declared.set(item.run_id, item);
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let runs, recommendations, events, preparations;
  try {
    runs = db.prepare("SELECT run_id, locale, result_count, created_at FROM skill_runs ORDER BY created_at, run_id").all();
    recommendations = db.prepare("SELECT run_id, concept_id FROM skill_recommendations").all();
    events = db.prepare("SELECT run_id, concept_id, event_type, occurred_at FROM skill_usage_events").all();
    preparations = db.prepare("SELECT run_id, concept_id FROM skill_preparations").all();
  } finally { db.close(); }
  if (runs.length !== declared.size) fail("Pilot manifest and database run counts disagree");
  const runMap = new Map(runs.map((run) => [run.run_id, run]));
  const recsByRun = new Map(runs.map((run) => [run.run_id, []]));
  const eventSets = new Map();
  for (const run of runs) {
    const entry = declared.get(run.run_id);
    const createdAt = timestamp(run.created_at);
    if (!entry || entry.locale !== run.locale || !Number.isInteger(run.result_count) || run.result_count < 0 || run.result_count > 3 || !Number.isFinite(createdAt) || createdAt < startedAt || createdAt > observedAt) fail("Pilot run is unlisted, mismatched, or outside the observation window");
  }
  for (const item of recommendations) {
    if (!runMap.has(item.run_id)) fail("Recommendation references an unknown run");
    const key = pairKey(item.run_id, item.concept_id);
    if (eventSets.has(key)) fail("Duplicate recommendation pair");
    eventSets.set(key, new Set());
    recsByRun.get(item.run_id).push(item.concept_id);
  }
  for (const item of events) {
    const set = eventSets.get(pairKey(item.run_id, item.concept_id));
    if (!set || !["recommended", "viewed", "applied", "ignored", "not_useful"].includes(item.event_type) || set.has(item.event_type) || !Number.isFinite(timestamp(item.occurred_at)) || timestamp(item.occurred_at) < timestamp(runMap.get(item.run_id).created_at) || timestamp(item.occurred_at) > observedAt) fail("Pilot event is inconsistent with its recommendation");
    set.add(item.event_type);
  }
  const preparedPairs = new Set(preparations.map((item) => pairKey(item.run_id, item.concept_id)));
  for (const [key, set] of eventSets) {
    if (set.has("applied") && (!preparedPairs.has(key) || set.has("ignored") || set.has("not_useful"))) fail("Pilot applied event has no valid preparation or conflicts with feedback");
  }
  const locales = { cn: { runs: 0, none_runs: 0, recommendation_pairs: 0 }, en: { runs: 0, none_runs: 0, recommendation_pairs: 0 } };
  let closedRuns = 0, closedPairs = 0, appliedPairs = 0, pendingPairs = 0, unresolvedPairs = 0, overdueUnresolvedPairs = 0, optedInRuns = 0;
  for (const run of runs) {
    const recs = recsByRun.get(run.run_id);
    if (recs.length !== run.result_count) fail("Pilot result_count disagrees with stored recommendations");
    const local = locales[run.locale];
    local.runs++;
    local.recommendation_pairs += recs.length;
    if (!recs.length) local.none_runs++;
    if (declared.get(run.run_id).eval_reuse_opt_in) optedInRuns++;
    const olderThanWindow = observedAt - timestamp(run.created_at) >= 24 * 60 * 60 * 1000;
    const allTerminal = recs.every((conceptId) => {
      const eventsForPair = eventSets.get(pairKey(run.run_id, conceptId));
      if (!eventsForPair?.has("recommended")) fail("Pilot recommendation has no recommended event");
      return ["applied", "ignored", "not_useful"].some((event) => eventsForPair.has(event));
    });
    const closed = olderThanWindow || allTerminal;
    if (closed) closedRuns++;
    for (const conceptId of recs) {
      const eventsForPair = eventSets.get(pairKey(run.run_id, conceptId));
      if (closed) {
        closedPairs++;
        if (eventsForPair.has("applied")) appliedPairs++;
      } else pendingPairs++;
      if (!["applied", "ignored", "not_useful"].some((event) => eventsForPair.has(event))) {
        unresolvedPairs++;
        if (olderThanWindow) overdueUnresolvedPairs++;
      }
    }
  }
  const applyRate = closedPairs ? appliedPairs / closedPairs : null;
  const requirements = policy.real_usage;
  const countMet = runs.length >= requirements.min_real_skill_runs && ["cn", "en"].every((locale) => locales[locale].runs >= requirements.min_runs_per_locale);
  return {
    status: applyRate === null ? "not_evaluable" : countMet && applyRate >= requirements.apply_rate_min ? "numeric_passed" : "numeric_failed",
    pilot_id: manifest.pilot_id, as_of: asOf,
    manifest_digest: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
    runs_total: runs.length, locales, eval_reuse_opt_in_runs: optedInRuns,
    feedback: { window_hours: 24, closed_runs: closedRuns, closed_recommendation_pairs: closedPairs, applied_pairs: appliedPairs, pending_recommendation_pairs: pendingPairs, unresolved_pairs: unresolvedPairs, overdue_unresolved_pairs: overdueUnresolvedPairs, apply_rate: applyRate },
    numeric_requirements: { min_runs: requirements.min_real_skill_runs, min_runs_per_locale: requirements.min_runs_per_locale, min_apply_rate: requirements.apply_rate_min },
    provenance_review_required: true,
  };
}
