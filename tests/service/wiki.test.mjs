import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeWiki, wikiSourceCompileLimit } from "../../lib/wiki.mjs";
import { createWikiStore } from "../../lib/wiki-store.mjs";
import { Siyuan, fail, hash, normalize } from "../../lib/siyuan.mjs";
import { readableMarkdown } from "../../lib/compact.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "cd-wiki-domain-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dataDir = join(directory, "operations"); mkdirSync(dataDir);
  const docs = new Map(), groups = new Map(); let next = 0;
  const id = () => "20261117000000-" + (++next).toString(36).padStart(7, "0");
  const add = (title = "既有概念", body = "这是人的历史原文。\n\n## 我的理解\n\n原有个人理解。", { legacy = false } = {}) => { const key = id(); docs.set(key, { id: key, title, body, groups: [], legacy }); return key; };
  const raw = key => { const doc = docs.get(key); if (doc) return [doc.body, ...doc.groups.map(k => groups.get(k).raw)].filter(Boolean).join("\n\n"); if (groups.has(key)) return groups.get(key).raw; fail("outside_scope", "不在库内"); };
  const read = key => { const d = docs.get(key); if (!d) fail("outside_scope", "不在库内"); const value = raw(key); return { id: key, title: d.title, markdown: readableMarkdown(normalize(value)), revision: hash({ title: d.title, raw: value }), editable: !d.legacy && d.groups.every(id => Boolean(groups.get(id).operation)) }; };
  const f = { directory, docs, groups, add, read, writes: 0, modelCalls: 0, pick: null, answer: null, throwAfterReceipt: false };
  const api = {
    c: { dataDir, notebookId: "isolated-box" }, origin: "http://kernel",
    identity: async () => "isolated-wiki-test", receipt: Siyuan.prototype.receipt,
    async operate(command, input, perform) {
      const result = await Siyuan.prototype.operate.call(api, command, input, perform);
      if (f.throwAfterReceipt && command === "wiki-append") { f.throwAfterReceipt = false; fail("transport_unknown", "模拟写成后响应丢失"); }
      return result;
    },
    markdown: async key => raw(key),
    async attrs(key) { const g = groups.get(key); if (!g) fail("outside_scope", "不在库内"); return g.operation ? { "custom-cd-operation": g.operation } : {}; },
    async setAttrs(key, values) {
      if (f.failMarkerOnce) { f.failMarkerOnce = false; fail("http_500", "模拟归属标记保存失败"); }
      const g = groups.get(key); if (!g) fail("outside_scope", "不在库内");
      g.operation = values["custom-cd-operation"] ?? g.operation;
      g.raw = g.raw.replace(new RegExp(`\\n\\{: id="${g.id}"[^\\n]*\\}$`), "") + `\n{: id="${g.id}" custom-cd-operation="${g.operation}"}`;
    },
    async flush() { if (f.failFlushOnce) { f.failFlushOnce = false; fail("http_500", "模拟写成后的内核flush失败"); } },
    async target(key) { const g = groups.get(key); if (!g) fail("outside_scope", "不在库内"); return { id: key, type: "s", root_id: g.cardId }; },
    async sql(statement) {
      const operation = /a\.value='([^']+)'/.exec(statement)?.[1];
      if (operation) { const root = /b\.root_id='([^']+)'/.exec(statement)?.[1]; return [...groups.values()].filter(g => g.cardId === root && g.operation === operation).map(g => ({ id: g.id })); }
      const key = /WHERE id='([^']+)'/.exec(statement)?.[1]; return key && groups.has(key) ? [{ id: key }] : [];
    },
    async api(path, input) {
      if (path === "/api/block/appendBlock") {
        const key = id(), operation = /custom-cd-operation="([^"]+)"/.exec(input.data)?.[1];
        let body = input.data.replace(/\n\{: custom-cd-operation="[^"]+"\}$/, "");
        if (f.freshNativeIds) body = body.replace(/\n\n\}\}\}$/, `\n{: id="${id()}"}\n\n}}}`);
        groups.set(key, { id: key, cardId: input.parentID, operation, raw: body + `\n{: id="${key}" custom-cd-operation="${operation}"}` }); docs.get(input.parentID).groups.push(key); f.writes++;
      } else if (path === "/api/block/updateBlock") {
        if (f.rejectNativeReplay && /\{: id=/.test(input.data)) fail("siyuan_error", "block not found");
        const g = groups.get(input.id);
        const data = f.freshNativeIds ? input.data.replace(/\n\n\}\}\}$/, `\n{: id="${id()}"}\n\n}}}`) : input.data;
        // SiYuan's updateBlock reconstructs the root and does not retain this custom attribute.
        g.operation = undefined;
        g.raw = data + `\n{: id="${g.id}"}`; f.writes++;
      } else if (path === "/api/block/deleteBlock") {
        const g = groups.get(input.id); docs.get(g.cardId).groups = docs.get(g.cardId).groups.filter(k => k !== input.id); groups.delete(input.id); f.writes++;
        if (f.failDeleteAfterMutation) { f.failDeleteAfterMutation = false; fail("transport_unknown", "模拟删除后的连接中断"); }
      } else throw Error("Unexpected API " + path);
    },
  };
  const executeCommand = async (_api, command, input) => {
    if (command === "get-document") return read(input.id);
    if (command === "list") return { items: [...docs.values()].map(d => ({ id: d.id, title: d.title })), hasMore: false };
    if (command === "create") return api.operate("create-document", input, async (rec, persist) => { rec.documentId ??= add(input.document.title, input.document.markdown); persist(); return { id: rec.documentId, revision: read(rec.documentId).revision, op_id: input.op_id }; });
    if (command === "operation-status") { const rec = (await api.receipt(input.op_id)).value; return { state: rec?.state ?? "unknown" }; }
    throw Error("Unexpected command " + command);
  };
  const complete = async request => {
    f.modelCalls++;
    let result;
    if (request.data.catalog) result = { cardIds: f.pick ?? request.data.catalog.slice(0, 5).map(c => c.id) };
    else result = { items: f.answer ?? [{ kind: request.data.candidates.length ? "update" : "create", cardId: request.data.candidates[0]?.id ?? "", title: request.data.candidates[0]?.title ?? "新概念", body: "新的解释。\n\n### 边界\n\n仍需结合情境。", question: "什么时候适用？", reason: "原始资料补充了适用边界。", quotes: [{ sourceId: request.data.source.id, quote: request.data.source.markdown }] }] };
    return request.validate ? request.validate(result) : result;
  };
  f.api = api; f.store = createWikiStore(join(directory, "wiki"), "isolated-wiki-test");
  f.call = (command, input = {}, options = {}) => executeWiki(api, command, input, { wikiRoot: join(directory, "wiki"), executeCommand, complete, ...options });
  f.source = (markdown = "原始材料说明：方法需要结合情境。", op_id = "source-one") => f.call("source-import", { op_id, title: "真实原文", markdown });
  f.propose = async source => f.call("wiki-propose", { sourceId: (source ?? await f.source()).id });
  f.approval = p => ({ id: p.id, expected_revision: p.revision, items: p.items.map(i => ({ id: i.id, selected: true, title: i.title, body: i.body, question: i.question })) });
  return f;
}

