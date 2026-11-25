import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, hash } from "../../lib/siyuan.mjs";
import { assertOwnedRun } from "../../scripts/test-runtime.mjs";

/** Injects a synthetic Chinese fixed-field card into this run's isolated kernel. */
export async function createLegacyCard(test, input) {
  assertOwnedRun(test.evidence);
  return test.core(`
    const {id}=await import('./lib/siyuan.mjs');
    const nl=String.fromCharCode(10);
    const fields=[
      ['name','名称',input.title],
      ['description','理解',input.description],
      ['source_text','来源',input.source??'https://example.org/legacy'],
      ['tags','标签',(input.tags??[]).map(value=>'- '+value).join(nl)],
    ].filter(([, ,value])=>value);
    const markdown=fields.map(([key,label,value])=>['## 中文 · '+label,'','{{{row','',value,'','}}}','{: custom-cd-field="'+key+'"}'].join(nl)).join(nl+nl);
    const doc=id();
    await api.newDoc(doc,input.title,markdown,api.c.libraryRootId);
    await api.setAttrs(doc,{'custom-cd-kind':'concept','custom-cd-schema':'1','custom-cd-legacy-id':input.legacyId,'custom-cd-meta':JSON.stringify({id:input.legacyId,lifecycle_status:'active',version:1})});
    let readingId;
    if(input.reading){
      readingId=id();
      await api.newDoc(readingId,input.reading.title,input.reading.markdown,doc);
      await api.setAttrs(readingId,{'custom-cd-kind':'article','custom-cd-parent':doc,'custom-cd-reading':'1'});
    }
    await api.flush();
    console.log(JSON.stringify({id:doc,readingId}));
  `, input);
}

// Frozen pre-raw receipt format. Never dispatch the retired producers to seed a test.
export function freezeLegacyReceipt(test, target, command, input, fields) {
  assertOwnedRun(test.evidence);
  const requestHash = hash(canonical({command, input, target}));
  const rec = {command, input, target, requestHash, state:"unknown", createdAt:"2026-11-01T08:00:00Z", ...fields};
  writeFileSync(join(test.evidence.configurationRoot, "operations", input.op_id + ".json"), JSON.stringify(rec), {flag:"wx"});
  return rec;
}

export async function seedLegacyAppend(test, target, request, nativeContent) {
  assertOwnedRun(test.evidence);
  const {kramdown:beforeCard} = await test.kernel("/api/block/getBlockKramdown", {id:request.id});
  freezeLegacyReceipt(test, target, "append", request, {documentId:request.id, intended:request.markdown, beforeCard});
  const data = '{{{row\n\n' + nativeContent + '\n\n}}}\n{: custom-cd-operation="' + request.op_id + '"}';
  await test.kernel("/api/block/appendBlock", {parentID:request.id, dataType:"markdown", data});
  await test.kernel("/api/sqlite/flushTransaction");
}
