import { readRoute, routeHref, pageSize } from "./routes.mjs";
import { scrollWorkspaceTo } from "./lib/utils.mjs";
const scenarioPreferenceKey = "cd.atlas.position.v1";
const scenarioViews = ["scenes", "disciplines"];

function readScenarioPreference(browser) {
  try {
    const saved = JSON.parse(browser.localStorage?.getItem(scenarioPreferenceKey) ?? "null");
    if (!scenarioViews.includes(saved?.view)) return {};
    const record = value => value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [];
    return {
      view: saved.view,
      categoryId: typeof saved.categoryId === "string" ? saved.categoryId : "",
      open: Object.fromEntries(record(saved.open).filter(([view, entry]) =>
        scenarioViews.includes(view) && (entry === null || typeof entry === "string"))),
      cards: Object.fromEntries(record(saved.cards).filter(([, card]) => typeof card === "string")),
      ...(Number.isFinite(saved.top) && saved.top >= 0 && { top: saved.top }),
    };
  } catch { return {}; }
}

function alignScenarioPosition(position, data) {
  if (!data.catalog || !Array.isArray(data.disciplines)) return position;
  const groups = data.catalog.groups ?? [];
  const entries = { scenes: groups.flatMap(group => group.entries), disciplines: data.disciplines };
  const open = { ...position.open };
  let moved = false;
  for (const view of scenarioViews) {
    if (open[view] && !entries[view].some(entry => entry.id === open[view])) {
      delete open[view];
      moved ||= position.view === view;
    }
  }
  const cards = Object.fromEntries(Object.values(entries).flat().flatMap(entry =>
    entry.items.some(item => item.cardId === position.cards?.[entry.id]) ? [[entry.id, position.cards[entry.id]]] : []));
  const categories = position.view === "disciplines" ? data.disciplines : groups;
  const validCategory = !position.categoryId || categories.some(category => category.id === position.categoryId);
  const jumpEntry = position.jumpEntry && entries[position.view]?.some(entry => entry.id === position.jumpEntry)
    ? position.jumpEntry : undefined;
  return { ...position, open, cards, ...(!validCategory && { categoryId: "" }),
    ...(position.jumpEntry && { jumpEntry }),
    ...((moved || !validCategory) && { top: undefined, focusId: undefined }) };
}
export class RequestError extends Error {
  constructor(code, message, status = 0) { super(message); this.code = code; this.status = status; }
}
export function errorText(error, fallback = "操作未完成，请稍后重试。") {
  if (["outside_scope", "not_found", "identity_conflict"].includes(error.code)) return "未找到这张卡片，或它不在当前知识库中。";
  if (error.code === "transport_unknown") return "暂时无法连接知识库，请检查服务后重试。";
  return fallback;
}
export function formatDate(value) {
  if (!value) return "";
  const compact = String(value).match(/^(\d{4})(\d{2})(\d{2})/);
  const date = compact ? new Date(`${compact[1]}-${compact[2]}-${compact[3]}T12:00:00`) : new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function createWorkspace({ fetch: fetcher = globalThis.fetch, browser = globalThis.window,
  sessionId, onUnauthorized, setTitle = title => { browser.document.title = title; } } = {}) {
  const lifetime = new AbortController();
  const sessionHistory = value => !sessionId || value?.cd_auth === sessionId ? value : { cd_auth: sessionId };
  if (sessionId) {
    try { browser.localStorage?.removeItem(scenarioPreferenceKey); } catch { /* Storage may be disabled. */ }
  }
  const scenarioPreference = () => sessionId ? {} : readScenarioPreference(browser);
  const initialRoute = readRoute(browser.location.href);
  let state = { route: initialRoute.kind, ...initialRoute.filters, total: 0, tags: [], current: null,
    navigating: false, items: [], listLoading: false, listRefreshing: false, tagsLoading: false, tagsError: "", listMessage: "", listError: false, message: null,
    scenarioData: null, scenarioLoading: false, scenarioError: "",
    scenarioPosition: initialRoute.scenario ?? { view: "scenes" }, scenarioReturn: false,
    scenarioSourceView: null, scenarioRelationsData: null,
    graphData: null, graphView: {}, graphLoading: false, graphError: "", graphReturn: false, graphCanGoBack: false };
  const listeners = new Set();
  let listRequest;
  let tagsRequest;
  let listCache;
  let facets;
  let graphCache;
  let lastGraphPositions;
  let listReturn;
  let pendingContent;
  let documentRequest = 0;
  let scenarioRequest;
  let graphRequest;
  let scenarioScrollTimer;
  const scenarioHistoryScroll = new Map();
  let cardRequest;
  let queryTimer;
  let currentUrl = browser.location.href;
  const initialHistory = sessionHistory(browser.history.state);
  let historyIndex = initialHistory?.cd_index ?? 0;
  let destroyed = false;
  browser.history.replaceState({ ...initialHistory, cd_index: historyIndex }, "", currentUrl);
  function beginNavigation() {
    cardRequest?.controller.abort();
    cardRequest = undefined;
    return ++documentRequest;
  }
  const update = (patch) => {
    if (destroyed) return;
    if (patch.route && patch.route !== "graph" && state.route === "graph") {
      graphRequest?.abort();
      patch = { ...patch, graphData: null, graphLoading: false };
    }
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };
  const message = (text, options = {}) => update({ message: { text, ...options } });
  async function request(path, { method = "POST", body, signal } = {}) {
    signal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    signal.throwIfAborted();
    let response;
    try { response = await fetcher(path, { method, credentials: "same-origin", signal, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
    catch (error) { if (error.name === "AbortError") throw error; throw new RequestError("transport_unknown", "无法连接知识库"); }
    signal.throwIfAborted();
    if (response.status === 401 && onUnauthorized) {
      onUnauthorized();
      throw new RequestError("unauthorized", "会话已过期，请重新登录", 401);
    }
    let result;
    try { result = await response.json(); } catch { throw new RequestError("transport_unknown", "服务返回了无法确认的结果", response.status); }
    signal.throwIfAborted();
    if (!response.ok || !result.ok) {
      throw new RequestError(result.error?.code || "request_failed", result.error?.message || "请求未完成", response.status);
    }
    return result.data;
  }
  const command = (name, body) => request(`/api/v1/commands/${name}`, { body });
  const filters = () => ({query:state.query,tag:state.tag,updatedFrom:state.updatedFrom,updatedTo:state.updatedTo,page:state.page});
  const href = (kind, id, hash = "") => routeHref(kind, id, filters(), hash);
  function commitLocation(kind,id,{replace=false,hash='',listPosition=kind==='detail'?browser.history.state?.cd_list_position:undefined,
    scenarioOrigin = kind === 'detail' ? browser.history.state?.cd_atlas_origin : undefined,
    graphOrigin = kind === 'detail' ? browser.history.state?.cd_graph_origin : undefined,
    graphBase, routeFilters = filters() }={}) {
    if(!replace)historyIndex++;
    browser.history[replace?'replaceState':'pushState']({
      ...(replace && browser.history.state),
      ...(sessionId && { cd_auth: sessionId }),
      id: kind === "graph" ? undefined : id, cd_index:historyIndex, cd_list_position:listPosition,
      cd_graph_origin: graphOrigin, cd_graph_view: kind === "graph" ? id : undefined,
      cd_graph_base: kind === "graph" ? graphBase ?? historyIndex : undefined,
      cd_atlas_origin: scenarioOrigin, cd_atlas_position: kind === 'scenarios' ? id : undefined,
    },'',routeHref(kind,id,routeFilters,hash));
    currentUrl=browser.location.href;
  }
  function ownsGraphEntry() {
    return state.route === "graph" && currentUrl === browser.location.href &&
      browser.history.state?.cd_index === historyIndex && new URL(currentUrl).pathname === "/graph";
  }
  function setGraphView(view, { replace = false } = {}) {
    if (!ownsGraphEntry()) return;
    const base = browser.history.state.cd_graph_base ?? historyIndex;
    if (view.edge && (!view.occurrenceAnchor ||
        view.edge.source !== state.graphView.edge?.source || view.edge.target !== state.graphView.edge?.target ||
        view.occurrenceIndex !== state.graphView.occurrenceIndex)) {
      const edge = state.graphData?.edges.find(item => item.source === view.edge.source && item.target === view.edge.target);
      view = { ...view, occurrenceAnchor: edge?.occurrences[view.occurrenceIndex ?? 0]?.anchor };
    } else if (!view.edge && view.occurrenceAnchor) {
      const { occurrenceAnchor, ...withoutSource } = view;
      view = withoutSource;
    }
    if (!replace) beginNavigation();
    commitLocation("graph", view, { replace, graphBase: base });
    update({ graphView: view, graphCanGoBack: historyIndex > base, navigating: false, message: null });
  }
  // The data and a lazy route's DOM can arrive in either order. A failed DOM
  // lookup stays pending until the component reports its next committed render.
  function routeContentReady(kind) {
    const pending = pendingContent;
    if (!pending || pending.kind !== kind || pending.frame) return;
    pending.frame = true;
    browser.requestAnimationFrame(() => {
      pending.frame = false;
      if (pending !== pendingContent) return;
      if (destroyed || state.route !== kind || pending.requestId !== documentRequest || pending.run() !== false)
        pendingContent = undefined;
    });
  }
  function afterContent(kind, run) {
    pendingContent = { kind, run, requestId: documentRequest };
    routeContentReady(kind);
  }
  function focusMoved(previous) {
    const { activeElement, body } = browser.document;
    return activeElement && activeElement !== previous && activeElement !== body;
  }
  function restoreGraphFocus(previousFocus) {
    const id = browser.history.state?.cd_graph_focus;
    afterContent("graph", () => {
      // Opening the inspector focuses its heading as part of mounting. Returning
      // to a saved citation or card action completes that same focus handoff.
      const inspectorMounted = id && browser.document.activeElement?.id === "graph-selected-title";
      if (!ownsGraphEntry() || (!inspectorMounted && focusMoved(previousFocus))) return;
      const target = browser.document.getElementById(id || "graph-heading") ?? browser.document.getElementById("graph-heading");
      if (!target) return false;
      target.focus?.({ preventScroll: true });
      if (id) target.scrollIntoView?.({ block: "nearest" });
    });
  }
  function showGraphData(data) {
    let view = state.graphView;
    let lostSelection = false;
    if (view.nodeId && !data.nodes.some(node => node.id === view.nodeId)) {
      view = { ...view, nodeId: undefined, popup: false, edge: undefined, occurrenceIndex: 0, occurrenceAnchor: undefined };
      if (view.camera?.focusId) {
        const { focusId, ...camera } = view.camera;
        view.camera = camera;
      }
      lostSelection = true;
    } else if (view.edge) {
      const edge = data.edges.find(edge => edge.source === view.edge.source && edge.target === view.edge.target);
      if (!edge) {
        view = { ...view, edge: undefined, occurrenceIndex: 0, occurrenceAnchor: undefined };
        lostSelection = true;
      } else {
        const index = view.occurrenceAnchor ? edge.occurrences.findIndex(item => item.anchor === view.occurrenceAnchor)
          : view.occurrenceIndex ?? 0;
        lostSelection = index < 0 || index >= edge.occurrences.length;
        const occurrenceIndex = lostSelection ? 0 : index;
        const occurrenceAnchor = edge.occurrences[occurrenceIndex]?.anchor;
        if (occurrenceIndex !== view.occurrenceIndex || occurrenceAnchor !== view.occurrenceAnchor)
          view = { ...view, occurrenceIndex, occurrenceAnchor };
      }
    }
    if (view !== state.graphView) {
      browser.history.replaceState({ ...browser.history.state, cd_graph_view: view }, "", currentUrl);
      if (lostSelection) message("原来的卡片或引用位置已有变化，已显示当前可用的内容。");
    }
    const previousFocus = lostSelection ? browser.document.activeElement : null;
    update({ graphData: data, graphView: view });
    if (previousFocus?.id === "graph-open-source" || previousFocus?.id === "graph-open-card")
      restoreGraphFocus(previousFocus);
  }
  async function loadGraph() {
    graphRequest?.abort();
    const controller = new AbortController();
    graphRequest = controller;
    update({ graphLoading: true, graphError: "" });
    try {
      const data = await request("/api/graph", { method: "GET", signal: controller.signal });
      if (!ownsGraphEntry() || controller.signal.aborted) return;
      if (data.complete === false && graphCache) {
        const coverage = Number.isInteger(data.scanned) ? `本次已读取正文 ${data.scanned} / ${data.total ?? data.nodes.length} 张。` : "";
        update({ graphError: `部分知识卡未能读取。${coverage}仍显示上次完整图谱。` });
      } else {
        const signature = JSON.stringify(data);
        const display = graphCache?.signature === signature ? graphCache.data : data;
        if (data.complete === true) graphCache = { data: display, signature };
        if (data.complete === false) update({ graphData: display });
        else showGraphData(display);
      }
    } catch (error) {
      if (ownsGraphEntry() && !controller.signal.aborted)
        update({ graphError: errorText(error, "图谱暂时无法读取，请重试。") + (graphCache ? "仍显示上次完整图谱。" : "") });
    } finally {
      if (ownsGraphEntry() && !controller.signal.aborted) {
        update({ graphLoading: false });
        routeContentReady("graph");
      }
    }
  }
  async function graphPage({ replace = false, fromHistory = false, withinGraph = false } = {}) {
    const saved = (fromHistory || replace) ? browser.history.state : null;
    const view = saved?.cd_graph_view ?? {};
    const reuse = withinGraph && state.route === "graph" && state.graphData;
    const previousFocus = browser.document.activeElement;
    if (!fromHistory) saveScenarioScroll();
    stopScenarioRead();
    clearTimeout(queryTimer);
    stopListReads();
    beginNavigation();
    if (!fromHistory) commitLocation("graph", view, { replace, graphBase: saved?.cd_graph_base });
    currentUrl = browser.location.href;
    update({ route: "graph", current: null, navigating: false, message: null, graphView: view,
      graphReturn: false, graphCanGoBack: historyIndex > browser.history.state?.cd_graph_base,
      ...(!reuse && { graphError: "", graphLoading: true, graphData: graphCache?.data ?? null }) });
    setTitle("知识图谱 · Concept Discovery");
    if (reuse) {
      if (!state.graphLoading && !state.graphError && state.graphData.complete !== false) showGraphData(state.graphData);
    } else {
      const loading = loadGraph();
      if (graphCache) restoreGraphFocus(previousFocus);
      else {
        const entryRequest = documentRequest;
        void loading.then(() => {
          if (entryRequest === documentRequest && ownsGraphEntry()) restoreGraphFocus(previousFocus);
        });
      }
      if (!fromHistory) await loading;
    }
    return true;
  }
  function stopScenarioRead() {
    clearTimeout(scenarioScrollTimer);
    scenarioRequest?.abort();
    scenarioRequest = undefined;
  }
  function persistScenarioPosition(position) {
    if (sessionId) return;
    const { view, categoryId, open, cards, top } = position;
    try {
      browser.localStorage?.setItem(scenarioPreferenceKey, JSON.stringify({ view, categoryId, open, cards, top }));
    } catch { /* The current history entry still retains the position. */ }
  }
  function ownsScenarioEntry() {
    return state.route === 'scenarios' && browser.location.href === currentUrl &&
      browser.history.state?.cd_index === historyIndex && new URL(currentUrl).pathname === '/scenarios';
  }
  const scenarioEntryKey = () => `${historyIndex}\n${currentUrl}`;
  function recordScenarioPosition(position) {
    if (!ownsScenarioEntry()) return;
    scenarioHistoryScroll.delete(scenarioEntryKey());
    browser.history.replaceState({ ...browser.history.state, cd_atlas_position: position }, "", href('scenarios', position));
    currentUrl = browser.location.href;
    persistScenarioPosition(position);
  }
  function saveScenarioScroll({ departing = false } = {}) {
    clearTimeout(scenarioScrollTimer);
    if (state.route !== 'scenarios' || state.scenarioLoading || !state.scenarioData) return;
    const pane = browser.document.getElementById("workspace");
    if (!pane) return;
    if (departing) {
      const key = scenarioEntryKey();
      const top = scenarioHistoryScroll.get(key) ?? pane.scrollTop;
      scenarioHistoryScroll.set(key, top);
      persistScenarioPosition({ ...state.scenarioPosition, top });
    } else if (ownsScenarioEntry()) {
      recordScenarioPosition({ ...state.scenarioPosition, top: pane.scrollTop });
    }
  }
  function trackScenarioScroll() {
    if (!ownsScenarioEntry() || state.scenarioLoading || !state.scenarioData) return;
    const pane = browser.document.getElementById("workspace");
    if (pane) scenarioHistoryScroll.set(scenarioEntryKey(), pane.scrollTop);
    clearTimeout(scenarioScrollTimer);
    scenarioScrollTimer = setTimeout(saveScenarioScroll, 160);
  }
  function setScenarioPosition(patch) {
    if (!ownsScenarioEntry()) return;
    const pane = browser.document.getElementById("workspace");
    const current = state.scenarioPosition;
    const changedLocation = (patch.view && patch.view !== current.view) ||
      (patch.categoryId !== undefined && patch.categoryId !== current.categoryId) ||
      (patch.open && patch.open[current.view] !== current.open?.[current.view]);
    const position = { ...current, ...(changedLocation && { jumpEntry: undefined }),
      ...(pane && { top: pane.scrollTop }), ...patch };
    recordScenarioPosition(position);
    update({ scenarioPosition: position });
  }
  function rememberScenarioPosition(focusId) {
    const pane = browser.document.getElementById("workspace");
    const active = browser.document.activeElement;
    const position = { ...state.scenarioPosition, top: pane?.scrollTop ?? 0,
      focusId: focusId || (active?.id?.startsWith("atlas-") ? active.id : "atlas-heading") };
    setScenarioPosition(position);
    return position;
  }
  async function loadScenarios() {
    stopScenarioRead();
    const controller = new AbortController();
    scenarioRequest = controller;
    update({ scenarioLoading: true, scenarioError: "" });
    try {
      const data = await request("/api/scenarios", { method: "GET", signal: controller.signal });
      if (controller.signal.aborted || !ownsScenarioEntry()) return;
      const requested = state.scenarioPosition.jumpEntry;
      let position = alignScenarioPosition(state.scenarioPosition, data);
      const unavailable = requested && (!position.jumpEntry || position.open?.[position.view] !== requested || !position.cards?.[requested]);
      if (unavailable) {
        position = { ...position, jumpEntry: undefined, top: undefined, focusId: undefined };
        if (position.open?.[position.view] === requested) position.open = { ...position.open, [position.view]: null };
      }
      update({ scenarioData: data, scenarioRelationsData: data, scenarioLoading: false, scenarioPosition: position,
        ...(unavailable && { message: { text: "这张卡与目标分类的关联已有变化。", error: true } }) });
      recordScenarioPosition(position);
      afterContent("scenarios", () => {
        if (controller.signal.aborted || !ownsScenarioEntry()) return;
        if (!browser.document.getElementById("atlas-heading")) return false;
        const { top, focusId, categoryId, jumpEntry } = state.scenarioPosition;
        const document = browser.document;
        const pane = document.getElementById("workspace");
        const entry = jumpEntry
          ? document.getElementById(`atlas-preview-${jumpEntry}`) ?? document.getElementById(`atlas-entry-${jumpEntry}`)
          : null;
        const target = entry ?? (categoryId ? document.getElementById(categoryId) : null);
        if (Number.isFinite(top)) pane?.scrollTo(0, top);
        else if (target && !target.closest('[hidden]')) scrollWorkspaceTo(pane, target);
        else pane?.scrollTo(0, 0);
        if (focusId) {
          const focus = document.getElementById(focusId);
          (focus && !focus.closest('[hidden], details:not([open])') ? focus : document.getElementById("atlas-heading"))?.focus({ preventScroll: true });
        } else if (target && !target.closest('[hidden]')) {
          (entry ?? document.getElementById(`atlas-entry-${categoryId}`) ?? target).focus({ preventScroll: true });
        }
      });
    } catch {
      if (!controller.signal.aborted && ownsScenarioEntry())
        update({ scenarioLoading: false, scenarioError: "暂时无法读取场景图鉴，请稍后重试。" });
    }
  }
  async function scenarioPage({ replace = false, fromHistory = false, position = { view: "scenes", ...scenarioPreference() } } = {}) {
    clearTimeout(queryTimer);
    stopListReads();
    beginNavigation();
    update({ route: 'scenarios', navigating: false,
      message: null, scenarioPosition: position, scenarioData: null, scenarioError: "", scenarioLoading: true, scenarioReturn: false });
    if (!fromHistory) commitLocation('scenarios', position, { replace });
    currentUrl = browser.location.href;
    setTitle("场景图鉴 · Concept Discovery");
    const loading = loadScenarios();
    if (!fromHistory) await loading;
    return true;
  }
  async function backFromCard() {
    const graphIndex = browser.history.state?.cd_graph_origin;
    if (Number.isInteger(graphIndex) && graphIndex < historyIndex) {
      browser.history.go(graphIndex - historyIndex);
      return true;
    }
    const position = browser.history.state?.cd_atlas_origin;
    return position ? scenarioPage({ position }) : listPage({ restore: true });
  }
  async function jumpToAtlas(target, cardId, focusId) {
    const { view, categoryId, entryId } = target;
    if (!scenarioViews.includes(view) || !categoryId || !entryId || !cardId) return false;
    let source;
    if (ownsScenarioEntry() && !state.scenarioLoading) {
      source = rememberScenarioPosition(focusId);
    } else if (state.route === "detail" && state.current?.id === cardId &&
        browser.location.href === currentUrl && browser.history.state?.cd_index === historyIndex) {
      const pane = browser.document.getElementById("workspace");
      source = browser.history.state.cd_atlas_origin;
      if (!source) return false;
      browser.history.replaceState({ ...browser.history.state,
        cd_atlas_reader: { id: cardId, top: pane?.scrollTop ?? 0, focusId },
      }, "", currentUrl);
    } else return false;
    return scenarioPage({ position: {
      view, categoryId, jumpEntry: entryId,
      open: { ...source.open, [view]: entryId },
      cards: { ...source.cards, [entryId]: cardId },
      returnIndex: historyIndex,
    } });
  }
  function backFromAtlasJump() {
    if (!ownsScenarioEntry()) return;
    const { returnIndex } = state.scenarioPosition;
    if (Number.isInteger(returnIndex) && returnIndex < historyIndex) browser.history.go(returnIndex - historyIndex);
  }
  function rememberListPosition(id) {
    const pane = browser.document.getElementById("workspace");
    const items = state.items;
    if (!pane || !items?.some(item => item.id === id)) return null;
    const position = { path: href("list"), id, top: pane.scrollTop };
    // Back uses the original list entry. The detail entry also carries the
    // position for the explicit return action and subsequent detail navigation.
    browser.history.replaceState({ ...browser.history.state, cd_list_position: position }, "", currentUrl);
    return position;
  }
  function stopListReads(keepFacetKey) {
    listRequest?.abort();
    listRequest = undefined;
    if (tagsRequest && tagsRequest.key !== keepFacetKey) {
      tagsRequest.controller.abort();
      tagsRequest = undefined;
    }
  }
  function restoreListPosition() {
    const returning = listReturn;
    if (!returning || returning.requestId !== documentRequest) return;
    const { position } = returning;
    const present = state.items.some(item => item.id === position.id);
    // The initial cached result already restored the source. Only a removed
    // source needs a second handoff after reconciliation.
    if (returning.restored && present === returning.present) return;
    afterContent("list", () => {
      if (returning !== listReturn) return;
      if (state.listLoading) return false;
      const document = browser.document;
      const list = document.getElementById("list-page");
      if (!list) return false;
      const pane = document.getElementById("workspace");
      if (focusMoved(returning.focus)) return;
      const link = present && Array.from(list.querySelectorAll(".card-title-link")).find(item => item.dataset.cardId === position.id);
      if (present && !link) return false;
      const target = link || document.getElementById("search-input");
      if (!target) return false;
      if (link) {
        pane?.scrollTo(0, position.top);
        link.focus({ preventScroll: true });
        link.scrollIntoView({ block: "nearest" });
      } else target.focus();
      Object.assign(returning, { restored: true, focus: target, top: pane?.scrollTop, present });
    });
  }
  const facetFilters = ({ query, updatedFrom, updatedTo } = state) => ({ query: query.trim(), updatedFrom, updatedTo });
  const listKey = selected => routeHref("list", null, selected);
  function listMessage(data, selected) {
    if (data.items.length) return "";
    return selected.query || selected.tag || selected.updatedFrom || selected.updatedTo
      ? "没有找到匹配的卡片。调整筛选条件后重试。" : "还没有知识卡。";
  }
  async function loadListTags() {
    if (state.route !== "list" || state.navigating || tagsRequest) return;
    const scope = facetFilters();
    const key = JSON.stringify(scope);
    if (facets?.key === key) return;
    // A selected-tag list query already computes all facets for this scope.
    if (state.tag && listRequest) {
      update({ tagsLoading: true });
      return;
    }
    const controller = new AbortController();
    tagsRequest = { key, controller };
    update({ tagsLoading: true, tagsError: "" });
    try {
      const data = await request("/api/v1/commands/list", { body: { ...scope, tag: "", includeTags: true, offset: 0, limit: 1 },
        signal: controller.signal });
      if (controller.signal.aborted) return;
      facets = { key, tags: data.tags ?? [] };
      update({ tags: facets.tags });
    } catch (error) {
      if (!controller.signal.aborted) update({ tagsError: errorText(error, "暂时无法读取标签，请重试。") });
    } finally {
      if (!controller.signal.aborted) {
        tagsRequest = undefined;
        update({ tagsLoading: false });
      }
    }
  }
  async function loadList(routePatch = {}, inputFacetKey) {
    if ((routePatch.route ?? state.route) !== "list") return;
    const selected = { ...filters(), ...routePatch };
    const key = listKey(selected);
    const cached = listCache?.key === key ? listCache : null;
    const scope = facetFilters(selected);
    const facetKey = JSON.stringify(scope);
    // Typing starts a new search before its debounced row request. The chooser
    // can finish first. Only that same search can reuse its completed or pending read.
    const sameInput = inputFacetKey === facetKey;
    const rowRequestSuppliesTags = sameInput && selected.tag && tagsRequest?.key === facetKey;
    stopListReads(sameInput && !selected.tag ? facetKey : undefined);
    if (!sameInput) facets = undefined;
    const controller = new AbortController();
    listRequest = controller;
    update({ ...routePatch, items: cached?.items ?? [], total: cached?.total ?? 0, listLoading: !cached, listRefreshing: Boolean(cached),
      listMessage: cached ? listMessage(cached, selected) : "正在读取卡片…", listError: false,
      tags: facets?.tags ?? [], tagsLoading: Boolean(tagsRequest || rowRequestSuppliesTags), tagsError: sameInput ? state.tagsError : "" });
    if (cached) restoreListPosition();
    try {
      const data = await request("/api/v1/commands/list", { body: { ...scope, offset: (state.page - 1) * pageSize,
        limit: pageSize, tag: state.tag, includeTags: state.tag ? true : "page" }, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (state.tag) {
        facets = { key: facetKey, tags: data.tags ?? [] };
        update({ tags: facets.tags, tagsLoading: false, tagsError: "" });
      }
      if (listReturn?.restored && (focusMoved(listReturn.focus) || browser.document.getElementById("workspace")?.scrollTop !== listReturn.top))
        listReturn = undefined;
      const last = Math.max(1, Math.ceil(data.total / pageSize));
      if (state.page > last) {
        // Removing the old table can itself clamp scrollTop and blur its link.
        // The corrected page still owns the pending focus handoff.
        if (listReturn) listReturn.restored = false;
        listCache = undefined;
        const next = { ...filters(), page: last };
        commitLocation("list", null, { replace: true, routeFilters: next });
        return loadList(next);
      }
      const signature = JSON.stringify(data.items);
      const items = cached?.signature === signature ? cached.items : data.items;
      listCache = { key, signature, items, total: data.total };
      update({ items, total: data.total, listMessage: listMessage(data, selected), listLoading: false, listRefreshing: false });
      restoreListPosition();
    } catch (error) {
      if (!controller.signal.aborted) {
        const reason = error.code === "invalid_input" ? "请检查更新时间范围及筛选条件。" : errorText(error, "列表暂时无法读取，请稍后重试。");
        update({ listMessage: reason + (cached ? "仍显示上次读取的列表。" : ""), listError: true,
          listLoading: false, listRefreshing: false,
          ...(state.tag && state.tagsLoading && { tagsLoading: false, tagsError: "暂时无法读取标签，请重试。" }) });
      }
    } finally {
      if (listRequest === controller) listRequest = undefined;
    }
  }
  async function listPage({ replace = false, fromHistory = false, restore = fromHistory, hash = "", nextFilters = filters(), inputFacetKey } = {}) {
    if (!fromHistory) saveScenarioScroll();
    clearTimeout(queryTimer);
    stopScenarioRead();
    const position = restore ? browser.history.state?.cd_list_position : undefined;
    const requestId = beginNavigation();
    listReturn = position?.path === listKey(nextFilters) ? { position, requestId, focus: browser.document.activeElement } : undefined;
    if (!fromHistory) commitLocation("list", null, { replace, listPosition: position, hash, routeFilters: nextFilters });
    setTitle("知识卡 · Concept Discovery");
    await loadList({ ...nextFilters, route: "list", navigating: false, message: null }, inputFacetKey);
    return true;
  }
  async function applyFilters(patch) {
    clearTimeout(queryTimer);
    await listPage({ nextFilters: { ...filters(), ...patch, page: patch.page || 1 } });
  }
  function setQuery(value, { immediate = false } = {}) {
    clearTimeout(queryTimer);
    stopListReads();
    beginNavigation();
    listReturn = undefined;
    facets = undefined;
    update({ query: value, navigating: false, tags: [], tagsError: "", tagsLoading: false,
      listRefreshing: false, ...(value !== state.query && { items: [], total: 0, listLoading: true, listError: false }) });
    const nextFilters = { ...filters(), page: 1 };
    const submit = () => listPage({ nextFilters, inputFacetKey: JSON.stringify(facetFilters(nextFilters)) });
    if (immediate) return submit();
    queryTimer = setTimeout(submit, 250);
  }
  function navigate(id, { replace = false, fromHistory = false, hash = "", focusId } = {}) {
    beginNavigation();
    clearTimeout(queryTimer);
    if (state.route === "list") stopListReads();
    cardRequest = { id, hash, focusId, fromHistory, replace, controller: new AbortController() };
    return loadCard(cardRequest);
  }
  function loadCard(target, retry = false) {
    target.pending ??= readCard(target, retry).finally(() => { target.pending = undefined; });
    return target.pending;
  }
  async function readCard({ id, hash, focusId, fromHistory, replace, controller }, retry) {
    update({ navigating: true, ...(!retry && { message: null }), listRefreshing: false, listLoading: false, tagsLoading: false });
    try {
      const card = await request("/api/v1/commands/get-document", { body: { id }, signal: controller.signal });
      if (controller.signal.aborted) return false;
      const scenarioOrigin = !fromHistory && state.route === 'scenarios'
        ? rememberScenarioPosition(focusId) : browser.history.state?.cd_atlas_origin;
      const fromGraph = !fromHistory && ownsGraphEntry();
      const graphOrigin = fromGraph ? historyIndex : browser.history.state?.cd_graph_origin;
      if (fromGraph) {
        browser.history.replaceState({ ...browser.history.state,
          cd_graph_focus: focusId || browser.document.activeElement?.id }, "", currentUrl);
      }
      stopScenarioRead();
      stopListReads();
      const listPosition = !fromHistory && state.route === "list" ? rememberListPosition(id) : browser.history.state?.cd_list_position;
      const anchor = hash || (card.anchor ? `#${encodeURIComponent(card.anchor)}` : "");
      const savedReader = fromHistory ? browser.history.state?.cd_atlas_reader : undefined;
      const readerPosition = savedReader?.id === card.id ? savedReader : undefined;
      let documentAnchor = "";
      if (!readerPosition) {
        try { documentAnchor = decodeURIComponent(anchor.slice(1)); } catch {}
      }
      update({ route: "detail", current: card, documentAnchor, listLoading: false,
        message: null, graphReturn: Number.isInteger(graphOrigin),
        scenarioReturn: Boolean(scenarioOrigin), scenarioSourceView: scenarioOrigin?.view ?? null });
      if (!fromHistory) commitLocation('detail',card.id,{replace,hash:anchor,listPosition,scenarioOrigin,graphOrigin});
      currentUrl = browser.location.href;
      setTitle(`${card.title} · Concept Discovery`);
      afterContent("detail", () => {
        if (!browser.document.getElementById("reader")) return false;
        const pane = browser.document.getElementById("workspace");
        if (!documentAnchor) pane?.scrollTo(0, readerPosition?.top ?? 0);
        if (readerPosition?.focusId)
          (browser.document.getElementById(readerPosition.focusId) ?? pane)?.focus?.({ preventScroll: true });
      });
      return true;
    } catch (error) {
      if (!controller.signal.aborted) {
        if (fromHistory || replace) update({ route: "detail", current: null,
          graphReturn: Number.isInteger(browser.history.state?.cd_graph_origin),
          scenarioReturn: Boolean(browser.history.state?.cd_atlas_origin) });
        message(errorText(error, "正文暂时无法读取。请稍后重新读取。"), { error: true, reload: true });
      }
      return false;
    }
    finally { if (!controller.signal.aborted) update({ navigating: false }); }
  }
  async function applyLocation(replace=false, withinGraph=false){
    const route = readRoute(browser.location.href);
    if (route.redirect) {
      browser.history.replaceState({ ...browser.history.state, cd_index: historyIndex }, "", route.redirect);
      currentUrl = browser.location.href;
      replace = false;
    }
    clearTimeout(queryTimer);
    if (route.kind !== "graph") graphRequest?.abort();
    if (route.kind === 'list') return listPage({ replace, fromHistory: !replace, hash: route.hash, restore: true, nextFilters: route.filters });
    stopListReads();
    update({ ...route.filters, listLoading: false });
    if(route.kind==='wiki')return wikiPage({replace,fromHistory:!replace,sourceId:new URL(browser.location.href).searchParams.get('source')});
    if (route.kind === "graph") return graphPage({ replace, fromHistory: !replace, withinGraph });
    if (route.kind === 'scenarios') {
      const saved = browser.history.state?.cd_atlas_position;
      const explicitView = new URL(browser.location.href).searchParams.has("view") || route.scenario.categoryId || route.scenario.jumpEntry;
      const pendingTop = saved ? scenarioHistoryScroll.get(scenarioEntryKey()) : undefined;
      const position = saved || explicitView ? { ...saved, ...route.scenario,
        ...(saved?.open && route.scenario.open && { open: { ...saved.open, ...route.scenario.open } }),
        ...(saved?.cards && route.scenario.cards && { cards: { ...saved.cards, ...route.scenario.cards } }),
      }
        : { ...route.scenario, ...scenarioPreference() };
      if (Number.isFinite(pendingTop)) position.top = pendingTop;
      return scenarioPage({ replace, fromHistory: !replace, position });
    }
    if (route.kind === 'detail') return navigate(route.id, { replace, fromHistory: !replace, hash: route.hash });
    stopScenarioRead();
    beginNavigation();
    update({route:'missing',current:null,navigating:false,message:null});
  }
  function wikiPage({ replace = false, fromHistory = false, sourceId } = {}) {
    const entering = state.route !== "wiki";
    if (!fromHistory) saveScenarioScroll();
    stopScenarioRead();
    clearTimeout(queryTimer);stopListReads();beginNavigation();
    update({route:'wiki',navigating:false,message:null,wikiSourceId:sourceId??null});
    if(!fromHistory)commitLocation('wiki',sourceId,{replace});
    currentUrl=browser.location.href;setTitle('资料 · Concept Discovery');
    if (entering) browser.requestAnimationFrame(() => {
      if (state.route === "wiki") browser.document.getElementById("workspace")?.focus();
    });
    return true;
  }
  function popState(event) {
    const withinGraph = readRoute(currentUrl).kind === "graph" && readRoute(browser.location.href).kind === "graph";
    saveScenarioScroll({ departing: true });
    const entry = sessionHistory(event.state);
    historyIndex = entry?.cd_index ?? historyIndex + 1;
    currentUrl = browser.location.href;
    if (!Number.isInteger(entry?.cd_index)) {
      browser.history.replaceState({ ...entry, cd_index: historyIndex }, "", currentUrl);
    }
    return applyLocation(false, withinGraph);
  }
  browser.addEventListener("popstate", popState);
  browser.addEventListener("pagehide", saveScenarioScroll);
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, getSnapshot: () => state,
    start: () => applyLocation(true),
    navigate, loadList, loadListTags, listPage, applyFilters, href, setQuery, wikiPage, command, routeContentReady,
    scenarioPage, loadScenarios, setScenarioPosition, trackScenarioScroll, backFromCard,
    graphPage, loadGraph, setGraphView,
    graphPositions: {
      get snapshot() { return lastGraphPositions; },
      save(snapshot) { if (!destroyed) lastGraphPositions = snapshot(); },
    },
    graphBack() { if (ownsGraphEntry() && state.graphCanGoBack) browser.history.go(-1); },
    openGraphSource(edge, occurrence) {
      return navigate(edge.source, { hash: "#" + encodeURIComponent(occurrence.anchor), focusId: "graph-open-source" });
    },
    openGraphCard(node) { return navigate(node.id, { focusId: "graph-open-card" }); },
    jumpToAtlas, backFromAtlasJump,
    readAtlasRelations: signal => request("/api/scenarios", { method: "GET", signal }),
    setCardFragment(id) {
      if (state.route === "detail" && state.current) {
        commitLocation("detail", state.current.id, { replace: true, hash: `#${encodeURIComponent(id)}` });
      }
    },
    reload() {
      if (cardRequest && state.message?.reload) return loadCard(cardRequest, true);
    },
    destroy() {
      destroyed = true;
      lastGraphPositions = undefined;
      beginNavigation();
      lifetime.abort();
      stopListReads();
      graphRequest?.abort();
      stopScenarioRead();
      clearTimeout(queryTimer);
      browser.removeEventListener("popstate", popState);
      browser.removeEventListener("pagehide", saveScenarioScroll);
      listeners.clear();
    },
  };
}
