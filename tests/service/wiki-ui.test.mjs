import test from "node:test";
import assert from "node:assert/strict";
import { createWikiOperations, decodeWikiSource } from "../../web/wiki-async.mjs";

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

test("late source-A draft cannot replace source-B selection or release generation ownership", async () => {
  const operations = createWikiOperations({ active: true, key: "source-A" });
  const ticket = operations.begin("generate");
  const completion = deferred();
  const state = { source: "B", draft: "正在编辑的B草稿" };
  const result = completion.promise.then(value => {
    if (operations.isCurrent(ticket)) { state.source = value; state.draft = ""; }
  }).finally(() => operations.finish(ticket));
  operations.setView({ active: false, key: "source-A" });
  operations.setView({ active: true, key: "source-B" });
  const sourceRead = operations.begin("source");
  assert.equal(operations.busy(), "generate");
  operations.finish(sourceRead);
  assert.equal(operations.busy(), "generate");
  completion.resolve("迟到的A草稿"); await result;
  assert.deepEqual(state, { source: "B", draft: "正在编辑的B草稿" });
  assert.equal(operations.busy(), "");
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
