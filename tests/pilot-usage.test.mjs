import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { summarizePilotUsage } from "../eval/summarize-pilot-usage.mjs";
import { openRegistry } from "../server/registry.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "pilot-usage-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "pilot.sqlite");
  const registry = openRegistry(dbPath);
  registry.create({ id: "inversion", locales: { cn: { name: "逆向思维", description: "倒推风险", source_text: "测试出处", trigger: ["选择"], agent_instruction: "倒推" }, en: { name: "Inversion", description: "Work backward", source_text: "Test source", trigger: ["Decision"], agent_instruction: "Invert" } } });
  const first = registry.createSkillRun({ locale: "cn", recommendations: [{ id: "inversion", concept_version: 1 }] });
  registry.prepareSkillSelection(first.run_id, "inversion", "cn", 1);
  registry.recordSkillEvent(first.run_id, "inversion", "applied");
  const second = registry.createSkillRun({ locale: "en", recommendations: [] });
  const third = registry.createSkillRun({ locale: "cn", recommendations: [{ id: "inversion", concept_version: 1 }] });
  registry.close();
  const runs = [first, second, third].map((run, index) => ({ run_id: run.run_id, locale: index === 1 ? "en" : "cn", session_ref: "session-one", user_initiated: true, actual_task: true, eval_reuse_opt_in: index === 0 }));
  const manifest = { schema_version: 1, pilot_id: "test-fixture", operator_ref: "test-only", started_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), runs };
  return { dir, dbPath, manifest, third };
}

test("pilot summary separates closed, pending, NONE, and opt-in runs", (t) => {
  const { dbPath, manifest, third } = fixture(t);
  const now = new Date().toISOString();
  const current = summarizePilotUsage(dbPath, manifest, { asOf: now });
  assert.equal(current.status, "numeric_failed");
  assert.equal(current.runs_total, 3);
  assert.equal(current.locales.cn.runs, 2);
  assert.equal(current.locales.en.none_runs, 1);
  assert.equal(current.eval_reuse_opt_in_runs, 1);
  assert.deepEqual({ closed: current.feedback.closed_recommendation_pairs, applied: current.feedback.applied_pairs, pending: current.feedback.pending_recommendation_pairs, unresolved: current.feedback.unresolved_pairs, rate: current.feedback.apply_rate }, { closed: 1, applied: 1, pending: 1, unresolved: 1, rate: 1 });
  const db = new DatabaseSync(dbPath);
  db.prepare("UPDATE skill_runs SET created_at = ? WHERE run_id = ?").run(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), third.run_id);
  db.close();
  const matured = summarizePilotUsage(dbPath, manifest, { asOf: now });
  assert.equal(matured.feedback.closed_recommendation_pairs, 2);
  assert.equal(matured.feedback.apply_rate, 0.5);
  assert.equal(matured.feedback.overdue_unresolved_pairs, 1);
});

test("pilot summary rejects unlisted and non-real runs", (t) => {
  const { dbPath, manifest } = fixture(t);
  assert.throws(() => summarizePilotUsage(dbPath, { ...manifest, runs: manifest.runs.slice(1) }), /counts disagree/);
  assert.throws(() => summarizePilotUsage(dbPath, { ...manifest, runs: [{ ...manifest.runs[0], actual_task: false }, ...manifest.runs.slice(1)] }), /invalid or duplicate run/);
});

test("pilot summary CLI keeps aggregate output private", (t) => {
  const { dir, dbPath, manifest } = fixture(t);
  const manifestPath = join(dir, "runs.json");
  const outputPath = join(dir, "summary.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/pilot-usage-summary.mjs", import.meta.url)), "--db", dbPath, "--manifest", manifestPath, "--output", outputPath], { encoding: "utf8" });
  assert.equal(result.status, 2, result.stderr);
  const output = readFileSync(outputPath, "utf8");
  assert.equal(JSON.parse(output).runs_total, 3);
  assert.equal(output.includes(manifest.runs[0].run_id), false);
  assert.equal(statSync(outputPath).mode & 0o777, 0o600);
});
