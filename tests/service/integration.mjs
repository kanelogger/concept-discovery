import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { runtime, digest } from "./runtime.mjs";
import { id, normalize } from "../../lib/siyuan.mjs";
import { verifyWiki } from "./wiki-integration.mjs";
import { verifyRawCli } from "./raw-integration.mjs";
import { createLegacyCard, freezeLegacyReceipt, seedLegacyAppend } from "./legacy-fixture.mjs";

const assertNoLanguageFields = value => {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!["locale", "locales", "language", "chineseArticleId"].includes(key), "output has no language field: " + key);
    assertNoLanguageFields(child);
  }
};

const test = await runtime("integration");
let passed = false;
try {
  const request = (path, options = {}) => fetch(test.url + path, options);
  const readiness = await request("/api/status");
  assert.equal(readiness.status, 200);
  assert.deepEqual(await readiness.json(), { ok: true, data: { readOnly: true } });
  assert.equal(readiness.headers.get("set-cookie"), null);
  const noOrigin = await request("/api/v1/commands/list", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(noOrigin.status, 403);
  const browser = await request("/api/v1/commands/list", { method: "POST", headers: { "content-type": "application/json", origin: test.url }, body: "{}" });
  assert.equal(browser.status, 200);
  assert.equal((await browser.json()).ok, true);
  assert.equal(browser.headers.get("set-cookie"), null);
  for (const method of ["GET", "POST", "DELETE"])
    assert.equal((await request("/api/session", { method, headers: { origin: test.url } })).status, 404);
  for (const headers of [{ authorization: "Bearer wrong-agent-token" }, { authorization: "Bearer wrong-agent-token", origin: test.url }])
    assert.equal((await request("/api/v1/commands/list", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" })).status, 401);
  const crossOrigin = await request("/api/v1/commands/list", { method: "POST", headers: { "content-type": "application/json", origin: "https://attacker.invalid" }, body: "{}" });
  assert.equal(crossOrigin.status, 403);
  const crossSite = await request("/api/v1/commands/list", { method: "POST", headers: { "content-type": "application/json", origin: test.url, "sec-fetch-site": "cross-site" }, body: "{}" });
  assert.equal(crossSite.status, 403);
  const wrongHostStatus = await new Promise((resolve, reject) => {
    // Node fetch normalizes Host; use HTTP directly to exercise the actual header.
    const message = httpRequest(test.url + "/api/v1/commands/list", { method: "POST", headers: { "content-type": "application/json", origin: test.url, host: "attacker.invalid" } }, response => { response.resume(); resolve(response.statusCode); });
    message.on("error", reject); message.end("{}");
  });
  assert.equal(wrongHostStatus, 403);
  assert.equal((await request("/api/model-settings", { headers: { origin: test.url } })).status, 404);
  assert.equal((await request("/api/model-settings", { headers: { authorization: "Bearer " + test.token, origin: test.url } })).status, 404);
  for (const path of ["/api/query/sql", "/api/file/getFile", "/stage/build/desktop/"]) {
    assert.equal((await request(path, { method: "POST", headers: { authorization: "Bearer " + test.token }, body: "{}" })).status, 404);
  }
  const forbidden = await test.call("init", {}, false);
  assert.ok(forbidden.code);
  test.record("browser-origin-and-agent-token-routing", { readinessStatus: 200, sameOriginWithoutCookie: 200, noOriginStatus: 403, wrongTokenStatus: 401, crossOriginStatus: 403, crossSiteStatus: 403, wrongHostStatus: 403, legacySessionStatus: 404, nativeEndpointsStatus: 404, agentModelSettingsStatus: 404, adminCommandRejected: forbidden.code });
  assert.equal((await test.call("search", {query:"中文", locale:"cn"}, false)).code, "invalid_input");
  test.record("language-inputs-rejected", {searchLocale:true});

  const identity = await test.core("console.log(JSON.stringify(await api.identity()));");
  const rawStatus = op_id => test.core(`
    const {rawWrite} = await import('./lib/raw-write.mjs');
    console.log(JSON.stringify(await rawWrite(api, 'raw-status', input)));
  `, {identity, op_id});
  const interruptedInput = {op_id:"interrupted-create", identity, id:id(), kind:"card", expected_revision:null,
    title:"中断创建专属", markdown:"中断创建前后保持一致的正文。"};
  const creation = await test.core(`
    const {rawWrite} = await import('./lib/raw-write.mjs');
    const setAttrs = api.setAttrs.bind(api);
    api.setAttrs = async () => { throw Object.assign(new Error('injected metadata transport failure'), {code:'transport_unknown'}); };
    let error;
    try { await rawWrite(api, 'raw-document', input); } catch (e) { error = {code:e.code, message:e.message}; }
    api.setAttrs = setAttrs;
    const pending = await rawWrite(api, 'raw-status', input);
    const resumed = await rawWrite(api, 'raw-document', input);
    const verified = await rawWrite(api, 'raw-status', input);
    const rows = await api.sql("SELECT id FROM blocks WHERE type='d' AND content='中断创建专属'");
    console.log(JSON.stringify({error, pending, resumed, verified, rows}));
  `, interruptedInput);
  assert.equal(creation.error.code, "transport_unknown");
  assert.ok(["unknown", "prepared"].includes(creation.pending.state));
  assert.equal(creation.verified.state, "verified");
  assert.deepEqual(creation.rows.map(row => row.id), [interruptedInput.id]);
  assert.equal(creation.resumed.id, interruptedInput.id);
  test.record("interrupted-raw-creation-resume", {request:interruptedInput, observed:creation});

  const title = "旧创建回执合成卡", markdown = "原生文档和书签必须沿用。";
  for (const [command, request, documentId, fields] of [
    ["create", {op_id:"old-structured-create", card:{title, understanding:markdown}}, "20261101000000-oldcard", {readings:[]}],
    ["create-document", {op_id:"old-document-create", document:{title, markdown}}, "20261101000000-olddoc1",
      {intendedTitle:title, intendedMarkdown:markdown}],
  ]) {
    const receipt = freezeLegacyReceipt(test, identity, command, request, {documentId, ...fields});
    await test.core(`
      await api.newDoc(input.documentId, input.title, input.markdown, api.c.libraryRootId);
      await api.setAttrs(input.documentId, {'custom-cd-kind':'concept', 'custom-cd-schema':'2',
        'custom-cd-request':input.requestHash});
      await api.flush();
      console.log(JSON.stringify(true));
    `, {documentId, title, markdown, requestHash:receipt.requestHash});
    assert.equal((await rawStatus(request.op_id)).state, "unknown");
    const before = await test.call("get", {id:documentId});
    await test.kernel("/api/attr/setBlockAttrs", {id:documentId, attrs:{"custom-cd-complete":"1"}});
    await test.kernel("/api/sqlite/flushTransaction");
    const status = await rawStatus(request.op_id);
    assert.equal(status.state, "verified");
    assert.deepEqual([status.result.id, status.result.op_id], [documentId, request.op_id]);
    if (command === "create-document") assert.equal(status.result.document.markdown, markdown);
    assert.deepEqual(await rawStatus(request.op_id), status);
    const after = await test.call("get", {id:documentId});
    assert.equal(after.markdown, markdown);
    assert.deepEqual(after.sections.map(block => block.id), before.sections.map(block => block.id));
  }
  test.record("historical-creation-receipts", {incompleteKeptPending:true, oldIdsPreserved:true});

  const reference = await test.createDocument({title:"相关方法", markdown:"相关卡片正文。"});
  const original = "原始理解。\n\n## 出处\n\nhttps://example.org/source\n\n## 自测\n\n怎样判断限制？\n\n## 相关卡片\n\n[相关方法](kane://blocks/" + reference.id + ")";
  const created = await test.createDocument({ title: "限制测试", markdown: original });
  const card = await test.call("get-document", { id: created.id });
  assert.equal(card.title, "限制测试"); assert.equal(card.editable, false);
  assert.ok(card.markdown.includes("原始理解。"));
  assert.ok(card.html.includes("相关方法"));
  assert.ok(card.markdown.includes("kane://blocks/" + reference.id));
  assert.ok(card.html.includes('href="/?id=' + reference.id + '"'));
  const installedRead = await test.cli("get-document", { id: created.id });
  const installedList = await test.cli("list", { offset: 0, limit: 50 });
  const fullTags = await test.call("list", { includeTags: true, limit: 50 });
  const taggedPage = await test.call("list", { includeTags: "page", limit: 1, offset: 1 });
  assert.equal(taggedPage.total, fullTags.total);
  assert.deepEqual(taggedPage.items, fullTags.items.slice(1, 2));
  assert.ok(!Object.hasOwn(taggedPage, 'tags'));
  const batchCheck = await test.core(`
    const batch = await api.markdowns([...input.ids].reverse());
    const single = await Promise.all(input.ids.map(id => api.markdown(id)));
    let mixedError;
    try { await api.markdowns([...input.ids, '20000101000000-missing']); }
    catch (error) { mixedError = error.code; }
    console.log(JSON.stringify({ matching: input.ids.every((id, index) => batch[id] === single[index]), mixedError }));
  `, { ids: [reference.id, created.id] });
  assert.deepEqual(batchCheck, { matching: true, mixedError: 'siyuan_error' });
  test.record("paged-list-and-batched-bodies", { batchCheck, pageSize: taggedPage.items.length, total: taggedPage.total });
  const installedSearch = await test.cli("search", { query: "原始理解", limit: 5 });
  assert.equal((await test.cli("search", { query: "原始理解", locale: "cn" }, false)).code, "invalid_input");
  for (const command of ["create","save-document","delete-document","update-block","append","recover","operation-status","source-import","wiki-draft","ask"]) {
    assert.equal((await test.call(command, {}, false)).code, "invalid_command", command);
    const rejected = await test.cli(command, {}, false);
    assert.equal(rejected.code, "invalid_command", command);
    assert.match(rejected.message, /raw/);
  }
  assert.equal(installedRead.revision, card.revision);
  assert.equal(installedRead.markdown, card.markdown);
  assert.ok(installedList.items.some((item) => item.id === created.id));
  assert.ok(installedSearch.some((item) => item.id === created.id));
  test.record("installed-cli-read-search-and-list", { id: created.id, expected: card, read: installedRead, list: installedList, search: installedSearch });
  const initial = await test.call("get", { id: created.id });
  const paragraphs = initial.sections.filter((section) => section.markdown.includes("原始理解"));
  assert.ok(paragraphs.length, "get exposes the editable paragraph fingerprint");
  const stale = paragraphs[0];
  const oldAppend = {op_id:"append-card", id:created.id, expected_hash:initial.hash, field:"usage", markdown:"追加的使用说明。"};
  await seedLegacyAppend(test, identity, oldAppend, "## 用法\n\n追加的使用说明。");
  const appendStatus = await rawStatus(oldAppend.op_id);
  assert.equal(appendStatus.state, "verified");
  const append = appendStatus.result;
  assert.equal(append.id, created.id);
  assert.equal(append.hash, (await test.call("get", {id:created.id})).hash);
  const appended = await test.call("get-document", { id: created.id });
  assert.equal(appended.editable, false);
  assert.ok(appended.markdown.includes("追加的使用说明。"));
  const nativeSnapshot = (id) => test.core("const{Documents}=await import('./lib/documents.mjs');const{Knowledge}=await import('./lib/knowledge.mjs');console.log(JSON.stringify(await new Documents(api,new Knowledge(api)).snapshot(input.id)));", { id });
  const nativeBefore = await nativeSnapshot(created.id);
  const saveInput = { op_id: "save-card", id: created.id, expected_revision: appended.revision, title: "限制测试已编辑", markdown: appended.markdown.replace("原始理解。", "编辑后的理解。") };
  const saved = await test.admin("save-document", saveInput);
  const after = await test.call("get-document", { id: created.id });
  assert.equal(after.title, saveInput.title); assert.ok(after.markdown.includes("编辑后的理解。"));
  assert.ok(after.markdown.includes("追加的使用说明。"));
  const nativeAfter = await nativeSnapshot(created.id);
  const stableAttrs = (attrs) => Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== "updated"));
  const untouched = nativeBefore.nodes.filter((node) => !normalize(node.raw).includes("原始理解。"));
  assert.ok(untouched.some((node) => node.type === "s"), "the Agent append wrapper is included in the preservation check");
  for (const old of untouched) {
    const current = nativeAfter.nodes.find((node) => node.id === old.id);
    assert.ok(current, "unmodified native block ID remains: " + old.id);
    assert.equal(normalize(current.raw), normalize(old.raw));
    assert.deepEqual(stableAttrs(current.attrs), stableAttrs(old.attrs));
  }
  assert.deepEqual(await test.admin("save-document", saveInput), saved, "same op_id is idempotent");
  const repeatedDifferent = await test.admin("save-document", { ...saveInput, title: "changed retry" }, false);
  assert.equal(repeatedDifferent.code, "operation_conflict");
  const rejected = await test.admin("update-block", { op_id: "stale-block", id: stale.id, expected_hash: stale.hash, markdown: "旧版本覆盖" }, false);
  assert.equal(rejected.code, "content_conflict");
  const restoreOld = await test.admin("recover", { op_id: "restore-old", backup_op_id: "append-card", expected_hash: append.hash }, false);
  assert.equal(restoreOld.code, "content_conflict");
  assert.equal((await test.call("get-document", { id: created.id })).revision, after.revision);
  const recovery = await test.admin("recover", { op_id: "restore-save", backup_op_id: "save-card", expected_hash: saved.revision, expected_revision: saved.revision });
  const restored = await test.call("get-document", { id: created.id });
  assert.equal(restored.title, appended.title);
  assert.equal(restored.markdown, appended.markdown);
  assert.ok(restored.markdown.includes("追加的使用说明。"));
  const nativeRestored = await nativeSnapshot(created.id);
  assert.equal(nativeRestored.signature, nativeBefore.signature, "recovery restores original IDs, parents and stable attributes");
  const status = await test.admin("operation-status", { op_id: "save-card" });
  assert.equal(status.state, "verified");
  const hits = await test.call("search", { query: "追加的使用说明", limit: 20 });
  assert.ok(hits.some((hit) => hit.id === created.id));
  assert.ok(hits.every((hit) => hit.url.startsWith(test.url)));
  test.record("document-write-and-recovery", { id: created.id, relatedId: reference.id, original, appended, saved, after, restored, recovery, preservedBlockIds: untouched.map((node) => node.id), expectedNativeSignature: nativeBefore.signature, restoredNativeSignature: nativeRestored.signature, staleRejected: rejected, oldRestoreRejected: restoreOld, status, kernelMarkdown: await test.kernel("/api/block/getBlockKramdown", { id: created.id }) });

  const faultCard = await test.createDocument({ title: "部分写入前", markdown: "部分写入前的正文。" });
  const faultBefore = await test.call("get-document", { id: faultCard.id });
  const partial = await test.core("const original=api.api.bind(api);let injected=false;api.api=async(path,body)=>{if(path==='/api/filetree/renameDocByID'&&!injected){injected=true;throw Object.assign(new Error('injected transport failure'),{code:'transport_unknown'});}return original(path,body);};let error;try{await execute(api,'save-document',input);}catch(e){error={code:e.code,message:e.message};}api.api=original;console.log(JSON.stringify({error,status:await execute(api,'operation-status',{op_id:input.op_id})}));", { op_id: "partial-save", id: faultCard.id, expected_revision: faultBefore.revision, title: "部分写入后的标题", markdown: "部分写入后的正文。" });
  assert.equal(partial.error.code, "transport_unknown");
  assert.equal(partial.status.state, "unknown");
  assert.ok(partial.status.recovery_revision);
  const partialRead = await test.call("get-document", { id: faultCard.id });
  assert.ok(partialRead.markdown.includes("部分写入后的正文。"));
  assert.equal(partialRead.title, faultBefore.title);
  await test.admin("recover", { op_id: "restore-partial", backup_op_id: "partial-save", expected_revision: partial.status.recovery_revision });
  const partialRestored = await test.call("get-document", { id: faultCard.id });
  assert.equal(partialRestored.markdown, faultBefore.markdown); assert.equal(partialRestored.title, faultBefore.title);
  test.record("partial-write-reconciliation", { id: faultCard.id, before: faultBefore, observedPartial: partialRead, operation: partial, restored: partialRestored });

  const recoveryCard = await test.createDocument({ title: "恢复故障前标题", markdown: "恢复故障前正文。" });
  const recoveryBase = await test.call("get-document", { id: recoveryCard.id });
  const beforeFailedRecovery = await test.admin("save-document", { op_id: "save-before-recovery-fault", id: recoveryCard.id, expected_revision: recoveryBase.revision, title: "恢复操作前标题", markdown: "恢复操作前正文。" });
  const partialRecovery = (input) => test.core("const original=api.api.bind(api);let injected=false;api.api=async(path,body)=>{if(path==='/api/filetree/renameDocByID'&&!injected){injected=true;throw Object.assign(new Error('injected recovery rename failure'),{code:'transport_unknown'});}return original(path,body);};let error;try{await execute(api,'recover',input);}catch(e){error={code:e.code,message:e.message};}api.api=original;console.log(JSON.stringify({error,status:await execute(api,'operation-status',{op_id:input.op_id})}));", input);
  const recoveryFailure = await partialRecovery({ op_id: "partial-recovery", backup_op_id: "save-before-recovery-fault", expected_revision: beforeFailedRecovery.revision });
  assert.equal(recoveryFailure.error.code, "transport_unknown");
  assert.equal(recoveryFailure.status.state, "unknown");
  assert.ok(recoveryFailure.status.recovery_revision);
  const partialRecoveryRead = await test.call("get-document", { id: recoveryCard.id });
  assert.equal(partialRecoveryRead.markdown, recoveryBase.markdown);
  assert.equal(partialRecoveryRead.title, beforeFailedRecovery.title);
  const recoveryUndo = await test.admin("recover", { op_id: "undo-partial-recovery", backup_op_id: "partial-recovery", expected_revision: recoveryFailure.status.recovery_revision });
  const recoveryUndone = await test.call("get-document", { id: recoveryCard.id });
  assert.equal(recoveryUndone.title, beforeFailedRecovery.title);
  assert.equal(recoveryUndone.markdown, beforeFailedRecovery.markdown);
  const secondSave = await test.admin("save-document", { op_id: "save-before-second-recovery-fault", id: recoveryCard.id, expected_revision: recoveryUndone.revision, title: "第二次恢复前标题", markdown: "第二次恢复前正文。" });
  const secondFailure = await partialRecovery({ op_id: "second-partial-recovery", backup_op_id: "save-before-second-recovery-fault", expected_revision: secondSave.revision });
  assert.equal(secondFailure.status.state, "unknown"); assert.ok(secondFailure.status.recovery_revision);
  const laterEdit = await test.admin("save-document", { op_id: "later-edit-after-partial-recovery", id: recoveryCard.id, expected_revision: secondFailure.status.recovery_revision, title: "后续编辑应保留", markdown: "部分恢复后的后续编辑必须保留。" });
  const rejectedRecoveryUndo = await test.admin("recover", { op_id: "reject-stale-recovery-undo", backup_op_id: "second-partial-recovery", expected_revision: secondFailure.status.recovery_revision }, false);
  assert.equal(rejectedRecoveryUndo.code, "content_conflict");
  const retainedLaterEdit = await test.call("get-document", { id: recoveryCard.id });
  assert.equal(retainedLaterEdit.revision, laterEdit.revision);
  assert.equal(retainedLaterEdit.markdown, laterEdit.markdown);
  test.record("partial-recovery-can-be-undone-safely", { id: recoveryCard.id, base: recoveryBase, beforeFailedRecovery, failure: recoveryFailure, observedPartial: partialRecoveryRead, undo: recoveryUndo, restoredBeforeRecovery: recoveryUndone, secondFailure, laterEdit, rejectedUndo: rejectedRecoveryUndo, retainedLaterEdit });

  const orderCard = await test.createDocument({ title: "正文调序", markdown: "第一段。\n\n第二段。\n\n第三段。" });
  const orderBefore = await test.call("get-document", { id: orderCard.id });
  const orderNativeBefore = await test.call("get", { id: orderCard.id });
  await test.admin("save-document", { op_id: "reorder-card", id: orderCard.id, expected_revision: orderBefore.revision, title: orderBefore.title, markdown: "第三段。\n\n第二段。\n\n第一段。" });
  const orderAfter = await test.call("get-document", { id: orderCard.id });
  const orderNativeAfter = await test.call("get", { id: orderCard.id });
  const orderIDs = {};
  for (const text of ["第一段。", "第二段。", "第三段。"]) {
    const before = orderNativeBefore.sections.find((section) => normalize(section.markdown) === text);
    const after = orderNativeAfter.sections.find((section) => normalize(section.markdown) === text);
    assert.ok(before && after); assert.equal(after.id, before.id);
    orderIDs[text] = { before: before.id, after: after.id };
  }
  assert.ok(orderAfter.markdown.indexOf("第三段。") < orderAfter.markdown.indexOf("第二段。"));
  assert.ok(orderAfter.markdown.indexOf("第二段。") < orderAfter.markdown.indexOf("第一段。"));
  test.record("paragraph-reorder-keeps-identities", { id: orderCard.id, before: orderBefore.markdown, after: orderAfter.markdown, ids: orderIDs });

  const legacy = await createLegacyCard(test, { legacyId: "legacy-card", title: "中文旧格式", description: "旧格式理解保留 API。", tags: ["旧卡标签"], reading: { title: "中文补充阅读", markdown: "中文补充正文。" } });
  const legacyRead = await test.call("get-document", { id: legacy.id });
  assert.equal(legacyRead.editable, false);
  assert.equal(legacyRead.legacyFixedFields, true);
  assert.ok(legacyRead.markdown.includes("旧格式理解"));
  assert.match(legacyRead.markdown, /中文 · 理解/);
  assert.match(legacyRead.html, /旧格式理解/);
  assert.deepEqual(legacyRead.tags, ["旧卡标签"]);
  assert.deepEqual(legacyRead.readings.map(reading => ({ id: reading.id, title: reading.title })), [{ id: legacy.readingId, title: "中文补充阅读" }]);
  const legacyNative = await test.call("get", { id: "legacy-card" });
  assert.equal(legacyNative.title, "中文旧格式");
  assert.equal(legacyNative.summary, "旧格式理解保留 API。");
  assert.equal(legacyNative.content.description, legacyNative.summary);
  assert.equal(legacyNative.readings[0].markdown, "中文补充正文。");
  assertNoLanguageFields(legacyRead); assertNoLanguageFields(legacyNative);
  const legacyHits = await test.call("search", { query: "旧格式理解", limit: 5 });
  assert.equal(legacyHits.find(hit => hit.id === legacy.id)?.summary, legacyNative.summary);
  assertNoLanguageFields(legacyHits);
  const legacyList = await test.call("list", { tag: "旧卡标签", includeTags: true });
  const legacyListItem = legacyList.items.find(item => item.id === legacy.id);
  assert.deepEqual(legacyListItem?.tags, legacyRead.tags);
  assertNoLanguageFields(legacyListItem);
  assert.match((await test.call("get-document", { id: legacy.readingId })).html, /中文补充正文/);
  assert.equal((await test.admin("save-document", { op_id: "legacy-whole-denied", id: legacy.id, expected_revision: legacyRead.revision, title: legacyRead.title, markdown: "不能整篇覆盖旧字段。" }, false)).code, "unsupported_structure");
  const legacyDescription = legacyNative.sections.find(section => section.key === "description");
  const legacyUpdate = { op_id: "legacy-block-update", id: legacyDescription.id, expected_hash: legacyDescription.hash, markdown: "按块更新的中文理解保留 API。" };
  const legacyUpdated = await test.admin("update-block", legacyUpdate);
  assert.equal((await test.admin("update-block", { ...legacyUpdate, op_id: "legacy-stale-block", markdown: "过期输入不能覆盖。" }, false)).code, "content_conflict");
  const legacyAfter = await test.call("get", { id: "legacy-card" });
  assert.equal(legacyAfter.content.description, legacyUpdate.markdown);
  assert.equal(legacyAfter.sections.find(section => section.id === legacyDescription.id)?.hash, legacyUpdated.hash);
  assert.equal((await test.call("get-document", { id: legacy.id })).editable, false);
  assertNoLanguageFields(legacyAfter);
  test.record("chinese-fixed-field-read-and-block-protection", { id: legacy.id, readingId: legacy.readingId, editable: legacyRead.editable, title: legacyRead.title, summary: legacyNative.summary, updated: legacyUpdated, staleHashRejected: true, noLanguageFields: true });

  const readingCard = await test.createDocument({title:"带阅读的卡片", markdown:"补充阅读属于这张卡片。"});
  await test.createDocument({title:"独立补充材料", markdown:"补充阅读独有线索XYZ。", parent:readingCard.id});
  const readingParent = await test.call("get-document", { id: readingCard.id });
  assert.equal(readingParent.readings.length, 1);
  const reading = await test.call("get-document", { id: readingParent.readings[0].id });
  assert.ok(reading.markdown.includes("补充阅读独有线索XYZ"));
  const readingHits = await test.call("search", { query: "补充阅读独有线索XYZ", limit: 5 });
  assertNoLanguageFields(readingParent); assertNoLanguageFields(readingHits);
  assert.ok(readingHits.some((hit) => hit.id === readingCard.id));
  const misplaced = await test.core(`const {id}=await import('./lib/siyuan.mjs');const doc=id();
    await api.newDoc(doc,'错位阅读','错位阅读独有线索XYZ。',api.c.libraryRootId);
    await api.setAttrs(doc,{'custom-cd-kind':'article','custom-cd-parent':input.parentId});await api.flush();
    console.log(JSON.stringify({id:doc}));`, { parentId: readingCard.id });
  const scopedList = await test.call("list", { query: "错位阅读独有线索XYZ" });
  assert.equal(scopedList.total, 0);
  assert.deepEqual((await test.call("get-document", { id: readingCard.id })).readings.map(item => item.id), [reading.id]);
  test.record("reading-source-scope", { parentId: readingCard.id, readingId: reading.id, misplacedId: misplaced.id, scopedList });
  const layout = await test.core("const{id}=await import('./lib/siyuan.mjs');const doc=id();await api.newDoc(doc,'原生复杂布局','{{{row\\n\\n复杂布局里的原文。\\n\\n}}}',api.c.libraryRootId);await api.setAttrs(doc,{'custom-cd-schema':'2','custom-cd-kind':'concept'});console.log(JSON.stringify({id:doc}));");
  const layoutRead = await test.call("get-document", { id: layout.id });
  assert.equal(layoutRead.editable, false); assert.ok(layoutRead.readOnlyReason); assert.ok(layoutRead.markdown.includes("复杂布局里的原文。"));
  const formattedMarkdown = '| 字段 | 值 |\n| --- | --- |\n| 检查 | 通过 |\n\n```js\nconst proof = "<script>";\n```';
  const formatted = await test.createDocument({ title: "代码与表格", markdown: formattedMarkdown });
  const formattedRead = await test.call("get-document", { id: formatted.id });
  assert.match(formattedRead.html, /<table(?:\s[^>]*)?>/);
  assert.match(formattedRead.html, /<pre(?:\s[^>]*)?><code/);
  assert.ok(formattedRead.markdown.includes('const proof = "<script>";'));
  assert.doesNotMatch(formattedRead.html, /<script[\s>]/i);
  test.record("supplementary-reading-and-native-layout", { parentId: readingCard.id, reading, searchHits: readingHits, complex: { id: layout.id, editable: layoutRead.editable, reason: layoutRead.readOnlyReason, markdown: layoutRead.markdown }, formatted: formattedRead });

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAIAAAAUMWhjAAAAJElEQVR4nGMQTwunKWIYtWDUglELRi0YtWDUglELRi0YGhYAAMJ9fB+MFECJAAAAAElFTkSuQmCC", "base64");
  const form = new FormData(); form.append("files[]", new Blob([png], { type: "image/png" }), "probe.png");
  const upload = await request("/api/assets", { method: "POST", headers: { authorization: "Bearer " + test.token }, body: form });
  assert.equal(upload.status, 404);
  const assetPath = "/assets/raw-" + digest(png) + ".png";
  await test.core(`
    const {rawWrite} = await import("./lib/raw-write.mjs");
    const saved = await rawWrite(api, "raw-asset", {...input, identity:await api.identity()});
    console.log(JSON.stringify(saved));
  `, {path:assetPath.slice(1), bytes:png.toString("base64"), sha256:digest(png)});
  const image = await request(assetPath.startsWith("/") ? assetPath : "/" + assetPath);
  assert.equal(image.status, 200); assert.equal(digest(Buffer.from(await image.arrayBuffer())), digest(png));
  for (const headers of [{ origin: "https://attacker.invalid" }, { "sec-fetch-site": "cross-site" }])
    assert.equal((await request(assetPath.startsWith("/") ? assetPath : "/" + assetPath, { headers })).status, 403);
  const traversal = await request("/assets/%2e%2e%2fconf%2fconf.json", { headers: { authorization: "Bearer " + test.token } });
  assert.ok([400, 403, 404].includes(traversal.status));
  test.record("rendering-and-assets", { scriptPrevented: true, imagePath: assetPath, expectedHash: digest(png), rawAssetHash: digest(png), publicUploadStatus: upload.status, directAssetStatus: 200, crossOriginAssetStatus: 403, crossSiteAssetStatus: 403, traversalStatus: traversal.status });
  await test.restart();
  const persistent = await test.call("get-document", { id: created.id });
  assert.equal(persistent.title, restored.title); assert.equal(persistent.markdown, restored.markdown);
  const installedPersistent = await test.cli("get-document", { id: created.id });
  const localStatus = await test.admin("operation-status", { op_id: "save-card" });
  assert.equal(installedPersistent.revision, persistent.revision);
  assert.equal(installedPersistent.markdown, persistent.markdown);
  assert.equal(localStatus.state, "verified");
  test.record("restart-persistence", { expected: restored, actual: persistent, installedCLI: installedPersistent, localOperationStatus: localStatus });
  const filterPrefix = "分页筛选";
  await test.createDocuments(Array.from({length:25}, (_, at) => ({
    title:filterPrefix+at, markdown:"筛选正文。\n\n## 标签\n\n方法论、分析,设计",
  })));
  const filteredFirst=await test.call('list',{query:filterPrefix,tag:'方法论',includeTags:true,limit:20,offset:0});
  const filteredSecond=await test.call('list',{query:filterPrefix,tag:'方法论',includeTags:true,limit:20,offset:20});
  assert.equal(filteredFirst.total,25);assert.equal(filteredFirst.items.length,20);assert.equal(filteredSecond.items.length,5);assert.equal(filteredSecond.hasMore,false);
  assert.equal(new Set([...filteredFirst.items,...filteredSecond.items].map(x=>x.id)).size,25);
  assert.ok(filteredFirst.tags.includes('分析,设计'));
  const filteredReading=await test.call('list',{query:'补充阅读独有线索XYZ',includeTags:true,limit:20});assert.equal(filteredReading.total,1);assert.equal(filteredReading.items[0].id,readingCard.id);
  assertNoLanguageFields(filteredReading.items[0]);
  const beforeDelete = await test.call("get-document", { id: readingCard.id });
  const readingBefore = await test.call("get-document", { id: reading.id });
  const remove = { op_id: "delete-reading-parent", id: readingCard.id, expected_revision: beforeDelete.revision };
  assert.equal(beforeDelete.deletable, false);
  assert.equal(readingBefore.deletable, false);
  const childRejected = await test.admin("delete-document", { ...remove, op_id: "delete-child-denied", id: reading.id, expected_revision: readingBefore.revision }, false);
  assert.equal(childRejected.code, "outside_scope");
  const staleDelete = await test.admin("delete-document", { ...remove, op_id: "delete-stale", expected_revision: "stale" }, false);
  assert.equal(staleDelete.code, "content_conflict");
  const observed = await test.core(`
    const saveAttrs=api.setAttrs.bind(api);
    api.setAttrs=async(...args)=>{await saveAttrs(...args);throw Object.assign(new Error('lost response'),{code:'transport_unknown'});};
    let code;
    try { await execute(api,'delete-document',input); } catch(error) { code=error.code; }
    api.setAttrs=saveAttrs;
    const receipt=await execute(api,'operation-status',{op_id:input.op_id});
    console.log(JSON.stringify({code,receipt}));
  `, remove);
  assert.equal(observed.code, "operation_pending");
  assert.equal(observed.receipt.state, "verified");
  const deleted = observed.receipt.result;
  assert.equal(deleted.deleted, true);
  assert.deepEqual(await test.admin("delete-document", remove), deleted);
  for (const id of [readingCard.id, reading.id])
    assert.equal((await test.call("get-document", { id }, false)).code, "outside_scope");
  const removedHits = await test.call("list", { query: "补充阅读独有线索XYZ" });
  assert.equal(removedHits.total, 0);
  assert.deepEqual(await test.call("search", { query: "补充阅读独有线索XYZ" }), []);
  await test.restart();
  assert.equal((await test.call("get-document", { id: reading.id }, false)).code, "outside_scope");
  const undo = await test.admin("recover", { op_id: "restore-deleted-parent", backup_op_id: remove.op_id, expected_revision: deleted.revision });
  assert.equal(undo.deleted, false);
  const recoveredCard = await test.call("get-document", { id: readingCard.id });
  assert.equal(recoveredCard.markdown, beforeDelete.markdown);
  assert.deepEqual(recoveredCard.readings, beforeDelete.readings);
  assert.equal((await test.call("get-document", { id: reading.id })).markdown, readingBefore.markdown);
  assert.equal((await test.call("list", { query: "补充阅读独有线索XYZ" })).total, 1);
  test.record("delete-card-and-recover", { id: readingCard.id, childId: reading.id, childRejected, staleDelete, observed, removedHits, undo, recoveredCard });
  const dated=await test.call('list',{query:filterPrefix,updatedFrom:'2000-01-01',updatedTo:'2000-01-02',includeTags:true});assert.equal(dated.total,0);
  const rejectedDate=await test.call('list',{updatedFrom:'2026-02-30'},false);assert.equal(rejectedDate.code,'invalid_input');
  test.record('list-filters-before-pagination',{first:filteredFirst,second:filteredSecond,reading:filteredReading,dated,rejectedDate});
  const timeCard=await test.createDocument({title:'正文时间测试', markdown:'块时间应该驱动卡片更新时间。'});
  const nativeTimes=await test.core(`
    const blocks=await api.sql("SELECT id,type,updated FROM blocks WHERE root_id='"+input.id+"'");
    const root=blocks.find(row=>row.type==='d');
    const body=blocks.find(row=>row.type==='p');
    await new Promise(resolve=>setTimeout(resolve,1100));
    await api.api('/api/block/updateBlock',{id:body.id,dataType:'markdown',data:'原生修改正文后的新内容。'});
    await api.flush();
    const [edited]=await api.sql("SELECT updated FROM blocks WHERE id='"+body.id+"'");
    console.log(JSON.stringify({root:root.updated,body:edited.updated}));
  `,{id:timeCard.id});
  const timeDetail=await test.call('get-document',{id:timeCard.id});
  assert.ok(nativeTimes.body>nativeTimes.root);
  const day=nativeTimes.body.slice(0,8).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
  const timeList=await test.call('list',{query:'正文时间测试',updatedFrom:day,updatedTo:day});
  assert.ok(timeDetail.markdown.includes('原生修改正文后的新内容'));
  assert.equal(timeDetail.updated,nativeTimes.body);assert.equal(timeList.total,1);assert.equal(timeList.items[0].updated,timeDetail.updated);
  test.record('effective-document-update-time',{id:timeCard.id,nativeTimes,detail:timeDetail.updated,list:timeList});
  await verifyRawCli(test);
  await verifyWiki(test);
  passed = true;
  console.log("PASS real application/API integration, auth, compatibility, save and recovery");
} catch (error) {
  test.evidence.failure = { message: error.message, stack: error.stack };
  throw error;
} finally { await test.finish(passed); }
