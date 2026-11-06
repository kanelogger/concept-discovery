import test from "node:test";
import assert from "node:assert/strict";
import { diffBlocks, markdownChunks, markdownEquivalent, Documents } from "../../lib/documents.mjs";
import { Siyuan } from "../../lib/siyuan.mjs";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const unit = (id, markdown) => ({ id, markdown, attrs: { "custom-note": "preserve" }, descendants: [] });
test("document differences retain equal anchors and only replace changed runs", () => {
  const before = [unit("a", "First"), unit("b", "Second"), unit("c", "Last")];
  const plan = diffBlocks(before, markdownChunks("First\n\nChanged\n\nLast"));
  assert.deepEqual(plan.assigned, ["a", "b", "c"]);
  assert.deepEqual(plan.changes, [{ action: "update", id: "b", markdown: "Changed", attrs: { "custom-note": "preserve" }, descendants: [] }]);
});
test("block inserts keep their source order around existing anchors", () => {
  const before = [unit("a", "First"), unit("b", "Last")];
  const plan = diffBlocks(before, markdownChunks("First\n\nAdded one\n\nAdded two\n\nLast"));
  assert.equal(plan.assigned[0], "a"); assert.equal(plan.assigned[3], "b");
  assert.equal(plan.changes.length, 2);
  assert.ok(plan.changes.every((step) => step.action === "insert" && step.nextID === "b"));
  assert.deepEqual(plan.changes.map((step) => step.markdown), ["Added one", "Added two"]);
});
test("duplicate paragraphs remain separate anchors", () => {
  const plan = diffBlocks([unit("a", "Same"), unit("b", "Same"), unit("c", "End")], markdownChunks("Same\n\nSame\n\nEnd"));
  assert.deepEqual(plan.assigned, ["a", "b", "c"]); assert.deepEqual(plan.changes, []);
});
test("native identity and layout injection is refused outside literal examples", () => {
  for (const text of ['Paragraph\n{: id="20261105000000-abcdefg"}', "{{{row\n\nText\n\n}}}", "> Paragraph\n> {: id=\"20261105000000-abcdefg\"}", 'Text{: id="20261105000000-abcdefg"}'])
    assert.throws(() => markdownChunks(text), { code: "unsupported_structure" });
  const literal = '```markdown\n{{{row\n{: id="20261105000000-abcdefg"}\n}}}\n```';
  assert.equal(markdownChunks(literal)[0].markdown, literal);
});
test("stale document versions are rejected before mutation", async () => {
  let writes = 0;
  const a = { operate: async (_c, _i, fn) => fn({ input: {} }, () => {}), api: async () => { writes++; } };
  const documents = new Documents(a, {});
  documents.snapshot = async () => ({ id: "doc", editable: true, revision: "current", units: [] });
  await assert.rejects(documents.save({ op_id: "stale", id: "doc", title: "Title", markdown: "Body", expected_revision: "old" }), { code: "content_conflict" });
  assert.equal(writes, 0);
});
test("backup persistence failure prevents all writes", async () => {
  let writes = 0;
  const a = { operate: async (_c, _i, fn) => fn({ input: {} }, () => { throw new Error("disk full"); }), api: async () => { writes++; } };
  const documents = new Documents(a, {});
  documents.snapshot = async () => ({ id: "doc", title: "Title", editable: true, revision: "current", units: [] });
  await assert.rejects(documents.save({ op_id: "no-backup", id: "doc", title: "Title", markdown: "Body", expected_revision: "current" }), /disk full/);
  assert.equal(writes, 0);
});
test("an error after a document write starts becomes uncertain", async () => {
  const a = { operate: async (_c, _i, fn) => fn({ input: {} }, () => {}), api: async () => { throw Object.assign(new Error("native failure"), { code: "siyuan_error" }); } };
  const documents = new Documents(a, {});
  documents.snapshot = async () => ({ id: "doc", title: "Title", editable: true, revision: "current", units: [] });
  await assert.rejects(documents.save({ op_id: "partial", id: "doc", title: "Title", markdown: "Body", expected_revision: "current" }), { code: "operation_pending" });
});
test("remote plain HTTP remains denied unless a trusted internal config opts in", () => {
  assert.throws(() => new Siyuan({ url: "http://kernel:6806", token: "token" }), { code: "configuration" });
  assert.equal(new Siyuan({ url: "http://kernel:6806", token: "token", internal: true }).origin, "http://kernel:6806");
  assert.throws(() => new Siyuan({ url: "http://user:password@kernel:6806", token: "token", internal: true }), { code: "configuration" });
});

