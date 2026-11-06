import { readRoute, routeHref, pageSize } from "./routes.mjs";
export class RequestError extends Error {
  constructor(code, message, status = 0) { super(message); this.code = code; this.status = status; }
}
export function errorText(error, fallback = "操作未完成，请稍后重试。") {
  if (error.status === 401) return "访问已过期，请重新登录。";
  if (["content_conflict", "version_conflict", "revision_conflict"].includes(error.code)) return "这张卡片已有新的修改。你的编辑仍保留，请核对后重新读取。";
  if (["write_locked", "operation_pending"].includes(error.code)) return "知识库正在处理另一次保存，请稍后核对再继续。";
  if (["read_only", "structure_conflict", "unsupported_structure"].includes(error.code)) return "这张卡片的结构暂不支持整篇保存。你的编辑仍保留，可请 Agent 按内容块维护。";
  if (error.code === "invalid_input") return "请检查标题和正文，标题不能为空，内容中不要加入内部维护标记。";
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

export function createWorkspace({ fetch: fetcher = globalThis.fetch, loadEditor = () => import("./editor.jsx"), browser = globalThis.window } = {}) {
  const initialRoute = readRoute(browser.location.href);
  let state = { route: initialRoute.kind, ...initialRoute.filters, total: 0, tags: [], current: null, authenticated: false, sessionLoading: true, loginBusy: false, loginMessage: "正在连接知识库…", loginError: false,
    editing: false, isNew: false, base: null, draft: { title: "", markdown: "" }, pending: null, busy: false, navigating: false, uploading: false,
    editorLoading: false, Editor: null, editorSession: 0, preview: false, items: [], listLoading: false, listMessage: "", listError: false, hasMore: false,
    documentStatus: "选择一张卡片", message: null, deletionReceipt: null, confirmOpen: false,
    listMode: initialRoute.mode, askAvailable: false, askQuestion: "", askResult: null, askBusy: false, askMessage: null };
  const listeners = new Set();
  let editor;
  let editorPromise;
  let listRequest = 0;
  let documentRequest = 0;
  let queryTimer;
  let activeAsk;
  let askViewId;
  const askViews = new Map();
  let confirmResolve;
  let currentUrl = browser.location.href;
  let historyIndex = browser.history.state?.cd_index ?? 0;
  let pendingHistory;
  let historyMovement = Promise.resolve();
  let historyMoveCompletion;
  let destroyed = false;
  browser.history.replaceState({ ...browser.history.state, cd_index: historyIndex }, "", currentUrl);
  const update = (patch) => { if (destroyed) return; state = { ...state, ...patch }; listeners.forEach((listener) => listener()); };
  const message = (text = "", options = {}) => update({ message: text ? { text, checkLabel: state.pending?.command === "delete-document" ? "核对删除结果" : undefined, ...options } : null });
  const draft = () => ({ title: state.draft.title, markdown: editor?.getValue() ?? state.draft.markdown });
  const dirty = () => state.editing && (draft().title !== state.base?.title || draft().markdown !== state.base?.markdown);
  const protectedDraft = () => Boolean(state.pending || state.uploading || dirty());
  const uncertain = (error) => error.status === 401 || error.status >= 500 || ["transport_unknown", "readback_conflict", "operation_pending"].includes(error.code);
  function abortAsk() {
    if (!activeAsk) return;
    const request = activeAsk;
    activeAsk = undefined;
    request.abort();
    update({ askBusy: false });
  }
  function clearAsk() {
    abortAsk();
    askViews.clear();
    askViewId = undefined;
    update({ askQuestion: "", askResult: null, askMessage: null });
  }
  function showLogin(text = "") {
    clearAsk();
    update({ authenticated: false, sessionLoading: false, loginMessage: text, loginError: false, askAvailable: false });
  }
  async function request(path, { method = "POST", body, signal } = {}) {
    let response;
    try { response = await fetcher(path, { method, credentials: "same-origin", signal, headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) }); }
    catch (error) { if (error.name === "AbortError") throw error; throw new RequestError("transport_unknown", "无法连接知识库"); }
    signal?.throwIfAborted();
    let result;
    try { result = await response.json(); } catch { throw new RequestError("transport_unknown", "服务返回了无法确认的结果", response.status); }
    signal?.throwIfAborted();
    if (!response.ok || !result.ok) {
      if (response.status === 401 && path !== "/api/session") showLogin("连接已过期，请重新输入访问码。编辑内容仍保留在此页面。");
      throw new RequestError(result.error?.code || "request_failed", result.error?.message || "请求未完成", response.status);
    }
    return result.data;
  }
  const command = (name, body) => request(`/api/v1/commands/${name}`, { body });
  async function guard() {
    if (state.confirmOpen) return false;
    if (state.uploading) { message("图片仍在上传，请等上传完成后再切换卡片。正文仍保留。"); return false; }
    if (state.pending) { message(state.pending.command === "delete-document" ? "请先核对删除结果。" : "上一次保存的结果尚未确认，请先核对。编辑内容仍保留。", { check: true }); return false; }
    if (!dirty()) return true;
    update({ confirmOpen: true });
    return new Promise((resolve) => { confirmResolve = resolve; });
  }
  function decideLeave(leave) {
    const resolve = confirmResolve;
    confirmResolve = undefined;
    update({ confirmOpen: false });
    resolve?.(leave);
  }
  const filters = () => ({query:state.query,tag:state.tag,updatedFrom:state.updatedFrom,updatedTo:state.updatedTo,page:state.page});
  const href = (kind, id, hash = "") => routeHref(kind, id, filters(), hash, state.listMode);
  function commitLocation(kind,id,{replace=false,hash='',listPosition=kind==='detail'||kind==='edit'?browser.history.state?.cd_list_position:undefined}={}) {
    if(!replace)historyIndex++;
    browser.history[replace?'replaceState':'pushState']({
      id, cd_index:historyIndex, cd_list_position:listPosition,
      cd_ask_view: state.listMode === "ask" ? askViewId : undefined,
    },'',href(kind,id,hash));
    currentUrl=browser.location.href;
  }
  function rememberListPosition(id) {
    const pane = browser.document.getElementById("workspace");
    const items = state.listMode === "ask" ? state.askResult?.data.cards : state.items;
    if (!pane || !items?.some(item => item.id === id)) return null;
    const position = { path: href("list"), id, top: pane.scrollTop, viewId: askViewId };
    // Back uses the original list entry. The detail entry also carries the
    // position for the explicit return action and subsequent detail navigation.
    browser.history.replaceState({ ...browser.history.state, cd_list_position: position }, "", currentUrl);
    return position;
  }
  function restoreListPosition(position, requestId, previousFocus) {
    // A changed result count can clamp the original page during the reload.
    const { page } = readRoute(position.path).filters;
    browser.requestAnimationFrame(() => {
      const asking = state.listMode === "ask";
      if (requestId !== documentRequest || state.route !== "list" ||
          (asking ? position.viewId !== askViewId || state.askBusy : state.listLoading || state.listError) ||
          position.path !== routeHref("list", null, { ...filters(), page }, "", state.listMode)) return;
      const document = browser.document;
      const list = document.getElementById("list-page");
      const focus = document.activeElement;
      if (!list || list.contains(focus) || (focus !== previousFocus && focus !== document.body)) return;
      const link = Array.from(list.querySelectorAll(".card-title-link")).find(item => item.dataset.cardId === position.id);
      if (!link) { document.getElementById(asking ? "ask-question" : "search-input")?.focus(); return; }
      document.getElementById("workspace")?.scrollTo(0, position.top);
      link.focus({ preventScroll: true });
      link.scrollIntoView({ block: "nearest" });
    });
  }
  async function loadList() {
    if (state.listMode === "ask") return;
    const requestId=++listRequest;
    update({listLoading:true,listMessage:'正在读取卡片…',listError:false});
    try {
      const data=await command('list',{offset:(state.page-1)*pageSize,limit:pageSize,query:state.query.trim(),tag:state.tag,updatedFrom:state.updatedFrom,updatedTo:state.updatedTo,includeTags:true});
      if(requestId!==listRequest)return;
      const last=Math.max(1,Math.ceil(data.total/pageSize));
      if(state.page>last){update({page:last});if(state.route==='list')commitLocation('list',null,{replace:true});return loadList();}
      update({items:data.items,total:data.total,tags:data.tags||[],hasMore:data.hasMore,listMessage:data.items.length?'':state.query||state.tag||state.updatedFrom||state.updatedTo?'没有找到匹配的卡片。调整筛选条件后重试。':'还没有知识卡。新建第一张卡片吧。'});
    }catch(error){if(requestId===listRequest)update({listMessage:error.code==='invalid_input'?'请检查更新时间范围及筛选条件。':errorText(error,'列表暂时无法读取，请稍后重试。'),listError:true});}
    finally{if(requestId===listRequest)update({listLoading:false});}
  }
  async function listPage({protect=true,replace=false,fromHistory=false,restore=fromHistory}={}){
    if(protect&&!await guard())return false;
    const listPosition = restore ? browser.history.state?.cd_list_position : undefined;
    const restorePosition = listPosition?.path === href("list");
    const previousFocus = browser.document.activeElement;
    const requestId = ++documentRequest;
    update({route:'list',editing:false,isNew:false,base:null,navigating:false,editorLoading:false,message:null,documentStatus:'知识卡'});
    if(!fromHistory)commitLocation('list',null,{replace,listPosition});
    browser.document.title='知识卡 · Concept Discovery';
    await loadList();
    if(restorePosition)restoreListPosition(listPosition,requestId,previousFocus);
    return true;
  }
  async function applyFilters(patch){
    if(!await guard())return;
    clearTimeout(queryTimer);++listRequest;update({...patch,page:patch.page||1});
    await listPage({protect:false});
  }
  function setQuery(value,{immediate=false}={}){
    clearTimeout(queryTimer);++listRequest;update({query:value});
    if(immediate)return applyFilters({query:value});
    queryTimer=setTimeout(()=>void applyFilters({query:value}),250);
  }
  async function switchListMode(mode) {
    if (!["ask", "keyword"].includes(mode) || state.route !== "list" || state.listMode === mode || !await guard()) return;
    clearTimeout(queryTimer);
    ++listRequest;
    abortAsk();
    const previous = mode === "ask" ? [...askViews.entries()].at(-1) : undefined;
    askViewId = previous?.[0];
    update({
      listMode: mode, listLoading: false,
      askQuestion: previous?.[1].question ?? "", askResult: previous?.[1] ?? null, askMessage: null,
    });
    return listPage({ protect: false });
  }
  async function submitAsk() {
    const question = state.askQuestion.trim();
    if (!state.authenticated || state.route !== "list" || state.listMode !== "ask" ||
        !state.askAvailable || state.askBusy || state.navigating || state.editorLoading ||
        !question || Array.from(question).length > 1000) return;
    const requestController = new AbortController();
    activeAsk = requestController;
    askViewId = crypto.randomUUID();
    const viewId = askViewId;
    commitLocation("list", null);
    update({ askQuestion: question, askBusy: true, askResult: null, askMessage: null });
    try {
      const data = await request("/api/v1/commands/ask", { body: { question }, signal: requestController.signal });
      if (activeAsk !== requestController) return;
      const result = { question, data };
      askViews.set(viewId, result);
      if (askViews.size > 5) askViews.delete(askViews.keys().next().value);
      update({ askResult: result });
    } catch (error) {
      if (activeAsk === requestController) {
        const text = error instanceof RequestError && error.code.startsWith("ask_")
          ? error.message : "本次分析未完成。请重试，或使用关键词搜索。";
        update({ askMessage: { text, error: true } });
      }
    } finally {
      if (activeAsk === requestController) {
        activeAsk = undefined;
        update({ askBusy: false });
      }
    }
  }
  function cancelAsk() {
    if (!activeAsk) return;
    abortAsk();
    update({ askMessage: { text: "本次分析已取消。" } });
  }
  async function navigate(id, { replace = false, fromHistory = false, hash = "", protect = true } = {}) {
    if (protect && !await guard()) return false;
    clearTimeout(queryTimer);
    abortAsk();
    const requestId = ++documentRequest;
    update({ navigating: true, documentStatus: "正在读取…" });
    try {
      const card = await command("get-document", { id });
      if (requestId !== documentRequest) return false;
      const chineseArticle = card.legacyFixedFields && card.readings?.find(reading => reading.locale === "cn" && reading.title === "中文长文");
      let primaryReading;
      if (chineseArticle) {
        try {
          const article = await command("get-document", { id: chineseArticle.id });
          if (article.html) primaryReading = { id: article.id, html: article.html };
        } catch (error) {
          if (error.status === 401) throw error;
          // The original card and its reading link remain available on failure.
        }
      }
      if (requestId !== documentRequest) return false;
      const listPosition = !fromHistory && state.route === "list" ? rememberListPosition(id) : undefined;
      update({ route: "detail", current: { ...card, primaryReading }, editing: false, isNew: false, base: null, preview: false, pending: null, documentStatus: "知识卡", message: null });
      const anchor = hash || (card.anchor ? `#${encodeURIComponent(card.anchor)}` : "");
      if (!fromHistory) commitLocation('detail',card.id,{replace,hash:anchor,listPosition});
      currentUrl = browser.location.href;
      browser.document.title = `${card.title} · Concept Discovery`;
      browser.requestAnimationFrame(() => {
        browser.document.getElementById("workspace")?.scrollTo(0, 0);
        if (anchor) { try { browser.document.getElementById(decodeURIComponent(anchor.slice(1)))?.scrollIntoView(); } catch {} }
      });
      return true;
    } catch (error) {
      if (requestId === documentRequest) {
        if (fromHistory || !state.editing) update({ current: null, editing: false, base: null });
        message(errorText(error, "正文暂时无法读取。请稍后重新读取。"), { error: true, reload: true });
        update({ documentStatus: "读取未完成" });
      }
      return false;
    }
    finally { if (requestId === documentRequest) update({ navigating: false }); }
  }
  async function showApp(session) {
    update({ authenticated: true, sessionLoading: false, loginMessage: "", loginError: false, askAvailable: session.askAvailable === true });
    if (state.editing || state.current) return;
    await applyLocation(true);
  }
  async function applyLocation(replace=false){
    const route=readRoute(browser.location.href);
    clearTimeout(queryTimer);
    ++listRequest;
    abortAsk();
    const storedId = route.mode === "ask" ? browser.history.state?.cd_ask_view : undefined;
    const result = askViews.get(storedId);
    askViewId = result ? storedId : undefined;
    update({
      ...(route.mode === "keyword" ? route.filters : {}),
      listMode: route.mode, listLoading: false,
      askQuestion: result?.question ?? "", askResult: result ?? null, askMessage: null,
    });
    if(route.kind==='list')return listPage({protect:false,replace,fromHistory:!replace});
    if(route.kind==='new')return editCard({isNew:true,protect:false,replace,fromHistory:!replace});
    if(route.kind==='detail'||route.kind==='edit'){
      const loaded=await navigate(route.id,{protect:false,replace,fromHistory:!replace,hash:route.hash});
      if(loaded&&route.kind==='edit')return editCard({protect:false,replace:true,fromHistory:!replace});
      return;
    }
    update({route:'missing',editing:false,documentStatus:'页面不存在'});
  }
  async function login(accessCode) {
    update({ loginBusy: true, loginMessage: "正在进入…", loginError: false });
    try { await showApp(await request("/api/session", { body: { accessCode } })); }
    catch (error) { update({ loginMessage: error.status === 401 || error.status === 403 ? "访问码不正确，请重新输入。" : "暂时无法进入知识库，请检查服务后重试。", loginError: true }); }
    finally { update({ loginBusy: false }); }
  }
  async function editCard({ isNew = false, protect = true, replace = false, fromHistory = false } = {}) {
    if ((protect && !await guard()) || state.editorLoading) return;
    if (!isNew && (!state.current || !state.current.editable)) return;
    clearTimeout(queryTimer);
    abortAsk();
    const requestId = ++documentRequest;
    update({ editorLoading: true, documentStatus: "正在加载编辑器…" });
    try {
      if (!editorPromise) editorPromise = loadEditor().catch((error) => { editorPromise = undefined; throw error; });
      const { default: Editor } = await editorPromise;
      if (requestId !== documentRequest) return;
      const base = isNew ? { title: "", markdown: "" } : { title: state.current.title, markdown: state.current.markdown };
      editor = null;
      update({ route: isNew ? "new" : "edit", Editor, editing: true, isNew, base, draft: { ...base }, editorSession: state.editorSession + 1, preview: false, navigating: false, message: null, documentStatus: isNew ? "新建知识卡" : "编辑知识卡" });
      if(!fromHistory)commitLocation(isNew?"new":"edit",state.current?.id,{replace});
      browser.document.title=(isNew?"新增知识卡":"编辑知识卡")+" · Concept Discovery";
      browser.requestAnimationFrame(() => { browser.document.getElementById("workspace")?.scrollTo(0, 0); if (isNew) browser.document.getElementById("edit-title")?.focus(); else editor?.focus(); });
    } catch { if (requestId === documentRequest) message("编辑器未能加载，卡片原文仍保留。请稍后重新点击编辑。", { error: true }); }
    finally { update({ editorLoading: false }); }
  }
  async function finishSave(result) {
    const id = result.id || result.documentId;
    if (await navigate(id, { protect: false, replace: true })) { message("已保存。网页和 Agent 读取的是同一份知识。"); await loadList(); }
    else message("保存已完成，但暂时无法重新读取正文。编辑内容仍保留，请稍后核对。", { check: true });
  }
  async function finishPending(pending, result) {
    if (pending.command !== "delete-document") return finishSave(result);
    if (result.id !== pending.input.id || result.deleted !== true)
      throw new RequestError("operation_pending", "删除结果尚未核对。");
    clearAsk();
    update({ current: null, pending: null, listMode: "keyword", deletionReceipt: pending.input.op_id });
    await listPage({ protect: false, replace: true, restore: true });
  }
  async function deleteCard({ id, revision }) {
    if (state.route !== "detail" || state.navigating || state.editorLoading || state.busy || state.pending ||
        !state.current?.deletable || state.current.id !== id || state.current.revision !== revision) return;
    const input = Object.freeze({ op_id: crypto.randomUUID(), id, expected_revision: revision });
    update({ pending: { command: "delete-document", input } });
    await submitPending();
  }
  async function submitPending() {
    const pending = state.pending;
    if (!pending || state.busy) return;
    const deleting = pending.command === "delete-document";
    update({ pending: { ...pending, retryAllowed: false }, busy: true });
    message(deleting ? "正在删除…" : "正在保存…");
    try { await finishPending(pending, await command(pending.command, pending.input)); }
    catch (error) {
      if (uncertain(error)) message(deleting ? "删除结果尚未确认，请先核对。" : "保存结果尚未确认，编辑内容仍保留。请先核对结果，再继续操作。", { error: true, check: true });
      else {
        update({ pending: null });
        const text = deleting && error.code === "content_conflict" ? "卡片已修改，请重新读取后再删除。" : errorText(error);
        message(text, { error: true, reload: Boolean(state.current) });
      }
    } finally { update({ busy: false }); }
  }
  async function save() {
    if (state.busy || state.pending || state.uploading || state.navigating || !state.draft.title.trim() || (!state.isNew && !dirty())) return;
    const content = draft();
    const input = Object.freeze(state.isNew ? { op_id: crypto.randomUUID(), document: Object.freeze(content) } : { op_id: crypto.randomUUID(), id: state.current.id, expected_revision: state.current.revision, ...content });
    update({ draft: content, pending: { command: state.isNew ? "create" : "save-document", input } });
    await submitPending();
  }
  async function checkOperation() {
    if (!state.pending || state.busy) return;
    const pending = state.pending;
    const deleting = pending.command === "delete-document";
    update({ busy: true });
    try {
      const result = await command("operation-status", { op_id: pending.input.op_id });
      if (result.state === "verified") await finishPending(pending, result.result || result);
      else if (result.state === "failed") { update({ pending: null }); message(deleting ? "删除未完成，请重新读取卡片。" : "本次保存未完成。编辑内容仍保留，请重新读取卡片后核对。", { error: true, reload: Boolean(state.current) }); }
      else if (["unknown", "prepared"].includes(result.state) && deleting) {
        update({ pending: { ...pending, retryAllowed: true } });
        message("删除尚未确认。可以核对结果，或继续同一次删除。", { check: true, retry: true, retryLabel: "继续删除" });
      }
      else if (["unknown", "prepared"].includes(result.state) && pending.command === "create") { update({ pending: { ...pending, retryAllowed: true } }); message("这张卡片的创建已经开始，尚未完成。编辑内容仍保留，可以继续完成创建，不会另建一张卡片。", { check: true, retry: true, retryLabel: "继续完成创建" }); }
      else { update({ pending: { ...pending, retryAllowed: false } }); message(deleting ? "请稍后再次核对删除结果。" : "这次保存还没有可确认的结果。请保持此页面，稍后再次核对。", { check: true }); }
    } catch (error) {
      const missing = ["operation_conflict", "not_found"].includes(error.code);
      update({ pending: { ...pending, retryAllowed: missing } });
      message(missing ? deleting ? "尚未找到删除记录。服务恢复后，可用同一次请求重试。" : "尚未找到本次保存的记录。服务恢复后，可用同一次请求重试，编辑内容仍保留。" : errorText(error), { error: true, check: true, retry: missing });
    } finally { update({ busy: false }); }
  }
  async function uploadImages(files, { insert = true } = {}) {
    if (!files.length || !state.editing || state.pending || state.busy || state.uploading || state.navigating || state.preview) return;
    update({ uploading: true });
    const inserted = [];
    const paths = [];
    try {
      for (const file of files) { const form = new FormData(); form.append("files[]", file); const result = await request("/api/assets", { body: form }); paths.push(result.path); inserted.push(`![${file.name.replace(/[\[\]\\\r\n]/g, "")}](${result.path})`); }
      update({ uploading: false }); if (insert) editor?.insert(inserted.join("\n\n")); message("图片已插入正文，保存卡片后即可一起读取。");
      return paths;
    } catch (error) { update({ uploading: false }); if (insert && inserted.length) editor?.insert(inserted.join("\n\n")); message("图片未能全部插入，已上传的图片和正文仍保留。" + errorText(error, "请检查图片格式和大小后重试。"), { error: true }); return paths; }
    finally { update({ uploading: false }); }
  }
  async function logout() {
    if (!await guard()) return;
    clearAsk();
    try { await request("/api/session", { method: "DELETE" }); clearTimeout(queryTimer); ++documentRequest; ++listRequest; update({ current: null, editing: false, isNew: false, base: null, pending: null, draft: { title: "", markdown: "" }, editorSession: state.editorSession + 1, query: "", items: [], message: null, deletionReceipt: null }); showLogin(); }
    catch (error) { message(errorText(error), { error: true }); }
  }
  async function cancelEdit(){if(!await guard())return;if(state.isNew)return listPage({protect:false,replace:true});return navigate(state.current.id,{protect:false,replace:true});}
  async function home(){return listPage();}
  function beforeUnload(event) { if (protectedDraft()) { event.preventDefault(); event.returnValue = ""; } }
  function moveHistory(index, url) {
    // Serialize restoration and the confirmed traversal. A second Back may have
    // moved the browser again while the first leave dialog was still open.
    historyMovement = historyMovement.then(async () => {
      if (!Number.isInteger(index) || !Number.isInteger(browser.history.state?.cd_index)) {
        browser.history.replaceState({ ...browser.history.state, cd_index: historyIndex }, "", url);
        return;
      }
      while (!destroyed && browser.history.state.cd_index !== index) {
        await new Promise((resolve) => {
          historyMoveCompletion = resolve;
          browser.history.go(index - browser.history.state.cd_index);
        });
      }
    });
    return historyMovement;
  }
  async function popState(event) {
    if (historyMoveCompletion) {
      const complete = historyMoveCompletion;
      historyMoveCompletion = undefined;
      complete();
      return;
    }
    if (pendingHistory || state.confirmOpen) {
      await moveHistory(historyIndex, currentUrl);
      return;
    }
    const target = { url: browser.location.href, index: event.state?.cd_index };
    pendingHistory = target;
    try {
      if (!await guard()) {
        await moveHistory(historyIndex, currentUrl);
        return;
      }
      await moveHistory(target.index, target.url);
      if (destroyed) return;
      if (Number.isInteger(target.index)) historyIndex = target.index;
      currentUrl = target.url;
      await applyLocation(false);
    } finally {
      if (pendingHistory === target) pendingHistory = undefined;
    }
  }
  browser.addEventListener("beforeunload", beforeUnload);
  browser.addEventListener("popstate", popState);
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, getSnapshot: () => state,
    async start() { try { const session = await request("/api/session", { method: "GET" }); if (session.authenticated) await showApp(session); else showLogin(); } catch { showLogin("暂时无法连接知识库，请检查服务后重试。"); } },
    login, logout, navigate, editCard, loadList, listPage, applyFilters, filters, href, setQuery, save, deleteCard, checkOperation, uploadImages, cancelEdit, home, decideLeave,
    dismissDeletionReceipt() { update({ deletionReceipt: null }); },
    switchListMode, submitAsk, cancelAsk,
    readModelSettings: signal => request("/api/model-settings", { method: "GET", signal }),
    async saveModelSettings(body) {
      const settings = await request("/api/model-settings", { method: "PUT", body });
      update({ askAvailable: settings.configured });
      return settings;
    },
    setAskQuestion(value) { update({ askQuestion: value }); },
    setEditor(value) { editor = value; },
    setTitle(value) { update({ draft: { ...state.draft, title: value } }); },
    setMarkdown(value) { update({ draft: { ...state.draft, markdown: value } }); },
    setPreview(preview) { if (preview !== state.preview) update({ preview }); },
    preview: async (markdown, signal) => (await request("/api/preview", { body: { markdown }, signal })).html,
    retry() { if (state.pending?.retryAllowed) return submitPending(); },
    reload() { const id = state.current?.id || readRoute(browser.location.href).id; if (id) return navigate(id, { replace: true }); },
    reportError(text) { message(text, { error: true }); }, dirty,
    destroy() { destroyed = true; clearAsk(); historyMoveCompletion?.(); historyMoveCompletion = undefined; clearTimeout(queryTimer); decideLeave(false); browser.removeEventListener("beforeunload", beforeUnload); browser.removeEventListener("popstate", popState); listeners.clear(); },
  };
}
