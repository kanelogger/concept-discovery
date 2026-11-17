import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { markdownEquivalent } from "../../lib/documents.mjs";
import { wikiFixtureKey } from "../fixtures/wiki-model.mjs";

const fixtureScript = readFileSync(new URL("../fixtures/wiki-model.mjs", import.meta.url), "utf8");
const fixturePaths = { script: "/tmp/cd-wiki-fixture.mjs", control: "/tmp/cd-wiki-fixture-control.json", records: "/tmp/cd-wiki-fixture-records.json", ready: "/tmp/cd-wiki-fixture-ready.json" };

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


/** One real-kernel draft -> ordinary document-save path; never calls an external model. */
export async function verifyWiki(test) {
  const raw = "理解需要自己解释。\n\n迁移需要在新情境中判断适用条件。";
  const source = await test.call("source-import", { op_id: "wiki-source-one", title: "合成学习资料", markdown: raw });
  assert.equal(source.markdown, raw);
  assert.deepEqual(await test.cli("source-get", { id: source.id }), source);
  assert.equal((await test.call("source-import", { op_id: "wiki-source-one", title: "合成学习资料", markdown: raw })).id, source.id);
  const independent = await test.call("source-import", { op_id: "wiki-source-two", title: "合成学习资料", markdown: raw + "\n新的边界。" });
  assert.notEqual(independent.sourceId, source.sourceId); assert.equal(independent.version, 1);

  const browser = await installWikiModel(test);
  const before = await test.call("list", { limit: 100 });
  const generated = await test.call("wiki-draft", { sourceId: source.id });
  assert.equal(generated.target, null); assert.ok(generated.markdown.includes(source.id));
  assert.deepEqual(await test.call("list", { limit: 100 }), before, "generation never creates a card");
  assert.deepEqual((await test.call("wiki-proposals", {})).items, [], "drafts are not persisted proposals");
  assert.deepEqual((await test.call("wiki-events", {})).items, [], "new workflow does not write knowledge events");

  const personalText = "这是人的独立理解，后续整理不得替换。";
  const personal = "## 我的理解\n\n" + personalText;
  const created = await test.cli("create", { op_id: "wiki-draft-create", document: { title: generated.title, markdown: generated.markdown + "\n\n" + personal } });
  const card = await test.call("get-document", { id: created.id });
  test.record("wiki-initial-document", { requested: generated.markdown + "\n\n" + personal, document: card });
  assert.equal(card.editable, true);
  assert.equal(markdownEquivalent(card.markdown, generated.markdown + "\n\n" + personal), true, "SiYuan may normalize blank lines, but must preserve the complete draft and personal section");
  assert.ok(card.markdown.includes(personalText));
  assert.equal((await test.call("wiki-card", { id: card.id })).question, "这份资料说明了什么？");
  await setWikiModelResponse(test, { draft: { title: "模型不能改目标卡名", body: "补充资料明确了迁移的适用边界。", question: "什么时候需要重新核对边界？", quotes: [{ quote: "迁移需要在新情境中判断适用条件。" }] } });
  const update = await test.cli("wiki-draft", { sourceId: source.id, cardId: card.id });
  assert.deepEqual(update.target, { id: card.id, title: card.title, revision: card.revision });
  assert.equal(update.title, card.title);
  assert.equal((await test.call("get-document", { id: card.id })).revision, card.revision, "existing-card draft is also read-only");
  const save = { op_id: "wiki-draft-save", id: card.id, title: card.title, expected_revision: card.revision, markdown: card.markdown + "\n\n" + update.markdown };
  const response = await fetch(test.url + "/api/v1/commands/save-document", { method: "POST", headers: { "content-type": "application/json", origin: test.url, cookie: browser.cookie }, body: JSON.stringify(save) });
  assert.equal(response.status, 200); const saved = (await response.json()).data;
  assert.equal((await test.call("save-document", save)).revision, saved.revision, "same save receipt is idempotent");
  const readback = await test.core("console.log(JSON.stringify({markdown:await api.markdown(input.id),receipt:await execute(api,'operation-status',{op_id:input.op_id})}));", { id: card.id, op_id: save.op_id });
  assert.ok(readback.markdown.includes(personalText)); assert.ok(readback.markdown.includes(update.markdown.split("\n")[0]));
  assert.ok(readback.markdown.includes("补充资料明确了迁移的适用边界。"));
  assert.equal(readback.receipt.state, "verified");
  assert.equal((await test.call("save-document", { ...save, op_id: "wiki-stale-save" }, false)).code, "content_conflict");

  const legacy = await test.call("create", { op_id: "wiki-old-card", concept: { id: "wiki-old-card", locales: { cn: { name: "旧字段卡", description: "人的旧中文正文。" }, en: { name: "Old card", description: "Retain English and links." } } } });
  const legacyBefore = await test.call("get-document", { id: legacy.id });
  assert.equal(legacyBefore.editable, false);
  assert.equal((await test.call("wiki-draft", { sourceId: source.id, cardId: legacy.id }, false)).code, "unsupported_structure");
  assert.deepEqual(await test.call("get-document", { id: legacy.id }), legacyBefore);
  for (const command of ["ask", "polish-description", "wiki-propose", "wiki-apply", "wiki-understanding", "wiki-recover"])
    assert.equal((await test.call(command, {}, false)).code, "invalid_command");

  const oversized = await test.call("source-import", { op_id: "wiki-long-source", title: "完整保留", markdown: "文".repeat(20001) });
  assert.equal((await test.call("wiki-draft", { sourceId: oversized.id }, false)).code, "invalid_input");
  await setWikiModelResponse(test, { draft: { title: "非法引用", body: "不应采用。", question: "", quotes: [{ quote: "原文没有这句话。" }] } });
  assert.equal((await test.call("wiki-draft", { sourceId: source.id }, false)).code, "draft_invalid_output");
  await test.restart();
  assert.deepEqual(await test.cli("source-get", { id: source.id }), source);
  const restarted = await test.call("get-document", { id: card.id });
  assert.ok(restarted.markdown.includes(personalText)); assert.equal(restarted.editable, true);
  test.record("wiki-draft-ordinary-save", { sourceId: source.id, targetId: card.id, legacyId: legacy.id, generatedReadOnly: true,
    personalTextPreserved: true, receiptState: readback.receipt.state, externalModelCalls: 0, coldRestoreRequired: false });
}
