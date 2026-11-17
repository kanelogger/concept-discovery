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

test("wiki route refresh and protected auxiliary drafts retain their navigation and session", async () => {
  const h=harness((url,body)=>{
    if(url==='/api/session')return ok({authenticated:true,draftAvailable:true});
    if(url.endsWith('/list'))return ok({items:[],total:0,tags:[]});
    if(url.endsWith('/source-import'))return {ok:false,status:401,error:{code:'unauthorized',message:'expired'}};
    throw new Error(url);
  });
  try{
    h.browser.history.replaceState({},'', '/wiki');await h.workspace.start();
    assert.equal(h.workspace.getSnapshot().route,'wiki');
    h.workspace.setAuxiliaryDirty('wiki',true);
    const leaving=h.workspace.listPage();await tick();
    assert.equal(h.workspace.getSnapshot().confirmOpen,true);h.workspace.decideLeave(false);await leaving;
    assert.equal(h.workspace.getSnapshot().route,'wiki');
    await assert.rejects(h.workspace.command('source-import',{title:'草稿',markdown:'保留正文',op_id:'import-one'}));
    assert.equal(h.workspace.getSnapshot().authenticated,false);
    assert.equal(h.workspace.dirty(),true);
    await h.workspace.login('access');
    assert.equal(h.workspace.getSnapshot().route,'wiki');
    assert.equal(h.workspace.dirty(),true);
    h.workspace.setAuxiliaryDirty('wiki',false);
  }finally{h.workspace.destroy();}
});

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

test("a legacy concept is displayed first and keeps its long article as supplementary reading", async () => {
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
    assert.equal(current.primaryReading, undefined);
    assert.equal(current.readings[1].id, "article");
    assert.deepEqual(h.requests.filter(request => request.body?.id).map(request => request.body.id), ["legacy"]);
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


function wikiHarness({ existing = card('target'), loadEditor } = {}) {
  let stored = existing;
  return harness((url, body) => {
    if (url === '/api/session') return ok({ authenticated: true, draftAvailable: true });
    if (url.endsWith('/list')) return ok({ items: [], total: 0 });
    if (url.endsWith('/get-document')) return ok({ ...stored, id: body.id });
    if (url.endsWith('/save-document')) { stored = { ...stored, title: body.title, markdown: body.markdown, revision: 'saved' }; return ok({ id: body.id }); }
    if (url.endsWith('/create')) { stored = { ...card('new-card'), ...body.document }; return ok({ id: stored.id }); }
    throw new Error(url);
  }, loadEditor);
}
const generatedDraft = target => ({ source: { id: 'source-one', title: '原始资料', version: 1, hash: 'source-hash' }, target, title: target?.title || '新整理卡', markdown: '整理稿。\n\n> 原文依据\n\n[原文](/wiki?source=source-one)' });

test('a single-card draft preserves original text and understanding until ordinary save', async () => {
  const original = { ...card('target'), markdown: '原始正文\n\n## 我的理解\n\n这是我自己的解释。\n\n## 适用任务\n\n描述也属于原文。' };
  const h = wikiHarness({ existing: original });
  try {
    await h.workspace.start(); await h.workspace.wikiPage();
    const generated = generatedDraft({ id: original.id, title: original.title, revision: original.revision });
    assert.equal(await h.workspace.openWikiDraft(generated), true);
    assert.equal(h.workspace.getSnapshot().route, 'edit');
    assert.equal(h.workspace.getSnapshot().draft.markdown, original.markdown + '\n\n' + generated.markdown);
    assert.equal(h.requests.some(request => /\/(create|save-document|wiki-apply|wiki-understanding)$/.test(request.url)), false);
    await h.workspace.save();
    const written = h.requests.find(request => request.url.endsWith('/save-document')).body;
    assert.equal(written.expected_revision, original.revision);
    assert.equal(written.markdown, original.markdown + '\n\n' + generated.markdown);
    assert.equal(h.workspace.getSnapshot().current.markdown, written.markdown);
  } finally { h.workspace.destroy(); }
});

test('a generated new card is an unsaved ordinary editor draft', async () => {
  const h = wikiHarness();
  try {
    await h.workspace.start(); await h.workspace.wikiPage();
    const generated = generatedDraft(null);
    await h.workspace.openWikiDraft(generated);
    assert.equal(h.workspace.getSnapshot().route, 'new');
    assert.equal(h.workspace.getSnapshot().isNew, true);
    assert.equal(h.workspace.dirty(), true);
    assert.equal(h.requests.some(request => request.url.endsWith('/create')), false);
    await h.workspace.save();
    assert.deepEqual(h.requests.find(request => request.url.endsWith('/create')).body.document, { title: generated.title, markdown: generated.markdown });
  } finally { h.workspace.destroy(); }
});

test('a stale generated target is rejected before entering an editor or writing', async () => {
  const h = wikiHarness({ existing: { ...card('target'), revision: 'newer' } });
  try {
    await h.workspace.start(); await h.workspace.wikiPage();
    await assert.rejects(h.workspace.openWikiDraft(generatedDraft({ id: 'target', title: 'target', revision: 'older' })), { code: 'revision_conflict' });
    assert.equal(h.workspace.getSnapshot().route, 'wiki');
    assert.equal(h.workspace.getSnapshot().editing, false);
    assert.equal(h.requests.some(request => request.url.endsWith('/save-document')), false);
  } finally { h.workspace.destroy(); }
});

test('a late draft editor load cannot replace a newer card navigation', async () => {
  const waiting = Promise.withResolvers();
  const h = wikiHarness({ loadEditor: () => waiting.promise });
  try {
    await h.workspace.start(); await h.workspace.wikiPage();
    const opening = h.workspace.openWikiDraft(generatedDraft(null)); await tick();
    await h.workspace.navigate('later'); waiting.resolve({ default() {} });
    assert.equal(await opening, false);
    assert.equal(h.workspace.getSnapshot().route, 'detail');
    assert.equal(h.workspace.getSnapshot().current.id, 'later');
    assert.equal(h.workspace.getSnapshot().editorLoading, false);
  } finally { h.workspace.destroy(); }
});

test('my understanding opens the ordinary Markdown editor and saves with its original revision', async () => {
  const original = { ...card('target'), markdown: '原文及旧理解，不应被抽取重写。' };
  const h = wikiHarness({ existing: original });
  try {
    await h.workspace.start(); await h.workspace.navigate(original.id); await h.workspace.editUnderstanding();
    assert.equal(h.workspace.getSnapshot().draft.markdown, original.markdown + '\n\n## 我的理解\n\n');
    h.workspace.setMarkdown(h.workspace.getSnapshot().draft.markdown + '新的理解。');
    await h.workspace.save();
    assert.equal(h.requests.find(request => request.url.endsWith('/save-document')).body.expected_revision, original.revision);
    assert.equal(h.requests.some(request => request.url.endsWith('/wiki-understanding')), false);
  } finally { h.workspace.destroy(); }
});

test('my understanding reuses an existing section without manufacturing another empty heading', async () => {
  const original = { ...card('target'), markdown: '原文。\n\n## 我的理解\n\n已经写下的理解。' };
  const h = wikiHarness({ existing: original });
  try {
    await h.workspace.start(); await h.workspace.navigate(original.id); await h.workspace.editUnderstanding();
    assert.equal(h.workspace.getSnapshot().draft.markdown, original.markdown);
    assert.equal(h.workspace.dirty(), false);
    assert.equal(h.requests.some(request => /\/(save-document|wiki-understanding)$/.test(request.url)), false);
  } finally { h.workspace.destroy(); }
});
