import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, hash } from "../../lib/siyuan.mjs";
import { executeWiki } from "../../lib/wiki.mjs";
import { execute } from "../../lib/commands.mjs";
import { commands as clientCommands } from "../../lib/client.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "cd-wiki-")), library = "wiki-library";
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cards = new Map();
  const api = { c: { dataDir: join(root, "operations") }, identity: async () => library };
  const executeCommand = async (_api, command, { id }) => {
    assert.equal(command, "get-document");
    return cards.get(id);
  };
  const call = (name, input) => executeWiki(api, name, input, { wikiRoot: root, executeCommand });
  return { root, library, api, cards, call };
}

test("historical proposals/events stay byte-exact and readable while their write commands are gone", async t => {
  const f = fixture(t);
  const base = join(f.root, hash(canonical(f.library))), proposalId = "prop_" + "a".repeat(32), eventId = "evt_" + "b".repeat(32);
  const proposal = { id: proposalId, kind: "proposal", state: "unknown", pendingApproval: { frozen: true }, items: [], createdAt: "2026-11-01", updatedAt: "2026-11-01" };
  const historical = { ...proposal, revision: hash(canonical(proposal)) };
  const event = { id: eventId, kind: "item-applied", createdAt: "2026-11-01" };
  const path = join(base, "proposals", proposalId + ".json"), bytes = JSON.stringify(historical);
  mkdirSync(join(base, "proposals"), { recursive: true });
  mkdirSync(join(base, "events"));
  writeFileSync(path, bytes);
  writeFileSync(join(base, "events", eventId + ".json"), JSON.stringify({ record: event, recordHash: hash(canonical(event)) }));
  assert.deepEqual(await f.call("wiki-proposal", { id: proposalId }), historical);
  assert.deepEqual((await f.call("wiki-proposals", {})).items, [historical]);
  assert.deepEqual((await f.call("wiki-events", {})).items, [event]);
  (await f.call("wiki-proposal", {id:proposalId})).pendingApproval.frozen = false;
  assert.deepEqual(await f.call("wiki-proposal", {id:proposalId}), historical);
  for (const name of ["source-import", "wiki-draft", "wiki-propose", "wiki-apply", "wiki-understanding", "wiki-recover", "ask", "polish-description"]) {
    assert.equal(clientCommands.includes(name), false);
    await assert.rejects(f.call(name, {}), { code: "invalid_command" });
    await assert.rejects(execute(f.api, name, {}), { code: "invalid_command" });
  }
  assert.equal(readFileSync(path, "utf8"), bytes);
  f.cards.set("old", { id: "old", revision: "old-rev", markdown: "## 中文 · 自问\n\n旧问题？\n\n## 我的理解\n\n人的旧理解。" });
  assert.deepEqual(await f.call("wiki-card", { id: "old" }), { id: "old", revision: "old-rev", question: "旧问题？" });
});

test("reading a card question does not depend on the archive filesystem", async t => {
  const f = fixture(t);
  const wikiRoot = join(f.root, "unavailable");
  writeFileSync(wikiRoot, "not a directory");
  const input = {id:"block-id"};
  let reads = 0;
  const options = {wikiRoot, executeCommand: async (api, name, {id}) => {
    reads++;
    assert.equal(name, "get-document");
    assert.equal(id, input.id);
    return {id:"resolved-card", revision:"same-version", markdown:"## 自测：为什么？"};
  }};
  assert.deepEqual(await executeWiki(f.api, "wiki-card", input, options),
    {id:"resolved-card", revision:"same-version", question:"为什么？"});
  await assert.rejects(executeWiki(f.api, "sources-list", {}, options), {code:"outside_scope"});
  await assert.rejects(executeWiki(f.api, "wiki-card", input, {...options, signal:AbortSignal.abort()}), {name:"AbortError"});
  assert.equal(reads, 1);
});

test("cancelling during a card identity check avoids starting the document read", async () => {
  const controller = new AbortController();
  const api = {identity: async ({signal}) => {
    assert.equal(signal, controller.signal);
    controller.abort();
    return "library";
  }, inScope: () => assert.fail("document read after cancellation")};
  await assert.rejects(executeWiki(api, "wiki-card", {id:"20261123000000-aaaaaaa"},
    {signal:controller.signal}), {name:"AbortError"});
});
