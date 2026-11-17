import { normalize } from "../../lib/siyuan.mjs";
import { installWikiModel } from "../service/wiki-integration.mjs";
import { test, expect, opId, login, markdownValue, setMarkdown, gate, settled, ensureSource, chooseEditorMode } from "./fixtures.mjs";

const create = (service, title, markdown = "初始正文。") => service.call("create", { op_id: opId("browser-create"), document: { title, markdown } });
const savePath = "**/api/v1/commands/save-document";

test("single-card draft enters the ordinary editor and preserves the original understanding", async ({ service, ui }) => {
  const { page, editorURL } = ui;
  await installWikiModel(service);
  const original = '## 核心理解\n\n原有正文必须完整保留。\n\n## 我的理解\n\n这是我亲自写的理解。';
  const title = '单卡合并 ' + opId('draft');
  const card = await create(service, title, original);
  await login(page, service);
  await page.locator('#wiki-nav').click();
  await page.getByLabel('资料标题', { exact: true }).fill('合成原文 ' + opId('source'));
  await page.getByLabel('原始正文', { exact: true }).fill('合成资料说明：整理只产生草稿，审阅后保存才写入。');
  await page.locator('#wiki-save-source').click();
  await expect(page.locator('#wiki-page')).toContainText('原文快照已保存');
  const source = (await service.call('sources-list', {})).items[0];
  await page.getByLabel('整理到哪张卡片', { exact: true }).click();
  await page.getByText(title, { exact: true }).click();
  const before = await service.call('get-document', { id: card.id });
  await page.locator('#wiki-generate-draft').click();
  await expect(page.locator('#wiki-open-draft')).toBeVisible();
  const generated = await page.getByLabel('整理稿（Markdown，可修改）', { exact: true }).inputValue();
  expect(generated).toContain('/wiki?source=' + source.id);
  expect((await service.call('get-document', { id: card.id })).revision).toBe(before.revision);
  await page.locator('#wiki-open-draft').click();
  await expect(page.locator('#editor-form')).toBeVisible();
  expect(await markdownValue(page, editorURL)).toBe(before.markdown + '\n\n' + generated);
  expect((await service.call('get-document', { id: card.id })).revision).toBe(before.revision);
  await page.locator('#save-card').click();
  await expect(page.locator('#reader')).toBeVisible();
  const saved = await service.call('get-document', { id: card.id });
  expect(normalize(saved.markdown).startsWith(normalize(before.markdown))).toBe(true);
  expect(saved.markdown).toContain('这是我亲自写的理解。');
  expect(saved.markdown).toContain('/wiki?source=' + source.id);
  await page.locator('#wiki-edit-understanding').click();
  await expect(page.locator('#editor-form')).toBeVisible();
  expect(await markdownValue(page, editorURL)).toBe(saved.markdown);
  expect((await service.call('get-document', { id: card.id })).revision).toBe(saved.revision);
  service.record('single-card-ordinary-save', { id: card.id, sourceId: source.id, generationDidNotWrite: true, originalUnderstandingPreserved: true, ordinarySave: true });
});

