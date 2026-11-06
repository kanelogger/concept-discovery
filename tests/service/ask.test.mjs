import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ask } from "../../lib/ask.mjs";
import { askEvidence } from "../../lib/ask-evidence.mjs";
import { Documents } from "../../lib/documents.mjs";
import { createApp } from "../../server/app.mjs";
import { chatCompletions, loadModelConfig } from "../../server/model.mjs";
import { createAskRunner } from "../../server/ask.mjs";

const origin = "http://127.0.0.1";
const updated = "20261106010000";
const excerpt = "上线前验证可回滚的最小改动，并记录故障隔离步骤。";

function library() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE blocks(id,root_id,box,path,type,content,updated);
    CREATE TABLE attributes(block_id,name,value);
    CREATE INDEX blocks_root ON blocks(root_id);
    CREATE UNIQUE INDEX blocks_id ON blocks(id);
    CREATE INDEX attrs_block ON attributes(block_id)`);
  const insert = db.prepare("INSERT INTO blocks VALUES (?, ?, ?, ?, ?, ?, ?)");
  const add = (id, root, path, type, content, { box = "box", date = updated } = {}) =>
    insert.run(id, root, box, path, type, content, date);
  const attr = (id, name, value) => db.prepare("INSERT INTO attributes VALUES (?, ?, ?)").run(id, name, value);
  add("parent", "parent", "/root/folder/parent.sy", "d", "上线检查");
  attr("parent", "custom-cd-schema", "1");
  attr("parent", "custom-cd-kind", "concept");
  add("body", "parent", "/root/folder/parent.sy", "p", excerpt);
  add("plain", "plain", "/root/plain.sy", "d", "边界条件");
  add("plain-body", "plain", "/root/plain.sy", "p", "资料缺口需要核实。");
  function reading(id, path, text, options = {}) {
    add(id, id, path, "d", id, options);
    attr(id, "custom-cd-kind", options.kind ?? "article");
    attr(id, "custom-cd-parent", "parent");
    add(id + "-body", id, path, "p", text, options);
  }
  reading("legacy", "/root/folder/parent/legacy.sy", "先演练回退，再确认发布窗口。");
  reading("outside", "/elsewhere/parent/outside.sy", "非库资料", { date: "20990101000000" });
  reading("misplaced", "/root/other/misplaced.sy", "错位资料", { date: "20990101000000" });
  reading("wrongbox", "/root/folder/parent/wrongbox.sy", "异库资料", { box: "elsewhere", date: "20990101000000" });
  reading("internal", "/root/folder/parent/internal.sy", "内部标记", { kind: "relation", date: "20990101000000" });
  add("fake-path", "parent", "/outside/forged.sy", "p", "伪造块", { date: "20990101000000" });
  const sql = [];
  const api = {
    origin: "http://kernel:6806",
    c: { notebookId: "box", libraryRootId: "root", token: "fake-kernel-key" },
    identity: async () => "isolated-fixture",
    sql: async statement => { sql.push(statement); return db.prepare(statement).all(); },
    markdown: async () => "## 标签\n\n合成",
  };
  return { api, db, add, sql };
}

test("the list and evidence use the same legitimate reading paths, types and parent links", async t => {
  const f = library();
  t.after(() => f.db.close());
  const docs = new Documents(f.api, {});
  for (const query of ["非库资料", "错位资料", "异库资料", "内部标记", "伪造块"]) {
    const result = await docs.list({ query });
    assert.equal(result.total, 0, query);
    assert.deepEqual(await askEvidence(f.api, [query]), [], query);
  }
  const ordinary = await docs.list({ query: "缺口", tag: "合成" });
  assert.deepEqual(ordinary.items.map(item => item.id), ["plain"]);
  const legitimate = await docs.list({ query: "演练回退" });
  assert.equal(legitimate.total, 1);
  assert.equal(legitimate.items[0].updated, updated);
  const [card] = await askEvidence(f.api, ["演练回退"]);
  assert.equal(card.id, "parent");
  assert.deepEqual(card.evidence[0], { id: "e1", text: "先演练回退，再确认发布窗口。", readingId: "legacy", readingTitle: "legacy" });

  docs.snapshot = async () => ({ id: "parent", title: "上线检查", attrs: {}, markdown: excerpt, units: [] });
  const detail = await docs.get("parent");
  assert.deepEqual(detail.readings.map(reading => reading.id), ["legacy"]);
  assert.equal(detail.updated, updated);
});

test("candidate reads and evidence stay bounded and retain hits late in long passages", async t => {
  const f = library();
  t.after(() => f.db.close());
  for (let i = 0; i < 30; i++) {
    const id = "card-" + String(i).padStart(2, "0");
    const path = "/root/" + id + ".sy";
    f.add(id, id, path, "d", "共有名词");
    for (let n = 0; n < 5; n++) {
      f.add(id + "-" + n, id, path, "p", "🧪".repeat(1100) + "共有名词_%" + "甲".repeat(1100));
    }
  }
  const cards = await askEvidence(f.api, ["共有名词", "_%"]);
  assert.equal(cards.length, 8);
  assert.equal(cards[0].id, "card-00");
  assert.equal(f.sql.length, 10);
  assert.ok(f.sql.slice(0, 2).every(statement => statement.endsWith("LIMIT 20")));
  assert.ok(f.sql.slice(2).every(statement => statement.endsWith("LIMIT 3")));
  let characters = 0;
  for (const card of cards) {
    assert.ok(card.evidence.length <= 3);
    const length = card.evidence.reduce((total, e) => total + Array.from(e.text).length, 0);
    assert.ok(length <= 2000);
    characters += length;
    assert.match(card.evidence[0].text, /共有名词_%/);
  }
  assert.ok(characters <= 16000);
});

function mockAnswer(data) {
  const card = data.candidates[0];
  const evidenceIds = [card.evidence[0].id];
  return {
    status: "answered",
    cards: [{ cardId: card.id, evidenceIds, reason: "资料适用于上线风险排查。", boundary: "适合用在变更前。具体风险仍需团队确认。" }],
    steps: [{ action: "列出最小改动的回滚步骤，并在发布前完成一次验证。", evidenceIds }],
    gaps: [],
  };
}
const completion = value => new Response(JSON.stringify({
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }],
  usage: { prompt_tokens: 13, completion_tokens: 8 },
}));

test("ask performs bounded two-stage analysis, hydrates quotations and distinguishes inadequate evidence", async t => {
  const f = library();
  t.after(() => f.db.close());
  const calls = [];
  const complete = async request => {
    calls.push(request);
    return calls.length === 1 ? { queries: ["上线", "上线"] } : mockAnswer(request.data);
  };
  const result = await ask(f.api, { question: "  怎么做上线检查？  " }, { publicUrl: origin, complete });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].maxTokens, 512);
  assert.equal(calls[1].maxTokens, 4096);
  assert.deepEqual(calls[0].data, { question: "怎么做上线检查？" });
  assert.equal(result.cards[0].title, "上线检查");
  assert.equal(result.cards[0].url, origin + "/cards/parent");
  assert.equal(result.cards[0].evidence[0].text, excerpt);
  assert.deepEqual(result.steps[0].cardIds, ["parent"]);
  assert.equal(f.sql.filter(s => s.endsWith("LIMIT 20")).length, 1);
  let missCalls = 0;
  const miss = await ask(f.api, { question: "找偏远星系" }, {
    complete: async () => { missCalls++; return { queries: ["偏远星系"] }; },
  });
  assert.equal(miss.status, "no_match");
  assert.deepEqual(miss.cards, []);
  assert.equal(missCalls, 1);
  const gap = await ask(f.api, { question: "上线审批由哪位同事负责" }, {
    complete: async ({ data }) => data.candidates
      ? { status: "insufficient", cards: [], steps: [], gaps: ["资料缺少审批分工。"] }
      : { queries: ["上线"] },
  });
  assert.equal(gap.status, "insufficient");
  assert.deepEqual(gap.gaps, ["资料缺少审批分工。"]);
  await assert.rejects(ask(f.api, { question: " " }, { complete }), { code: "invalid_ask_question" });
});

test("unretrieved cards, cross-card references, extra output fields and invalid queries fail closed", async t => {
  const f = library();
  t.after(() => f.db.close());
  for (const corrupt of [
    value => { value.cards[0].cardId = "outside"; },
    value => { value.cards[0].evidenceIds = ["unretrieved"]; },
    value => { value.cards[0].quote = "编造"; },
    value => { value.steps[0].evidenceIds = ["e99"]; },
  ]) {
    await assert.rejects(ask(f.api, { question: "上线怎么准备？" }, {
      complete: async ({ data }) => {
        if (!data.candidates) return { queries: ["上线"] };
        const value = mockAnswer(data);
        corrupt(value);
        return value;
      },
    }), { code: "ask_invalid_output" });
  }
  await assert.rejects(ask(f.api, { question: "上线怎么准备？" }, {
    complete: async () => ({ queries: Array(5).fill("上线") }),
  }), { code: "ask_invalid_output" });
});

test("model configuration requires a secret file and permits HTTPS or local test endpoints", () => {
  const profile = { baseUrl: "https://model.invalid/v1/", model: "demo", apiKeyFile: "model-key" };
  const config = loadModelConfig(profile, path => { assert.equal(path, "model-key"); return "test-only"; });
  assert.equal(config.url, "https://model.invalid/v1/chat/completions");
  assert.equal(config.maxTokenField, "max_completion_tokens");
  assert.equal(loadModelConfig({ ...profile, baseUrl: "http://127.0.0.1:9142/v1", maxTokenField: "max_tokens" }, () => "test-only").maxTokenField, "max_tokens");
  for (const baseUrl of ["http://remote.invalid/v1", "https://model.invalid/v1?secret=x", "https://key@model.invalid/"]) {
    assert.equal(loadModelConfig({ ...profile, baseUrl }, () => assert.fail("unsafe profile read the key")), null);
  }
  assert.equal(loadModelConfig(profile, () => { throw new Error("missing"); }), null);
});

async function appFixture(t, { modelFetch, askTimeoutMs, enabled = true, logAsk } = {}) {
  const f = library();
  const server = createApp({
    api: f.api, publicUrl: origin, agentToken: "fake-agent-key", accessCode: "fake-access-code",
    llm: enabled ? { url: "https://model.invalid/v1/chat/completions", model: "fixture", apiKey: "fake-model-key", maxTokenField: "max_tokens" } : null,
    modelFetch, askTimeoutMs, logAsk: logAsk ?? (() => {}),
  });
  await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
  const url = origin + ":" + server.address().port;
  t.after(async () => {
    await new Promise(ok => { server.close(ok); server.closeAllConnections(); });
    f.db.close();
  });
  const post = (path, body, options = {}) => fetch(url + path, {
    method: "POST", body: JSON.stringify(body),
    ...options, headers: { "Content-Type": "application/json", ...options.headers },
  });
  const authenticate = async () => {
    const response = await post("/api/session", { accessCode: "fake-access-code" }, { headers: { origin } });
    assert.equal(response.status, 200);
    return { cookie: response.headers.get("set-cookie"), origin };
  };
  const command = (name, input, options) => post("/api/v1/commands/" + name, input, options);
  return { authenticate, command, url };
}
const bearer = { authorization: "Bearer fake-agent-key" };
const input = { question: "项目上线前怎样排查失败风险？" };

test("browser session and CLI command transport return the same grounded result, with safe model error mapping", async t => {
  const posted = [];
  const logs = [];
  let rejectProvider = false;
  const fixture = await appFixture(t, {
    modelFetch: async (url, options) => {
      assert.equal(url, "https://model.invalid/v1/chat/completions");
      assert.equal(options.headers.Authorization, "Bearer fake-model-key");
      assert.equal(options.redirect, "error");
      const body = JSON.parse(options.body);
      posted.push(body);
      const data = JSON.parse(body.messages[1].content);
      if (rejectProvider) return new Response("provider diagnostic fake-model-key", { status: 401 });
      return completion(data.candidates ? mockAnswer(data) : { queries: ["上线"] });
    },
    logAsk: log => logs.push(log),
  });
  const { command, authenticate } = fixture;
  assert.equal((await command("ask", input)).status, 401);
  const session = await authenticate();
  assert.equal((await command("ask", input, { headers: { cookie: session.cookie } })).status, 403);
  const web = await (await command("ask", input, { headers: session })).json();
  const cli = await (await command("ask", input, { headers: bearer })).json();
  assert.equal(web.ok, true);
  assert.deepEqual(web, cli);
  assert.deepEqual(posted.map(body => body.max_tokens), [512, 4096, 512, 4096]);
  assert.ok(posted.every(body => body.response_format.type === "json_object" && body.stream === false && !("tools" in body)));
  assert.doesNotMatch(JSON.stringify(posted), /fake-(kernel|agent)-key|非库资料|内部标记/);
  assert.deepEqual(logs.map(log => [log.modelCalls, log.cards, log.promptTokens]), [[2, 1, 26], [2, 1, 26]]);
  assert.doesNotMatch(JSON.stringify(logs), /fake-|上线|回滚/);

  rejectProvider = true;
  const error = await command("ask", input, { headers: session });
  assert.equal(error.status, 503);
  assert.doesNotMatch(await error.text(), /fake-model-key|provider diagnostic/);
  assert.equal((await command("list", {}, { headers: session })).status, 200);
});

test("missing model configuration keeps ordinary list usable and reports the disabled capability", async t => {
  const { authenticate, command, url } = await appFixture(t, { enabled: false });
  const session = await authenticate();
  const state = await (await fetch(url + "/api/session", { headers: session })).json();
  assert.deepEqual(state.data, { authenticated: true, askAvailable: false });
  assert.equal((await command("ask", input, { headers: session })).status, 503);
  assert.equal((await command("list", {}, { headers: session })).status, 200);
});

const untilAbort = signal => new Promise((_, reject) => {
  if (signal.aborted) reject(signal.reason);
  else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});

test("a cancelled request aborts the provider, rejects overlap, and releases the slot", async t => {
  const entered = Promise.withResolvers();
  const stopped = Promise.withResolvers();
  let wait = true;
  const { command } = await appFixture(t, {
    modelFetch: async (_url, { signal }) => {
      if (!wait) return completion({ queries: ["无匹配词"] });
      entered.resolve();
      return untilAbort(signal);
    },
    logAsk: log => stopped.resolve(log.error),
  });
  const controller = new AbortController();
  const pending = assert.rejects(command("ask", input, { headers: bearer, signal: controller.signal }), { name: "AbortError" });
  await entered.promise;
  assert.equal((await command("ask", input, { headers: bearer })).status, 429);
  controller.abort();
  await pending;
  assert.equal(await stopped.promise, "ask_cancelled");
  wait = false;
  assert.equal((await (await command("ask", input, { headers: bearer })).json()).data.status, "no_match");
});

test("session logout aborts an in-flight analysis on the server", async t => {
  const entered = Promise.withResolvers();
  const { command, authenticate, url } = await appFixture(t, {
    modelFetch: async (_url, { signal }) => { entered.resolve(signal); return untilAbort(signal); },
  });
  const session = await authenticate();
  const pending = command("ask", input, { headers: session });
  const signal = await entered.promise;
  assert.equal((await fetch(url + "/api/session", { method: "DELETE", headers: session })).status, 200);
  assert.equal((await pending).status, 401);
  assert.equal(signal.aborted, true);
});

test("model timeout and malformed provider envelopes return distinct 504 and 502 responses", async t => {
  const { command } = await appFixture(t, {
    askTimeoutMs: 50,
    modelFetch: async (_url, { signal, body }) => JSON.parse(JSON.parse(body).messages[1].content).question === "等待"
      ? untilAbort(signal) : new Response(JSON.stringify({ choices: [{ message: { content: "unexpected prose" } }] })),
  });
  assert.equal((await command("ask", { question: "等待" }, { headers: bearer })).status, 504);
  assert.equal((await command("ask", input, { headers: bearer })).status, 502);
});

test("cancellation during scoped retrieval reaches SQL and skips model synthesis", async () => {
  const entered = Promise.withResolvers();
  const controller = new AbortController();
  let modelCalls = 0;
  const api = {
    c: { notebookId: "box", libraryRootId: "root" },
    identity: async () => "isolated-fixture",
    sql: (_statement, { signal }) => { entered.resolve(signal); return untilAbort(signal); },
  };
  const task = assert.rejects(ask(api, input, {
    signal: controller.signal,
    complete: async () => { modelCalls++; return { queries: ["上线"] }; },
  }), { name: "AbortError" });
  assert.equal(await entered.promise, controller.signal);
  controller.abort();
  await task;
  assert.equal(modelCalls, 1);
});

test("reading the second response body spends the remaining shared deadline", async t => {
  const f = library();
  t.after(() => f.db.close());
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const secondBody = Promise.withResolvers();
  let calls = 0;
  const complete = chatCompletions({
    url: "https://model.invalid/v1/chat/completions", apiKey: "synthetic-key", model: "test", maxTokenField: "max_tokens",
  }, async (_url, { signal }) => {
    calls++;
    if (calls === 1) {
      started.resolve();
      await release.promise;
      return completion({ queries: ["上线"] });
    }
    let sent = false;
    return new Response(new ReadableStream({
      start(stream) {
        signal.addEventListener("abort", () => stream.error(signal.reason), { once: true });
      },
      pull(stream) {
        if (!sent) {
          sent = true;
          stream.enqueue(Buffer.from('{"choices":'));
          return;
        }
        secondBody.resolve(signal);
        return untilAbort(signal).catch(() => {});
      },
    }));
  });
  const runner = createAskRunner(complete, { timeoutMs: 100, log: () => {} });
  const client = new AbortController();
  const task = assert.rejects(runner.run({ clientSignal: client.signal }, options => ask(f.api, input, options)), { code: "ask_timeout" });
  await started.promise;
  t.mock.timers.tick(60);
  release.resolve();
  const signal = await secondBody.promise;
  t.mock.timers.tick(39);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await task;
  assert.equal(signal.aborted, true);
  assert.equal(calls, 2);
});
