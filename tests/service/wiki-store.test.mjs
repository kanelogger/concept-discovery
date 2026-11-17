import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync, unlinkSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, hash } from "../../lib/siyuan.mjs";
import { createWikiStore, sourceImportLimit, sourceImportBytes } from "../../lib/wiki-store.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "cd-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, base: join(root, hash(canonical("one"))), store: createWikiStore(root, "one") };
}
const source = (op_id, markdown = " 原始文本😀\r\n ") => ({ op_id, title: "来源", markdown, url: "https://example.org/source" });

test("each import is an independent exact snapshot; same operation survives restart without duplication", t => {
  const f = fixture(t), input = source("one"), first = f.store.importSource(input);
  assert.equal(first.markdown, input.markdown); assert.equal(first.hash, hash(input.markdown));
  assert.deepEqual(createWikiStore(f.root, "one").importSource(input), first);
  const second = f.store.importSource(source("two"));
  assert.notEqual(second.id, first.id); assert.notEqual(second.sourceId, first.sourceId);
  assert.equal(second.version, 1); assert.equal(f.store.listSources().length, 2);
  assert.throws(() => f.store.importSource(source("one", "新正文")), { code: "operation_conflict" });
  assert.throws(() => f.store.importSource({ ...source("version"), sourceId: first.sourceId }), { code: "invalid_input" });
  const file = join(f.base, "sources", first.id + ".json"), bytes = readFileSync(file, "utf8");
  f.store.importSource(input); assert.equal(readFileSync(file, "utf8"), bytes);
  assert.deepEqual(readdirSync(join(f.base, "events")), []);
});

test("prepared import reconstructs the same snapshot while old source versions remain readable", t => {
  const f = fixture(t), input = source("prepared"), first = f.store.importSource(input);
  unlinkSync(join(f.base, "sources", first.id + ".json"));
  assert.deepEqual(createWikiStore(f.root, "one").importSource(input), first);
  const record = { sourceId: first.sourceId, title: "历史来源", markdown: "历史第二版本", url: "", author: "" };
  const legacy = { ...record, id: "src_" + hash(canonical(record)).slice(0, 32), version: 2, hash: hash(record.markdown), createdAt: "2026-11-01" };
  writeFileSync(join(f.base, "sources", legacy.id + ".json"), JSON.stringify({ record: legacy, recordHash: hash(canonical(legacy)) }));
  assert.deepEqual(f.store.getSource(legacy.id), legacy);
  assert.equal(f.store.putProposal, undefined); assert.equal(f.store.log, undefined);
});

test("snapshot budgets, metadata URLs, library scope and tamper checks remain enforced", t => {
  const f = fixture(t);
  assert.equal(sourceImportBytes, 1024 * 1024);
  const atLimit = f.store.importSource(source("limit", "文".repeat(sourceImportLimit)));
  assert.equal([...atLimit.markdown].length, sourceImportLimit);
  for (const input of [source("long", "文".repeat(sourceImportLimit + 1)), source("empty", " "), source("nul", "a\0b"),
    { ...source("url"), url: "file:///tmp/a" }, { ...source("credential"), url: "https://key@example.org" }])
    assert.throws(() => f.store.importSource(input), { code: "invalid_input" });
  assert.throws(() => createWikiStore(f.root, "two").getSource(atLimit.id), { code: "not_found" });
  assert.throws(() => f.store.getSource("../service.json"), { code: "invalid_input" });
  const path = join(f.base, "sources", atLimit.id + ".json"), bytes = readFileSync(path, "utf8");
  writeFileSync(path, bytes.replace('"version": 1', '"version": 9'));
  assert.throws(() => f.store.getSource(atLimit.id), { code: "content_conflict" });
  unlinkSync(path); const other = join(f.root, "outside.json"); writeFileSync(other, bytes); symlinkSync(other, path);
  assert.throws(() => f.store.getSource(atLimit.id), { code: "outside_scope" });
});
