import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { importKnowledgeList } from "../scripts/import-knowledge-list.mjs";
import { openRegistry } from "../server/registry.mjs";

const item = {
  id: "sample-concept", lifecycle_status: "active", interaction_type: "lens", epistemic_type: "principle", domains: ["science"], intents: ["explain"],
  locales: {
    cn: { name: "样例", description: "样例描述", source_text: "示例出处：请替换为可追溯的书名、作者或原始资料说明。", trigger: ["分析"], agent_instruction: "分析任务" },
    en: { name: "Sample", description: "Sample description", source_text: "A verified example source", trigger: ["Analyze"], agent_instruction: "Analyze task" },
  },
};

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "knowledge-import-"));
  const sourcePath = join(dir, "source.json");
  const preparedPath = join(dir, "prepared.json");
  const reportPath = join(dir, "report.json");
  const dbPath = join(dir, "catalog.sqlite");
  const source = { count: 1, items: [item] };
  const bytes = Buffer.from(JSON.stringify(source));
  const source_sha256 = createHash("sha256").update(bytes).digest("hex");
  const cleaned = structuredClone(item);
  delete cleaned.lifecycle_status;
  cleaned.locales.cn.source_text = "";
  writeFileSync(sourcePath, bytes);
  writeFileSync(preparedPath, JSON.stringify({ source_sha256, count: 1, items: [cleaned] }));
  writeFileSync(reportPath, JSON.stringify({ source_sha256, changed_fields: 1, affected_concepts: 1, changes: [{ concept_id: item.id, locale: "cn", field: "locales.cn.source_text", before: item.locales.cn.source_text, after: "", reason: "explicit_replace_me_placeholder" }] }));
  return { sourcePath, preparedPath, reportPath, dbPath };
}

test("knowledge import writes an exact fresh catalog and refuses to overwrite it", () => {
  const paths = fixture();
  const original = readFileSync(paths.sourcePath);
  const result = importKnowledgeList(paths);
  assert.equal(result.imported, 1);
  assert.equal(result.cleared_source_fields, 1);
  assert.deepEqual(result.recommendable, { cn: 0, en: 1, both: 0 });
  assert.deepEqual(readFileSync(paths.sourcePath), original);
  const registry = openRegistry(paths.dbPath);
  try {
    assert.equal(registry.get(item.id).locales.cn.source_text, "");
    assert.equal(registry.revisions(item.id).length, 1);
    assert.equal(registry.dashboard().usage.runs_total, 0);
  } finally { registry.close(); }
  assert.throws(() => importKnowledgeList(paths), /already exists/);
  assert.ok(existsSync(paths.dbPath));
});

test("knowledge import rejects unreported edits before creating a database", () => {
  const paths = fixture();
  const prepared = JSON.parse(readFileSync(paths.preparedPath));
  prepared.items[0].locales.en.name = "Changed without evidence";
  writeFileSync(paths.preparedPath, JSON.stringify(prepared));
  assert.throws(() => importKnowledgeList(paths), /Unreported prepared change/);
  assert.equal(existsSync(paths.dbPath), false);
});
