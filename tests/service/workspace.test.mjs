import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspace } from "../../web/workspace.mjs";
import { tagTone } from "../../web/lib/utils.mjs";

test("tag tones cover eight swatches and are stable for equivalent labels", () => {
  assert.deepEqual("ABCDEFGH".split("").map(tagTone), [1, 2, 3, 4, 5, 6, 7, 0]);
  assert.equal(tagTone("Cafe\u0301"), tagTone("Café"));
  assert.equal(tagTone("方法论"), 6);
});

function harness(handle, loadEditor = async () => ({ default() {} }), asynchronousHistory = false) {
  const listeners = new Map();
  const browser = { location: { href: "http://localhost/" }, document: { title: "", getElementById: () => null }, requestAnimationFrame: (fn) => fn(), addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const visits = [{ url: browser.location.href, state: {} }];
  let position = 0;
  browser.history = { get state() { return visits[position].state; }, replaceState(state, _, url) { visits[position] = { state, url: new URL(url, browser.location.href).href }; browser.location.href = visits[position].url; }, pushState(state, _, url) { visits.splice(++position); visits.push({ state, url: new URL(url, browser.location.href).href }); browser.location.href = visits[position].url; }, go(delta) { const move = () => { position += delta; browser.location.href = visits[position].url; void listeners.get("popstate")?.({ state: visits[position].state }); }; if (asynchronousHistory) setImmediate(move); else move(); } };
  const requests = [];
  const workspace = createWorkspace({ browser, loadEditor, fetch: async (url, options) => { const body = options.body ? JSON.parse(options.body) : undefined; requests.push({ url, body }); const value = await handle(url, body, options); return { ok: value.status !== 401 && value.ok !== false, status: value.status || 200, json: async () => value }; } });
  return { workspace, requests, browser, visits, listeners };
}
const ok = (data) => ({ ok: true, data });
const card = (id) => ({ id, title: id, markdown: "原文", html: "<p>原文</p>", revision: "rev-1", editable: true });
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("a 401 keeps the draft and frozen request for query then exact retry", async () => {
  let first = true;
  const h = harness((url, body) => {
    if (url === "/api/session") return ok({ authenticated: true });
    if (url.endsWith("/list")) return ok({ items: [], total: 0, tags: [] });
    if (url.endsWith("/create") && first) { first = false; return { ok: false, status: 401, error: { code: "unauthorized", message: "expired" } }; }
    if (url.endsWith("/create")) return ok({ id: "created" });
    if (url.endsWith("/operation-status")) return { ok: false, error: { code: "not_found" } };
    if (url.endsWith("/get-document")) return ok(card(body.id));
    throw new Error(url);
  });
  const m = h.workspace;
  try {
    await m.start(); await m.editCard({ isNew: true }); m.setTitle("草稿"); m.setMarkdown("保留正文"); await m.save();
    const pending = m.getSnapshot().pending;
    assert.equal(m.getSnapshot().authenticated, false); assert.equal(m.getSnapshot().draft.markdown, "保留正文"); assert.equal(Object.isFrozen(pending.input), true);
    await m.login("access"); assert.equal(m.getSnapshot().pending.input, pending.input);
    await m.checkOperation(); await m.retry();
    assert.deepEqual(h.requests.filter((r) => r.url.endsWith("/create")).map((r) => r.body), [pending.input, pending.input]);
  } finally { m.destroy(); }
});

test("late document reads cannot replace a newer navigation", async () => {
  let release;
  const h = harness(async (url, body) => {
    if (url.endsWith("/get-document")) { if (body.id === "slow") await new Promise((r) => { release = r; }); return ok(card(body.id)); }
    throw new Error(url);
  });
  try {
    const slow = h.workspace.navigate("slow"); await tick(); await h.workspace.navigate("latest"); release(); await slow;
    assert.equal(h.workspace.getSnapshot().current.id, "latest");
  } finally { h.workspace.destroy(); }
});

test("a legacy Chinese article is displayed at the parent card URL with the original notes available", async () => {
  const h = harness((url, body) => {
    if (url === "/api/session") return ok({ authenticated: true });
    if (!url.endsWith("/get-document")) throw new Error(url);
    if (body.id === "article") return ok({ ...card("article"), html: "<p>长文正文</p>" });
    if (body.id === "legacy") return ok({
      ...card("legacy"), legacyFixedFields: true, editable: false,
      readings: [
        { id: "source", locale: "cn", title: "出处" },
        { id: "article", locale: "cn", title: "中文长文" },
      ],
    });
    throw new Error(body.id);
  });
  try {
    h.browser.history.replaceState({}, "", "/cards/legacy");
    await h.workspace.start();
    const { current } = h.workspace.getSnapshot();
    assert.equal(h.browser.location.href, "http://localhost/cards/legacy");
    assert.equal(current.id, "legacy");
    assert.equal(current.html, "<p>原文</p>");
    assert.deepEqual(current.primaryReading, { id: "article", html: "<p>长文正文</p>" });
    assert.deepEqual(h.requests.filter(request => request.body?.id).map(request => request.body.id), ["legacy", "article"]);
  } finally { h.workspace.destroy(); }
});

test("an unavailable Chinese article leaves its parent card and reading link available", async () => {
  const h = harness((url, body) => {
    if (body.id === "legacy") return ok({
      ...card("legacy"), legacyFixedFields: true, editable: false,
      readings: [{ id: "article", locale: "cn", title: "中文长文" }],
    });
    return { ok: false, error: { code: "not_found" } };
  });
  try {
    assert.equal(await h.workspace.navigate("legacy"), true);
    const { current } = h.workspace.getSnapshot();
    assert.equal(current.id, "legacy");
    assert.equal(current.primaryReading, undefined);
    assert.equal(current.readings[0].id, "article");
  } finally { h.workspace.destroy(); }
});

test("cancelling a dirty history navigation restores its entry without a push", async () => {
  const h = harness((url, body) => url.endsWith("/get-document") ? ok(card(body.id)) : Promise.reject(new Error(url)));
  try {
    await h.workspace.navigate("one"); await h.workspace.navigate("two"); await h.workspace.editCard(); h.workspace.setTitle("未保存");
    const count = h.visits.length;
    h.browser.history.go(-1); await tick(); assert.equal(h.workspace.getSnapshot().confirmOpen, true);
    h.workspace.decideLeave(false); await tick();
    assert.equal(h.browser.location.href, "http://localhost/cards/two/edit"); assert.equal(h.visits.length, count); assert.equal(h.workspace.getSnapshot().draft.title, "未保存");
  } finally { h.workspace.destroy(); }
});

test("navigating during lazy editor loading releases the loading lock", async () => {
  let release;
  const h = harness((url, body) => url.endsWith("/get-document") ? ok(card(body.id)) : Promise.reject(new Error(url)), () => new Promise((resolve) => { release = resolve; }));
  try {
    const loading = h.workspace.editCard({ isNew: true }); await tick();
    assert.equal(h.workspace.getSnapshot().editorLoading, true);
    await h.workspace.navigate("selected"); release({ default() {} }); await loading;
    assert.equal(h.workspace.getSnapshot().editorLoading, false);
    assert.equal(h.workspace.getSnapshot().current.id, "selected");
    assert.equal(h.workspace.getSnapshot().editing, false);
  } finally { h.workspace.destroy(); }
});

for (const asynchronousHistory of [false, true]) {
  for (const leave of [false, true]) {
    test(`two Back actions share the first confirmation (${leave ? "leave" : "cancel"}, ${asynchronousHistory ? "async" : "sync"} traversal)`, async () => {
      const h = harness((url, body) => url.endsWith("/get-document") ? ok(card(body.id)) : Promise.reject(new Error(url)), undefined, asynchronousHistory);
      try {
        await h.workspace.navigate("one"); await h.workspace.navigate("two"); await h.workspace.navigate("three");
        await h.workspace.editCard(); h.workspace.setTitle("未保存的three");
        const count = h.visits.length;
        h.browser.history.go(-1); await tick();
        assert.equal(h.workspace.getSnapshot().confirmOpen, true);
        h.browser.history.go(-1); await tick();
        assert.equal(h.workspace.getSnapshot().confirmOpen, true);
        h.workspace.decideLeave(leave);
        for (let round = 0; round < 8; round++) await tick();
        const expected = "three";
        assert.equal(h.workspace.getSnapshot().current.id, expected);
        assert.equal(h.browser.location.href, `http://localhost/cards/${expected}${leave ? "" : "/edit"}`);
        assert.equal(h.visits.length, count);
        assert.equal(h.workspace.getSnapshot().confirmOpen, false);
        assert.equal(h.workspace.getSnapshot().editing, !leave);
        if (!leave) assert.equal(h.workspace.getSnapshot().draft.title, "未保存的three");
      } finally { h.workspace.destroy(); }
    });
  }
}

test('refreshing an edit route retains its canonical edit URL',async()=>{
 const h=harness((url,body)=>url==='/api/session'?ok({authenticated:true}):url.endsWith('/get-document')?ok(card(body.id)):Promise.reject(new Error(url)));
 try{h.browser.history.replaceState({},'','/cards/card/edit');await h.workspace.start();assert.equal(h.workspace.getSnapshot().editing,true);assert.equal(h.browser.location.href,'http://localhost/cards/card/edit');}finally{h.workspace.destroy();}
});
test('delayed list filtering cannot navigate away from an opened detail',async()=>{
 const h=harness((url,body)=>url.endsWith('/get-document')?ok(card(body.id)):url.endsWith('/list')?ok({items:[],total:0}):Promise.reject(new Error(url)));
 try{h.workspace.setQuery('keyword');await h.workspace.navigate('opened');await new Promise(resolve=>setTimeout(resolve,300));assert.equal(h.workspace.getSnapshot().route,'detail');assert.equal(h.browser.location.href,'http://localhost/cards/opened?q=keyword');}finally{h.workspace.destroy();}
});

for (const viaHistory of [false, true]) {
  test(`returning to filtered results restores the source card (${viaHistory ? "browser Back" : "list button"})`, async () => {
    let items = [{ id: "opened" }];
    let total = 40;
    const h = harness((url, body) => {
      if (url.endsWith("/list")) return ok({ items, total });
      if (url.endsWith("/get-document")) return ok(card(body.id));
      throw new Error(url);
    });
    const document = h.browser.document;
    const link = { dataset: { cardId: "opened" }, focus: () => { document.activeElement = link; }, scrollIntoView() {} };
    const search = { focus: () => { document.activeElement = search; } };
    const list = {
      querySelectorAll: () => items.length ? [link] : [],
      contains: (element) => element === link || element === search,
    };
    const pane = { scrollTop: 0, scrollTo: (_, top) => { pane.scrollTop = top; } };
    document.getElementById = (id) => ({ workspace: pane, "list-page": list, "search-input": search })[id];
    const m = h.workspace;
    try {
      await m.applyFilters({ query: "keyword", page: 2 });
      pane.scrollTop = 700;
      await m.navigate("opened");
      assert.equal(pane.scrollTop, 0);
      if (viaHistory) {
        h.browser.history.go(-1);
        await tick();
      } else await m.listPage({ restore: true });
      assert.equal(h.browser.location.href, "http://localhost/cards?q=keyword&page=2");
      assert.equal(pane.scrollTop, 700);
      assert.equal(document.activeElement, link);

      await m.navigate("opened");
      document.activeElement = null;
      items = [];
      total = 19;
      await m.listPage({ restore: true });
      assert.equal(h.browser.location.href, "http://localhost/cards?q=keyword");
      assert.equal(document.activeElement, search);
    } finally { m.destroy(); }
  });
}

test("a delayed list return leaves newly moved keyboard focus alone", async () => {
  let release;
  let hold = false;
  const h = harness(async (url, body) => {
    if (url.endsWith("/get-document")) return ok(card(body.id));
    if (hold) await new Promise(resolve => { release = resolve; });
    return ok({ items: [{ id: "opened" }], total: 1 });
  });
  const document = h.browser.document;
  const header = {};
  const link = { dataset: { cardId: "opened" }, focus: () => { document.activeElement = link; }, scrollIntoView() {} };
  const list = { contains: () => false, querySelectorAll: () => [link] };
  const pane = { scrollTop: 100, scrollTo() {} };
  document.getElementById = (id) => ({ workspace: pane, "list-page": list })[id];
  const m = h.workspace;
  try {
    await m.listPage();
    await m.navigate("opened");
    hold = true;
    const returned = m.listPage({ restore: true });
    await tick();
    document.activeElement = header;
    release();
    await returned;
    assert.equal(document.activeElement, header);
  } finally { m.destroy(); }
});

test("ask restores the in-memory result and focus after opening its card", async () => {
  const data = { status: "answered", cards: [card("example")], steps: [], gaps: [] };
  const h = harness((url, body) => {
    if (url === "/api/session") return ok({ authenticated: true, askAvailable: true });
    if (url.endsWith("/list")) return ok({ items: [], total: 0, tags: [] });
    if (url.endsWith("/ask")) return ok(data);
    if (url.endsWith("/get-document")) return ok(card(body.id));
    throw new Error(url);
  });
  const pane = { scrollTop: 127, scrollTo(_x, y) { this.scrollTop = y; } };
  const doc = h.browser.document;
  doc.body = {};
  const link = { dataset: { cardId: "example" }, focus() { doc.activeElement = link; }, scrollIntoView() {} };
  const list = { querySelectorAll: () => [link], contains: value => value === link };
  doc.activeElement = doc.body;
  doc.getElementById = id => ({ workspace: pane, "list-page": list })[id] ?? null;
  const m = h.workspace;
  const question = "需要保护的测试问题";
  try {
    await m.start();
    await m.applyFilters({ query: "原关键词" });
    await m.switchListMode("ask");
    m.setAskQuestion(question);
    await m.submitAsk();
    await m.navigate("example");
    assert.equal(h.browser.location.href, "http://localhost/cards/example?mode=ask");
    assert.equal(pane.scrollTop, 0);
    assert.doesNotMatch(JSON.stringify(h.visits), /需要保护的测试问题/);

    await m.listPage({ restore: true });
    assert.deepEqual(m.getSnapshot().askResult, { question, data });
    assert.equal(pane.scrollTop, 127);
    assert.equal(doc.activeElement, link);
    assert.equal(h.requests.filter(item => item.url.endsWith("/ask")).length, 1);

    await m.switchListMode("keyword");
    assert.equal(m.getSnapshot().query, "原关键词");
    assert.equal(h.browser.location.href, "http://localhost/cards?q=%E5%8E%9F%E5%85%B3%E9%94%AE%E8%AF%8D");
    h.browser.history.go(-1);
    await tick();
    assert.deepEqual(m.getSnapshot().askResult, { question, data });
  } finally { m.destroy(); }

  const reload = createWorkspace({ browser: h.browser, fetch: async () => ({
    ok: true, status: 200, json: async () => ok({ authenticated: true, askAvailable: true }),
  }) });
  try {
    await reload.start();
    assert.equal(reload.getSnapshot().listMode, "ask");
    assert.equal(reload.getSnapshot().askQuestion, "");
    assert.equal(reload.getSnapshot().askResult, null);
  } finally { reload.destroy(); }
});

test("cancelled ask responses cannot replace a later answer or end its session", async () => {
  const pending = Promise.withResolvers();
  let cancelledSignal;
  const response = { status: "insufficient", cards: [], steps: [], gaps: ["资料缺口"] };
  const h = harness((url, body, options) => {
    if (url === "/api/session") return ok({ authenticated: true, askAvailable: true });
    if (url.endsWith("/list")) return ok({ items: [], total: 0, tags: [] });
    if (body.question === "延迟") { cancelledSignal = options.signal; return pending.promise; }
    return ok(response);
  });
  const m = h.workspace;
  try {
    await m.start();
    await m.switchListMode("ask");
    m.setAskQuestion("延迟");
    const previous = m.submitAsk();
    m.cancelAsk();
    assert.equal(cancelledSignal.aborted, true);
    m.setAskQuestion("新问题");
    await m.submitAsk();
    pending.resolve({ status: 401, ok: false, error: { code: "unauthorized", message: "expired" } });
    await previous;
    assert.equal(m.getSnapshot().authenticated, true);
    assert.deepEqual(m.getSnapshot().askResult, { question: "新问题", data: response });
    assert.equal(m.getSnapshot().pending, null);
  } finally { m.destroy(); }
});

test("an expired application session clears completed answers and invalidates pending analysis", async () => {
  let expire = false;
  const h = harness((url, body, options) => {
    if (url === "/api/session") return ok({ authenticated: options.method !== "DELETE", askAvailable: true });
    if (url.endsWith("/list")) return ok({ items: [], total: 0, tags: [] });
    if (expire) return { status: 401, ok: false, error: { code: "ask_session_expired" } };
    return ok({ status: "no_match", cards: [], steps: [], gaps: ["无可用依据"] });
  });
  const m = h.workspace;
  try {
    await m.start();
    await m.switchListMode("ask");
    m.setAskQuestion("旧问题");
    await m.submitAsk();
    assert.ok(m.getSnapshot().askResult);
    expire = true;
    m.setAskQuestion("会话到期时的问题");
    await m.submitAsk();
    assert.equal(m.getSnapshot().authenticated, false);
    assert.equal(m.getSnapshot().askResult, null);
    assert.equal(m.getSnapshot().askQuestion, "");
    assert.equal(m.getSnapshot().askBusy, false);
    assert.equal(m.getSnapshot().pending, null);
    await m.login("access");
    h.browser.history.go(-1);
    await tick();
    assert.equal(m.getSnapshot().askResult, null);
  } finally { m.destroy(); }
});

test("opening a card or loading the editor prevents hidden analysis submissions", async () => {
  for (const route of ["detail", "new"]) {
    const ready = Promise.withResolvers();
    const h = harness(async (url, body) => {
      if (url === "/api/session") return ok({ authenticated: true, askAvailable: true });
      if (url.endsWith("/list")) return ok({ items: [], total: 0, tags: [] });
      if (url.endsWith("/ask")) return ok({ status: "answered", cards: [card("example")], steps: [], gaps: [] });
      if (url.endsWith("/get-document")) { await ready.promise; return ok(card(body.id)); }
      throw new Error(url);
    }, async () => { await ready.promise; return { default() {} }; });
    const m = h.workspace;
    try {
      await m.start();
      await m.switchListMode("ask");
      m.setAskQuestion("已有分析");
      await m.submitAsk();
      const transition = route === "detail" ? m.navigate("example") : m.editCard({ isNew: true });
      await tick();
      assert.equal(m.getSnapshot().navigating || m.getSnapshot().editorLoading, true);
      m.setAskQuestion("不能在导航期间提交");
      await m.submitAsk();
      assert.equal(h.requests.filter(item => item.url.endsWith("/ask")).length, 1);
      assert.equal(m.getSnapshot().askBusy, false);
      ready.resolve();
      await transition;
      assert.equal(m.getSnapshot().route, route);
    } finally { ready.resolve(); m.destroy(); }
  }
});

test("a confirmed deletion is reconciled before returning to a refreshed list", async () => {
  let deleted = false;
  const h = harness((url, input) => {
    if (url.endsWith("/list")) return ok({ items: deleted ? [] : [card("sample")], total: deleted ? 0 : 1 });
    if (url.endsWith("/get-document")) return ok({ ...card(input.id), deletable: true });
    if (url.endsWith("/delete-document")) {
      deleted = true;
      throw new Error("lost response");
    }
    if (url.endsWith("/operation-status")) return ok({ state: "verified", result: { id: "sample", deleted: true } });
    throw new Error(url);
  });
  const m = h.workspace;
  try {
    await m.navigate("sample");
    await m.deleteCard({ id: "sample", revision: "stale" });
    assert.equal(deleted, false);
    await m.deleteCard(m.getSnapshot().current);
    assert.equal(m.getSnapshot().route, "detail");
    const pending = m.getSnapshot().pending;
    assert.equal(pending.input.expected_revision, "rev-1");
    await m.checkOperation();
    assert.equal(m.getSnapshot().route, "list");
    assert.equal(m.getSnapshot().pending, null);
    assert.deepEqual(m.getSnapshot().items, []);
    assert.equal(h.requests.find(r => r.url.endsWith("/operation-status")).body.op_id, pending.input.op_id);
  } finally { m.destroy(); }
});

test("following a deleted link clears the previous card and its action target", async () => {
  const h = harness((url, input) => {
    if (url.endsWith("/get-document") && input.id === "deleted")
      return { ok: false, status: 403, error: { code: "outside_scope" } };
    if (url.endsWith("/get-document")) return ok({ ...card(input.id), deletable: true });
    throw new Error(url);
  });
  try {
    await h.workspace.navigate("current");
    assert.equal(h.workspace.getSnapshot().current.id, "current");
    assert.equal(await h.workspace.navigate("deleted", { fromHistory: true }), false);
    assert.equal(h.workspace.getSnapshot().current, null);
    assert.equal(h.workspace.getSnapshot().message.error, true);
  } finally { h.workspace.destroy(); }
});

test("description suggestions stay local until adopted and saved, failures preserve drafts", async () => {
  let fail = false;
  const stored = { ...card("task-card"), markdown: "正文。\n\n## 适用情境\n\n原描述。\n\n## 边界\n\n原边界。" };
  const h = harness((url, body) => {
    if (url === "/api/session") return ok({ authenticated: true, askAvailable: true });
    if (url.endsWith("/list")) return ok({ items: [], total: 0 });
    if (url.endsWith("/get-document")) return ok(stored);
    if (url.endsWith("/polish-description")) return fail ? {ok:false,status:503,error:{code:"ask_unavailable"}} : ok({description:"润色建议。"});
    if (url.endsWith("/save-document")) { stored.markdown = body.markdown; return ok({id:stored.id}); }
    throw new Error(url);
  });
  const m = h.workspace;
  try {
    await m.start(); await m.navigate(stored.id); await m.editCard();
    assert.equal(m.getSnapshot().draft.description, "原描述。");
    assert.ok(!m.getSnapshot().draft.markdown.includes("原描述"));
    await m.polishDescription();
    assert.equal(m.dirty(), false);
    assert.equal(m.getSnapshot().draft.description, "原描述。");
    m.discardPolish(); assert.equal(m.getSnapshot().polishSuggestion, null);
    await m.polishDescription(); m.setPolishSuggestion("修改建议。"); m.adoptPolish();
    assert.equal(m.dirty(), true); assert.equal(stored.markdown.includes("修改建议"), false);
    fail = true; await m.polishDescription();
    assert.equal(m.getSnapshot().draft.description, "修改建议。");
    assert.match(m.getSnapshot().polishMessage, /原描述已保留/);
    await m.save();
    assert.equal(stored.markdown, "正文。\n\n## 适用情境\n\n修改建议。\n\n## 边界\n\n原边界。");
    const request = h.requests.find(r => r.url.endsWith("/polish-description"));
    assert.deepEqual(request.body, {title:stored.title,description:"原描述。"});
  } finally { m.destroy(); }
});

test("late polish cannot replace a changed title or another card", async () => {
  let release;
  const h = harness(async (url, body) => {
    if (url === "/api/session") return ok({authenticated:true, askAvailable:true});
    if (url.endsWith("/list")) return ok({items:[],total:0});
    if (url.endsWith("/get-document")) return ok(card(body.id));
    if (url.endsWith("/polish-description")) { await new Promise(resolve => { release=resolve; }); return ok({description:"过期结果"}); }
    throw new Error(url);
  });
  try {
    const m=h.workspace; await m.start(); await m.navigate("one"); await m.editCard();
    const pending=m.polishDescription(); await tick(); m.setTitle("新标题"); release(); await pending;
    assert.equal(m.getSnapshot().polishSuggestion,null);
    assert.equal(m.getSnapshot().draft.title,"新标题");
  } finally { h.workspace.destroy(); }
});
