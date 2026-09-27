import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareKnowledgeDemo, defaultSamples } from "../scripts/prepare-knowledge-demo.mjs";
import { openRegistry } from "../server/registry.mjs";

const samples = JSON.parse(readFileSync(defaultSamples, "utf8"));
function fixture(t) { const dir = mkdtempSync(join(tmpdir(), "knowledge-demo-")); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }

test("twelve bilingual samples are browsable, linked and persist after demo preparation", (t) => {
  const dir = fixture(t);
  const dbPath = join(dir, "demo.sqlite");
  assert.equal(samples.concepts.length, 12);
  assert.equal(prepareKnowledgeDemo({ dbPath }).relations, samples.relations.length);
  const registry = openRegistry(dbPath); t.after(() => registry.close());
  for (const concept of registry.list()) {
    for (const locale of ["cn", "en"]) {
      assert.equal(concept.readiness[locale].browsable, true);
      assert.equal(concept.readiness[locale].recommendable, false);
      for (const field of ["trigger", "questions", "avoid_when", "examples"]) assert.ok(concept.locales[locale][field].length);
      assert.match(concept.locales[locale].source_text, /https:\/\//);
      assert.match(concept.locales[locale].examples[0], /^(说明性示例：|Illustrative example:)/);
    }
    assert.ok(samples.relations.some((r) => [r.source_concept_id, r.target_concept_id].includes(concept.id)));
    assert.equal(registry.revisions(concept.id).length, 1);
  }
  assert.ok(registry.query({ locale: "cn", q: "大家都很忙但越来越慢" }).some((c) => c.id === "theory-of-constraints"));
});

test("demo preparation requires an explicit fresh path, including all SQLite companions and symlinks", (t) => {
  const dir = fixture(t);
  assert.throws(() => prepareKnowledgeDemo(), /Explicit/);
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const dbPath = join(dir, `existing${suffix || 'db'}.sqlite`);
    writeFileSync(`${dbPath}${suffix}`, "do not change");
    assert.throws(() => prepareKnowledgeDemo({ dbPath }), /already exists/);
    assert.equal(readFileSync(`${dbPath}${suffix}`, "utf8"), "do not change");
  }
  const dbPath = join(dir, "symlink.sqlite");
  symlinkSync(join(dir, "missing-target"), dbPath);
  assert.throws(() => prepareKnowledgeDemo({ dbPath }), /already exists/);
});

test("invalid fields, duplicate IDs and broken references leave no demo database", (t) => {
  const dir = fixture(t);
  for (const mutate of [
    (d) => d.concepts.push(d.concepts[0]),
    (d) => { d.relations[0].target_concept_id = "absent"; },
    (d) => { d.concepts[1].locales.cn.questions = "not an array"; },
    (d) => { d.concepts[1].locales.cn.name = ""; d.concepts[1].locales.en.name = ""; },
    // Fails after all Concepts and the first Relation have already been created.
    (d) => { d.relations[1].relation_type = "invented"; },
    (d) => d.relations.push(d.relations[0]),
  ]) {
    const input = structuredClone(samples); mutate(input);
    const inputPath = join(dir, "input.json"); writeFileSync(inputPath, JSON.stringify(input));
    assert.throws(() => prepareKnowledgeDemo({ dbPath: join(dir, "failed.sqlite"), inputPath }));
    assert.deepEqual(readdirSync(dir), ["input.json"]);
  }
});
