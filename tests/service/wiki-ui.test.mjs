import test from "node:test";
import assert from "node:assert/strict";
import { clearSavedUnderstandingDraft, createWikiOperations, decodeWikiSource, latestWikiSources, reviewedWikiChoice } from "../../web/wiki-async.mjs";

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

test("late A generation cannot replace B review, and source read cannot release generation ownership", async () => {
  const operations = createWikiOperations({ active: true, key: "source-A" });
  const ticket = operations.begin("generate");
  const completion = deferred();
  const state = { proposal: "B", draft: "正在编辑的B草稿" };
  const result = completion.promise.then(value => {
    if (operations.isCurrent(ticket)) { state.proposal = value; state.draft = ""; }
  }).finally(() => operations.finish(ticket));
  operations.setView({ active: false, key: "source-A" });
  operations.setView({ active: true, key: "source-B" });
  const sourceRead = operations.begin("source");
  assert.equal(operations.busy(), "generate");
  operations.finish(sourceRead);
  assert.equal(operations.busy(), "generate");
  assert.equal(operations.hasMutation(), true);
  completion.resolve("迟到的A提案"); await result;
  assert.deepEqual(state, { proposal: "B", draft: "正在编辑的B草稿" });
  assert.equal(operations.busy(), "");
});

test("a hidden same-card understanding response does not refresh or evict the newer editor", async () => {
  const operations = createWikiOperations({ active: true, key: "card-A" });
  const ticket = operations.begin("understanding");
  const completion = deferred();
  let onSavedCalls = 0;
  let editorDraft = "新的编辑草稿";
  let stored = false;
  const result = completion.promise.then(() => {
    stored = true;
    if (operations.isCurrent(ticket)) { onSavedCalls++; editorDraft = ""; }
  }).finally(() => operations.finish(ticket));
  operations.setView({ active: false, key: "card-A" });
  completion.resolve(); await result;
  assert.equal(stored, true);
  assert.equal(onSavedCalls, 0);
  assert.equal(editorDraft, "新的编辑草稿");
});

test("returning to the same card does not revive an older response epoch", () => {
  const operations = createWikiOperations({ active: true, key: "card-A" });
  const old = operations.begin("understanding");
  operations.setView({ active: false, key: "card-A" });
  operations.setView({ active: true, key: "card-A" });
  assert.equal(operations.isCurrent(old), false);
  const current = operations.begin("source");
  assert.equal(operations.isCurrent(current), true);
  operations.finish(old);
  assert.equal(operations.busy(), "source");
  operations.finish(current);
  assert.equal(operations.isCurrent(current), false);
});

test("source view changes invalidate previous reads without releasing a newer read", () => {
  const operations = createWikiOperations({ active: true, key: "source-A" });
  const a = operations.begin("source");
  operations.changeView("source-B");
  const b = operations.begin("proposal");
  assert.equal(operations.isCurrent(a), false);
  operations.finish(a);
  assert.equal(operations.busy(), "proposal");
  assert.equal(operations.isCurrent(b), true);
});

test("file decoding preserves valid Chinese and rejects invalid UTF-8 without changing a draft", () => {
  const chinese = "原始中文\r\n第二行，含合法替换字符：�。";
  assert.equal(decodeWikiSource(new TextEncoder().encode(chinese)), chinese);
  let draft = "必须保留的当前草稿";
  assert.throws(() => { draft = decodeWikiSource(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])); }, /UTF-8/);
  assert.equal(draft, "必须保留的当前草稿");
  assert.throws(() => decodeWikiSource(new Uint8Array([0xe4, 0xb8])), /UTF-8/);
});

test("review payload preserves update titles while allowing create titles to be edited", () => {
  const update = { id: "update", kind: "update", status: "pending", title: "原卡", before: { title: "原卡标题" }, body: "正文", question: "问题" };
  const edit = { selected: true, title: "误改的标题", body: "审阅后的正文", question: "审阅后的问题" };
  assert.deepEqual(reviewedWikiChoice(update, edit), { id: "update", selected: true, title: "原卡标题", body: "审阅后的正文", question: "审阅后的问题" });
  assert.equal(reviewedWikiChoice({ ...update, kind: "create" }, edit).title, "误改的标题");
  assert.equal(reviewedWikiChoice({ ...update, status: "applied" }, edit).selected, false);
});

test("hidden understanding success clears only the saved same-card draft before returning", async () => {
  const operations = createWikiOperations({ active: true, key: "card-A" });
  const ticket = operations.begin("understanding");
  const completion = deferred();
  let draft = { cardId: "card-A", text: "已提交的理解" };
  const saved = { ...draft };
  let refreshCalls = 0;
  const result = completion.promise.then(() => {
    draft = clearSavedUnderstandingDraft(draft, saved);
    if (operations.isCurrent(ticket)) refreshCalls++;
  }).finally(() => operations.finish(ticket));
  operations.setView({ active: false, key: "card-A" });
  completion.resolve(); await result;
  operations.setView({ active: true, key: "card-A" });
  assert.equal(refreshCalls, 0);
  assert.equal(draft.text, "");
  assert.equal(Boolean(draft.text.trim()), false, "returning does not revive a saved dirty draft or enable duplicate append");
  const newerDraft = { cardId: "card-A", text: "后来新输入的理解" };
  assert.equal(clearSavedUnderstandingDraft(newerDraft, saved), newerDraft);
  const otherCard = { cardId: "card-B", text: saved.text };
  assert.equal(clearSavedUnderstandingDraft(otherCard, saved), otherCard);
});

test("source groups choose their maximum version regardless of snapshot list order", () => {
  const sources = [
    { sourceId: "A", id: "A3", version: 3, title: "第三版标题" },
    { sourceId: "B", id: "B2", version: 2, title: "B标题" },
    { sourceId: "A", id: "A1", version: 1, title: "旧版标题" },
    { sourceId: "A", id: "A2", version: 2, title: "第二版标题" },
  ];
  assert.equal(latestWikiSources(sources).find(source => source.sourceId === "A").id, "A3");
  assert.equal(latestWikiSources([...sources].reverse()).find(source => source.sourceId === "A").title, "第三版标题");
  assert.equal(latestWikiSources(sources).length, 2);
  assert.deepEqual(sources.map(source => source.id), ["A3", "B2", "A1", "A2"]);
});
