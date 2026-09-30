import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { importCuratedKnowledge } from "../scripts/import-curated-knowledge.mjs";
import { openRegistry } from "../server/registry.mjs";

function concept(id) {
  const local = { name: id, aliases: [], description: "A qualified description", source_text: "Research reference, 2020. https://example.org/research", article_body: "## Definition\n\nA researched explanation.\n\n## Limits\n\nUse evidence before applying.", trigger: ["A concrete situation"], questions: ["What evidence is missing?"], examples: ["Illustrative example: compare two proposals."], avoid_when: ["The relevant evidence is unavailable."], transform: ["State the assumption", "Check the evidence"], tags: ["reasoning"], agent_instruction: "State assumptions and limits." };
  return { id, interaction_type: "lens", epistemic_type: "principle", domains: ["reasoning"], intents: ["evaluate"], locales: { cn: { ...structuredClone(local), name: `知识 ${id}` }, en: structuredClone(local) } };
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "curated-import-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = join(dir, "library.sqlite");
  const input = join(dir, "complete.json");
  const registry = openRegistry(db);
  const old = concept("existing");
  old.locales.cn.article_body = "Original Chinese article";
  old.locales.en.article_body = "Original English article";
  old.locales.en.source_text = "Original article: https://example.org/old-article";
  old.locales.cn.source_text = "An old unverified assertion";
  registry.create(old);
  const untouched = registry.create(concept("untouched"));
  registry.close();
  const items = [concept("existing"), concept("new-concept")];
  const relation = { source_concept_id: "existing", target_concept_id: "new-concept", relation_type: "related_to", note: { cn: "互相补充的说明", en: "Complementary explanations" } };
  const write = (records = items, relations = [relation]) => writeFileSync(input, JSON.stringify({ count: records.length, items: records, relations }));
  write();
  return { db, input, items, relation, write, untouched };
}

function snapshot(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return Object.fromEntries(["concepts", "revisions", "media_assets", "concept_relations"].map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])); }
  finally { db.close(); }
}

test("curated import previews, backs up, merges articles, preserves existing records and repeats without changes", (t) => {
  const f = fixture(t);
  const before = snapshot(f.db);
  const preview = importCuratedKnowledge(f);
  assert.deepEqual(preview.summary.map(({ action }) => action), ["update", "create"]);
  assert.equal(preview.relationsAdded, 1);
  assert.deepEqual(snapshot(f.db), before);
  const result = importCuratedKnowledge({ ...f, apply: true });
  assert.ok(existsSync(result.backup));
  assert.deepEqual(snapshot(result.backup), before);
  const registry = openRegistry(f.db);
  try {
    assert.deepEqual(registry.get("untouched"), f.untouched);
    const updated = registry.get("existing");
    assert.equal(updated.version, 2);
    assert.ok(updated.locales.cn.article_body.startsWith("Original Chinese article"));
    assert.ok(updated.locales.en.article_body.includes("Researched supplement"));
    assert.ok(updated.locales.en.source_text.includes("https://example.org/old-article"));
    assert.equal(updated.locales.cn.source_text, f.items[0].locales.cn.source_text);
    assert.equal(registry.revisions("existing").length, 2);
    assert.equal(registry.get("new-concept").readiness.cn.recommendable, true);
  } finally { registry.close(); }
  const after = snapshot(f.db);
  const repeat = importCuratedKnowledge({ ...f, apply: true });
  assert.deepEqual(repeat.summary.map(({ action }) => action), ["skip", "skip"]);
  assert.equal(repeat.relationsAdded, 0);
  assert.equal(repeat.backup, null);
  assert.deepEqual(snapshot(f.db), after);
});

test("a later invalid Concept or relation leaves the real database untouched", (t) => {
  const f = fixture(t);
  const before = snapshot(f.db);
  const bad = structuredClone(f.items);
  bad[1].domains = ["not-a-real-domain"];
  f.write(bad);
  assert.throws(() => importCuratedKnowledge({ ...f, apply: true }), /unknown code/);
  assert.deepEqual(snapshot(f.db), before);
  f.write(f.items, [{ ...f.relation, target_concept_id: "missing-concept" }]);
  assert.throws(() => importCuratedKnowledge({ ...f, apply: true }), /not found/);
  assert.deepEqual(snapshot(f.db), before);
});

test("duplicates, placeholder sources, missing content and archived records are rejected", (t) => {
  const f = fixture(t);
  const before = snapshot(f.db);
  f.write([f.items[0], f.items[0]]);
  assert.throws(() => importCuratedKnowledge({ ...f, apply: true }), /Duplicate Concept/);
  const incomplete = structuredClone(f.items);
  incomplete[1].locales.en.source_text = "Example source: replace this";
  f.write(incomplete);
  assert.throws(() => importCuratedKnowledge({ ...f, apply: true }), /placeholder source/);
  incomplete[1].locales.en.source_text = "A source";
  incomplete[1].locales.cn.questions = [];
  f.write(incomplete);
  assert.throws(() => importCuratedKnowledge({ ...f, apply: true }), /missing questions/);
  assert.deepEqual(snapshot(f.db), before);
  const registry = openRegistry(f.db);
  registry.archive("existing", { expected_version: 1 });
  registry.close();
  f.write();
  const archived = snapshot(f.db);
  assert.throws(() => importCuratedKnowledge({ ...f, apply: true }), /archived Concept/);
  assert.deepEqual(snapshot(f.db), archived);
});