test("new source compiles into reviewed cards, recall context and real personal writing", async t => {
  const f = fixture(t), source = await f.source(), p = await f.propose(source);
  assert.equal(f.docs.size, 0, "proposing never writes cards");
  const approved = f.approval(p), result = await f.call("wiki-apply", approved);
  assert.equal(result.state, "applied"); assert.equal(f.docs.size, 1);
  const cardId = result.items[0].cardId, context = await f.call("wiki-card", { id: cardId });
  assert.equal(context.question, "什么时候适用？"); assert.equal(context.sources[0].quote, source.markdown);
  const saveInput = { id: cardId, op_id: "my-thought", expected_revision: context.revision, text: "我会先确认边界，再使用这个方法。" };
  await f.call("wiki-understanding", saveInput);
  const after = await f.call("wiki-card", { id: cardId });
  assert.equal(after.understandings.length, 1); assert.equal(after.understandings[0].text, saveInput.text);
  assert.match(f.read(cardId).markdown, /我会先确认边界/);
  await f.call("wiki-understanding", saveInput); assert.equal((await f.call("wiki-card", { id: cardId })).understandings.length, 1);
  assert.equal((await f.call("wiki-proposals")).items.length, 1, "internal learning records are not proposals");
  assert.equal((await f.call("wiki-events")).items.filter(e => e.kind === "understanding-saved").length, 1);
  await f.call("wiki-apply", approved); assert.equal(f.docs.size, 1, "same approval cannot duplicate a card");
});

