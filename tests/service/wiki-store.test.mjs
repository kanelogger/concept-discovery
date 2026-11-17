import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWikiStore, sourceImportLimit, sourceImportBytes } from "../../lib/wiki-store.mjs";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "cd-wiki-store-"));
  const store = createWikiStore(directory, "library-a");
  return { directory, store, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
const source = (op_id, markdown = "原文第一行。\n\n原文第二行。") => ({ op_id, title: "原始资料", markdown, url: "https://example.org/article", author: "作者" });
const proposal = (state = "draft") => ({ id: "prop_" + "a".repeat(32), state, items: [{ id: "item-first", title: "概念" }] });
const code = (fn, expected) => assert.throws(fn, error => error.code === expected);

test("source import retains exact immutable snapshots, versions and idempotent receipts", () => {
  const f = fixture();
  try {
    const raw = "  # 标题\r\n\r\n原文😀。  \n";
    const first = f.store.importSource(source("source-one", raw));
    assert.equal(first.markdown, raw);
    assert.equal(first.version, 1);
    assert.match(first.hash, /^[a-f0-9]{64}$/);
    assert.deepEqual(f.store.importSource(source("source-one", raw)), first);
    assert.deepEqual(f.store.importSource(source("source-same-content", raw)), first);
    code(() => f.store.importSource(source("source-one", "不同内容")), "operation_conflict");
    const second = f.store.importSource({ ...source("source-two", "第二版本。"), sourceId: first.sourceId });
    assert.notEqual(second.id, first.id);
    assert.equal(second.sourceId, first.sourceId);
    assert.equal(second.version, 2);
    assert.equal(f.store.getSource(first.id).markdown, raw);
    assert.equal(f.store.listSources().length, 2);
    const restarted = createWikiStore(f.directory, "library-a");
    assert.deepEqual(restarted.getSource(first.id), first);
    assert.deepEqual(restarted.importSource(source("source-one", raw)), first);
  } finally { f.cleanup(); }
});

test("source limits reject excess without truncating and metadata never fetches a URL", () => {
  const f = fixture();
  try {
    assert.equal(sourceImportBytes, 1024 * 1024);
    const atLimit = f.store.importSource(source("at-limit", "文".repeat(sourceImportLimit)));
    assert.equal([...atLimit.markdown].length, sourceImportLimit);
    code(() => f.store.importSource(source("over-limit", "文".repeat(sourceImportLimit + 1))), "invalid_input");
    code(() => f.store.importSource({ ...source("bad-url"), url: "file:///etc/passwd" }), "invalid_input");
    code(() => f.store.importSource({ ...source("credential-url"), url: "https://name:secret@example.org" }), "invalid_input");
    code(() => f.store.importSource(source("empty", "   ")), "invalid_input");
    code(() => f.store.importSource(source("nul", "a\0b")), "invalid_input");
    const emoji = f.store.importSource(source("emoji", "😀".repeat(sourceImportLimit)));
    assert.equal([...emoji.markdown].length, sourceImportLimit);
    assert.equal(f.store.listSources().length, 2);
  } finally { f.cleanup(); }
});

test("prepared imports recover after interruption and reserve their original version", () => {
  const f = fixture();
  try {
    const first = f.store.importSource(source("interrupted", "原始版本。"));
    const library = readdirSync(f.directory)[0];
    // Reproduce the state after the operation receipt was written but before
    // the source snapshot became visible.
    unlinkSync(join(f.directory, library, "sources", first.id + ".json"));
    const restarted = createWikiStore(f.directory, "library-a");
    code(() => restarted.importSource(source("interrupted", "换了请求内容。")), "operation_conflict");
    const later = restarted.importSource(source("later", "后续版本。"));
    assert.equal(later.version, 2);
    assert.deepEqual(restarted.importSource(source("interrupted", "原始版本。")), first);
    assert.deepEqual(restarted.listSources().map(value => value.version).sort(), [1, 2]);
  } finally { f.cleanup(); }
});

test("library namespaces, identifiers, symlinks and raw tamper checks protect boundaries", () => {
  const f = fixture();
  try {
    const imported = f.store.importSource(source("first"));
    const other = createWikiStore(f.directory, "library-b");
    assert.deepEqual(other.listSources(), []);
    code(() => other.getSource(imported.id), "not_found");
    code(() => other.importSource({ ...source("version"), sourceId: imported.sourceId }), "not_found");
    for (const id of ["../outside", "/etc/passwd", "src_../outside", "src_%2e%2e", "src_" + "f".repeat(32) + "/x"])
      code(() => f.store.getSource(id), "invalid_input");
    const library = readdirSync(f.directory).find(name => readdirSync(join(f.directory, name)).includes("sources") && readdirSync(join(f.directory, name, "sources")).length);
    const file = join(f.directory, library, "sources", imported.id + ".json");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const envelope = JSON.parse(readFileSync(file, "utf8"));
    envelope.record.markdown = "被篡改的原文";
    writeFileSync(file, JSON.stringify(envelope));
    code(() => f.store.getSource(imported.id), "content_conflict");
    const outside = join(f.directory, "outside.json");
    writeFileSync(outside, "{}");
    const linkedId = "src_" + "f".repeat(32);
    symlinkSync(outside, join(f.directory, library, "sources", linkedId + ".json"));
    code(() => f.store.getSource(linkedId), "outside_scope");
  } finally { f.cleanup(); }
});

test("proposal CAS survives reopening and rejects stale updates or corrupt versions", () => {
  const f = fixture();
  try {
    const first = f.store.putProposal(proposal());
    code(() => f.store.putProposal(proposal("reviewed")), "content_conflict");
    code(() => f.store.putProposal(proposal("reviewed"), { expectedRevision: "wrong" }), "content_conflict");
    const reviewed = f.store.putProposal(proposal("reviewed"), { expectedRevision: first.revision });
    assert.notEqual(reviewed.revision, first.revision);
    code(() => f.store.putProposal(proposal("applying"), { expectedRevision: first.revision }), "content_conflict");
    assert.equal(createWikiStore(f.directory, "library-a").getProposal(first.id).state, "reviewed");
    assert.equal(f.store.listProposals().length, 1);
    code(() => f.store.putProposal({ id: "prop_../../outside", state: "draft" }), "invalid_input");
    const library = readdirSync(f.directory)[0];
    const file = join(f.directory, library, "proposals", first.id + ".json");
    const edited = JSON.parse(readFileSync(file, "utf8")); edited.state = "tampered";
    writeFileSync(file, JSON.stringify(edited));
    code(() => f.store.getProposal(first.id), "content_conflict");
  } finally { f.cleanup(); }
});

test("knowledge events deduplicate stable IDs and remain independent of mutable proposals", () => {
  const f = fixture();
  try {
    const input = { id: "evt_" + "b".repeat(32), kind: "source-imported", sourceId: "source-ref" };
    const first = f.store.log(input);
    assert.deepEqual(f.store.log(input), first);
    code(() => f.store.log({ ...input, kind: "card-applied" }), "operation_conflict");
    assert.deepEqual(createWikiStore(f.directory, "library-a").events(), [first]);
    assert.deepEqual(f.store.log({ kind: "another-event" }), f.store.log({ kind: "another-event" }));
    const dated = { id: "evt_" + "c".repeat(32), kind: "dated-event", createdAt: "2026-11-17T01:00:00Z" };
    assert.deepEqual(f.store.log(dated), f.store.log(dated));
    assert.equal(f.store.events().length, 3);
  } finally { f.cleanup(); }
});

test("withLock serializes store instances for the same library, releases failures and rejects nesting", async () => {
  const f = fixture();
  try {
    const second = createWikiStore(f.directory, "library-a");
    const order = [];
    let unblock;
    let didStart;
    const blocked = new Promise(yes => { unblock = yes; });
    const started = new Promise(yes => { didStart = yes; });
    const first = f.store.withLock(async () => {
      order.push("first-start");
      didStart();
      await blocked;
      order.push("first-end");
      throw new Error("injected");
    });
    const next = second.withLock(async () => { order.push("second"); });
    await started;
    assert.deepEqual(order, ["first-start"]);
    unblock();
    await assert.rejects(first, /injected/);
    await next;
    assert.deepEqual(order, ["first-start", "first-end", "second"]);
    await f.store.withLock(async () => {
      await assert.rejects(second.withLock(async () => {}), error => error.code === "write_locked");
    });
    await f.store.withLock(async () => { order.push("released"); });
    assert.equal(order.at(-1), "released");
  } finally { f.cleanup(); }
});
