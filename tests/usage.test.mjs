import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openRegistry } from "../server/registry.mjs";

test("Skill Usage transitions retain task, run, Concept version and locale across restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "concept-usage-"));
  const dbPath = join(directory, "registry.sqlite");
  let registry = openRegistry(dbPath);
  try {
    registry.create({ id: "inversion", locales: { cn: { name: "逆向思维" } } });
    assert.throws(() => registry.createSkillRun({ locale: "cn", recommendations: [{ id: "inversion", concept_version: 3 }, { id: "missing", concept_version: 1 }] }));
    assert.equal(registry.dashboard().usage.runs_total, 0);
    const item = [{ id: "inversion", concept_version: 3 }];
    const first = registry.createSkillRun({ locale: "cn", recommendations: item });
    assert.notEqual(first.task_id, first.run_id);
    assert.equal(registry.skillRun(first.run_id).recommendations[0].concept_version, 3);
    assert.throws(() => registry.recordSkillEvent(first.run_id, "inversion", "applied"), { code: "invalid_usage_transition" });
    const viewed = registry.recordSkillEvent(first.run_id, "inversion", "viewed");
    assert.deepEqual([viewed.task_id, viewed.run_id, viewed.concept_id, viewed.concept_version, viewed.locale, viewed.event], [first.task_id, first.run_id, "inversion", 3, "cn", "viewed"]);
    assert.ok(!Number.isNaN(Date.parse(viewed.timestamp)));
    assert.throws(() => registry.recordSkillEvent(first.run_id, "inversion", "ignored"), { code: "invalid_usage_transition" });
    registry.recordSkillEvent(first.run_id, "inversion", "not_useful");
    assert.throws(() => registry.prepareSkillSelection(first.run_id, "inversion", "cn", 4), { code: "invalid_usage_transition" });

    const second = registry.createSkillRun({ locale: "cn", recommendations: item });
    registry.recordSkillEvent(second.run_id, "inversion", "ignored");
    assert.throws(() => registry.recordSkillEvent(second.run_id, "inversion", "applied"), { code: "invalid_usage_transition" });
    registry.recordSkillEvent(second.run_id, "inversion", "viewed");
    registry.recordSkillEvent(second.run_id, "inversion", "not_useful");
    assert.throws(() => registry.recordSkillEvent(second.run_id, "inversion", "not_useful"), { code: "invalid_usage_transition" });

    const third = registry.createSkillRun({ locale: "en", recommendations: item });
    assert.throws(() => registry.prepareSkillSelection(third.run_id, "inversion", "cn", 4), { code: "selection_not_recommended" });
    registry.prepareSkillSelection(third.run_id, "inversion", "en", 4);
    assert.throws(() => registry.recordSkillEvent(third.run_id, "inversion", "ignored"), { code: "invalid_usage_transition" });
    const applied = registry.recordSkillEvent(third.run_id, "inversion", "applied");
    assert.equal(applied.concept_version, 4);
    assert.equal(applied.locale, "en");
    assert.throws(() => registry.recordSkillEvent(third.run_id, "inversion", "not_useful"), { code: "invalid_usage_transition" });
    assert.throws(() => registry.recordSkillEvent(third.run_id, "inversion", "ignored"), { code: "invalid_usage_transition" });
    const none = registry.createSkillRun({ locale: "en", recommendations: [] });
    assert.throws(() => registry.recordSkillEvent(none.run_id, "inversion", "viewed"), { code: "selection_not_recommended" });

    const usage = registry.dashboard().usage;
    assert.deepEqual({ runs: usage.runs_total, none: usage.none_runs, events: usage.events }, { runs: 4, none: 1, events: { recommended: 3, viewed: 2, applied: 1, ignored: 1, not_useful: 2 } });
    assert.deepEqual({ cn: usage.locales.cn.runs_total, en: usage.locales.en.runs_total, enNone: usage.locales.en.none_runs, enApplied: usage.locales.en.events.applied }, { cn: 2, en: 2, enNone: 1, enApplied: 1 });
    registry.close();
    registry = openRegistry(dbPath);
    assert.deepEqual(registry.dashboard().usage, usage);
    assert.equal(registry.skillRun(first.run_id).task_id, first.task_id);
    registry.archive("inversion", { expected_version: 1 });
    assert.throws(() => registry.delete("inversion", { expected_version: 2, confirm_id: "inversion" }), { code: "has_references" });
  } finally {
    registry.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
