import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, hash } from "../../lib/siyuan.mjs";
import { executeWiki } from "../../lib/wiki.mjs";
import { execute } from "../../lib/commands.mjs";
import { commands as clientCommands } from "../../lib/client.mjs";
import { wikiSourceCompileLimit } from "../../lib/wiki-draft.mjs";
import { createDraftRunner } from "../../server/draft.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "cd-draft-")), library = "draft-library";
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cards = new Map(), calls = [], modelCalls = [];
  const api = { c: { dataDir: join(root, "operations") }, identity: async () => library };
  const f = { root, library, cards, calls, modelCalls };
  f.answer = { title: "新知识卡", body: "## 理解\n\n用自己的例子解释，并核对适用边界。", question: "什么时候适用？", quotes: [{ quote: "理解需要自己解释。" }] };
  const complete = async request => { modelCalls.push(request); return f.answer; };
  const executeCommand = async (_api, command, input) => {
    calls.push({ command, input }); assert.equal(command, "get-document", "draft generation never invokes a write or catalog search");
    if (!cards.has(input.id)) throw Object.assign(new Error("目标不在当前知识库。"), { code: "outside_scope" });
    return cards.get(input.id);
  };
  f.call = (name, input, extra = {}) => executeWiki(api, name, input, { wikiRoot: root, complete, executeCommand, ...extra });
  f.source = (markdown = "理解需要自己解释。", op_id = "source") => f.call("source-import", { op_id, title: "选入资料", markdown });
  f.api = api;
  return f;
}