test("old fixed-field contents remain byte-exact while own AI area can be updated", async t => {
  const f = fixture(t), cardId = f.add("旧结构", "## 中文 · 理解\n\n人的历史原文与链接。\n\n## English\n\nRetain this.", { legacy: true });
  const original = f.docs.get(cardId).body, p = await f.propose();
  assert.equal(p.items[0].kind, "update");
  const applied = await f.call("wiki-apply", f.approval(p));
  assert.equal(applied.state, "applied"); assert.equal(f.docs.get(cardId).body, original);
  const context = await f.call("wiki-card", { id: cardId });
  await f.call("wiki-understanding", { id: cardId, op_id: "legacy-thought", expected_revision: context.revision, text: "这是我自己的推敲。" });
  const next = await f.propose(await f.source("第二份原文补充另一种边界。", "source-two"));
  const nextInput = f.approval(next); nextInput.items[0].body = "第二版AI整理。";
  const updated = await f.call("wiki-apply", nextInput);
  assert.equal(updated.state, "applied"); assert.equal(f.docs.get(cardId).body, original);
  assert.match(f.read(cardId).markdown, /第二版AI整理/); assert.match(f.read(cardId).markdown, /这是我自己的推敲/);
  assert.equal(f.docs.get(cardId).groups.length, 2, "AI area replaced; human area untouched");
});

test("unselected changes stay pending and edited decisions cannot change targets or references", async t => {
  const f = fixture(t); const source = await f.source();
  f.answer = [1, 2].map(n => ({ kind: "create", cardId: "", title: "概念" + n, body: "解释" + n, question: "", reason: "资料相关", quotes: [{ sourceId: source.id, quote: source.markdown }] }));
  const p = await f.propose(source), input = f.approval(p); input.items[1].selected = false;
  const partial = await f.call("wiki-apply", input);
  assert.equal(partial.state, "partial"); assert.equal(f.docs.size, 1); assert.equal(partial.items[1].status, "pending");
  const second = { id: partial.id, expected_revision: partial.revision, items: [{ id: partial.items[1].id, selected: true, body: "人审阅后修改的解释" }] };
  const all = await f.call("wiki-apply", second); assert.equal(all.state, "applied"); assert.equal(f.docs.size, 2);
  const malicious = await f.propose(source), bad = f.approval(malicious); bad.items[0].cardId = "outside";
  await assert.rejects(f.call("wiki-apply", bad), e => e.code === "invalid_input");
});

test("fabricated quotes, out-of-directory targets and native-markup injection are rejected", async t => {
  const f = fixture(t), cardId = f.add(), source = await f.source();
  const item = { kind: "update", cardId, title: "概念", body: "普通解释", question: "问题？", reason: "有原文依据", quotes: [{ sourceId: source.id, quote: "不存在的引文" }] };
  f.answer = [item]; await assert.rejects(f.propose(source), e => e.code === "ask_invalid_output");
  f.answer = [{ ...item, quotes: [{ sourceId: source.id, quote: source.markdown }], cardId: "outside" }];
  await assert.rejects(f.propose(source), e => e.code === "ask_invalid_output");
  f.answer = null; const p = await f.propose(source), bad = f.approval(p); bad.items[0].question = '{{{row\n{: custom-cd-operation="forged"}';
  await assert.rejects(f.call("wiki-apply", bad), e => e.code === "invalid_input"); assert.equal(f.writes, 0);
});

