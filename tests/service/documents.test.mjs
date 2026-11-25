import test from "node:test";
import assert from "node:assert/strict";
import { diffBlocks, markdownChunks, markdownEquivalent, Documents } from "../../lib/documents.mjs";
import { DatabaseSync } from "node:sqlite";
import { Knowledge } from "../../lib/knowledge.mjs";
import { rawWrite } from "../../lib/raw-write.mjs";
import { execute } from "../../lib/commands.mjs";
import { hash, save, Siyuan } from "../../lib/siyuan.mjs";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
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
    command: "save-document", state: "unknown", target: "library", documentId: "doc",
    recoveryRevision: "observed-partial", recoverySignature: "observed-native", beforeDocument: {},
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

// Exercise the active raw writer with the same native library and receipt store
// as the read tests below. Interrupt after newDoc, before ownership is stamped.
async function interruptedCreation(t) {
  const { api, db, md } = chineseLibrary(t);
  const input = {op_id:"resume-create", id:"20261118000000-newcard", kind:"card",
    identity:await api.identity(), title:"One card", markdown:"Original content", expected_revision:null};
  let created = 0;
  api.newDoc = async (id, title, markdown, parent) => {
    created++;
    const prefix = parent === api.c.libraryRootId ? "/root/" : "/root/" + parent + "/";
    db.prepare("INSERT INTO blocks VALUES (?,?,?,?,?,?,?,?,?)").run(id,id,"book",prefix+id+".sy","d",parent,title,"","20261118000000");
    md.set(id, markdown);
  };
  const write = request => rawWrite(api, "raw-document", request);
  const setAttrs = api.setAttrs;
  api.setAttrs = async () => { throw Object.assign(new Error("disconnected"), {code:"transport_unknown"}); };
  await assert.rejects(write(input), {code:"transport_unknown"});
  api.setAttrs = setAttrs;
  assert.equal(created, 1);
  return {api, db, md, input, write, created:() => created};
}

test("interrupted raw creation resumes one card and preserves its reading's parent", async t => {
  const {api, input, write, created} = await interruptedCreation(t);
  await assert.rejects(write({...input, title:"Different request"}), {code:"operation_conflict"});
  const result = await write(input);
  assert.equal(result.id, input.id);
  assert.equal(created(), 1);
  const reading = await write({...input, op_id:"create-reading", kind:"reading", parent:result.id,
    id:"20261118000001-reading", title:"原文", markdown:"原始内容。"});
  const cardAttrs = await api.attrs(result.id), readingAttrs = await api.attrs(reading.id);
  assert.equal(cardAttrs["custom-cd-complete"], "1");
  assert.equal(readingAttrs["custom-cd-parent"], result.id);
  for (const attrs of [cardAttrs, readingAttrs])
    assert.ok(Object.keys(attrs).every(key => !/locale|language/.test(key)));
  assert.equal((await rawWrite(api, "raw-status", input)).state, "verified");
});