test("startup list and lazy editor cannot replace a new draft", async ({ service, ui }) => {
  const { page, editorURL } = ui;
  await page.addInitScript(() => localStorage.setItem("concept-discovery.theme", "gray"));
  const related = await create(service, "启动竞态 " + opId("reference"), "- 原文第一项\n- 原文第二项");
  const relatedDocument = await service.call("get-document", { id: related.id });
  const list = gate(), editor = gate(), listRequested = gate(), editorRequested = gate();
  const listFinished = gate(), editorFinished = gate();
  let listHeld = false, editorHeld = false;
  await page.route("**/api/v1/commands/list", async (route) => {
    if (listHeld) return route.continue();
    listHeld = true;
    listRequested.release();
    try {
      const response = await route.fetch();
      await list.promise;
      await route.fulfill({ response });
    } finally { listFinished.release(); }
  });
  await page.route((url) => url.pathname === editorURL, async (route) => {
    if (editorHeld) return route.continue();
    editorHeld = true;
    editorRequested.release();
    try {
      const response = await route.fetch();
      await editor.promise;
      await route.fulfill({ response });
    } finally { editorFinished.release(); }
  });
  try {
    await login(page, service);
    await expect(page.locator(".app-header select")).toHaveCount(0);
    await expect(page.locator("html")).toHaveCSS("background-color", "color(srgb 0.981176 0.962353 0.936471)");
    await listRequested.promise;
    await page.locator("#tag-filter").click();
    await expect(page.locator("#tag-filter")).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await page.locator("#updated-from").click();
    await expect(page.getByText("今天", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    if (await page.locator("#back-to-list").isVisible()) { await page.locator("#back-to-list").click(); await expect(page.locator("#list-page")).toBeVisible(); }
    await page.locator("#new-card").click();
    await editorRequested.promise;
    list.release();
    await listFinished.promise;
    await expect(page.locator(`#card-list a[data-card-id="${related.id}"]`)).toBeVisible();
    await settled(page);
    editor.release();
    await editorFinished.promise;
    await expect(page.getByRole("radio", { name: "源码", exact: true })).toBeChecked();
    await expect(page.getByRole("textbox", { name: "Markdown 源码" })).toBeVisible();
    await expect(page.locator("#edit-title")).toHaveValue("");
    await page.getByRole("textbox", { name: "Markdown 源码" }).press("ControlOrMeta+s");
    await expect(page.locator("#save-card")).toBeDisabled();
    expect(await markdownValue(page, editorURL)).toBe("");
    await expect(page.locator("#document-status")).toContainText("新建");
    await expect(page.locator("#knowledge-markdown-preview")).toBeHidden();
    await page.locator("#back-to-list").click();
    await page.locator(`#card-list a[data-card-id="${related.id}"]`).click();
    await page.locator("#edit-card").click();
    const source = page.getByRole("textbox", { name: "Markdown 源码" });
    await expect(source).toHaveValue(relatedDocument.markdown);
    await chooseEditorMode(page, "预览");
    await expect(page.locator("#knowledge-markdown-preview li").first()).toHaveText("原文第一项");
    await ensureSource(page);
    await expect(source).toHaveValue(relatedDocument.markdown);
    await expect(page.locator("#save-card")).toBeDisabled();
    service.record("startup-intent-race", { relatedId: related.id, listReleasedBeforeEditor: true, emptyTitle: true, emptyNativeDocument: true });
  } finally {
    list.release(); editor.release();
    await Promise.all([...(listHeld ? [listFinished.promise] : []), ...(editorHeld ? [editorFinished.promise] : [])]);
  }
});

test("stale search, document and preview responses cannot overwrite current state", async ({ service, ui }) => {
  const { page, editorURL } = ui;
  const oldTerm = opId("outdated").replaceAll("-", "");
  const newTerm = opId("current").replaceAll("-", "");
  const a = await create(service, "旧线索 " + oldTerm);
  const b = await create(service, "新线索 " + newTerm);
  expect((await service.call("search", { query: oldTerm, locale: "cn", limit: 20 })).map((item) => item.id)).toEqual([a.id]);
  expect((await service.call("search", { query: newTerm, locale: "cn", limit: 20 })).map((item) => item.id)).toEqual([b.id]);
  await login(page, service, b.id);
  await page.locator("#back-to-list").click();
  await expect(page.locator("#list-page")).toBeVisible();
  const oldSearch = gate(), searched = gate(), searchFinished = gate();
  await page.route("**/api/v1/commands/list", async (route) => {
    if (route.request().postDataJSON().query !== oldTerm) return route.continue();
    const response = await route.fetch();
    searched.release();
    await oldSearch.promise;
    try { await route.fulfill({ response }); } finally { searchFinished.release(); }
  });
  try {
    await page.locator("#search-input").fill(oldTerm);
    await searched.promise;
    const currentSearch = page.waitForResponse((response) => response.url().endsWith("/api/v1/commands/list") && response.request().postDataJSON().query === newTerm);
    await page.locator("#search-input").fill(newTerm);
    expect((await (await currentSearch).json()).data.items.map((item) => item.id)).toEqual([b.id]);
    await expect(page.locator(`#card-list a[data-card-id="${b.id}"]`)).toBeVisible();
    await expect(page.locator(`#card-list a[data-card-id="${a.id}"]`)).toHaveCount(0);
    oldSearch.release();
    await searchFinished.promise;
    await settled(page);
    await expect(page.locator(`#card-list a[data-card-id="${a.id}"]`)).toHaveCount(0);
    await expect(page.locator(`#card-list a[data-card-id="${b.id}"]`)).toBeVisible();
  } finally { oldSearch.release(); }
  await page.locator("#clear-search").click();
  await expect(page.locator(`#card-list a[data-card-id="${a.id}"]`)).toBeVisible();

  const oldDocument = gate(), documentRequested = gate(), documentFinished = gate();
  await page.route("**/api/v1/commands/get-document", async (route) => {
    if (route.request().postDataJSON().id !== a.id) return route.continue();
    const response = await route.fetch();
    documentRequested.release();
    await oldDocument.promise;
    try { await route.fulfill({ response }); } finally { documentFinished.release(); }
  });
  try {
    await page.locator(`#card-list a[data-card-id="${a.id}"]`).click();
    await documentRequested.promise;
    const currentDocument = page.waitForResponse((response) => response.url().endsWith("/api/v1/commands/get-document") && response.request().postDataJSON().id === b.id);
    await page.locator(`#card-list a[data-card-id="${b.id}"]`).click();
    expect((await (await currentDocument).json()).data.id).toBe(b.id);
    await expect(page.locator("#document-title")).toHaveText("新线索 " + newTerm);
    oldDocument.release();
    await documentFinished.promise;
    await settled(page);
    await expect(page.locator("#document-title")).toHaveText("新线索 " + newTerm);
  } finally { oldDocument.release(); }

  const oldPreview = gate(), previewRequested = gate(), previewFinished = gate();
  let oldPreviewAborted = false;
  await page.route("**/api/preview", async (route) => {
    if (route.request().postDataJSON().markdown !== "旧预览") return route.continue();
    const response = await route.fetch();
    previewRequested.release();
    await oldPreview.promise;
    try { await route.fulfill({ response }); }
    catch (error) {
      // Changing the draft intentionally aborts its obsolete preview request.
      if (!route.request().failure() && !/closed|aborted|already handled/i.test(error.message)) throw error;
      oldPreviewAborted = true;
    } finally { previewFinished.release(); }
  });
  try {
    if (await page.locator("#back-to-list").isVisible()) { await page.locator("#back-to-list").click(); await expect(page.locator("#list-page")).toBeVisible(); }
    await page.locator("#new-card").click();
    await setMarkdown(page, editorURL, "旧预览");
    await chooseEditorMode(page, "预览");
    await previewRequested.promise;
    await ensureSource(page);
    const current = '新预览\n\n<script>window.__previewExecuted=true</script>\n\n[危险链接](javascript:window.__previewExecuted=true)';
    await setMarkdown(page, editorURL, current);
    await chooseEditorMode(page, "预览");
    const preview = page.locator("#knowledge-markdown-preview .service-preview-body");
    await expect(preview).toContainText("新预览");
    oldPreview.release();
    await previewFinished.promise;
    await settled(page);
    await expect(preview).toContainText("新预览");
    await expect(preview).not.toContainText("旧预览");
    await expect(preview.locator("script, [onerror], a[href^='javascript:']")).toHaveCount(0);
    expect(await markdownValue(page, editorURL)).toBe(current);
    await page.locator("#back-to-list").click();
    await expect(page.getByRole("dialog", { name: "放弃未保存的修改？" })).toBeVisible();
    await expect(page.locator("#keep-editing")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.locator("#back-to-list")).toBeFocused();
    expect(await markdownValue(page, editorURL)).toBe(current);
    service.record("obsolete-response-protection", { a: a.id, b: b.id, searchAndDocumentRetained: b.id, oldPreviewAborted, finalMarkdown: current, previewHTML: await preview.innerHTML() });
  } finally { oldPreview.release(); }
});

test("lost save response and interrupted create reconcile the original operation", async ({ service, ui }) => {
  const { page, editorURL } = ui;
  const card = await create(service, "丢失响应 " + opId("save"));
  await login(page, service, card.id);
  await page.locator("#edit-card").click();
  const savedText = "已提交但响应丢失的正文。";
  await setMarkdown(page, editorURL, savedText);
  let lostInput;
  const requests = [];
  page.on("request", request => { if (request.url().endsWith("/api/v1/commands/save-document")) requests.push(request); });
  await page.route(savePath, async (route) => {
    lostInput = route.request().postDataJSON();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("failed");
  }, { times: 1 });
  await page.getByRole("textbox", { name: "Markdown 源码" }).press("ControlOrMeta+s");
  await expect(page.locator("#check-operation")).toBeVisible();
  expect(requests).toHaveLength(1);
  await expect(page.locator("#markdown-source")).toHaveJSProperty("readOnly", true);
  await expect(page.locator("#edit-title")).toHaveJSProperty("readOnly", true);
  await expect(page.locator("#upload-image")).toBeDisabled();
  await page.locator("#markdown-source").click();
  await page.keyboard.insertText("不允许写入");
  expect(await markdownValue(page, editorURL)).toBe(savedText);
  const committed = await service.cli("get-document", { id: card.id });
  expect(committed.markdown).toBe(savedText);
  await page.locator("#check-operation").click();
  await expect(page.locator("#document-body")).toContainText(savedText);
  const lostStatus = await service.cli("operation-status", { op_id: lostInput.op_id });
  expect(lostStatus.state).toBe("verified");

  let partialInput, partial;
  await page.route("**/api/v1/commands/create", async (route) => {
    partialInput = route.request().postDataJSON();
    partial = await service.core("const original=api.setAttrs.bind(api);let injected=false;api.setAttrs=async(...args)=>{if(!injected){injected=true;throw Object.assign(new Error('injected browser metadata failure'),{code:'transport_unknown'});}return original(...args);};let error;try{await execute(api,'create',input);}catch(e){error={code:e.code,message:e.message};}api.setAttrs=original;const receipt=(await api.receipt(input.op_id)).value;console.log(JSON.stringify({error,status:await execute(api,'operation-status',{op_id:input.op_id}),documentId:receipt.documentId,markdown:await api.markdown(receipt.documentId)}));", partialInput);
    expect(partial.status.state).toBe("unknown");
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: partial.error }) });
  }, { times: 1 });
  if (await page.locator("#back-to-list").isVisible()) { await page.locator("#back-to-list").click(); await expect(page.locator("#list-page")).toBeVisible(); }
    await page.locator("#new-card").click();
  const title = "中断创建 " + opId("resume");
  await page.locator("#edit-title").fill(title);
  await setMarkdown(page, editorURL, "应续跑原始创建请求的正文。");
  await page.locator("#save-card").click();
  await expect(page.locator("#check-operation")).toBeVisible();
  await expect(page.locator("#markdown-source")).toHaveJSProperty("readOnly", true);
  expect(await markdownValue(page, editorURL)).toBe(partialInput.document.markdown);
  await page.locator("#check-operation").click();
  await expect(page.locator("#retry-operation")).toBeVisible();
  const resumedRequest = page.waitForRequest((request) => request.url().endsWith("/api/v1/commands/create") && request.method() === "POST");
  await page.locator("#retry-operation").click();
  expect((await resumedRequest).postDataJSON()).toEqual(partialInput);
  await expect(page.locator("#document-title")).toHaveText(title);
  const status = await service.cli("operation-status", { op_id: partialInput.op_id });
  const rows = await service.kernel("/api/query/sql", { stmt: `SELECT id FROM blocks WHERE type='d' AND content='${title}'`, mode: "readonly" });
  expect(status.state).toBe("verified");
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe(partial.documentId);
  service.record("uncertain-operation-reconciliation", { lostInput, committed, lostStatus, partialInput, partial, resumedStatus: status, nativeDocuments: rows });
});