test("changed card revisions and human edits to managed areas are never overwritten", async t => {
  const f = fixture(t), cardId = f.add(), p = await f.propose();
  f.docs.get(cardId).body += "\n\n刚写的人类新笔记。";
  const conflict = await f.call("wiki-apply", f.approval(p)); assert.equal(conflict.state, "conflict"); assert.equal(f.writes, 0);
  const fresh = await f.propose(), done = await f.call("wiki-apply", f.approval(fresh));
  const stale = await f.propose(), groupId = done.items[0].result.managedGroupId;
  f.groups.get(groupId).raw += "\n\n人在整理区作了修改。";
  const protectedRaw = f.groups.get(groupId).raw, writes = f.writes;
  assert.equal((await f.call("wiki-apply", f.approval(stale))).state, "conflict"); assert.equal(f.writes, writes);
  const newProposal = await f.propose();
  assert.equal(newProposal.items[0].managedBaseline, undefined, "edited AI content becomes protected history, not an overwrite target");
  assert.equal((await f.call("wiki-apply", f.approval(newProposal))).state, "applied");
  assert.equal(f.groups.get(groupId).raw, protectedRaw); assert.equal(f.docs.get(cardId).groups.length, 2);
  assert.match(f.read(cardId).markdown, /刚写的人类新笔记/); assert.match(f.read(cardId).markdown, /人在整理区作了修改/);
});

test("write completed before metadata response can resume from original operation without duplication", async t => {
  const f = fixture(t); f.add(); const p = await f.propose(), approval = f.approval(p);
  f.throwAfterReceipt = true;
  const unknown = await f.call("wiki-apply", approval); assert.equal(unknown.state, "unknown"); assert.equal(f.writes, 1);
  assert.deepEqual(unknown.pendingApproval, approval);
  const resumed = await f.call("wiki-apply", approval); assert.equal(resumed.state, "applied"); assert.equal(f.writes, 1);
  await f.call("wiki-apply", approval); assert.equal(f.writes, 1);
  assert.equal((await f.call("wiki-events")).items.filter(e => e.kind === "item-applied").length, 1);
});

