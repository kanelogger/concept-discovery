import assert from "node:assert/strict";
import { readFileSync, cpSync, existsSync, lstatSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normalize } from "../../lib/siyuan.mjs";
import { runtime, digest } from "./runtime.mjs";
import { wikiFixtureKey } from "../fixtures/wiki-model.mjs";

const fixtureScript = readFileSync(new URL("../fixtures/wiki-model.mjs", import.meta.url), "utf8");
const fixturePaths = { script: "/tmp/cd-wiki-fixture.mjs", control: "/tmp/cd-wiki-fixture-control.json", records: "/tmp/cd-wiki-fixture-records.json", ready: "/tmp/cd-wiki-fixture-ready.json" };
const exec = promisify(execFile);

function metadataManifest(root) {
  const result = {};
  function visit(relative) {
    const file = join(root, relative), stat = lstatSync(file);
    assert.equal(stat.isSymbolicLink(), false, "backup metadata must not escape through a symlink");
    if (stat.isDirectory()) for (const name of readdirSync(file).sort()) visit(join(relative, name));
    else if (stat.isFile()) result[relative] = digest(readFileSync(file));
  }
  for (const directory of ["wiki", "operations"]) { assert.ok(existsSync(join(root, directory))); visit(directory); }
  return result;
}

async function verifyWikiBackupRestore(test, expected) {
  const repository = resolve(new URL("../../", import.meta.url).pathname);
  const compose = ["compose", "-p", test.name, "--env-file", join(test.root, "compose.env"), "-f", join(repository, "deploy/compose.yaml")];
  await exec("docker", [...compose, "stop", "app", "kernel"], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  const backup = join(test.dir, "wiki-cold-backup");
  cpSync(test.root, backup, { recursive: true, errorOnExist: true, force: false });
  const beforeManifest = metadataManifest(test.root);
  assert.deepEqual(metadataManifest(backup), beforeManifest);
  test.record("wiki-consistent-private-backup", { sourceStackStopped: true, domains: ["workspace", "wiki", "operations", "private-config"], wikiAndOperationHashes: beforeManifest });

  let restored, passed = false;
  try {
    restored = await runtime("wiki-restore", { build: false, initialize(restoredRoot) {
      cpSync(backup, restoredRoot, { recursive: true, errorOnExist: true, force: false });
      const envPath = join(restoredRoot, "compose.env");
      const env = readFileSync(envPath, "utf8")
        .replace(/^CONCEPT_PRIVATE_ROOT=.*$/m, "CONCEPT_PRIVATE_ROOT=" + restoredRoot)
        .replace(/^CONCEPT_PORT=.*$/m, "CONCEPT_PORT=6806")
        .replace(/^COMPOSE_PROJECT_NAME=.*\n?/m, "");
      writeFileSync(envPath, env, { mode: 0o600 });
      assert.deepEqual(metadataManifest(restoredRoot), beforeManifest, "raw, proposal and receipt files restored exactly before boot");
    } });
    assert.notEqual(restored.root, test.root);
    assert.notEqual(restored.name, test.name);
    const identity = await restored.core("console.log(JSON.stringify(await api.identity()));");
    assert.equal(identity, expected.identity);
    const source = await restored.call("source-get", { id: expected.source.id });
    assert.deepEqual(source, expected.source);
    const proposal = await restored.call("wiki-proposal", { id: expected.proposal.id });
    assert.deepEqual(proposal, expected.proposal);
    const document = await restored.call("get-document", { id: expected.card.id });
    assert.equal(document.id, expected.card.id);
    assert.equal(document.title, expected.card.title);
    assert.equal(document.markdown, expected.card.markdown);
    assert.equal(document.editable, true, "ordinary wiki cards remain web-editable after cold restore");
    const restoredLegacy = await restored.call("get-document", { id: expected.legacyId });
    assert.equal(restoredLegacy.editable, false, "old fixed-field cards remain read-only after cold restore");
    const learning = await restored.call("wiki-card", { id: expected.card.id });
    assert.deepEqual(learning.understandings, expected.learning.understandings);
    assert.deepEqual(learning.sources, expected.learning.sources);
    const events = await restored.call("wiki-events", {});
    assert.deepEqual(events, expected.events);
    const receipt = await restored.call("operation-status", { op_id: expected.understandingOp });
    assert.equal(receipt.state, "verified");
    restored.record("wiki-restored-private-domains", { originRunId: test.name, identity, sourceId: source.id, proposalId: proposal.id, cardId: document.id,
      expectedDocumentHash: digest(expected.card.markdown), actualDocumentHash: digest(document.markdown), understandings: learning.understandings,
      sourceReferences: learning.sources, editable: document.editable, legacyEditable: restoredLegacy.editable,
      eventCount: events.items.length, operationState: receipt.state, externalModelCalls: 0 });
    passed = true;
  } catch (error) {
    if (restored) { restored.evidence.failure = { message: error.message, stack: error.stack }; restored.persist(); }
    throw error;
  } finally {
    if (restored) {
      await restored.finish(passed);
      test.record("wiki-private-backup-restore", { restoreRunId: restored.name, result: restored.evidence.result, cleaned: restored.evidence.cleaned,
        cleanupStatus: restored.evidence.cleanup?.status, separatePrivateRoot: true, preservedLibraryIdentity: true,
        sourceId: expected.source.id, proposalId: expected.proposal.id, cardId: expected.card.id });
    }
  }
}

export async function setWikiModelResponse(test, control) {
  return test.core(`const fs=await import('node:fs');fs.writeFileSync(input.path,JSON.stringify(input.control),{mode:0o600});console.log(JSON.stringify({configured:true}));`, { path: fixturePaths.control, control });
}

/** Starts only inside this run's app container; cleanup destroys the container. */
export async function installWikiModel(test, control = {}) {
  const ready = await test.core(`
    const fs=await import('node:fs');const{spawn}=await import('node:child_process');
    fs.writeFileSync(input.paths.script,input.script,{mode:0o600});
    fs.writeFileSync(input.paths.control,JSON.stringify(input.control),{mode:0o600});
    let active=false;try{active=(await fetch('http://127.0.0.1:31373/health')).ok;}catch{}
    if(!active){try{fs.unlinkSync(input.paths.ready);}catch{}
      spawn(process.execPath,[input.paths.script,input.paths.control,input.paths.records,input.paths.ready,'31373'],{detached:true,stdio:'ignore'}).unref();
    }
    for(let attempt=0;attempt<100;attempt++){
      try{const r=await fetch('http://127.0.0.1:31373/health');if(r.ok){console.log(JSON.stringify({baseUrl:'http://127.0.0.1:31373',synthetic:true}));process.exit(0);}}catch{}
      await new Promise(yes=>setTimeout(yes,50));
    }
    throw new Error('Wiki fixture readiness timeout');
  `, { script: fixtureScript, paths: fixturePaths, control });
  const login = await fetch(test.url + "/api/session", { method: "POST", headers: { "content-type": "application/json", origin: test.url }, body: JSON.stringify({ accessCode: test.accessCode }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const settings = await fetch(test.url + "/api/model-settings", { method: "PUT", headers: { "content-type": "application/json", origin: test.url, cookie },
    body: JSON.stringify({ baseUrl: ready.baseUrl, model: "wiki-fixture", maxTokenField: "max_tokens", apiKey: wikiFixtureKey }) });
  assert.equal(settings.status, 200, "synthetic loopback model configured through browser session");
  const result = await settings.json();
  assert.equal(result.ok, true);
  test.record("wiki-loopback-fixture", { baseUrl: ready.baseUrl, synthetic: true, externalModelCalls: 0 });
  return { ...ready, cookie };
}

const oneItem = ({ kind = "create", cardId = "", title, body, question = "怎样验证自己的理解？", quote }) => ({
  kind, cardId, title, body, question, reason: "用合成原文核对并更新概念，保留人的理解。", quotes: [{ sourceId: "$SOURCE_ID", quote }],
});
const approval = p => ({ id: p.id, expected_revision: p.revision, items: p.items.map(item => ({ id: item.id, selected: true })) });

export async function verifyWiki(test) {
  const raw = "理解需要自己解释。\n\n迁移需要在新情境中判断适用条件。";
  const anonymous = await fetch(test.url + "/api/v1/commands/source-get", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "src_" + "a".repeat(32) }) });
  assert.equal(anonymous.status, 401);
  const imported = await test.call("source-import", { op_id: "wiki-source-one", title: "合成学习资料", markdown: raw, url: "https://example.org/wiki-source" });
  assert.equal(imported.markdown, raw);
  assert.equal(imported.version, 1);
  assert.deepEqual(await test.cli("source-get", { id: imported.id }), imported);
  assert.equal((await test.call("source-get", { id: "../kernel.json" }, false)).code, "invalid_input");
  assert.equal((await test.call("source-import", { op_id: "wiki-too-large", title: "超限", markdown: "文".repeat(200001) }, false)).code, "invalid_input");
  const repeated = await test.cli("source-import", { op_id: "wiki-source-one", title: "合成学习资料", markdown: raw, url: "https://example.org/wiki-source" });
  assert.equal(repeated.id, imported.id);
  const newer = await test.cli("source-import", { op_id: "wiki-source-two", sourceId: imported.sourceId, title: "合成学习资料", markdown: raw + "\n\n新的版本补充边界。", url: "https://example.org/wiki-source" });
  assert.equal(newer.version, 2);
  assert.equal(newer.sourceId, imported.sourceId);
  assert.equal((await test.call("source-get", { id: imported.id })).markdown, raw);

  const newItem = oneItem({ title: "合成理解卡", body: "## 核心理解\n\n理解包括自己的解释与适用边界。", quote: "理解需要自己解释。" });
  const browser = await installWikiModel(test, { cardIds: [], items: [newItem] });
  const generated = await test.call("wiki-propose", { sourceId: imported.id });
  assert.equal(generated.state, "draft");
  assert.equal(generated.items.length, 1);
  const reviewed = approval(generated);
  reviewed.items[0].body = "## 核心理解\n\n用户审阅后的解释：通过自己的例子检查理解。";
  const applied = await test.cli("wiki-apply", reviewed);
  assert.equal(applied.state, "applied");
  assert.equal(applied.items[0].status, "applied");
  const cardId = applied.items[0].result.cardId;
  const card = await test.call("get-document", { id: cardId });
  assert.equal(card.editable, true, "ordinary wiki cards are editable after initial adoption");
  assert.ok(card.markdown.includes("用户审阅后的解释"));
  assert.ok(card.markdown.includes(imported.id));
  const repeatedApplied = await test.call("wiki-apply", reviewed);
  assert.equal(repeatedApplied.items[0].result.managedGroupId, applied.items[0].result.managedGroupId);
  assert.equal((await test.call("get-document", { id: cardId })).revision, card.revision);
  const learning = await test.call("wiki-card", { id: cardId });
  assert.equal(learning.question, newItem.question);
  assert.equal(learning.sources[0].id, imported.id);
  const understandingRequest = { id: cardId, op_id: "wiki-my-understanding", expected_revision: learning.revision, text: "我的理解：能在新问题里说清适用边界，才算开始会用。" };
  const understanding = await test.cli("wiki-understanding", understandingRequest);
  assert.equal((await test.call("wiki-understanding", understandingRequest)).revision, understanding.revision);
  const afterUnderstanding = await test.call("get-document", { id: cardId });
  assert.equal(afterUnderstanding.editable, true, "understanding append preserves ordinary web editing");
  assert.ok(afterUnderstanding.markdown.includes(understandingRequest.text));
  const personal = await test.call("wiki-card", { id: cardId });
  assert.equal(personal.understandings.length, 1);
  assert.ok(personal.understandings[0].text.includes(understandingRequest.text));
  test.record("wiki-source-proposal-review-understanding", { source: imported, newer, proposal: generated.id, approved: applied, card: afterUnderstanding, learning: personal, repeatedApplySameGroup: true });

  const oversized = await test.call("source-import", { op_id: "wiki-compile-too-large", title: "完整保留但不超预算整理", markdown: "文".repeat(20001) });
  const modelCounts = () => test.core(`const fs=await import('node:fs');console.log(JSON.stringify(JSON.parse(fs.readFileSync(input.path,'utf8')).count));`, { path: fixturePaths.records });
  const callsBeforeLimit = await modelCounts();
  const limited = await test.call("wiki-propose", { sourceId: oversized.id }, false);
  assert.equal(limited.code, "invalid_input");
  assert.equal(await modelCounts(), callsBeforeLimit, "over-budget material is not silently truncated and sent");
  assert.equal((await test.call("source-get", { id: oversized.id })).markdown.length, 20001);
  await setWikiModelResponse(test, { cardIds: [], items: [oneItem({ title: "非法引文", body: "不应被保存。", quote: "不存在于原文的伪造引用。" })] });
  const invalidQuote = await test.call("wiki-propose", { sourceId: imported.id }, false);
  assert.equal(invalidQuote.code, "ask_invalid_output");
  test.record("wiki-model-boundaries", { sourceId: oversized.id, preservedCharacters: 20001, overBudget: limited, forgedQuoteRejected: invalidQuote.code, anonymousStatus: anonymous.status });

  // A later compilation replaces its own AI area without replacing human writing.
  await setWikiModelResponse(test, { cardIds: [cardId], items: [oneItem({ kind: "update", cardId, title: "合成理解卡", body: "第二版AI解释：新情境需要重新核对适用边界。", quote: "新的版本补充边界。" })] });
  const updateProposal = await test.call("wiki-propose", { sourceId: newer.id });
  const updateApproval = approval(updateProposal);
  const updated = await test.call("wiki-apply", updateApproval);
  assert.equal(updated.state, "applied");
  const updatedCard = await test.call("get-document", { id: cardId });
  assert.equal(updatedCard.editable, true, "updating an AI area preserves its application-owned layout marker");
  assert.ok(updatedCard.markdown.includes("第二版AI解释"));
  assert.ok(updatedCard.markdown.includes(understandingRequest.text));
  assert.equal((await test.call("wiki-card", { id: cardId })).understandings.length, 1);
  const recoveryBaseline = await test.core(`const receipt=(await api.receipt(input.op_id)).value;console.log(JSON.stringify({receipt,group:await api.markdown(input.groupId)}));`, { op_id: updated.items[0].result.op_id, groupId: updated.items[0].result.managedGroupId });
  test.record("wiki-managed-update-before-recovery", { proposal: updated, document: updatedCard, recoveryBaseline });
  const recovered = await test.cli("wiki-recover", { op_id: "wiki-recover-ai", backup_op_id: updated.items[0].result.op_id, expected_hash: updated.items[0].result.managedHash });
  assert.equal(recovered.restored, true);
  const recoveredCard = await test.call("get-document", { id: cardId });
  assert.equal(recoveredCard.editable, true, "recovering an AI area preserves ordinary web editing");
  assert.ok(recoveredCard.markdown.includes("用户审阅后的解释"));
  assert.ok(!recoveredCard.markdown.includes("第二版AI解释"));
  assert.ok(recoveredCard.markdown.includes(understandingRequest.text));
  const forbiddenRecovery = await test.call("wiki-recover", { op_id: "wiki-recover-human-denied", backup_op_id: understandingRequest.op_id, expected_hash: "0".repeat(64) }, false);
  assert.equal(forbiddenRecovery.code, "outside_scope");
  test.record("wiki-update-and-ai-only-recovery", { id: cardId, updated, recovered, document: recoveredCard, humanRecoveryDenied: forbiddenRecovery.code });

  await setWikiModelResponse(test, { cardIds: [cardId], items: [oneItem({ kind: "update", cardId, title: "合成理解卡", body: "恢复后再次整理仍只更新AI区域。", quote: "新的版本补充边界。" })] });
  const afterRecoveryProposal = await test.call("wiki-propose", { sourceId: newer.id });
  const afterRecoveryApplied = await test.call("wiki-apply", approval(afterRecoveryProposal));
  assert.equal(afterRecoveryApplied.state, "applied");
  const recompiled = await test.call("get-document", { id: cardId });
  assert.equal(recompiled.editable, true, "later compilation does not turn an ordinary card into a native read-only layout");
  assert.ok(recompiled.markdown.includes("恢复后再次整理"));
  assert.ok(recompiled.markdown.includes(understandingRequest.text));
  test.record("wiki-compilation-continues-after-recovery", { proposalId: afterRecoveryProposal.id, applied: afterRecoveryApplied, document: recompiled });

  // Exercise the same session/Origin-protected save endpoint as the web editor.
  // This happens after the last proposal for this card so no later baseline is invalidated.
  const webUnderstanding = understandingRequest.text + "（网页编辑补充：先找反例，再决定如何迁移。）";
  const webSave = await fetch(test.url + "/api/v1/commands/save-document", { method: "POST",
    headers: { "content-type": "application/json", origin: test.url, cookie: browser.cookie },
    body: JSON.stringify({ op_id: "wiki-edit-understanding-web", id: cardId, expected_revision: recompiled.revision,
      title: recompiled.title, markdown: recompiled.markdown.replace(understandingRequest.text, webUnderstanding) }) });
  const webSaved = await webSave.json();
  assert.equal(webSave.status, 200, "ordinary wiki card still saves through the browser editor endpoint");
  assert.equal(webSaved.ok, true);
  const webEdited = await test.call("get-document", { id: cardId });
  assert.equal(webEdited.editable, true);
  assert.ok(webEdited.markdown.includes(webUnderstanding));
  assert.ok(webEdited.markdown.includes("恢复后再次整理"));
  assert.ok((await test.call("wiki-card", { id: cardId })).understandings[0].text.includes(webUnderstanding));
  test.record("wiki-ordinary-card-remains-web-editable", { id: cardId, stages: ["created", "understanding-appended", "AI-updated", "AI-recovered", "AI-recompiled"],
    savedThroughBrowserSession: true, document: webEdited, understanding: webUnderstanding });

  // Old fixed-field content remains untouched; only a separately owned AI area is appended.
  const legacy = await test.call("create", { op_id: "wiki-legacy", concept: { id: "wiki-legacy", locales: { cn: { name: "旧格式保护卡", description: "需要保留的中文理解", source_text: "https://example.org/legacy" }, en: { name: "Protected legacy", description: "Original English explanation" } } } });
  const legacyBefore = await test.call("get", { id: legacy.id });
  assert.equal((await test.call("get-document", { id: legacy.id })).editable, false);
  const legacySections = legacyBefore.sections.map(s => ({ id: s.id, markdown: normalize(s.markdown) }));
  await setWikiModelResponse(test, { cardIds: [legacy.id], items: [oneItem({ kind: "update", cardId: legacy.id, title: "不应改旧标题", body: "新增的AI整理区。", quote: "理解需要自己解释。" })] });
  const oldProposal = await test.call("wiki-propose", { sourceId: imported.id });
  const oldApproval = approval(oldProposal);
  const oldApplied = await test.call("wiki-apply", oldApproval);
  assert.equal(oldApplied.state, "applied");
  const legacyAfter = await test.call("get", { id: legacy.id });
  for (const section of legacySections) assert.equal(normalize(legacyAfter.sections.find(s => s.id === section.id)?.markdown ?? ""), section.markdown, "legacy field content and identity preserved");
  const legacyDocument = await test.call("get-document", { id: legacy.id });
  assert.equal(legacyDocument.title, "旧格式保护卡");
  assert.equal(legacyDocument.editable, false, "appending a separate AI area does not enable destructive legacy whole-document editing");
  test.record("wiki-protect-legacy-fields", { id: legacy.id, protectedSections: legacySections, applied: oldApplied });

  // Simulate the kernel accepting an append while its HTTP result is lost.
  const uncertainTarget = await test.call("create", { op_id: "wiki-unknown-target", document: { title: "未知结果目标", markdown: "历史正文必须保留。" } });
  await setWikiModelResponse(test, { cardIds: [uncertainTarget.id], items: [oneItem({ kind: "update", cardId: uncertainTarget.id, title: "未知结果目标", body: "仅追加一次的整理内容。", quote: "理解需要自己解释。" })] });
  const uncertainProposal = await test.call("wiki-propose", { sourceId: imported.id });
  const frozenApproval = approval(uncertainProposal);
  const uncertain = await test.core(`
    const{executeWiki}=await import('./lib/wiki.mjs');
    const original=api.api.bind(api);let injected=false;
    api.api=async(path,...args)=>{const result=await original(path,...args);if(path==='/api/block/appendBlock'&&!injected){injected=true;throw Object.assign(new Error('injected lost append response'),{code:'transport_unknown'});}return result;};
    const observed=await executeWiki(api,'wiki-apply',input,{publicUrl:'http://127.0.0.1'});
    api.api=original;await api.flush();console.log(JSON.stringify(observed));
  `, frozenApproval);
  assert.equal(uncertain.state, "unknown");
  const resumed = await test.call("wiki-apply", frozenApproval);
  assert.equal(resumed.state, "applied");
  const once = await test.call("get-document", { id: uncertainTarget.id });
  assert.equal(once.editable, true, "unknown-result reconciliation preserves the layout marker");
  assert.equal(once.markdown.split("仅追加一次的整理内容。").length - 1, 1);
  assert.ok(once.markdown.includes("历史正文必须保留。"));
  assert.equal((await test.call("wiki-apply", frozenApproval)).items[0].result.managedGroupId, resumed.items[0].result.managedGroupId);
  test.record("wiki-unknown-apply-reconciles-once", { proposalId: uncertainProposal.id, observed: uncertain, resumed, document: once });

  const providerLog = await test.core(`const fs=await import('node:fs');console.log(fs.readFileSync(input.path,'utf8'));`, { path: fixturePaths.records });
  assert.ok(providerLog.requests.length >= 8);
  assert.ok(providerLog.requests.every(request => request.model === "wiki-fixture" && request.input.source.id !== oversized.id));
  assert.ok(providerLog.requests.some(request => request.input.source.id === imported.id && request.input.source.markdown === raw));
  test.record("wiki-http-model-evidence", { synthetic: true, baseUrl: "http://127.0.0.1:31373", modelRequests: providerLog.count, sourceIds: [...new Set(providerLog.requests.map(request => request.input.source.id))], oversizedSourceSent: false, externalModelCalls: 0 });

  const eventCount = (await test.call("wiki-events", {})).items.length;
  await test.restart();
  assert.equal((await test.cli("source-get", { id: imported.id })).markdown, raw);
  assert.equal((await test.cli("wiki-proposal", { id: generated.id })).items[0].result.cardId, cardId);
  assert.ok((await test.cli("wiki-card", { id: cardId })).understandings[0].text.includes(understandingRequest.text));
  const restartedCard = await test.call("get-document", { id: cardId });
  assert.equal(restartedCard.editable, true, "ordinary wiki cards remain editable after restart");
  assert.ok(restartedCard.markdown.includes(webUnderstanding));
  assert.equal((await test.call("get-document", { id: legacy.id })).editable, false);
  assert.equal((await test.call("wiki-events", {})).items.length, eventCount);
  const installedSources = await test.cli("sources-list", {});
  assert.ok(installedSources.items.some(s => s.id === imported.id));
  test.record("wiki-restart-persistence", { sourceId: imported.id, proposalId: generated.id, cardId, understanding: understandingRequest.text, eventCount, externalModelCalls: 0, syntheticModelOnly: true });
  await verifyWikiBackupRestore(test, {
    identity: await test.core("console.log(JSON.stringify(await api.identity()));"),
    source: await test.call("source-get", { id: imported.id }),
    proposal: await test.call("wiki-proposal", { id: generated.id }),
    card: await test.call("get-document", { id: cardId }),
    learning: await test.call("wiki-card", { id: cardId }),
    events: await test.call("wiki-events", {}), understandingOp: understandingRequest.op_id, legacyId: legacy.id,
  });
}