test("concurrent Agent edit rejects stale save while retaining the browser draft", async ({ service, ui }) => {
  const { page, editorURL } = ui;
  const card = await create(service, "版本冲突 " + opId("conflict"), "并发修改前的正文。");
  await login(page, service, card.id);
  await page.locator("#edit-card").click();
  const draft = "浏览器尚未保存的理解。";
  await setMarkdown(page, editorURL, draft);
  const before = await service.cli("get", { id: card.id });
  await service.cli("append", { op_id: opId("agent-append"), id: card.id, expected_hash: before.hash, field: "usage", markdown: "Agent先写入的使用说明。" });
  const latest = await service.cli("get-document", { id: card.id });
  const response = page.waitForResponse((item) => item.url().endsWith("/api/v1/commands/save-document"));
  await page.locator("#save-card").click();
  const rejected = await (await response).json();
  expect(rejected.ok).toBe(false);
  expect(["revision_conflict", "version_conflict", "content_conflict"]).toContain(rejected.error.code);
  await expect(page.locator("#document-message-text")).toContainText("新的修改");
  expect(await markdownValue(page, editorURL)).toBe(draft);
  await expect(page.locator("#markdown-source")).toHaveJSProperty("readOnly", false);
  const unchanged = await service.cli("get-document", { id: card.id });
  expect(unchanged.revision).toBe(latest.revision);
  expect(unchanged.markdown).toContain("Agent先写入的使用说明。");
  expect(unchanged.markdown).not.toContain(draft);
  service.record("concurrent-version-rejection", { id: card.id, rejected, retainedDraft: draft, latest, afterRejectedSave: unchanged });
});

