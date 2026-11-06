import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ask } from "../../lib/ask.mjs";
import { askCatalog, askEvidence } from "../../lib/ask-evidence.mjs";
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
  assert.ok(f.sql.slice(2).every(statement => statement.endsWith("LIMIT 12")));
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
  assert.equal(calls[0].maxTokens, 1024);
  assert.equal(calls[1].maxTokens, 4096);
  assert.equal(calls[0].data.question, "怎么做上线检查？");
  assert.deepEqual(calls[0].data.catalog, [{title:"上线检查",description:""}, {title:"边界条件",description:""}]);
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
  assert.deepEqual(posted.map(body => body.max_tokens), [1024, 4096, 1024, 4096]);
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
  assert.equal(modelCalls, 0);
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

test("task vocabulary can select an existing concept through a bounded library catalogue", async t => {
  const f = library(); t.after(() => f.db.close());
  f.add('composition', 'composition', '/root/composition.sy', 'd', '合成谬误');
  f.add('composition-body', 'composition', '/root/composition.sy', 'p', '部分成立不代表整体成立，应检查相互作用。');
  const result = await ask(f.api, {question:'各组件都通过了，用户操作为什么仍失败？'}, {
    complete: async ({data}) => data.candidates ? mockAnswer(data)
      : {queries: data.catalog?.some(card => card.title === '合成谬误') ? ['合成谬误'] : ['组件 验收']},
  });
  assert.equal(result.status, 'answered');
  assert.equal(result.cards[0].id, 'composition');
});

test("blank JSON provider output is retried once instead of abandoning an answer", async () => {
  let calls = 0;
  const complete = chatCompletions({url:'https://model.invalid/chat/completions',apiKey:'fake',model:'test',maxTokenField:'max_tokens'}, async () => {
    calls++;
    return calls === 1 ? new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'   '}}]})) : completion({queries:['范围']});
  });
  assert.deepEqual((await complete({prompt:'Return JSON',data:{question:'test'},maxTokens:512,signal:new AbortController().signal})).value, {queries:['范围']});
  assert.equal(calls, 2);
});

test("catalogue stays scoped and bounded and exact titles outrank incidental mentions", async t => {
  const f = library(); t.after(() => f.db.close());
  assert.deepEqual((await askCatalog(f.api)).map(card => card.title), ['上线检查', '边界条件']);
  for(let i=0;i<220;i++){
    const id='item-'+String(i).padStart(3,'0'), path='/root/'+id+'.sy';
    f.add(id,id,path,'d',('长标题'+i).repeat(30));
    f.add(id+'-body',id,path,'p','关键方法是相关链接，仅用于交叉参考。');
  }
  f.add('zz-target','zz-target','/root/zz-target.sy','d','关键方法');
  f.add('zz-target-a','zz-target','/root/zz-target.sy','p','这一方法的可执行定义及边界。');
  f.add('zz-target-b','zz-target','/root/zz-target.sy','p','这一方法的可执行定义及边界。');
  f.add('zz-target-c','zz-target','/root/zz-target.sy','p','先列出条件，再收集验证证据。');
  const catalog=await askCatalog(f.api);
  assert.ok(catalog.length<=200);
  assert.ok(catalog.reduce((n,x)=>n+Array.from(x.title+x.description).length,0)<=12000);
  assert.ok(catalog.every(x=>Array.from(x.title).length<=120));
  const candidates=await askEvidence(f.api,['关键方法']);
  assert.equal(candidates[0].id,'zz-target');
  assert.equal(candidates[0].evidence.length,2);
  assert.equal(new Set(candidates[0].evidence.map(e=>e.text)).size,2);
});