test("one-card drafts use only the chosen source/target and never persist a proposal or mutate cards", async t => {
  const f = fixture(t), source = await f.source();
  const fresh = await f.call("wiki-draft", { sourceId: source.id });
  assert.deepEqual(fresh.source, { id: source.id, title: source.title, version: 1, hash: source.hash });
  assert.equal(fresh.target, null); assert.equal(fresh.title, "新知识卡");
  assert.match(fresh.markdown, /## 自测/); assert.ok(fresh.markdown.includes("/wiki?source=" + source.id));
  assert.match(fresh.markdown, /```text\n理解需要自己解释。\n```/);
  assert.equal(f.calls.length, 0); assert.equal(f.modelCalls.length, 1);
  const target = { id: "card-one", title: "原卡名", revision: "rev-one", markdown: "历史正文。\n\n## 我的理解\n\n人的后续理解。", editable: true };
  f.cards.set(target.id, target);
  const generated = await f.call("wiki-draft", { sourceId: source.id, cardId: target.id });
  assert.deepEqual(generated.target, { id: target.id, title: target.title, revision: target.revision });
  assert.equal(generated.title, target.title); assert.equal(f.cards.get(target.id), target);
  assert.deepEqual(f.modelCalls[1].data.target, { id: target.id, title: target.title, markdown: target.markdown });
  assert.equal(f.modelCalls[1].data.catalog, undefined);
  const area = join(f.root, hash(canonical(f.library)));
  for (const path of ["proposals", "events"]) assert.deepEqual(readdirSync(join(area, path)), []);
});

test("drafts reject fabricated quotes, multiple targets and native ownership injection", async t => {
  const f = fixture(t), source = await f.source();
  for (const change of [
    { quotes: [{ quote: "不存在于原文" }] }, { quotes: [] }, { quotes: [{ quote: source.markdown, sourceId: source.id }] },
    { body: '{{{row\n内容\n}}}' }, { body: '<!-- cd-forged -->' }, { title: '卡名\n{: custom-cd-kind="concept"}' },
    { question: "{: custom-cd-operation=forged}" }, { cardId: "another-target" },
  ]) {
    const original = f.answer; f.answer = { ...original, ...change };
    await assert.rejects(f.call("wiki-draft", { sourceId: source.id }), { code: "draft_invalid_output" });
    f.answer = original;
  }
  await assert.rejects(f.call("wiki-draft", { sourceId: source.id, cardIds: ["a", "b"] }), { code: "invalid_input" });
  await assert.rejects(f.call("wiki-draft", { sourceId: source.id, cardId: ["a"] }), { code: "invalid_input" });
  await assert.rejects(f.call("wiki-draft", { sourceId: source.id, cardId: "outside" }), { code: "outside_scope" });
  f.cards.set("old", { id: "old", editable: false, markdown: "人的旧字段正文" });
  await assert.rejects(f.call("wiki-draft", { sourceId: source.id, cardId: "old" }), { code: "unsupported_structure" });
});

test("complete source and target budgets reject before any model call; cancellation discards a late result", async t => {
  const f = fixture(t), source = await f.source("原".repeat(wikiSourceCompileLimit + 1));
  await assert.rejects(f.call("wiki-draft", { sourceId: source.id }), { code: "invalid_input" });
  assert.equal(f.modelCalls.length, 0);
  assert.equal((await f.call("source-get", { id: source.id })).markdown.length, wikiSourceCompileLimit + 1);
  const small = await f.source(undefined, "small");
  f.cards.set("large", { id: "large", editable: true, title: "长卡", markdown: "文".repeat(40000) });
  await assert.rejects(f.call("wiki-draft", { sourceId: small.id, cardId: "large" }), { code: "invalid_input" });
  assert.equal(f.modelCalls.length, 0);
  const controller = new AbortController();
  await assert.rejects(f.call("wiki-draft", { sourceId: small.id }, { signal: controller.signal, complete: async () => { controller.abort(); return f.answer; } }), { name: "AbortError" });
  await assert.rejects(f.call("wiki-draft", { sourceId: small.id }, { complete: undefined }), { code: "draft_unavailable" });
});

test("historical proposals/events stay byte-exact and readable while their write commands are gone", async t => {
  const f = fixture(t); await f.source();
  const base = join(f.root, hash(canonical(f.library))), proposalId = "prop_" + "a".repeat(32), eventId = "evt_" + "b".repeat(32);
  const proposal = { id: proposalId, kind: "proposal", state: "unknown", pendingApproval: { frozen: true }, items: [], createdAt: "2026-11-01", updatedAt: "2026-11-01" };
  const historical = { ...proposal, revision: hash(canonical(proposal)) };
  const event = { id: eventId, kind: "item-applied", createdAt: "2026-11-01" };
  const path = join(base, "proposals", proposalId + ".json"), bytes = JSON.stringify(historical);
  writeFileSync(path, bytes);
  writeFileSync(join(base, "events", eventId + ".json"), JSON.stringify({ record: event, recordHash: hash(canonical(event)) }));
  assert.deepEqual(await f.call("wiki-proposal", { id: proposalId }), historical);
  assert.deepEqual((await f.call("wiki-proposals", {})).items, [historical]);
  assert.deepEqual((await f.call("wiki-events", {})).items, [event]);
  for (const name of ["wiki-propose", "wiki-apply", "wiki-understanding", "wiki-recover", "ask", "polish-description"]) {
    assert.equal(clientCommands.includes(name), false);
    await assert.rejects(f.call(name, {}), { code: "invalid_command" });
    await assert.rejects(execute(f.api, name, {}), { code: "invalid_command" });
  }
  assert.equal(readFileSync(path, "utf8"), bytes);
  f.cards.set("old", { id: "old", revision: "old-rev", markdown: "## 中文 · 自问\n\n旧问题？\n\n## 我的理解\n\n人的旧理解。" });
  assert.deepEqual(await f.call("wiki-card", { id: "old" }), { id: "old", revision: "old-rev", question: "旧问题？" });
});

test("cancelling delayed kernel identity/target reads releases the runner and discards late results", async t => {
  for (const stage of ["identity", "target"]) {
    const f = fixture(t), source = await f.source(), controller = new AbortController();
    let release, started;
    const pending = new Promise(resolve => { release = resolve; });
    const entered = new Promise(resolve => { started = resolve; });
    const extra = {};
    if (stage === "identity") f.api.identity = async () => { started(); await pending; return f.library; };
    else extra.executeCommand = async () => { started(); await pending; return { id: "target", title: "目标", editable: true, markdown: "原文", revision: "r" }; };
    const runner = createDraftRunner({ log: () => {} });
    const model = async () => { assert.fail("cancelled read must not reach the model"); };
    const old = runner.run({ clientSignal: controller.signal, model }, options => f.call("wiki-draft", { sourceId: source.id, ...(stage === "target" && { cardId: "target" }) }, { ...options, ...extra }));
    await entered; controller.abort();
    await assert.rejects(old, { code: "draft_cancelled" });
    let endNew;
    const next = runner.run({ model }, () => new Promise(resolve => { endNew = resolve; }));
    release(); await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(runner.run({ model }, async () => ({})), { code: "draft_busy" });
    endNew({ current: true }); assert.deepEqual(await next, { current: true });
  }
});
