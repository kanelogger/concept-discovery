import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, readFileSync, readdirSync, unlinkSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, hash } from "../../lib/siyuan.mjs";
import { createWikiStore, sourceSnapshotCharLimit, sourceSnapshotByteLimit } from "../../lib/wiki-store.mjs";
import { sourceSnapshot } from "./source-fixture.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "cd-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, base: join(root, hash(canonical("one"))), store: createWikiStore(root, "one") };
}
const source = (key, markdown = " 原始文本😀\r\n ") =>
  sourceSnapshot(key, { title: "来源", markdown, url: "https://example.org/source" });

test("raw restoration preserves exact snapshots and refuses to replace an existing record", t => {
  const f = fixture(t), first = source("one"), second = source("two");
  assert.deepEqual(f.store.restoreSource(first), first);
  assert.deepEqual(f.store.restoreSource(second), second);
  assert.notEqual(first.id, second.id);
  assert.equal(f.store.listSources().length, 2);
  const file = join(f.base, "sources", first.id + ".json");
  const bytes = readFileSync(file, "utf8");
  const reopened = createWikiStore(f.root, "one");
  assert.deepEqual(reopened.restoreSource(first), first);
  assert.throws(() => reopened.restoreSource({ ...first, version: 2 }), { code: "content_conflict" });
  assert.equal(readFileSync(file, "utf8"), bytes);
  assert.deepEqual(readdirSync(join(f.base, "events")), []);
  assert.ok(!readdirSync(f.base).includes("imports"));
});

test("pre-existing versioned snapshots and their old receipts stay byte-exact", t => {
  const f = fixture(t);
  const payload = { sourceId: "src_" + hash(canonical({ op_id: "legacy-import" })).slice(0, 32),
    title: "历史来源", markdown: "历史第二版本。\r\n", url: "", author: "" };
  const legacy = { ...payload, id: "src_" + hash(canonical(payload)).slice(0, 32),
    version: 2, hash: hash(payload.markdown), createdAt: "2026-11-01T00:00:00.000Z" };
  const snapshot = join(f.base, "sources", legacy.id + ".json");
  const bytes = JSON.stringify({ record: legacy, recordHash: hash(canonical(legacy)) });
  writeFileSync(snapshot, bytes);
  mkdirSync(join(f.base, "imports"));
  const receipt = join(f.base, "imports", hash(canonical("legacy-import")) + ".json");
  const recorded = JSON.stringify({ id: legacy.id, sourceId: legacy.sourceId,
    version: legacy.version, createdAt: legacy.createdAt, requestHash: "historical" });
  writeFileSync(receipt, recorded);
  assert.deepEqual(createWikiStore(f.root, "one", { readOnly: true }).getSource(legacy.id), legacy);
  assert.deepEqual(f.store.restoreSource(legacy), legacy);
  assert.equal(readFileSync(snapshot, "utf8"), bytes);
  assert.equal(readFileSync(receipt, "utf8"), recorded);
});

test("snapshot budgets, metadata URLs, library scope and tamper checks remain enforced", t => {
  const f = fixture(t);
  assert.equal(sourceSnapshotByteLimit, 1024 * 1024);
  const atLimit = f.store.restoreSource(source("limit", "文".repeat(sourceSnapshotCharLimit)));
  assert.equal([...atLimit.markdown].length, sourceSnapshotCharLimit);
  for (const input of [source("long", "文".repeat(sourceSnapshotCharLimit + 1)), source("empty", " "), source("nul", "a\0b"),
    sourceSnapshot("url", { title: "来源", markdown: "原文", url: "file:///tmp/a" }),
    sourceSnapshot("credential", { title: "来源", markdown: "原文", url: "https://key@example.org" })])
    assert.throws(() => f.store.restoreSource(input), { code: "invalid_input" });
  assert.throws(() => createWikiStore(f.root, "two").getSource(atLimit.id), { code: "not_found" });
  assert.throws(() => f.store.getSource("../service.json"), { code: "invalid_input" });
  const path = join(f.base, "sources", atLimit.id + ".json"), bytes = readFileSync(path, "utf8");
  writeFileSync(path, bytes.replace('"version": 1', '"version": 9'));
  assert.throws(() => f.store.getSource(atLimit.id), { code: "content_conflict" });
  unlinkSync(path); const other = join(f.root, "outside.json"); writeFileSync(other, bytes); symlinkSync(other, path);
  assert.throws(() => f.store.getSource(atLimit.id), { code: "outside_scope" });
});

test("reader never creates missing library or area directories and rejects symlinks", t => {
  const f = fixture(t), saved = f.store.restoreSource(source("existing"));
  const read = (id = "one") => createWikiStore(f.root, id, {readOnly: true});
  assert.deepEqual(read().getSource(saved.id), saved);
  assert.equal(read().restoreSource, undefined);
  const initial = readdirSync(f.root);
  assert.deepEqual(read("missing").listSources(), []);
  assert.throws(() => read("missing").getSource(saved.id), {code:"not_found"});
  assert.deepEqual(readdirSync(f.root), initial);
  rmSync(join(f.base, "events"), {recursive:true});
  assert.deepEqual(read().events(), []);
  assert.ok(!readdirSync(f.base).includes("events"));
  symlinkSync(join(f.base, "proposals"), join(f.base, "events"));
  assert.throws(read, {code:"outside_scope"});
});
