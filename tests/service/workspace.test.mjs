import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspace } from "../../web/workspace.mjs";
import { tagTone } from "../../web/lib/utils.mjs";

test("tag tones cover eight swatches and are stable for equivalent labels", () => {
  assert.deepEqual("ABCDEFGH".split("").map(tagTone), [1, 2, 3, 4, 5, 6, 7, 0]);
  assert.equal(tagTone("Cafe\u0301"), tagTone("Café"));
  assert.equal(tagTone("方法论"), 6);
});

function harness(handle) {
  const listeners = new Map();
  const browser = { location: { href: "http://localhost/" }, document: { title: "", getElementById: () => null }, requestAnimationFrame: (fn) => fn(), addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const visits = [{ url: browser.location.href, state: {} }];
  let position = 0;
  browser.history = { get state() { return visits[position].state; }, replaceState(state, _, url) { visits[position] = { state, url: new URL(url, browser.location.href).href }; browser.location.href = visits[position].url; }, pushState(state, _, url) { visits.splice(++position); visits.push({ state, url: new URL(url, browser.location.href).href }); browser.location.href = visits[position].url; }, go(delta) { const move = () => { position += delta; browser.location.href = visits[position].url; void listeners.get("popstate")?.({ state: visits[position].state }); }; move(); } };
  const requests = [];
  const workspace = createWorkspace({ browser, fetch: async (url, options) => { const body = options.body ? JSON.parse(options.body) : undefined; requests.push({ url, body, options }); const value = await handle(url, body, options); return { ok: value.status !== 401 && value.ok !== false, status: value.status || 200, json: async () => value }; } });
  return { workspace, requests, browser, visits, listeners };
}
const ok = (data) => ({ ok: true, data });
const card = (id) => ({ id, title: id, markdown: "原文", html: "<p>原文</p>", revision: "rev-1", editable: true });
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("graph traversal restores source, occurrence and camera without refetching for graph-only history", async () => {
  const data = { nodes: [{ id: "one", title: "原文" }, { id: "two", title: "邻卡" }],
    edges: [{ source: "one", target: "two", occurrences: [{ anchor: "cd-ref-a" }, { anchor: "cd-ref-b" }] }], complete: true };
  const h = harness((url, body) => url === "/api/graph" ? ok(data) :
    url.endsWith("/get-document") ? ok(card(body.id)) : ok({}));
  const m = h.workspace;
  try {
    h.browser.history.replaceState({}, "", "/graph");
    await m.start();
    const frames = [], focused = [];
    h.browser.requestAnimationFrame = callback => frames.push(callback);
    h.browser.document.getElementById = id => ({focus:() => focused.push(id)});
    const first = { nodeId: "two", query: "邻卡", camera: { x: 25, y: 10, k: 1.5 } };
    const second = { ...first, edge: { source: "one", target: "two" }, occurrenceIndex: 1 };
    m.setGraphView(first);
    m.setGraphView(second);
    const index = h.visits.length;
    m.setGraphView({ ...second, camera: { x: 30, y: 30, k: 2 } }, { replace: true });
    assert.equal(h.visits.length, index);
    m.graphBack();
    await tick();
    assert.deepEqual(m.getSnapshot().graphView, first);
    h.browser.history.go(1);
    await tick();
    const saved = m.getSnapshot().graphView;
    for (const callback of frames.splice(0)) callback();
    assert.deepEqual(focused, [], "graph-only history keeps keyboard focus in the current control");
    assert.equal(h.requests.filter(r => r.url === "/api/graph").length, 1);
    await m.openGraphSource(data.edges[0], data.edges[0].occurrences[1]);
    assert.equal(h.browser.location.href, "http://localhost/cards/one#cd-ref-b");
    assert.equal(m.getSnapshot().documentAnchor, "cd-ref-b");
    assert.equal(m.getSnapshot().graphReturn, true);
    await m.backFromCard();
    await tick();
    assert.equal(m.getSnapshot().route, "graph");
    assert.deepEqual(m.getSnapshot().graphView, saved);
    assert.equal(h.browser.history.state.cd_graph_focus, "graph-open-source");
    for (const callback of frames.splice(0)) callback();
    assert.deepEqual(focused, ["graph-open-source"], "returning from the reader hands focus back to the citation");
  } finally { m.destroy(); }
});

test("a late graph response cannot change the list", async () => {
  const waiting = Promise.withResolvers();
  const h = harness(url => url === "/api/graph" ? waiting.promise :
    url.endsWith("/list") ? ok({ items: [], total: 0 }) : ok({}));
  const m = h.workspace;
  try {
    const entering = m.graphPage();
    await tick();
    const signal = h.requests.find(entry => entry.url === "/api/graph").options.signal;
    await m.listPage();
    assert.equal(signal.aborted, true);
    waiting.resolve(ok({ nodes: [], edges: [], complete: true }));
    await entering;
    assert.equal(m.getSnapshot().route, "list");
    assert.equal(m.getSnapshot().graphData, null);
  } finally { waiting.resolve(ok({})); m.destroy(); }
});

test("a graph return follows the same occurrence after insertions and explains a removed citation", async () => {
  const edge = { source: "from", target: "to", occurrences: [{ anchor: "cd-ref-first" }, { anchor: "cd-ref-second" }] };
  const data = { nodes: [{ id: "from" }, { id: "to" }], edges: [edge], complete: true };
  const h = harness((url, body) => url === "/api/graph" ? ok(data) : ok(card(body.id)));
  const m = h.workspace;
  try {
    await m.graphPage();
    m.setGraphView({ nodeId: "from", edge: { source: "from", target: "to" }, occurrenceIndex: 1 });
    // Return from a card to its node, then traverse an older graph entry
    // using the newly read index, without issuing a third graph request.
    m.setGraphView({ nodeId: "to" });
    await m.openGraphCard({ id: "to" });
    edge.occurrences.unshift({ anchor: "cd-ref-new" });
    await m.backFromCard();
    await tick();
    m.graphBack();
    await tick();
    assert.equal(h.requests.filter(r => r.url === "/api/graph").length, 2);
    assert.equal(m.getSnapshot().graphView.occurrenceIndex, 2);
    assert.equal(m.getSnapshot().graphView.occurrenceAnchor, "cd-ref-second");
    assert.equal(m.getSnapshot().message, null);
    await m.openGraphSource(edge, edge.occurrences[2]);
    edge.occurrences.pop();
    await m.backFromCard();
    await tick();
    assert.equal(m.getSnapshot().graphView.occurrenceIndex, 0);
    assert.equal(m.getSnapshot().graphView.occurrenceAnchor, "cd-ref-new");
    assert.match(m.getSnapshot().message.text, /引用位置已有变化/);
  } finally { m.destroy(); }
});

test("scenario links restore position and the read-only request is discarded after leaving", async () => {
  const waiting = Promise.withResolvers();
  let requests = 0;
  const data = { catalog: { status: 'ready', groups: [] },
    disciplines: [{ id: 'discipline-research', items: [{ cardId: 'doc' }] }], cards: [{ id: 'doc' }] };
  const h = harness((url, body) => {
    if (url === '/api/scenarios') return ++requests === 3 ? waiting.promise : ok(data);
    if (url.endsWith('/list')) return ok({ items: [], total: 0 });
    if (url.endsWith('/get-document')) return ok(card(body.id));
    throw new Error(url);
  });
  const m = h.workspace;
  try {
    h.browser.history.replaceState({}, '', '/scenarios?view=discipline#discipline-research');
    await m.start();
    assert.equal(m.getSnapshot().scenarioData, data);
    assert.deepEqual(m.getSnapshot().scenarioPosition, { view: 'disciplines', categoryId: 'discipline-research', open: {}, cards: {} });
    m.setScenarioPosition({ cards: { 'discipline-research': 'doc' } });
    await m.navigate('doc', { focusId: 'atlas-card-discipline-research' });
    assert.equal(m.getSnapshot().scenarioReturn, true);
    await m.backFromCard();
    assert.deepEqual(m.getSnapshot().scenarioPosition, {
      view: 'disciplines', categoryId: 'discipline-research', cards: { 'discipline-research': 'doc' },
      top: 0, focusId: 'atlas-card-discipline-research', open: {},
    });
    const inFlight = m.loadScenarios();
    const request = h.requests.at(-1);
    assert.equal(request.options.method, 'GET');
    await m.listPage();
    assert.equal(request.options.signal.aborted, true);
    waiting.resolve(ok({ ...data, cards: [card('too-late')] }));
    await inFlight;
    assert.equal(m.getSnapshot().route, 'list');
    assert.equal(m.getSnapshot().scenarioData, data);
  } finally {
    waiting.resolve(ok(data));
    m.destroy();
  }
});

test("atlas cross-links keep the same card and return to the position in either atlas or detail", async () => {
  const data = {
    catalog: { groups: [{ id: "group-one", entries: [{ id: "scene-one", items: [{ cardId: "same-card" }] }] }] },
    disciplines: [{ id: "discipline-one", items: [{ cardId: "same-card" }] }],
  };
  const h = harness((path, body) => path === "/api/scenarios" ? ok(data)
    : path.endsWith("/get-document") ? ok(card(body.id)) : ok({}));
  const pane = { scrollTop: 0, scrollTo(_, top) { this.scrollTop = top; } };
  h.browser.document.getElementById = id => ({ workspace: pane, reader: {}, "atlas-heading": { focus() {} } })[id];
  const m = h.workspace;
  const discipline = { view: "disciplines", categoryId: "discipline-one", entryId: "discipline-one" };
  try {
    await m.scenarioPage({ position: { view: "scenes", categoryId: "group-one", open: { scenes: "scene-one" }, cards: { "scene-one": "same-card" } } });
    pane.scrollTop = 92;
    assert.equal(await m.jumpToAtlas(discipline, "same-card", "atlas-scene-link"), true);
    assert.equal(m.getSnapshot().scenarioPosition.cards["discipline-one"], "same-card");
    assert.equal(m.getSnapshot().scenarioPosition.open.disciplines, "discipline-one");
    m.setScenarioPosition({ open: { scenes: "scene-one", disciplines: null } });
    await m.loadScenarios();
    assert.equal(m.getSnapshot().message, null);
    assert.equal(m.getSnapshot().scenarioPosition.jumpEntry, undefined);
    m.backFromAtlasJump();
    await tick();
    assert.equal(m.getSnapshot().scenarioPosition.view, "scenes");
    assert.equal(m.getSnapshot().scenarioPosition.focusId, "atlas-scene-link");
    assert.equal(pane.scrollTop, 92);
    await m.jumpToAtlas(discipline, "same-card");
    await m.navigate("same-card");
    assert.equal(m.getSnapshot().scenarioSourceView, "disciplines");
    pane.scrollTop = 151;
    await m.jumpToAtlas({ view: "scenes", categoryId: "group-one", entryId: "scene-one" }, "same-card", "atlas-reader-link");
    m.backFromAtlasJump();
    await tick();
    assert.equal(m.getSnapshot().current.id, "same-card");
    assert.equal(m.getSnapshot().route, "detail");
    assert.equal(pane.scrollTop, 151);
  } finally { m.destroy(); }
});

test("atlas revisits restore browser preferences and direct category links take precedence", async () => {
  const data = {
    catalog: { status: "ready", groups: [{ id: "group-start", entries: [{ id: "scene-start", items: [{ cardId: "card-start" }] }] }] },
    disciplines: [{ id: "discipline-study", items: [{ cardId: "card-start" }] }],
  };
  const storage = new Map();
  const newVisit = url => {
    const h = harness(path => path === "/api/scenarios" ? ok(data) : ok({}));
    h.browser.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
    h.browser.history.replaceState({}, '', url);
    return h.workspace;
  };
  const first = newVisit('/scenarios');
  await first.start();
  first.setScenarioPosition({ view: "scenes", open: { scenes: "scene-start" }, cards: { "scene-start": "card-start" }, top: 180 });
  first.destroy();
  const next = newVisit('/scenarios');
  await next.start();
  assert.deepEqual(next.getSnapshot().scenarioPosition, {
    view: "scenes", categoryId: "", open: { scenes: "scene-start" }, cards: { "scene-start": "card-start" }, top: 180,
  });
  next.destroy();
  const direct = newVisit('/scenarios?view=discipline#discipline-study');
  await direct.start();
  assert.deepEqual(direct.getSnapshot().scenarioPosition,
    { view: "disciplines", categoryId: "discipline-study", open: {}, cards: {} });
  direct.destroy();
});

test("leaving atlas through browser history cannot rewrite the destination or lose a pending scroll", async () => {
  const h = harness(path => path === "/api/scenarios" ? ok({ catalog: { groups: [] }, disciplines: [] })
    : ok({ items: [], total: 0 }));
  const pane = { scrollTop: 0, scrollTo(_, top) { this.scrollTop = top; } };
  h.browser.document.getElementById = id => ({ workspace: pane, reader: {}, "atlas-heading": { focus() {} } })[id];
  const m = h.workspace;
  try {
    await m.start();
    await m.scenarioPage();
    pane.scrollTop = 173;
    m.trackScenarioScroll();
    h.browser.history.go(-1);
    await tick();
    assert.equal(m.getSnapshot().route, "list");
    assert.equal(h.browser.location.href, "http://localhost/cards");
    assert.equal(h.visits[0].state.cd_atlas_position, undefined);
    h.browser.history.go(1);
    await tick();
    assert.equal(m.getSnapshot().route, "scenarios");
    assert.equal(pane.scrollTop, 173);
  } finally { m.destroy(); }
});

test("native navigation to a new atlas fragment does not carry an outgoing scroll", async () => {
  const h = harness(path => path === "/api/scenarios" ? ok({
    catalog: { groups: [{ id: "group-later", entries: [] }] }, disciplines: [],
  }) : ok({}));
  const pane = { scrollTop: 0, scrollTo(_, top) { this.scrollTop = top; } };
  h.browser.document.getElementById = id => ({ workspace: pane, reader: {}, "atlas-heading": { focus() {} } })[id];
  const m = h.workspace;
  try {
    await m.scenarioPage();
    pane.scrollTop = 173;
    m.trackScenarioScroll();
    h.browser.history.pushState({}, '', '/scenarios#group-later');
    await h.listeners.get("popstate")({ state: null });
    await tick();
    assert.equal(m.getSnapshot().scenarioPosition.categoryId, "group-later");
    assert.equal(m.getSnapshot().scenarioPosition.top, undefined);
  } finally { m.destroy(); }
});

test("atlas card retry targets the failed link and slow atlas reads do not trap browser history", async () => {
  let unavailable = true;
  let atlasReads = 0;
  const waiting = Promise.withResolvers();
  const h = harness((url, body) => {
    if (url === '/api/scenarios') return ++atlasReads === 2 ? waiting.promise : ok({});
    if (url.endsWith('/get-document')) {
      if (unavailable) return { ok: false, status: 503, error: { code: 'transport_unknown' } };
      return ok(card(body.id));
    }
    throw new Error(url);
  });
  const m = h.workspace;
  try {
    await m.scenarioPage();
    assert.equal(await m.navigate('next-card', { focusId: "atlas-card-scene" }), false);
    assert.equal(m.getSnapshot().message.reload, true);
    unavailable = false;
    await m.reload();
    assert.equal(m.getSnapshot().current.id, 'next-card');
    assert.equal(h.browser.history.state.cd_atlas_origin.focusId, "atlas-card-scene");
    h.browser.history.go(-1);
    await tick();
    assert.equal(m.getSnapshot().route, 'scenarios');
    assert.equal(m.getSnapshot().scenarioLoading, true);
    const request = h.requests.at(-1);
    h.browser.history.go(1);
    await tick();
    assert.equal(m.getSnapshot().route, 'detail');
    assert.equal(request.options.signal.aborted, true);

    h.browser.history.go(-1);
    await tick();
    unavailable = true;
    const entries = h.visits.length;
    h.browser.history.go(1);
    await tick();
    assert.equal(m.getSnapshot().message.reload, true);
    assert.match(h.browser.location.href, /\/cards\/next-card$/);
    unavailable = false;
    await m.reload();
    assert.equal(m.getSnapshot().route, 'detail');
    assert.equal(h.visits.length, entries);
  } finally {
    waiting.resolve(ok({}));
    m.destroy();
  }
});

test("repeated retries from a parent load only the failed child, preserve its hash and push one history entry", async t => {
  const child = Promise.withResolvers();
  let childReads = 0;
  const h = harness((_, body) => {
    if (body.id === "parent") return ok(card(body.id));
    if (++childReads === 1) throw new Error("offline");
    return child.promise;
  });
  const m = h.workspace;
  t.after(() => m.destroy());
  await m.navigate("parent");
  await m.navigate("child", { hash: "#original-section", focusId: "child-link" });
  assert.equal(m.getSnapshot().current.id, "parent");
  assert.equal(m.getSnapshot().message.reload, true);
  const entries = h.visits.length;
  const first = m.reload();
  const second = m.reload();
  assert.deepEqual(h.requests.map(r => r.body.id), ["parent", "child", "child"]);
  child.resolve(ok(card("child")));
  await Promise.all([first, second]);
  assert.equal(m.getSnapshot().current.id, "child");
  assert.equal(m.getSnapshot().documentAnchor, "original-section");
  assert.equal(h.browser.location.href, "http://localhost/cards/child#original-section");
  assert.equal(h.visits.length, entries + 1);
  await m.reload();
  assert.equal(h.requests.length, 3, "there is no failed document to reload after success");
  h.browser.history.go(-1);
  await tick();
  assert.equal(m.getSnapshot().current.id, "parent");
});

test("leaving during a child retry cancels the read and discards the retry action", async t => {
  const child = Promise.withResolvers();
  let childReads = 0;
  const h = harness((_, body) => {
    if (body.id === "parent") return ok(card(body.id));
    if (++childReads === 1) throw new Error("offline");
    return child.promise;
  });
  const m = h.workspace;
  t.after(() => m.destroy());
  await m.navigate("parent");
  await m.navigate("child");
  const retry = m.reload();
  const signal = h.requests.at(-1).options.signal;
  await m.wikiPage();
  assert.equal(signal.aborted, true);
  child.resolve(ok(card("child")));
  await retry;
  await m.reload();
  assert.equal(h.requests.length, 3);
  assert.equal(m.getSnapshot().route, "wiki");
  assert.equal(h.browser.location.href, "http://localhost/wiki");
});

test("late atlas selection cannot overwrite a card history entry while Forward loads it", async () => {
  const deferred = Promise.withResolvers();
  let reads = 0;
  const h = harness((path, body) => {
    if (path === "/api/scenarios") return ok({});
    if (path.endsWith("/get-document")) return ++reads === 2 ? deferred.promise : ok(card(body.id));
    throw new Error(path);
  });
  const m = h.workspace;
  try {
    await m.scenarioPage();
    await m.navigate("forward-card");
    h.browser.history.go(-1);
    await tick();
    h.browser.history.go(1);
    await tick();
    assert.equal(m.getSnapshot().route, "scenarios");
    m.setScenarioPosition({ open: { scenes: "late" } });
    deferred.resolve(ok(card("forward-card")));
    await tick();
    assert.equal(h.browser.location.href, "http://localhost/cards/forward-card");
    assert.equal(m.getSnapshot().route, "detail");
  } finally {
    deferred.resolve(ok(card("forward-card")));
    m.destroy();
  }
});

test("startup reads cards with same-origin credentials and no model capability request", async t => {
  const h = harness(() => ok({ items: [card("direct")], total: 1 }));
  t.after(() => h.workspace.destroy());
  await h.workspace.start();
  assert.equal(h.workspace.getSnapshot().items[0].id, "direct");
  assert.deepEqual(h.requests.map(request => request.url), ["/api/v1/commands/list"]);
  assert.equal(h.requests[0].options.credentials, "same-origin");
});

test("source navigation restores the snapshot URL after Back and Forward", async t => {
  const h = harness(() => assert.fail("Source selection only changes the route"));
  t.after(() => h.workspace.destroy());
  h.browser.history.replaceState({}, "", "/wiki?source=first");
  await h.workspace.start();
  assert.equal(h.workspace.getSnapshot().wikiSourceId, "first");
  await h.workspace.wikiPage({ sourceId: "second" });
  assert.equal(h.browser.location.href, "http://localhost/wiki?source=second");
  h.browser.history.go(-1);
  await tick();
  assert.equal(h.workspace.getSnapshot().wikiSourceId, "first");
  h.browser.history.go(1);
  await tick();
  assert.equal(h.workspace.getSnapshot().wikiSourceId, "second");
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
    if (!url.endsWith("/get-document")) throw new Error(url);
    if (body.id === "article") return ok({ ...card("article"), html: "<p>长文正文</p>" });
    if (body.id === "legacy") return ok({
      ...card("legacy"), legacyFixedFields: true, editable: false,
      readings: [
        { id: "source", title: "出处" },
        { id: "article", title: "补充长文" },
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
    assert.deepEqual(current.readings, [{ id: 'source', title: '出处' }, { id: 'article', title: '补充长文' }]);
    assert.deepEqual(h.requests.filter(request => request.body?.id).map(request => request.body.id), ["legacy"]);
  } finally { h.workspace.destroy(); }
});

test("an unavailable supplementary article leaves its parent card and reading link available", async () => {
  const h = harness((url, body) => {
    if (body.id === "legacy") return ok({
      ...card("legacy"), legacyFixedFields: true, editable: false,
      readings: [{ id: "article", title: "补充长文" }],
    });
    return { ok: false, error: { code: "not_found" } };
  });
  try {
    assert.equal(await h.workspace.navigate("legacy"), true);
    const { current } = h.workspace.getSnapshot();
    assert.equal(current.id, "legacy");
    assert.deepEqual(current.readings, [{ id: 'article', title: '补充长文' }]);
  } finally { h.workspace.destroy(); }
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
    document.getElementById = (id) => ({ workspace: pane, reader: {}, "list-page": list, "search-input": search })[id];
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

for (const legacy of [
  { original: "/cards/new?q=example&page=2#list-page", canonical: "/cards?q=example&page=2#list-page", route: "list", command: "list" },
  { original: "/cards/record/edit?q=example&page=2#cd-ref-a", canonical: "/cards/record?q=example&page=2#cd-ref-a", route: "detail", command: "get-document" },
]) {
  test(`old ${legacy.route} link replaces its history entry and preserves filters and fragment`, async t => {
    const h = harness((url, body) => url.endsWith("/list") ? ok({ items: [], total: 40 }) : ok(card(body.id)));
    t.after(() => h.workspace.destroy());
    const state = { cd_index: 0, cd_list_position: { path: "/cards?q=example&page=2", id: "record", top: 40 } };
    h.browser.history.replaceState(state, "", legacy.original);
    await h.workspace.start();
    assert.equal(h.browser.location.href, "http://localhost" + legacy.canonical);
    assert.deepEqual(h.browser.history.state, state);
    assert.equal(h.workspace.getSnapshot().route, legacy.route);
    assert.equal(h.workspace.getSnapshot().page, 2);
    assert.equal(h.workspace.getSnapshot().query, "example");
    if (legacy.route === "detail") assert.equal(h.workspace.getSnapshot().documentAnchor, "cd-ref-a");
    assert.deepEqual(h.requests.map(({ url }) => url), ["/api/v1/commands/" + legacy.command]);
    await h.workspace.wikiPage();
    h.browser.history.go(-1);
    await tick();
    assert.equal(h.workspace.getSnapshot().route, legacy.route);
    assert.equal(h.browser.location.href, "http://localhost" + legacy.canonical);
    assert.equal(h.visits.length, 2);
  });
}

test("lists load tagged rows first and read complete facets only when requested for the current scope", async t => {
  const stale = Promise.withResolvers();
  let slow = true;
  const h = harness((url, body) => {
    assert.ok(url.endsWith("/list"));
    if (body.includeTags === "page")
      return ok({ items: [{ id: body.query || "home", tags: ["行标签"] }], total: 1 });
    if (!body.tag && slow) return stale.promise;
    return ok({ items: [{ id: "filtered" }], total: 1, tags: ["行标签", "另一页", body.query] });
  });
  const m = h.workspace;
  t.after(() => { stale.resolve(ok({ tags: ["旧标签"] })); m.destroy(); });
  await m.start();
  assert.deepEqual(h.requests.map(r => r.body.includeTags), ["page"]);
  assert.deepEqual(m.getSnapshot().items[0].tags, ["行标签"]);
  assert.deepEqual(m.getSnapshot().tags, []);
  const old = m.loadListTags();
  const facetRequest = h.requests.at(-1);
  assert.equal(facetRequest.body.includeTags, true);
  assert.equal(facetRequest.body.limit, 1);
  assert.equal(m.getSnapshot().tagsLoading, true);
  await m.loadListTags();
  assert.equal(h.requests.length, 2);
  await m.applyFilters({ query: "新", updatedFrom: "2026-11-01", updatedTo: "2026-11-30" });
  assert.equal(facetRequest.options.signal.aborted, true);
  stale.resolve(ok({ tags: ["旧标签"] }));
  await old;
  assert.deepEqual(m.getSnapshot().tags, []);
  slow = false;
  await m.loadListTags();
  assert.deepEqual(h.requests.at(-1).body, { includeTags: true, query: "新", updatedFrom: "2026-11-01",
    updatedTo: "2026-11-30", offset: 0, limit: 1, tag: "" });
  assert.deepEqual(m.getSnapshot().tags, ["行标签", "另一页", "新"]);
  await m.loadListTags();
  assert.equal(h.requests.length, 4);
  await m.applyFilters({ tag: "另一页" });
  assert.equal(h.requests.at(-1).body.includeTags, true);
  assert.equal(h.requests.at(-1).body.tag, "另一页");
  assert.equal(m.getSnapshot().items[0].id, "filtered");
  await m.loadListTags();
  assert.equal(h.requests.length, 5);
});

test("facet errors have an independent retry and leave table rows and count available", async t => {
  let unavailable = true;
  const h = harness((_, body) => {
    if (body.includeTags === "page") return ok({ items: [{ id: "first" }], total: 22 });
    if (unavailable) throw new TypeError("fetch failed");
    return ok({ tags: ["来自第二页"] });
  });
  const m = h.workspace;
  t.after(() => m.destroy());
  await m.start();
  const rows = m.getSnapshot().items;
  await m.loadListTags();
  assert.ok(m.getSnapshot().tagsError);
  assert.equal(m.getSnapshot().listError, false);
  assert.equal(m.getSnapshot().items, rows);
  assert.equal(m.getSnapshot().total, 22);
  unavailable = false;
  await m.loadListTags();
  assert.equal(m.getSnapshot().tagsError, "");
  assert.deepEqual(m.getSnapshot().tags, ["来自第二页"]);
  assert.equal(m.getSnapshot().items, rows);
});

test("the exact last list is interactive during revalidation and stale reads cannot overwrite a filter change", async t => {
  const refresh = Promise.withResolvers();
  const different = Promise.withResolvers();
  let reads = 0;
  const h = harness((url, body) => {
    if (url.endsWith("/get-document")) return ok(card(body.id));
    if (body.query === "new") return different.promise;
    if (++reads === 2) return refresh.promise;
    return ok({ items: [{ id: "old" }], total: 1 });
  });
  const m = h.workspace;
  t.after(() => m.destroy());
  await m.start();
  const cached = m.getSnapshot().items;
  await m.navigate("old");
  const returned = m.listPage({ restore: true });
  const request = h.requests.at(-1);
  assert.equal(m.getSnapshot().items, cached);
  assert.equal(m.getSnapshot().listLoading, false);
  assert.equal(m.getSnapshot().listRefreshing, true);
  const snapshots = [];
  const unsubscribe = m.subscribe(() => snapshots.push(m.getSnapshot()));
  const changed = m.applyFilters({ query: "new" });
  assert.equal(request.options.signal.aborted, true);
  assert.deepEqual(m.getSnapshot().items, []);
  refresh.resolve(ok({ items: [{ id: "late" }], total: 9 }));
  await returned;
  different.resolve(ok({ items: [{ id: "new" }], total: 1 }));
  await changed;
  unsubscribe();
  assert.equal(m.getSnapshot().items[0].id, "new");
  assert.ok(snapshots.every(snapshot => snapshot.query !== "new" || snapshot.items.every(item => item.id === "new")));
});

test("a failed cached list stays available and identical retry rows retain their identity", async t => {
  let unavailable = false;
  const h = harness(() => {
    if (unavailable) throw new Error("offline");
    return ok({ items: [{ id: "available", tags: ["A"] }], total: 1 });
  });
  const m = h.workspace;
  t.after(() => m.destroy());
  await m.start();
  const rows = m.getSnapshot().items;
  await m.wikiPage();
  unavailable = true;
  await m.listPage();
  assert.equal(m.getSnapshot().items, rows);
  assert.equal(m.getSnapshot().listLoading, false);
  assert.equal(m.getSnapshot().listRefreshing, false);
  assert.equal(m.getSnapshot().listError, true);
  assert.match(m.getSnapshot().listMessage, /上次/);
  unavailable = false;
  await m.loadList();
  assert.equal(m.getSnapshot().listError, false);
  assert.equal(m.getSnapshot().items, rows);
});

test("graph revisit retains the complete graph and newer interaction through partial, failed and identical refreshes", async t => {
  const data = { complete: true, total: 2, scanned: 2, nodes: [{ id: "A" }, { id: "B" }], edges: [] };
  const partial = { complete: false, total: 2, scanned: 1, nodes: [{ id: "A" }], edges: [] };
  const result = Promise.withResolvers();
  let reads = 0;
  const h = harness(url => {
    assert.equal(url, "/api/graph");
    switch (++reads) {
      case 2: return result.promise;
      case 3: throw new TypeError("fetch failed");
      default: return ok(structuredClone(data));
    }
  });
  const m = h.workspace;
  t.after(() => m.destroy());
  await m.graphPage();
  const cached = m.getSnapshot().graphData;
  await m.wikiPage();
  const returned = m.graphPage();
  assert.equal(m.getSnapshot().graphData, cached);
  assert.equal(m.getSnapshot().graphLoading, true);
  const view = { nodeId: "B", query: "B", camera: { x: 14, y: 5, k: 2 } };
  m.setGraphView(view);
  m.graphBack();
  await tick();
  assert.equal(reads, 2);
  h.browser.history.go(1);
  await tick();
  result.resolve(ok(partial));
  await returned;
  assert.equal(m.getSnapshot().graphData, cached);
  assert.deepEqual(m.getSnapshot().graphView, view);
  assert.match(m.getSnapshot().graphError, /1 \/ 2/);
  await m.loadGraph();
  assert.match(m.getSnapshot().graphError, /上次完整图谱/);
  assert.equal(m.getSnapshot().graphData, cached);
  await m.loadGraph();
  assert.equal(m.getSnapshot().graphData, cached);
  assert.equal(m.getSnapshot().graphError, "");
  assert.deepEqual(m.getSnapshot().graphView, view);
});

test("canvas cleanup after disposal cannot retain a position or replace another workspace's map", () => {
  const first = harness().workspace;
  const second = harness().workspace;
  try {
    const positions = first.graphPositions;
    const firstMap = { nodes: [{ id: "same", x: 10 }] };
    positions.save(() => firstMap);
    assert.equal(positions.snapshot, firstMap);
    first.destroy();
    assert.equal(positions.snapshot, undefined);
    assert.equal(second.graphPositions.snapshot, undefined);
    const secondMap = { nodes: [{ id: "same", x: 20 }] };
    second.graphPositions.save(() => secondMap);
    positions.save(() => assert.fail("a late canvas cleanup must discard its snapshot"));
    assert.equal(positions.snapshot, undefined);
    assert.equal(second.graphPositions.snapshot, secondMap);
  } finally { first.destroy(); second.destroy(); }
});

test("a cold partial graph is visible without becoming the next visit's cached graph", async t => {
  const partial = { complete: false, scanned: 1, total: 2, nodes: [{ id: "one" }], edges: [] };
  const waiting = Promise.withResolvers();
  let reads = 0;
  const h = harness(() => ++reads === 1 ? ok(partial) : waiting.promise);
  const m = h.workspace;
  t.after(() => m.destroy());
  await m.graphPage();
  assert.equal(m.getSnapshot().graphData, partial);
  await m.wikiPage();
  const next = m.graphPage();
  assert.equal(m.getSnapshot().graphData, null);
  waiting.resolve(ok({ ...partial, complete: true, total: 1 }));
  await next;
  assert.equal(m.getSnapshot().graphData.complete, true);
});

test("list and graph restore focus when a route chunk commits after the data and first frame", async t => {
  const graph = { complete: true, nodes: [{ id: "card" }], edges: [] };
  const h = harness((url, body) => url === "/api/graph" ? ok(graph) : url.endsWith("/list")
    ? ok({ items: [{ id: "card" }], total: 1 }) : ok(card(body.id)));
  const m = h.workspace;
  t.after(() => m.destroy());
  const document = h.browser.document;
  const pane = { scrollTop: 0, scrollTo(_, top) { this.scrollTop = top; } };
  const link = { dataset: { cardId: "card" }, focus() { document.activeElement = this; }, scrollIntoView() {} };
  const heading = { focus() { document.activeElement = this; } };
  const dom = { workspace: pane, reader: {} };
  document.getElementById = id => dom[id];
  await m.start();
  pane.scrollTop = 210;
  await m.navigate("card");
  await m.listPage({ restore: true });
  assert.equal(pane.scrollTop, 0);
  dom["list-page"] = { querySelectorAll: () => [link] };
  m.routeContentReady("list");
  assert.equal(document.activeElement, link);
  assert.equal(pane.scrollTop, 210);
  await m.graphPage();
  dom["graph-heading"] = heading;
  m.routeContentReady("graph");
  assert.equal(document.activeElement, heading);
  document.activeElement = link;
  m.routeContentReady("graph");
  assert.equal(document.activeElement, link);
});

test("reopening the tag chooser after a page read includes tags added to the library", async t => {
  let tags = ["原标签"], lookups = 0;
  const h = harness((_, body) => {
    if (body.includeTags === "page") return ok({ total: 40, items: [{ id: String(body.offset), tags: tags.slice(-1) }] });
    lookups++;
    return ok({ tags: [...tags] });
  });
  const m = h.workspace;
  t.after(() => m.destroy());
  await m.start();
  await m.loadListTags();
  await m.loadListTags();
  assert.equal(lookups, 1);
  tags = [...tags, "新标签"];
  await m.applyFilters({ page: 2 });
  assert.deepEqual(m.getSnapshot().items[0].tags, ["新标签"]);
  assert.equal(lookups, 1, "paging does not eagerly load all tags");
  await m.loadListTags();
  assert.deepEqual(m.getSnapshot().tags, tags);
  assert.equal(lookups, 2);
});

test("tags fetched while search is debouncing stay available when its rows arrive", { timeout: 2000 }, async t => {
  const h = harness((_, body) => body.includeTags === true ? ok({ tags: [body.query] }) :
    ok({ items: [{ id: body.query || "home" }], total: 1 }));
  const m = h.workspace;
  t.after(() => m.destroy());
  await m.start();
  const committed = Promise.withResolvers();
  m.subscribe(() => { if (m.getSnapshot().items[0]?.id === "新搜索") committed.resolve(); });
  m.setQuery("新搜索");
  await m.loadListTags();
  assert.deepEqual(m.getSnapshot().tags, ["新搜索"]);
  await committed.promise;
  assert.deepEqual(m.getSnapshot().tags, ["新搜索"]);
  await m.loadListTags();
  assert.equal(h.requests.filter(r => r.body.includeTags === true).length, 1);
});

test("a page change or route departure discards a facet read from the previous page", async t => {
  const first = Promise.withResolvers(), second = Promise.withResolvers();
  let lookups = 0;
  const h = harness((_, body) => body.includeTags === "page" ? ok({ total: 40, items: [{ id: String(body.offset) }] })
    : ++lookups === 1 ? first.promise : second.promise);
  const m = h.workspace;
  t.after(() => m.destroy());
  await m.start();
  const lookup = m.loadListTags();
  const request = h.requests.at(-1);
  await m.applyFilters({ page: 2 });
  assert.equal(request.options.signal.aborted, true);
  assert.equal(m.getSnapshot().tagsLoading, false);
  first.resolve(ok({ tags: ["上一页读取的快照"] }));
  await lookup;
  assert.deepEqual(m.getSnapshot().tags, []);
  await m.applyFilters({ updatedFrom: "2026-11-20" });
  assert.deepEqual(m.getSnapshot().tags, []);
  const pending = m.loadListTags();
  const stale = h.requests.at(-1);
  await m.wikiPage();
  assert.equal(stale.options.signal.aborted, true);
  second.resolve(ok({ tags: ["已离开"] }));
  await pending;
  await m.listPage();
  assert.deepEqual(m.getSnapshot().tags, []);
});

test("a pending tag chooser follows the selected-tag search through failure and retry", { timeout: 2000 }, async t => {
  const oldLookup = Promise.withResolvers(), rows = Promise.withResolvers(), started = Promise.withResolvers();
  let attempts = 0;
  const h = harness((_, body) => {
    if (body.query && body.tag) { started.resolve(); return rows.promise; }
    if (body.query && !body.tag) return ++attempts === 1 ? oldLookup.promise : ok({ tags: ["甲", "乙"] });
    return ok({ items: [{ id: "one" }], total: 1, tags: ["甲"] });
  });
  const m = h.workspace;
  t.after(() => m.destroy());
  await m.start();
  await m.applyFilters({ tag: "甲" });
  m.setQuery("新词");
  const chooser = m.loadListTags();
  const previous = h.requests.at(-1);
  await started.promise;
  assert.equal(previous.options.signal.aborted, true);
  assert.equal(m.getSnapshot().tagsLoading, true);
  oldLookup.resolve(ok({ tags: ["过期"] }));
  await chooser;
  const failed = Promise.withResolvers();
  m.subscribe(() => { if (m.getSnapshot().listError) failed.resolve(); });
  rows.reject(new Error("offline"));
  await failed.promise;
  assert.ok(m.getSnapshot().tagsError);
  await m.loadListTags();
  assert.deepEqual(m.getSnapshot().tags, ["甲", "乙"]);
});

test("list return still restores a fallback when shrinking the old table clamps scroll and blurs its link", async t => {
  const refresh = Promise.withResolvers();
  let reads = 0;
  const h = harness((url, body) => url.endsWith("/get-document") ? ok(card(body.id))
    : ++reads === 1 ? ok({ items: [{ id: "source" }], total: 45 })
    : reads === 2 ? refresh.promise : ok({ items: [{ id: "other" }], total: 1 }));
  const m = h.workspace;
  t.after(() => m.destroy());
  const document = h.browser.document;
  document.body = {};
  const pane = { scrollTop: 0, scrollTo(_, top) { this.scrollTop = top; } };
  const source = { dataset: { cardId: "source" }, focus() { document.activeElement = this; }, scrollIntoView() {} };
  const search = { focus() { document.activeElement = this; } };
  document.getElementById = id => ({
    reader: {}, workspace: pane, "list-page": { querySelectorAll: () => [source] }, "search-input": search,
  })[id];
  await m.applyFilters({ page: 3 });
  pane.scrollTop = 220;
  await m.navigate("source");
  const returning = m.listPage({ restore: true });
  assert.equal(document.activeElement, source);
  m.subscribe(() => {
    if (m.getSnapshot().page === 1 && m.getSnapshot().listLoading) {
      document.activeElement = document.body;
      pane.scrollTop = 0;
    }
  });
  refresh.resolve(ok({ items: [], total: 1 }));
  await returning;
  assert.equal(h.browser.location.href, "http://localhost/cards");
  assert.equal(document.activeElement, search);
});

test("inspector mount gives focus back to the saved graph action", async t => {
  const graph = { complete: true, nodes: [{ id: "one" }], edges: [] };
  const h = harness((url, body) => url === "/api/graph" ? ok(graph) : ok(card(body.id)));
  const m = h.workspace;
  t.after(() => m.destroy());
  const document = h.browser.document;
  const focusable = id => ({ id, focus() { document.activeElement = this; } });
  const mounted = { "graph-heading": focusable("graph-heading"), "graph-open-card": focusable("graph-open-card") };
  document.getElementById = id => mounted[id];
  await m.graphPage();
  m.setGraphView({ nodeId: "one" });
  await m.openGraphCard({ id: "one" });
  const frames = [];
  h.browser.requestAnimationFrame = callback => frames.push(callback);
  await m.backFromCard();
  document.activeElement = focusable("graph-selected-title");
  for (const callback of frames.splice(0)) callback();
  assert.equal(document.activeElement, mounted["graph-open-card"]);
});