test("DeepSeek JSON tasks disable default thinking without leaking vendor fields to other hosts", async () => {
  for(const url of ['https://api.deepseek.com/chat/completions','https://compatible.invalid/chat/completions']){
    let body;
    const complete=chatCompletions({url,apiKey:'fake',model:'deepseek-flash',maxTokenField:'max_tokens'},async(_url,o)=>{body=JSON.parse(o.body);return completion({queries:['范围']});});
    await complete({prompt:'JSON',data:{question:'test'},maxTokens:1024});
    if(url.includes('api.deepseek.com'))assert.deepEqual(body.thinking,{type:'disabled'});
    else assert.equal(Object.hasOwn(body,'thinking'),false);
  }
});

test("truncation retry increases a bounded budget and records only safe failure metadata", async () => {
  const budgets=[],events=[];
  const complete=chatCompletions({url:'https://model.invalid/chat/completions',apiKey:'secret-test',model:'test',maxTokenField:'max_tokens'},async(_url,o)=>{
    budgets.push(JSON.parse(o.body).max_tokens);
    return budgets.length===1 ? new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'private partial'}}]})) : completion({queries:['范围']});
  });
  await complete({prompt:'private prompt',data:{question:'private question'},maxTokens:4096,onDiagnostic:e=>events.push(e)});
  assert.deepEqual(budgets,[4096,8192]);
  assert.deepEqual(events.map(e=>e.outcome),['truncated','valid_json']);
  assert.doesNotMatch(JSON.stringify(events),/private|secret/);
});

test("malformed JSON recovery stops after one retry and refusals are never retried", async () => {
  for(const refusal of [false,true]){
    let calls=0;
    const complete=chatCompletions({url:'https://model.invalid/chat/completions',apiKey:'fake',model:'test',maxTokenField:'max_tokens'},async()=>{
      calls++;return new Response(JSON.stringify({choices:[{finish_reason:refusal?'content_filter':'stop',message:{content:'not json'}}]}));
    });
    await assert.rejects(complete({prompt:'JSON',data:{},maxTokens:512}),{code:'ask_invalid_output',diagnostic:refusal?'refusal':'content_json'});
    assert.equal(calls,refusal?1:2);
  }
});

test("cancellation between recovery attempts prevents another provider request", async () => {
  const controller=new AbortController();let calls=0;
  const complete=chatCompletions({url:'https://model.invalid/chat/completions',apiKey:'fake',model:'test',maxTokenField:'max_tokens'},async()=>{
    calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:' '}}]}));
  });
  await assert.rejects(complete({prompt:'JSON',data:{},maxTokens:512,signal:controller.signal,onDiagnostic:()=>controller.abort()}),{name:'AbortError'});
  assert.equal(calls,1);
});

test("exact concept retrieval uses explanatory content ahead of short labels", async t => {
  const f=library();t.after(()=>f.db.close());
  f.add('concept','concept','/root/concept.sy','d','方法卡');
  for(let i=0;i<15;i++){
    f.add('a'+i,'concept','/root/concept.sy','p','标签'+i);
    f.add('image'+i,'concept','/root/concept.sy','p','示意图 assets/'+String(i).padStart(100,'0')+'.png');
  }
  const explanation='面对任务时先区分观察与推断，再检查哪些证据支持当前结论，并明确仍然缺少的信息。';
  f.add('z-description','concept','/root/concept.sy','p',explanation);
  const [card]=await askEvidence(f.api,['方法卡']);
  assert.equal(card.evidence[0].text,explanation);
});

test("provider query schema mistakes recover once while reference mistakes still fail closed", async t => {
  const f=library();t.after(()=>f.db.close());let calls=0;
  const provider=chatCompletions({url:'https://model.invalid/chat/completions',apiKey:'fake',model:'test',maxTokenField:'max_tokens'},async(_url,{body})=>{
    calls++;const data=JSON.parse(JSON.parse(body).messages[1].content);
    return completion(calls===1?{queries:[]} : data.candidates ? mockAnswer(data) : {queries:['上线']});
  });
  const result=await ask(f.api,{question:'上线检查？'},{complete:async request=>(await provider(request)).value});
  assert.equal(result.status,'answered');assert.equal(calls,3);
});