test("own area recovery preserves later human writing and refuses changed managed content", async t => {
  const f = fixture(t), cardId = f.add(), p = await f.propose(), applied = await f.call("wiki-apply", f.approval(p));
  const item = applied.items[0], context = await f.call("wiki-card", { id: cardId });
  await f.call("wiki-understanding", { id: cardId, op_id: "later-thought", expected_revision: context.revision, text: "后续人的理解必须保留。" });
  const recovery = { op_id: "recover-area", backup_op_id: item.op_id, expected_hash: item.result.managedHash };
  const restored = await f.call("wiki-recover", recovery); assert.equal(restored.restored, true);
  assert.match(f.read(cardId).markdown, /后续人的理解必须保留/); assert.doesNotMatch(f.read(cardId).markdown, /## AI 整理/);
  await f.call("wiki-recover", recovery);
  const fresh = await f.propose(), written = await f.call("wiki-apply", f.approval(fresh)), other = written.items[0];
  f.groups.get(other.result.managedGroupId).raw += "\n\n人工变化。";
  await assert.rejects(f.call("wiki-recover", { op_id: "reject-area", backup_op_id: other.op_id, expected_hash: other.result.managedHash }), e => e.code === "content_conflict");
});

test("source compilation is bounded before model calls without truncation", async t => {
  const f = fixture(t), source = await f.source("原".repeat(wikiSourceCompileLimit + 1));
  await assert.rejects(f.propose(source), e => e.code === "invalid_input"); assert.equal(f.modelCalls, 0);
  assert.equal((await f.call("source-get", { id: source.id })).markdown.length, wikiSourceCompileLimit + 1);
});

test("recovery reconciles a completed deletion after a lost response and rejects unrelated operation IDs", async t => {
  const f = fixture(t); f.add(); const p = await f.propose(), applied = await f.call("wiki-apply", f.approval(p)), item = applied.items[0];
  const input = { op_id: "recover-lost", backup_op_id: item.op_id, expected_hash: item.result.managedHash };
  f.failDeleteAfterMutation = true;
  await assert.rejects(f.call("wiki-recover", input), e => e.code === "operation_pending");
  const writes = f.writes;
  const result = await f.call("wiki-recover", input);
  assert.equal(result.restored, true); assert.equal(f.writes, writes, "recovery observes the deletion rather than repeating it");
  const fresh = await f.propose(), second = await f.call("wiki-apply", f.approval(fresh)), next = second.items[0];
  await assert.rejects(f.call("wiki-recover", { op_id: next.op_id, backup_op_id: next.op_id, expected_hash: next.result.managedHash }), e => e.code === "operation_conflict");
  assert.equal((await f.call("wiki-proposal", { id: second.id })).items[0].status, "applied");
});

test("append and update flush errors remain reconcilable unknown writes without duplicate mutation", async t => {
  const f = fixture(t), cardId = f.add(), p = await f.propose(), approval = f.approval(p);
  f.failFlushOnce = true;
  const unknown = await f.call("wiki-apply", approval);
  assert.equal(unknown.state, "unknown"); assert.equal(f.writes, 1);
  assert.equal((await f.api.receipt(unknown.items[0].op_id)).value.state, "unknown");
  const reconciled = await f.call("wiki-apply", approval);
  assert.equal(reconciled.state, "applied"); assert.equal(f.writes, 1);
  const source = await f.source("第二份原文解释新的边界。", "update-source"), next = await f.propose(source), nextApproval = f.approval(next);
  f.failFlushOnce = true;
  const uncertainUpdate = await f.call("wiki-apply", nextApproval);
  assert.equal(uncertainUpdate.state, "unknown"); assert.equal(f.writes, 2);
  assert.equal((await f.api.receipt(uncertainUpdate.items[0].op_id)).value.state, "unknown");
  const updated = await f.call("wiki-apply", nextApproval);
  assert.equal(updated.state, "applied"); assert.equal(f.writes, 2);
  assert.match(f.read(cardId).markdown, /原有个人理解/);
});

test("restoration uses Markdown content rather than deleted native identities and can reconcile flush failure", async t => {
  const f = fixture(t); f.freshNativeIds = true; f.rejectNativeReplay = true;
  const cardId = f.add(), original = await f.propose(), first = await f.call("wiki-apply", f.approval(original));
  const before = f.read(cardId).markdown;
  const source = await f.source("第二份原文补充新的限制条件。", "restore-source"), second = await f.propose(source), updated = await f.call("wiki-apply", f.approval(second));
  const item = updated.items[0], request = { op_id: "restore-semantic", backup_op_id: item.op_id, expected_hash: item.result.managedHash };
  f.failFlushOnce = true;
  await assert.rejects(f.call("wiki-recover", request), e => e.code === "operation_pending");
  assert.equal((await f.api.receipt(request.op_id)).value.state, "unknown");
  const count = f.writes;
  assert.equal((await f.call("wiki-recover", request)).restored, true); assert.equal(f.writes, count);
  assert.equal(f.read(cardId).markdown, before);
  assert.equal((await f.call("wiki-card", { id: cardId })).sources[0].id, original.sourceId, "restored native IDs refresh the previous managed-version grant");
  const next = await f.propose(); assert.equal(next.items[0].cardId, cardId, "restored managed content remains updatable");
  await f.call("wiki-recover", request); assert.equal(f.writes, count);
  const originalItem = (await f.call("wiki-proposal", { id: first.id })).items[0];
  await f.call("wiki-recover", { op_id: "remove-restored-area", backup_op_id: originalItem.op_id, expected_hash: originalItem.result.managedHash });
  assert.doesNotMatch(f.read(cardId).markdown, /## AI 整理/); assert.match(f.read(cardId).markdown, /原有个人理解/);
});

test("delete restoration flush failure is checked from its original operation, not repeated", async t => {
  const f = fixture(t), cardId = f.add(), p = await f.propose(), applied = await f.call("wiki-apply", f.approval(p));
  const item = applied.items[0], request = { op_id: "delete-flush", backup_op_id: item.op_id, expected_hash: item.result.managedHash };
  f.failFlushOnce = true;
  await assert.rejects(f.call("wiki-recover", request), e => e.code === "operation_pending");
  const count = f.writes;
  assert.equal((await f.api.receipt(request.op_id)).value.state, "unknown");
  assert.equal((await f.call("wiki-recover", request)).restored, true); assert.equal(f.writes, count);
  assert.match(f.read(cardId).markdown, /原有个人理解/);
});

test("ordinary cards stay editable after AI updates, recovery and another update", async t => {
  const f = fixture(t), source = await f.source(), p = await f.propose(source), first = await f.call("wiki-apply", f.approval(p));
  const cardId = first.items[0].cardId, marker = first.items[0].result.managedMarker;
  assert.equal(f.read(cardId).editable, true);
  const next = await f.propose(await f.source("第二份原文补充使用条件。", "editable-source"));
  const updated = await f.call("wiki-apply", f.approval(next)), item = updated.items[0];
  assert.equal(updated.state, "applied"); assert.equal(f.read(cardId).editable, true);
  assert.equal(f.groups.get(item.result.managedGroupId).operation, marker);
  assert.equal(item.result.managedHash, hash(await f.api.markdown(item.result.managedGroupId)));
  await f.call("wiki-recover", { op_id: "editable-recover", backup_op_id: item.op_id, expected_hash: item.result.managedHash });
  assert.equal(f.read(cardId).editable, true);
  const again = await f.propose(); assert.equal((await f.call("wiki-apply", f.approval(again))).state, "applied");
  assert.equal(f.read(cardId).editable, true);
});

test("unknown update completes a missing root marker before recording its final managed hash", async t => {
  const f = fixture(t); const p = await f.propose(), first = await f.call("wiki-apply", f.approval(p)), cardId = first.items[0].cardId;
  const next = await f.propose(await f.source("补充一条明确边界。", "marker-source")), approval = f.approval(next);
  f.failMarkerOnce = true;
  const unknown = await f.call("wiki-apply", approval), writes = f.writes;
  assert.equal(unknown.state, "unknown"); assert.equal(f.read(cardId).editable, false, "the mock no longer hides native marker loss");
  const done = await f.call("wiki-apply", approval), result = done.items[0].result;
  assert.equal(done.state, "applied"); assert.equal(f.read(cardId).editable, true); assert.equal(f.writes, writes);
  assert.equal(result.managedHash, hash(await f.api.markdown(result.managedGroupId)));
  assert.equal(result.managedMarker, first.items[0].result.managedMarker);
});

test("unknown recovery repairs root ownership without repeating the restored content write", async t => {
  const f = fixture(t); const p = await f.propose(), first = await f.call("wiki-apply", f.approval(p)), cardId = first.items[0].cardId;
  const next = await f.propose(await f.source("另一份材料的新条件。", "restore-marker-source")), updated = await f.call("wiki-apply", f.approval(next)), item = updated.items[0];
  const input = { op_id: "recover-marker", backup_op_id: item.op_id, expected_hash: item.result.managedHash };
  f.failMarkerOnce = true;
  await assert.rejects(f.call("wiki-recover", input), e => e.code === "operation_pending");
  assert.equal(f.read(cardId).editable, false); const writes = f.writes;
  assert.equal((await f.call("wiki-recover", input)).restored, true); assert.equal(f.read(cardId).editable, true); assert.equal(f.writes, writes);
  assert.equal((await f.call("wiki-card", { id: cardId })).sources[0].id, p.sourceId);
});
