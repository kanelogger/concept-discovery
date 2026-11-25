import assert from "node:assert/strict";
import { sourceSnapshot, syncRawSources } from "./source-fixture.mjs";

export async function verifyWiki(test) {
  const input = {op_id:"wiki-source-one", title:"合成学习资料", markdown:"理解需要自己解释。\r\n\r\n迁移需要核对适用条件。"};
  const source = sourceSnapshot("wiki-source-one", { ...input, version: 2 });
  await syncRawSources(test, [source]);
  assert.equal(source.markdown, input.markdown);
  assert.deepEqual(await test.cli("source-get", {id:source.id}), source);
  assert.ok((await test.call("sources-list", {})).items.some(item => item.id === source.id && item.version === 2));

  const personalText = "这是人的独立理解，后续整理不得替换。";
  const card = await test.createDocument({
    title:"历史来源与人的理解", markdown:`## 我的理解\n\n${personalText}\n\n## 中文 · 自问\n\n这份资料说明了什么？\n\n[原文](/wiki?source=${source.id})`,
  });
  const before = await test.cli("get-document", {id:card.id});
  assert.equal(before.editable, false);
  assert.equal(before.deletable, false);
  assert.ok(before.html.includes("/wiki?source=" + source.id));
  assert.equal(before.question, "这份资料说明了什么？");
  assert.deepEqual(await test.cli("wiki-card", {id:card.id}), {
    id: card.id, revision: before.revision, question: before.question,
  });

  const archived = await test.core(`
    const {writeFileSync} = await import('node:fs');
    const {resolve,dirname,join} = await import('node:path');
    const {hash,canonical} = await import('./lib/siyuan.mjs');
    const base = resolve(dirname(api.c.dataDir), 'wiki', hash(canonical(await api.identity())));
    const record = {id:'prop_'+ 'a'.repeat(32),kind:'proposal',state:'archived',items:[],createdAt:'2026-11-01',updatedAt:'2026-11-01'};
    const proposal = {...record,revision:hash(canonical(record))};
    const event = {id:'evt_'+'b'.repeat(32),kind:'item-applied',createdAt:'2026-11-01'};
    writeFileSync(join(base,'proposals',proposal.id+'.json'), JSON.stringify(proposal), {flag:'wx'});
    writeFileSync(join(base,'events',event.id+'.json'), JSON.stringify({record:event,recordHash:hash(canonical(event))}), {flag:'wx'});
    console.log(JSON.stringify({proposal,event}));
  `);
  const readHistory = async () => {
    assert.deepEqual(await test.call("wiki-proposal", {id:archived.proposal.id}), archived.proposal);
    assert.ok((await test.call("wiki-proposals", {})).items.some(p => p.id === archived.proposal.id));
    assert.deepEqual((await test.cli("wiki-events", {})).items, [archived.event]);
  };
  await readHistory();
  const save = {op_id:"web-write-denied", id:card.id, expected_revision:before.revision, title:before.title, markdown:"替换正文。"};
  for (const headers of [{origin:test.url}, {authorization:"Bearer " + test.token}]) {
    const post = (command, body) => fetch(test.url + "/api/v1/commands/" + command, {
      method:"POST", headers:{"content-type":"application/json",...headers}, body:JSON.stringify(body),
    });
    for (const [command, body] of [["save-document",save],["operation-status",{op_id:save.op_id}],
      ["wiki-draft",{sourceId:source.id,cardId:card.id}],["source-import",{...input,op_id:"disallowed-import"}]]) {
      assert.equal((await post(command, body)).status, 404, command);
    }
  }
  const receipt = await test.core("console.log(JSON.stringify((await api.receipt(input.op_id)).value ?? null));", {op_id:save.op_id});
  assert.equal(receipt, null);
  await test.restart();
  assert.deepEqual(await test.cli("source-get", {id:source.id}), source);
  const restarted = await test.call("get-document", {id:card.id});
  assert.equal(restarted.revision, before.revision);
  assert.ok(restarted.markdown.includes(personalText));
  await readHistory();
  test.record("wiki-read-only-history", {sourceId:source.id, cardId:card.id, historicalProposal:archived.proposal.id,
    sourceByteExact:true, personalTextPreserved:true, refusedWriteCreatedNoReceipt:true});
}