test("upload failure and reauthentication preserve the draft and frozen save request", async ({ service, ui }) => {
  const { page, editorURL } = ui;
  const card = await create(service, "失败保护 " + opId("draft"));
  await login(page, service, card.id);
  await page.locator("#edit-card").click();
  const text = "上传失败和重新登录都必须保留这段正文。";
  const draft = "**" + text + "**\n\n__保留 Markdown 标记__";
  await setMarkdown(page, editorURL, text);
  await page.keyboard.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "加粗", exact: true }).click();
  await expect.poll(() => markdownValue(page, editorURL)).toBe("**" + text + "**");
  await setMarkdown(page, editorURL, draft);
  await chooseEditorMode(page, "预览");
  await expect(page.locator("#knowledge-markdown-preview strong").first()).toHaveText(text);
  await ensureSource(page);
  await expect(page.getByRole("textbox", { name: "Markdown 源码" })).toHaveValue(/__保留 Markdown 标记__/);
  expect(await markdownValue(page, editorURL)).toBe(draft);
  const image = { name: "probe.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAIAAAAUMWhjAAAAJElEQVR4nGMQTwunKWIYtWDUglELRi0YtWDUglELRi0YGhYAAMJ9fB+MFECJAAAAAElFTkSuQmCC", "base64") };
  const source = page.getByRole("textbox", { name: "Markdown 源码" });
  await source.evaluate(input => { const position = input.value.indexOf("\n") + 1; input.focus(); input.setSelectionRange(position, position); });
  await page.locator("#image-file").setInputFiles(image);
  await expect.poll(() => markdownValue(page, editorURL)).toMatch(/\*\*\n!\[probe\.png\]\(\/assets\/[^)]+\)\n__保留/);
  await setMarkdown(page, editorURL, draft);
  await page.route("**/api/assets", (route) => route.abort("failed"), { times: 1 });
  await page.locator("#image-file").setInputFiles(image);
  await expect(page.locator("#document-message-text")).toContainText(/图片|上传/);
  expect(await markdownValue(page, editorURL)).toBe(draft);
  await expect(page.locator("#save-card")).toBeEnabled();
  let frozen;
  await page.route(savePath, async (route) => {
    frozen = route.request().postDataJSON();
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "unauthorized", message: "injected expired session" } }) });
  }, { times: 1 });
  await chooseEditorMode(page, "预览");
  await expect(page.locator("#knowledge-markdown-preview strong").first()).toHaveText(text);
  await page.locator("#save-card").click();
  await expect(page.locator("#login-screen")).toBeVisible();
  await page.locator("#access-code").fill(service.accessCode);
  await page.locator("#login-button").click();
  await expect(page.locator("#editor-form")).toBeVisible();
  expect(await markdownValue(page, editorURL)).toBe(draft);
  await expect(page.locator("#check-operation")).toBeVisible();
  await page.locator("#check-operation").click();
  await expect(page.locator("#retry-operation")).toBeVisible();
  const retried = page.waitForRequest((request) => request.url().endsWith("/api/v1/commands/save-document") && request.method() === "POST");
  await page.locator("#retry-operation").click();
  const retryInput = (await retried).postDataJSON();
  expect(retryInput).toEqual(frozen);
  await expect(page.locator("#document-body strong").first()).toHaveText(text);
  const readback = await service.cli("get-document", { id: card.id });
  expect(readback.markdown).toMatch(/\*\*保留 Markdown 标记\*\*|__保留 Markdown 标记__/);
  expect(frozen.markdown).toBe(draft);
  service.record("failure-and-session-draft-protection", { id: card.id, uploadFailureRetainedDraft: draft, frozenRequest: frozen, retriedRequest: retryInput, readback });
});