test("raw creation resume refuses native content, path, schema, kind and ownership drift", async t => {
  for (const [name, change] of [
    ["body", ({md,input}) => md.set(input.id, "Later edits")],
    ["path", ({db,input}) => db.prepare("UPDATE blocks SET path=? WHERE id=?").run("/root/other/"+input.id+".sy", input.id)],
    ["schema", ({api,input}) => api.setAttrs(input.id, {"custom-cd-schema":"1"})],
    ["kind", ({api,input}) => api.setAttrs(input.id, {"custom-cd-kind":"article"})],
    ["request", ({api,input}) => api.setAttrs(input.id, {"custom-cd-request":"another-request"})],
  ]) await t.test(name, async subtest => {
    const fixture = await interruptedCreation(subtest);
    const {api, input, md, write, created} = fixture;
    await change(fixture);
    const native = async () => [md.get(input.id), await api.inScope(input.id), await api.attrs(input.id)];
    const before = await native();
    await assert.rejects(write(input), {code:"content_conflict"});
    assert.equal(created(), 1);
    assert.deepEqual(await native(), before);
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
  const original = { command: "save-document", state: "verified", target: "fixture-library", documentId: "doc",
    recoveryRevision: saved.revision, recoverySignature: saved.signature, afterRevision: saved.revision,
    afterSignature: saved.signature, result: {id:"doc", revision:saved.revision}, beforeDocument: beforeSave };
  const input = { op_id: "interrupted-recovery", backup_op_id: "original-save", expected_revision: saved.revision };
  try {
    await assert.rejects(documents.recover(input, original), { code: "transport_unknown" });
    const failed = (await api.receipt(input.op_id)).value;
    assert.equal(failed.state, "unknown");
    assert.equal(failed.recoveryRevision, current.revision);
    assert.equal(failed.recoverySignature, current.signature);
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
  let flushed = false, markdown = "- 原场景";
  const restored = [];
  const a = {c:{notebookId:"book"}, operate:async (command,input,fn) => fn({command,input}, () => {}),
    api:async (_path,input) => { markdown = input.data; flushed = false; }, flush:async () => { flushed = true; },
    sql:async sql => { assert.equal(flushed, true); return sql.includes("'list'") ? [{id:"list"}] : []; },
    setAttrs:async id => { restored.push(id); }};
  const docs = new Documents(a, {});
  docs.snapshot = async () => {
    const descendants = markdown.startsWith("- ") ? [{id:"old-child", attrs:{}}] : [];
    const units = [{id:"list", markdown, attrs:{}, descendants}];
    return {id:"doc", title:"标题", editable:true, raw:markdown, markdown, units,
      revision:hash(markdown), signature:hash(JSON.stringify(units))};
  };
  const result = await docs.save({id:"doc", op_id:"change-kind", title:"标题", markdown:"新描述。",
    expected_revision:hash(markdown)});
  assert.equal(result.markdown, "新描述。");
  assert.deepEqual(restored, ["list"]);
});


test("retired creation and append commands reject even valid requests before contacting the kernel", async () => {
  const api = {identity: async () => assert.fail("retired command contacted the kernel")};
  for (const [command, input] of [
    ["create", {op_id:"card", card:{title:"卡片", understanding:"正文"}}],
    ["create", {op_id:"document", document:{title:"卡片", markdown:"正文"}}],
    ["append", {op_id:"note", id:"20261118000008-aaaaaaa", expected_hash:"a".repeat(64), field:"note", markdown:"正文"}],
  ]) await assert.rejects(execute(api, command, input), {code:"invalid_command"});
});

test("removed language parameters are rejected before any read or write", async () => {
  const api = {identity: async () => assert.fail("obsolete requests must be rejected before contacting the kernel")};
  for (const command of ["list", "search", "get", "get-document", "save-document", "update-block"])
    for (const field of ["locale", "locales", "language", "chineseArticleId"])
      await assert.rejects(execute(api, command, { [field]: "cn" }), { code: "invalid_input" });
  for (const field of ["locale", "locales", "language"])
    await assert.rejects(new Knowledge({}).search({ query: "中文", [field]: "cn" }), { code: "invalid_input" });
});

const fixtureIds = {
  legacy: "20261118000000-aaaaaaa", nameGroup: "20261118000001-aaaaaaa", name: "20261118000002-aaaaaaa",
  descriptionGroup: "20261118000003-aaaaaaa", description: "20261118000004-aaaaaaa", heading: "20261118000005-aaaaaaa",
  reading: "20261118000006-aaaaaaa", readingBody: "20261118000007-aaaaaaa", compact: "20261118000008-aaaaaaa",
  compactBody: "20261118000009-aaaaaaa", sourceGroup: "20261118000010-aaaaaaa", source: "20261118000011-aaaaaaa",
  compactReading: "20261118000012-aaaaaaa", compactReadingBody: "20261118000013-aaaaaaa",
};
function chineseLibrary(t) {
  const directory = mkdtempSync(join(tmpdir(), "cd-chinese-library-"));
  const db = new DatabaseSync(":memory:");
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  db.exec("CREATE TABLE blocks(id,root_id,box,path,type,parent_id,content,subtype,updated); CREATE TABLE attributes(block_id,name,value,UNIQUE(block_id,name));");
  const md = new Map(), readingParents = new Map(), ids = fixtureIds;
  const api = new Siyuan({ url: "http://127.0.0.1:6806", token: "fixture", notebookId: "book", libraryRootId: "root", relationsRootId: "relations", dataDir: directory });
  let writes = 0;
  api.identity = async () => "chinese-library";
  api.sql = async statement => db.prepare(statement).all();
  api.attrs = async id => Object.fromEntries(db.prepare("SELECT name,value FROM attributes WHERE block_id=?").all(id).map(row => [row.name, row.value]));
  api.setAttrs = async (id, attrs) => { for (const [key, value] of Object.entries(attrs)) db.prepare("INSERT OR REPLACE INTO attributes VALUES (?,?,?)").run(id, key, value); };
  api.markdown = async id => { assert.ok(md.has(id), "fixture Markdown exists for " + id); return md.get(id); };
  api.flush = async () => {};
  const add = (id, root, parent, type, content, markdown = content, attrs = {}) => {
    if (type === "d" && attrs["custom-cd-parent"]) readingParents.set(root, parent);
    const path = readingParents.has(root) ? "/root/" + readingParents.get(root) + "/" + root + ".sy" : "/root/" + root + ".sy";
    db.prepare("INSERT INTO blocks VALUES (?,?,?,?,?,?,?,?,?)").run(id, root, "book", path, type, parent, content, type === "h" ? "h2" : "", "20261118000000");
    md.set(id, markdown);
    for (const [key, value] of Object.entries(attrs)) db.prepare("INSERT INTO attributes VALUES (?,?,?)").run(id, key, value);
  };
  const group = (id, child, key, label, value) => {
    const raw = '{{{row\n\n' + value + '\n{: id="' + child + '"}\n\n}}}\n{: id="' + id + '" custom-cd-field="' + key + '"}';
    add(id, ids.legacy, ids.legacy, "s", label, raw, { "custom-cd-field": key });
    add(child, ids.legacy, id, "p", value);
    return raw;
  };
  add(ids.legacy, ids.legacy, "root", "d", "中文旧卡", "", { "custom-cd-kind": "concept", "custom-cd-schema": "1", "custom-cd-legacy-id": "old-card", "custom-cd-meta": JSON.stringify({ id: "old-card", lifecycle_status: "active", version: 3 }) });
  add(ids.heading, ids.legacy, ids.legacy, "h", "中文 · 理解", "## 中文 · 理解");
  const name = group(ids.nameGroup, ids.name, "name", "名称", "中文旧卡");
  const description = group(ids.descriptionGroup, ids.description, "description", "理解", "中文理解：API 与 JavaScript。");
  const source = group(ids.sourceGroup, ids.source, "source_text", "来源", "https://example.org/source");
  md.set(ids.legacy, "## 中文 · 名称\n\n" + name + "\n\n## 中文 · 理解\n\n" + description + "\n\n## 中文 · 来源\n\n" + source);
  add(ids.reading, ids.reading, ids.legacy, "d", "补充阅读", "阅读原文，保留 URL。", { "custom-cd-kind": "article", "custom-cd-parent": ids.legacy });
  add(ids.readingBody, ids.reading, ids.reading, "p", "阅读原文，保留 URL。");
  add(ids.compact, ids.compact, "root", "d", "普通中文卡", "普通中文卡解释：使用 API。\n\n## 出处\n\nhttps://example.org/compact", { "custom-cd-kind": "concept", "custom-cd-schema": "2" });
  add(ids.compactBody, ids.compact, ids.compact, "p", "普通中文卡解释：使用 API。");
  add(ids.compactReading, ids.compactReading, ids.compact, "d", "普通卡补充阅读", "普通卡原文。", { "custom-cd-kind": "article", "custom-cd-parent": ids.compact });
  add(ids.compactReadingBody, ids.compactReading, ids.compactReading, "p", "普通卡原文。");
  api.api = async (path, input) => {
    if (path === "/api/block/getChildBlocks") return db.prepare("SELECT id,type FROM blocks WHERE parent_id=?").all(input.id);
    if (path === "/api/block/updateBlock") {
      writes++;
      const before = md.get(input.id);
      for (const [id, raw] of md) if (raw.includes(before)) md.set(id, raw.replace(before, input.data));
      db.prepare("UPDATE blocks SET content=? WHERE id=?").run(input.data, input.id);
      return [];
    }
    assert.fail("unexpected kernel operation: " + path);
  };
  return { api, db, md, ids, writes: () => writes };
}

async function saveOrdinaryCard(t, { disconnect = true } = {}) {
  const { api, db, md, ids, writes } = chineseLibrary(t);
  const id = ids.compact, child = ids.compactBody;
  // Use one paragraph and no child documents for this save.
  db.prepare("DELETE FROM blocks WHERE root_id=?").run(ids.compactReading);
  md.set(id, md.get(child));
  const docs = new Documents(api, new Knowledge(api));
  const before = await docs.snapshot(id);
  const identity = await api.identity();
  const request = {identity, kind:"card", id, op_id:"ordinary-save", title:before.title,
    markdown:"保存后的正文。", expected_revision:before.revision};
  const native = api.api;
  api.api = async (path, input) => {
    if (path === "/api/filetree/renameDocByID") {
      db.prepare("UPDATE blocks SET content=? WHERE id=?").run(input.title, input.id);
      return;
    }
    return native(path, input);
  };
  let loseFlush = disconnect;
  api.flush = async () => {
    if (loseFlush) {
      loseFlush = false;
      throw Object.assign(new Error("写入后连接中断"), {code:"transport_unknown"});
    }
  };
  const write = () => rawWrite(api, "raw-document", request);
  if (disconnect) await assert.rejects(write(), {code:"transport_unknown"});
  else await write();
  const saved = await docs.snapshot(id);
  assert.equal(saved.markdown, request.markdown);
  assert.notEqual(saved.revision, before.revision);
  const {p: path, value} = await api.receipt(request.op_id);
  assert.equal(value.state, disconnect ? "unknown" : "verified");
  return {api, child, saved, before, path, writes, snapshot:() => docs.snapshot(id),
    status:() => rawWrite(api, "raw-status", {identity, op_id:request.op_id}),
    outcome:() => rawWrite(api, "raw-outcome", {identity, method:"raw-document", request}), write,
    recover:expected_revision => rawWrite(api, "raw-recover", {identity, op_id:"undo-" + expected_revision,
      backup_op_id:request.op_id, expected_revision}),
    order:() => rawWrite(api, "raw-order-readings", {identity, id, op_id:"ordinary-order", readings:[],
      expected_operation:request.op_id})};
}

test("普通保存中断后，状态、结算、重放与恢复保留相同正文下的独立修改", async t => {
  for (const location of ["文档属性", "子块属性"]) await t.test(location, async t => {
    const f = await saveOrdinaryCard(t), receipt = readFileSync(f.path);
    const target = location === "文档属性" ? f.saved.id : f.child;
    await f.api.setAttrs(target, {"custom-user-note":"独立修改"});
    const edited = await f.snapshot();
    assert.equal(edited.markdown, f.saved.markdown);
    assert.equal(edited.revision === f.saved.revision, location === "子块属性");
    assert.notEqual(edited.signature, f.saved.signature);
    const writes = f.writes();
    assert.equal((await f.status()).state, "unknown");
    assert.equal((await f.outcome()).state, "pending");
    await assert.rejects(f.write(), {code:"operation_pending"});
    for (const revision of new Set([f.saved.revision, edited.revision]))
      await assert.rejects(f.recover(revision), {code:"content_conflict"});
    await assert.rejects(f.order(), {code:"content_conflict"});
    assert.deepEqual(await f.snapshot(), edited);
    assert.equal(f.writes(), writes);
    assert.deepEqual(readFileSync(f.path), receipt);
  });
});

test("普通保存中断且原生块未变化时，可确认、结算、重放并恢复", async t => {
  const f = await saveOrdinaryCard(t);
  const writes = f.writes();
  assert.equal((await f.status()).state, "verified");
  assert.equal((await f.outcome()).result.revision, f.saved.revision);
  assert.deepEqual(await f.write(), {id:f.saved.id, revision:f.saved.revision});
  assert.equal(f.writes(), writes);
  await f.recover(f.saved.revision);
  assert.equal((await f.snapshot()).signature, f.before.signature);
});

test("排序使用已完成普通保存的写后版本及原生块身份", async t => {
  for (const change of [false, true]) await t.test(change ? "子块已变" : "原写入", async t => {
    const f = await saveOrdinaryCard(t, {disconnect:false});
    if (change) {
      await f.api.setAttrs(f.child, {"custom-user-note":"独立修改"});
      const edited = await f.snapshot();
      assert.equal(edited.revision, f.saved.revision);
      assert.notEqual(edited.signature, f.saved.signature);
      await assert.rejects(f.order(), {code:"content_conflict"});
      await assert.rejects(f.recover(edited.revision), {code:"content_conflict"});
      assert.deepEqual(await f.snapshot(), edited);
    } else {
      assert.equal((await f.order()).id, f.saved.id);
      assert.equal((await f.api.attrs(f.saved.id))["custom-cd-reading-order"], "[]");
    }
  });
});

test("旧的已完成恢复可用冻结的整棵原生树核对，仍须保留后来同修订的子块属性", async t => {
  for (const drift of [false, true]) await t.test(drift ? "子块已变" : "完整恢复", async t => {
    const f = await saveOrdinaryCard(t, {disconnect:false});
    const restored = await f.recover(f.saved.revision);
    const {p: path, value: receipt} = await f.api.receipt(restored.op_id);
    // Completed legacy recover-document receipts predate write-side signatures.
    delete receipt.recoveryRevision;
    delete receipt.recoverySignature;
    delete receipt.afterSignature;
    save(path, receipt);
    const frozen = readFileSync(path);
    const undo = () => rawWrite(f.api, "raw-recover", {identity:receipt.target, op_id:"undo-legacy-restore",
      backup_op_id:restored.op_id, expected_revision:restored.revision});
    if (drift) {
      await f.api.setAttrs(f.child, {"custom-user-note":"独立修改"});
      const edited = await f.snapshot();
      const writes = f.writes();
      assert.equal(edited.revision, restored.revision);
      assert.notEqual(edited.signature, f.before.signature);
      await assert.rejects(undo(), error => ["invalid_backup","content_conflict"].includes(error.code));
      assert.deepEqual(await f.snapshot(), edited);
      assert.equal(f.writes(), writes);
    } else {
      await undo();
      assert.equal((await f.snapshot()).signature, f.saved.signature);
    }
    assert.deepEqual(readFileSync(path), frozen);
  });
});

test("后续看见完整的恢复目标不能把无写端签名的未决恢复晋升为成功", async t => {
  const f = await saveOrdinaryCard(t, {disconnect:false});
  const restored = await f.recover(f.saved.revision);
  const {p: path, value: receipt} = await f.api.receipt(restored.op_id);
  delete receipt.result;
  delete receipt.recoverySignature;
  delete receipt.afterRevision;
  delete receipt.afterSignature;
  receipt.state = "unknown";
  receipt.recoveryRevision = restored.revision;
  save(path, receipt);
  const pending = readFileSync(path);
  await f.api.setAttrs(f.saved.id, {updated:"20261124000000"});
  const later = await f.snapshot();
  assert.notEqual(later.revision, receipt.recoveryRevision);
  assert.equal(later.signature, f.before.signature);
  const status = await rawWrite(f.api, "raw-status", {identity:receipt.target, op_id:restored.op_id});
  assert.equal(status.state, "unknown");
  assert.equal(status.recovery_revision, undefined);
  const writes = f.writes();
  await assert.rejects(f.recover(f.saved.revision), {code:"operation_pending"});
  assert.equal(f.writes(), writes);
  assert.deepEqual(readFileSync(path), pending);
});

test("Chinese fixed-field and ordinary cards share get/search/readings without language dimensions", async t => {
  const { api, ids } = chineseLibrary(t), knowledge = new Knowledge(api);
  const legacy = await execute(api, "get", { id: "old-card" });
  assert.equal(legacy.id, ids.legacy); assert.equal(legacy.legacyId, "old-card"); assert.equal(legacy.schema, 1);
  assert.equal(legacy.title, "中文旧卡"); assert.equal(legacy.summary, "中文理解：API 与 JavaScript。");
  assert.equal(legacy.content.description, legacy.summary); assert.equal(legacy.version, 3);
  assert.equal(legacy.readings[0].id, ids.reading); assert.match(legacy.readings[0].markdown, /阅读原文/);
  assert.deepEqual(Object.keys(legacy.readings[0]).sort(), ["id", "markdown", "title"]);
  assert.ok(legacy.sections.some(section => section.id === ids.description));
  assert.ok(legacy.sections.some(section => section.id === ids.readingBody));
  assert.ok(legacy.sections.every(section => Object.keys(section).sort().join() === "hash,id,key,markdown"));
  for (const cardId of [ids.legacy, ids.compact]) {
    const card = await knowledge.get(cardId);
    for (const field of ["locale", "locales", "language", "chineseArticleId"]) assert.equal(Object.hasOwn(card, field), false);
  }
  const ordinary = await knowledge.get(ids.compact);
  assert.deepEqual(ordinary.readings, [{ id: ids.compactReading, title: "普通卡补充阅读", markdown: "普通卡原文。" }]);
  assert.ok(ordinary.sections.some(section => section.id === ids.compactReadingBody));
  const results = await execute(api, "search", { query: "API", limit: 20 });
  assert.equal(results.length, 2);
  assert.ok(results.some(card => card.name === "中文旧卡" && card.summary.includes("JavaScript")));
  assert.ok(results.some(card => card.name === "普通中文卡"));
  const documents = new Documents(api, knowledge);
  const detail = await documents.get(ids.legacy);
  assert.equal(detail.editable, false); assert.equal(detail.legacyFixedFields, true);
  assert.deepEqual(detail.readings, [{ id: ids.reading, title: "补充阅读", url: "/?id=" + ids.reading }]);
  assert.equal((await documents.list({ query: "阅读原文" })).items[0].id, ids.legacy);
});

test("Chinese fixed fields retain block writes, original identities and whole-document protection", async t => {
  const { api, ids, md, writes } = chineseLibrary(t), documents = new Documents(api, new Knowledge(api));
  const original = await documents.get(ids.legacy);
  await assert.rejects(documents.save({ id: ids.legacy, op_id: "fixed-whole", title: original.title, markdown: "替换正文", expected_revision: original.revision }), { code: "unsupported_structure" });
  await assert.rejects(execute(api, "update-block", { id: ids.heading, op_id: "fixed-heading", markdown: "## 改标题", expected_hash: hash(md.get(ids.heading)) }), { code: "outside_scope" });
  await assert.rejects(execute(api, "update-block", { id: ids.description, op_id: "fixed-stale", markdown: "新理解", expected_hash: "stale" }), { code: "content_conflict" });
  assert.equal(writes(), 0);
  const result = await execute(api, "update-block", { id: ids.description, op_id: "fixed-edit", markdown: "新的中文理解保留 API。", expected_hash: hash(md.get(ids.description)) });
  assert.equal(result.id, ids.description); assert.equal(writes(), 1);
  const updated = await new Knowledge(api).get("old-card");
  assert.equal(updated.content.description, "新的中文理解保留 API。");
  assert.ok(updated.sections.some(section => section.id === ids.description && section.hash === result.hash));
  assert.equal((await documents.get(ids.legacy)).editable, false);
});

test("duplicate or invalid fixed-field markers still fail safely", async t => {
  const { api, db, ids } = chineseLibrary(t), knowledge = new Knowledge(api);
  db.prepare("UPDATE attributes SET value='name' WHERE block_id=? AND name='custom-cd-field'").run(ids.descriptionGroup);
  await assert.rejects(knowledge.get(ids.legacy), { code: "structure_conflict" });
  db.prepare("UPDATE attributes SET value='unknown' WHERE block_id=? AND name='custom-cd-field'").run(ids.descriptionGroup);
  await assert.rejects(knowledge.get(ids.legacy), { code: "structure_conflict" });
});