test("a valid JSON answer with an invented reference is still rejected after bounded regeneration", async t => {
  const f=library();t.after(()=>f.db.close());let calls=0;
  const provider=chatCompletions({url:'https://model.invalid/chat/completions',apiKey:'fake',model:'test',maxTokenField:'max_tokens'},async(_url,{body})=>{
    calls++;const data=JSON.parse(JSON.parse(body).messages[1].content);
    if(!data.candidates)return completion({queries:['上线']});
    const answer=mockAnswer(data);answer.cards[0].evidenceIds=['invented'];return completion(answer);
  });
  await assert.rejects(ask(f.api,{question:'上线？'},{complete:async request=>(await provider(request)).value}),{code:'ask_invalid_output',diagnostic:'references'});
  assert.equal(calls,3);
});

test("an invalid reference candidate is discarded and regenerated once from original evidence", async t => {
  const f=library();t.after(()=>f.db.close());let calls=0;const sent=[];
  const provider=chatCompletions({url:'https://model.invalid/chat/completions',apiKey:'fake',model:'test',maxTokenField:'max_tokens'},async(_url,{body})=>{
    calls++;const request=JSON.parse(body);const data=JSON.parse(request.messages[1].content);sent.push(data);
    if(!data.candidates)return completion({queries:['上线']});
    const answer=mockAnswer(data);if(calls===2)answer.cards[0].evidenceIds=['invented'];return completion(answer);
  });
  const result=await ask(f.api,{question:'上线？'},{complete:async request=>(await provider(request)).value});
  assert.equal(result.status,'answered');assert.equal(calls,3);assert.deepEqual(sent[1],sent[2]);
  assert.doesNotMatch(JSON.stringify(result),/invented/);
});


test("task descriptions select candidates but only body passages become evidence", async t => {
  const f = library(); t.after(() => f.db.close());
  f.api.markdown = async id => id === "plain" ? "## 适用情境\n\n编写验收清单时帮助明确范围。" : "原文";
  const catalog = await askCatalog(f.api);
  assert.equal(catalog.find(card => card.id === "plain").description, "编写验收清单时帮助明确范围。");
  const candidates = await askEvidence(f.api, ["验收清单"], undefined, catalog);
  assert.equal(candidates[0].id, "plain");
  assert.equal(candidates[0].evidence[0].text, "资料缺口需要核实。");
  assert.deepEqual(await askEvidence(f.api, ["完全无关"], undefined, catalog), []);
});

test("catalogue truncation never turns a long description into answer evidence", async t => {
  const f = library(); t.after(() => f.db.close());
  const long = "任务说明".repeat(155);
  f.api.markdown = async id => id === "plain" ? "## 适用情境\n\n"+long : "原文";
  f.db.prepare("UPDATE blocks SET content=? WHERE id='plain-body'").run(long);
  const catalog = await askCatalog(f.api);
  assert.equal(catalog.find(card=>card.id==='plain').description.length, 600);
  assert.deepEqual(await askEvidence(f.api, ['边界条件'], undefined, catalog), []);
  assert.deepEqual(await askEvidence(f.api, ['边界条件'], undefined, []), []);
});

test("polish HTTP shares authentication and model config without reading or writing cards", async t => {
  let payload;
  const app = await appFixture(t, { modelFetch: async (_url, options) => {
    payload=JSON.parse(options.body); return completion({description:'用于试用的任务描述。'});
  }});
  const data={title:'合成卡',description:'原描述'};
  assert.equal((await app.command('polish-description',data)).status,401);
  const response=await app.command('polish-description',data,{headers:await app.authenticate()});
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).data,{description:'用于试用的任务描述。'});
  assert.deepEqual(JSON.parse(payload.messages[1].content),data);
  assert.equal((await app.command('polish-description',{title:'',description:''},{headers:bearer})).status,400);
});