test("partial-save recovery cannot overwrite a later revision", async () => {
  let writes = 0;
  const a = { operate: async (_c, _i, fn) => fn({ input: {} }, () => {}), identity: async () => "library", api: async () => { writes++; } };
  const documents = new Documents(a, {});
  documents.snapshot = async () => ({ revision: "later-revision" });
  await assert.rejects(documents.recover({ op_id: "recover-partial", expected_revision: "observed-partial" }, {
    state: "unknown", target: "library", documentId: "doc", recoveryRevision: "observed-partial", beforeDocument: {},
  }), { code: "content_conflict" });
  assert.equal(writes, 0);
});

test("read documents expose stable block anchors without native metadata", async () => {
  const a = { c: { notebookId: "book", libraryRootId: "root" }, sql: async () => [] };
  const documents = new Documents(a, {}, "http://localhost:6806");
  documents.snapshot = async () => ({ id: "doc", anchor: "block-a", title: "Title", markdown: "Body", revision: "revision", editable: true,
    units: [{ id: "block-a", markdown: "Body", raw: "native metadata", attrs: { secret: "hidden" } }] });
  const result = await documents.get("block-a");
  assert.deepEqual(result.blocks, [{ id: "block-a", markdown: "Body" }]);
  assert.equal(result.anchor, "block-a");
});

test("GFM table normalization compares semantics and remains one editable block", () => {
  const original = "| 字段 | 值 |\n| --- | --- |\n| 检查 | 通过 |";
  const normalized = "|字段|值|\n| ------| ------|\n|检查|通过|";
  assert.equal(markdownChunks(original).length, 1);
  assert.equal(markdownChunks(original)[0].kind, "table");
  assert.equal(markdownEquivalent(original, normalized), true);
  assert.deepEqual(diffBlocks([unit("table-id", normalized)], markdownChunks(original)).changes, []);
  assert.equal(markdownEquivalent(original, normalized.replace("通过", "失败")), false);
  assert.equal(markdownEquivalent("[source](https://one.example)", "[source](https://two.example)"), false);
  assert.equal(markdownEquivalent("![image](assets/one.png)", "![image](assets/two.png)"), false);
  assert.equal(markdownEquivalent("```js\nconst value = 1;\n```", "```js\nconst value = 2;\n```"), false);
  assert.equal(markdownEquivalent("```md\n" + original + "\n```", "```md\n" + normalized + "\n```"), false);
});

async function interruptedCreation(run) {
  const directory = mkdtempSync(join(tmpdir(), "cd-create-resume-"));
  const api = new Siyuan({ url: "http://127.0.0.1:6806", token: "fixture", notebookId: "notebook", libraryRootId: "root", dataDir: directory });
  const documents = new Documents(api, {}), cards = new Map();
  let created = 0, interrupt = true;
  api.identity = async () => "fixture-library";
  api.sql = async (statement) => {
    const key = /WHERE id='([^']+)'/.exec(statement)?.[1];
    return cards.has(key) ? [{ id: key, path: cards.get(key).path }] : [];
  };
  api.newDoc = async (id, title, markdown) => { created++; cards.set(id, { id, title, markdown, attrs: {}, path: "/root/" + id + ".sy" }); };
  api.setAttrs = async (id, attrs) => {
    if (interrupt) { interrupt = false; throw Object.assign(new Error("disconnected"), { code: "transport_unknown" }); }
    Object.assign(cards.get(id).attrs, attrs);
  };
  documents.snapshot = async (id) => cards.get(id);
  documents.get = async (id) => ({ id, title: cards.get(id).title, markdown: cards.get(id).markdown });
  const input = { op_id: "resume-create", document: { title: "One card", markdown: "Original content" } };
  try {
    await assert.rejects(documents.create(input), { code: "transport_unknown" });
    assert.equal(created, 1);
    await run({ api, documents, cards, input, created: () => created });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("interrupted plain-document creation resumes the same request without duplication", async () => {
  await interruptedCreation(async ({ api, documents, cards, input, created }) => {
    await assert.rejects(documents.create({ ...input, document: { ...input.document, title: "Different request" } }), { code: "operation_conflict" });
    const result = await documents.create(input);
    assert.equal(created(), 1); assert.equal(cards.size, 1);
    assert.equal(cards.get(result.id).attrs["custom-cd-complete"], "1");
    assert.equal((await api.receipt(input.op_id)).value.state, "verified");
  });
});
test("creation resume refuses an edited card, schema drift, moved card or foreign request", async () => {
  for (const [change, code] of [
    [card => { card.markdown = "Later edits"; }, "content_conflict"],
    [card => { card.attrs["custom-cd-schema"] = "1"; }, "content_conflict"],
    [card => { card.attrs["custom-cd-kind"] = "article"; }, "content_conflict"],
    [card => { card.path = "/root/other/" + card.id + ".sy"; }, "outside_scope"],
    [card => { card.attrs["custom-cd-request"] = "another-request"; }, "operation_conflict"],
  ]) await interruptedCreation(async ({ documents, cards, input, created }) => {
    const card = cards.values().next().value;
    change(card);
    const before = JSON.stringify(card);
    await assert.rejects(documents.create(input), { code });
    assert.equal(created(), 1); assert.equal(JSON.stringify(card), before);
  });
});

test("reordering equal paragraphs moves their original identities", () => {
  const plan = diffBlocks([unit("a", "First"), unit("b", "Second"), unit("c", "Third")], markdownChunks("Third\n\nSecond\n\nFirst"));
  assert.deepEqual(plan.assigned, ["c", "b", "a"]);
  assert.deepEqual(plan.changes, [{ action: "move", id: "b", previousID: "c" }, { action: "move", id: "a", previousID: "b" }]);
});
test("moved equal content is reserved before pairing edited paragraphs", () => {
  const plan = diffBlocks([unit("a", "First"), unit("b", "Last")], markdownChunks("New\n\nLast\n\nFirst"));
  assert.equal(plan.assigned[2], "a"); assert.equal(plan.assigned[1], "b");
  assert.equal(plan.changes.some((step) => step.action === "update" || step.action === "delete"), false);
  assert.equal(plan.changes.filter((step) => step.action === "insert").length, 1);
});
test("ambiguous native-container reordering fails before producing mutation steps", () => {
  const before = [{ ...unit("a", "First"), parent: "doc" }, { ...unit("b", "Second"), parent: "append-wrapper" }];
  assert.throws(() => diffBlocks(before, markdownChunks("Second\n\nFirst")), { code: "unsupported_structure" });
});

async function interruptedRecovery(run) {
  const directory = mkdtempSync(join(tmpdir(), "cd-recover-interruption-"));
  const api = new Siyuan({ url: "http://127.0.0.1:6806", token: "fixture", dataDir: directory });
  const documents = new Documents(api, {});
  api.identity = async () => "fixture-library";
  const snapshot = (title, body) => ({ id: "doc", title, markdown: body, raw: body, attrs: {}, revision: title + "|" + body, signature: title + "|" + body });
  const beforeSave = snapshot("Before title", "Before body"), saved = snapshot("Saved title", "Saved body");
  let current = structuredClone(saved), interrupt = true, writes = 0;
  const readLocks = [];
  documents.snapshot = async () => { readLocks.push(existsSync(join(directory, "write.lock"))); return structuredClone(current); };
  api.api = async (path, input) => {
    if (path === "/api/block/updateBlock") { writes++; current = snapshot(current.title, input.data); }
    else if (path === "/api/filetree/renameDocByID") {
      if (interrupt) { interrupt = false; throw Object.assign(new Error("rename outcome unknown"), { code: "transport_unknown" }); }
      writes++; current = snapshot(input.title, current.markdown);
    } else assert.fail("unexpected native mutation: " + path);
  };
  api.setAttrs = async () => {};
  api.flush = async () => {};
  const original = { command: "save-document", state: "verified", target: "fixture-library", documentId: "doc", afterRevision: saved.revision, beforeDocument: beforeSave };
  const input = { op_id: "interrupted-recovery", backup_op_id: "original-save", expected_revision: saved.revision };
  try {
    await assert.rejects(documents.recover(input, original), { code: "transport_unknown" });
    const failed = (await api.receipt(input.op_id)).value;
    assert.equal(failed.state, "unknown");
    assert.equal(failed.recoveryRevision, current.revision);
    assert.equal(current.title, saved.title);
    assert.equal(current.markdown, beforeSave.markdown);
    assert.deepEqual(failed.beforeDocument, saved);
    assert.equal(readLocks.every(Boolean), true);
    const writesBeforeRetry = writes;
    await assert.rejects(documents.recover(input, original), { code: "operation_pending" });
    assert.equal(writes, writesBeforeRetry, "an uncertain recovery must not be replayed");
    await run({ api, documents, failed, saved, current: () => structuredClone(current), setCurrent: value => { current = value; }, writes: () => writes });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("an interrupted recovery records a revision and can be undone to its own before state", async () => {
  await interruptedRecovery(async ({ api, documents, failed, saved, current }) => {
    await documents.recover({ op_id: "undo-interrupted-recovery", backup_op_id: "interrupted-recovery", expected_revision: failed.recoveryRevision }, failed);
    assert.deepEqual(current(), saved);
    assert.equal((await api.receipt("undo-interrupted-recovery")).value.state, "verified");
  });
});
test("undoing an interrupted recovery refuses any later document modification", async () => {
  await interruptedRecovery(async ({ documents, failed, current, setCurrent, writes }) => {
    setCurrent({ ...current(), title: "Later title", revision: "later-revision" });
    const before = current(), writesBefore = writes();
    await assert.rejects(documents.recover({ op_id: "undo-after-later-edit", backup_op_id: "interrupted-recovery", expected_revision: failed.recoveryRevision }, failed), { code: "content_conflict" });
    assert.deepEqual(current(), before); assert.equal(writes(), writesBefore);
  });
});

test("list-to-paragraph saves flush the index before restoring surviving block metadata", async () => {
  let flushed=false; const restored=[];
  const a={c:{notebookId:'book'},operate:async(_c,_i,fn)=>fn({input:{op_id:'change-kind'}},()=>{}),
    api:async()=>{flushed=false;}, flush:async()=>{flushed=true;},
    sql:async sql=>{assert.equal(flushed,true);return sql.includes("'list'")?[{id:'list'}]:[];},
    setAttrs:async id=>{restored.push(id);}};
  const docs=new Documents(a,{});
  docs.snapshot=async()=>({id:'doc',title:'标题',editable:true,revision:'before',units:[{id:'list',markdown:'- 原场景',attrs:{},descendants:[{id:'old-child',attrs:{}}]}]});
  docs.confirmSave=async()=>({verified:true});
  assert.deepEqual(await docs.save({id:'doc',title:'标题',markdown:'新描述。',expected_revision:'before'}),{verified:true});
  assert.deepEqual(restored,['list']);
});
