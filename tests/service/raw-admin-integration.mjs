// Dedicated real-kernel checks for administrator-only raw writes and native recovery.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { runtime } from "./runtime.mjs";
import { createLegacyCard, seedLegacyAppend } from "./legacy-fixture.mjs";
import { hash, normalize } from "../../lib/siyuan.mjs";
import { planRawSync,applyRawSync,settleRawSync,recoverRawOperation } from "../../scripts/raw-sync.mjs";

export async function verifyRawAdmin(instance) {
  const identity=await instance.core("console.log(JSON.stringify(await api.identity()));");
  const rpc=(method,input)=>instance.core("const {rawWrite}=await import('./lib/raw-write.mjs');console.log(JSON.stringify(await rawWrite(api,input.method,input.arg)));",
    {method,arg:{...input,identity}});
  const doc=await createLegacyCard(instance,{legacyId:"synthetic-raw-legacy",title:"原稿恢复合成卡",description:"存档前的理解",tags:["合成"]});
  const before=await instance.call("get-document",{id:doc.id});
  assert.equal(before.legacyFixedFields,true);
  const args={kind:"card",id:doc.id,title:"改写后的卡",markdown:"## 核心理解\n\n可恢复的一次修改。",
    op_id:"raw-test-convert",legacy:true,expected_revision:before.revision};
  const converted=await rpc("raw-document",args);
  assert.equal(converted.id,doc.id);
  const outcome=await rpc("raw-outcome",{method:"raw-document",request:{...args,identity}});
  assert.equal(outcome.state,"applied");assert.equal(outcome.result.revision,converted.revision);
  const unstarted=await rpc("raw-outcome",{method:"raw-document",request:{...args,identity,op_id:"never-issued"}});
  assert.equal(unstarted.state,"unstarted");
  assert.equal((await instance.call("get-document",{id:doc.id})).editable,false);
  await assert.rejects(rpc("raw-recover",{op_id:"reject-raw-restore",backup_op_id:args.op_id,expected_revision:before.revision}),/写后版本|content_conflict/);
  await rpc("raw-recover",{op_id:"raw-test-restore",backup_op_id:args.op_id,expected_revision:converted.revision});
  const restored=await instance.call("get-document",{id:doc.id});
  assert.equal(restored.legacyFixedFields,true);
  assert.equal(restored.title,before.title); assert.equal(restored.markdown,before.markdown);
  const readingId=await instance.core("const {id}=await import('./lib/siyuan.mjs');console.log(JSON.stringify(id()));");
  const readingArgs={kind:"reading",id:readingId,parent:doc.id,title:"原稿恢复合成阅读",markdown:"一段测试原文。",
    op_id:"raw-test-reading",expected_revision:null};
  const reading=await rpc("raw-document",readingArgs);
  assert.deepEqual(await rpc("raw-document",readingArgs),reading);
  assert.deepEqual((await rpc("raw-probe",{items:[{kind:"reading",id:readingId,parent:doc.id}]}))[0],reading);
  const card=await instance.call("get-document",{id:doc.id});
  assert.deepEqual(card.readings.map(x=>x.id),[readingId]);
  assert.deepEqual((await instance.call("list",{query:"原稿恢复合成阅读"})).items.map(c=>c.id),[doc.id]);
  instance.record("raw-legacy-and-reading",{sameDocument:true,nativeFieldsRestored:true,recoveryConflict:true,
    separateReading:true,retryDeduplicated:true,settlementReceiptVerified:true,unstartedReceiptDetected:true});
  await verifyInterruptedDocumentWrites(instance, rpc, identity, true);
  await verifyInterruptedDocumentWrites(instance, rpc, identity, false);
  await verifyUnwrittenRetry(instance,rpc);
  await verifyInterruptedRecovery(instance,rpc,identity);
  await verifyArchiveRecovery(instance,rpc,identity);
  await verifyLegacyBlockRecoveries(instance,rpc,identity);
}

async function verifyInterruptedDocumentWrites(instance, rpc, identity, legacy) {
  const kind = legacy ? "conversion" : "save";
  const scenarios = legacy ? ["edited", "unchanged", "unsigned"] : ["edited", "unchanged", "native"];
  for (const scenario of scenarios) {
    const op_id = `raw-${kind}-lost-flush-${scenario}`;
    const fixture = {title: "写入前的标题 " + op_id, markdown: "写入前的正文。"};
    const {id} = legacy
      ? await createLegacyCard(instance, {legacyId: op_id, title: fixture.title, description: fixture.markdown})
      : await instance.createDocument(fixture);
    if (!legacy) {
      await instance.kernel("/api/attr/setBlockAttrs", {id, attrs: {"custom-cd-meta": JSON.stringify({version: 1})}});
      await instance.kernel("/api/sqlite/flushTransaction");
    }
    const get = () => instance.call("get-document", {id});
    const receiptPath = join(instance.root, "operations", op_id + ".json");
    const readReceipt = () => JSON.parse(readFileSync(receiptPath, "utf8"));
    const before = await get();
    const request = {identity, kind: "card", id, op_id, ...(legacy && {legacy: true}), expected_revision: before.revision,
      title: "写入后的标题 " + op_id, markdown: "写入后可见的正文。"};
    assert.equal(Boolean(before.legacyFixedFields), legacy);
    const failure = await instance.core(`
      const {rawWrite} = await import('./lib/raw-write.mjs');
      const send = api.api.bind(api);
      const finalWrite = input.legacy ? "/api/attr/setBlockAttrs" : "/api/filetree/renameDocByID";
      let written = false, lostFlushes = 0;
      api.api = async (path, body, ...rest) => {
        const value = await send(path, body, ...rest);
        if (path === finalWrite && body.id === input.id) written = true;
        if (path === "/api/sqlite/flushTransaction" && written && !lostFlushes) {
          lostFlushes++;
          throw Object.assign(new Error("injected lost flush response"), {code:"transport_unknown"});
        }
        return value;
      };
      let code;
      try { await rawWrite(api, "raw-document", input); }
      catch (error) { code = error.code; }
      console.log(JSON.stringify({code, lostFlushes}));
    `, request);
    assert.equal(failure.lostFlushes, 1);
    assert.ok(["operation_pending", "transport_unknown"].includes(failure.code), failure.code);
    const saved = await get();
    const receipt = readReceipt();
    assert.equal(receipt.command, legacy ? "raw-convert-document" : "save-document");
    assert.equal(receipt.state, "unknown");
    assert.equal(receipt.beforeDocument.revision, before.revision);
    assert.equal(receipt.recoveryRevision, saved.revision);
    assert.notEqual(saved.revision, before.revision);
    assert.equal(saved.title, request.title);
    assert.equal(normalize(saved.markdown), request.markdown);
    assert.ok(saved.blocks.length > 0);
    const status = () => rpc("raw-status", {op_id});
    const outcome = () => rpc("raw-outcome", {method: "raw-document", request});
    const recover = (backup, revision) => rpc("raw-recover", {op_id: "undo-" + backup + "-" + revision.slice(0, 8),
      backup_op_id: backup, expected_revision: revision});

    if (scenario === "unchanged") {
      const confirmed = await status();
      assert.equal(confirmed.state, "verified");
      assert.equal(confirmed.result.revision, saved.revision);
      assert.equal((await outcome()).state, "applied");
      assert.deepEqual(await rpc("raw-document", request), {id, revision: saved.revision});
      assert.deepEqual((await get()).blocks, saved.blocks);
      if (!legacy) {
        await recover(op_id, saved.revision);
        const restored = await get();
        assert.equal(restored.title, before.title);
        assert.deepEqual(restored.blocks, before.blocks);
        const normallySaved = await rpc("raw-document", {...request, op_id: "ordinary-save-confirmed",
          expected_revision: restored.revision});
        await recover("ordinary-save-confirmed", normallySaved.revision);
        const secondRestore = await get();
        assert.equal(secondRestore.title, before.title);
        assert.deepEqual(secondRestore.blocks, before.blocks);
      }
      continue;
    }

    if (scenario === "unsigned" || scenario === "native") {
      const unsigned = scenario === "unsigned";
      if (unsigned) {
        // The 680135a converter stored a recoveryRevision after losing the
        // flush but no native signature. Reproduce that one field difference.
        assert.match(receipt.recoverySignature, /^[a-f0-9]{64}$/);
        delete receipt.recoverySignature;
        writeFileSync(receiptPath, JSON.stringify(receipt));
      }
      const child = saved.blocks[0].id;
      const childAttrs = () => instance.kernel("/api/attr/getBlockAttrs", {id: child});
      const original = await childAttrs();
      assert.equal(original["av-names"], undefined);
      // SiYuan omits this native attribute from the document Kramdown. Preserve
      // its second-resolution update time to exercise the same-revision case.
      await instance.kernel("/api/attr/setBlockAttrs", {id: child, attrs: {"av-names": "独立属性", updated: original.updated}});
      await instance.kernel("/api/sqlite/flushTransaction");
      assert.equal((await childAttrs())["av-names"], "独立属性");
      const changed = await get();
      assert.equal(changed.revision, saved.revision);
      assert.deepEqual(changed.blocks, saved.blocks);
      // Exercise recovery before status or settlement could change the receipt.
      await assert.rejects(recover(op_id, saved.revision), /content_conflict|invalid_backup|operation_pending/);
      assert.equal((await childAttrs())["av-names"], "独立属性");
      const unresolved = await status();
      assert.equal(unresolved.state, "unknown");
      assert.equal(unresolved.recovery_revision, unsigned ? undefined : saved.revision);
      const settlement = await outcome();
      assert.equal(settlement.state, "pending");
      assert.equal(settlement.recoveryRevision, unsigned ? null : saved.revision);
      await assert.rejects(rpc("raw-document", request), /operation_pending/);
      assert.equal((await childAttrs())["av-names"], "独立属性");
      assert.deepEqual((await get()).blocks, saved.blocks);
      assert.deepEqual(readReceipt(), receipt);
      continue;
    }

    const attrs = () => instance.kernel("/api/attr/getBlockAttrs", {id});
    const native = await attrs();
    assert.equal(native["custom-cd-schema"], "2");
    const meta = JSON.parse(native["custom-cd-meta"]);
    assert.equal(meta.version, 1);
    const updatedMeta = JSON.stringify({...meta, version: 2});
    await instance.kernel("/api/attr/setBlockAttrs", {id, attrs: {"custom-cd-meta": updatedMeta}});
    await instance.kernel("/api/sqlite/flushTransaction");
    const edited = await get();
    assert.notEqual(edited.revision, receipt.recoveryRevision);
    assert.equal(edited.title, saved.title);
    assert.equal(edited.markdown, saved.markdown);
    assert.deepEqual(edited.blocks, saved.blocks);
    const pending = await status();
    assert.equal(pending.state, "unknown");
    assert.equal(pending.recovery_revision, receipt.recoveryRevision);
    const settlement = await outcome();
    assert.equal(settlement.state, "pending");
    assert.equal(settlement.recoveryRevision, receipt.recoveryRevision);
    await assert.rejects(rpc("raw-document", request), /operation_pending/);
    for (const revision of [receipt.recoveryRevision, edited.revision]) {
      await assert.rejects(recover(op_id, revision), /content_conflict/);
    }
    assert.equal((await attrs())["custom-cd-meta"], updatedMeta);
    const after = await get();
    assert.equal(after.revision, edited.revision);
    assert.deepEqual(after.blocks, edited.blocks);
    assert.deepEqual(readReceipt(), receipt);
  }
  instance.record("raw-interrupted-" + kind, {independentMetadataPreserved: true, staleRecoveryRejected: true,
    independentRevisionRejected: true, unchangedWriteConfirmed: true, ...(legacy
      ? {unsignedChildAttributeRestoreRejected: true} : {changedNativeChildPreserved: true, confirmedSaveRestored: true, ordinarySaveRestored: true})});
}

async function verifyInterruptedRecovery(instance,rpc,identity) {
  const rawRoot=join(instance.dir,"interrupted-recovery-raw");
  const stateDir=join(instance.dir,"interrupted-recovery-state");
  const put=(key,title,body)=>{
    const dir=join(rawRoot,"方法",key);
    mkdirSync(dir,{recursive:true});
    writeFileSync(join(dir,"article.md"),`---\nname: ${title}\n---\n\n## 核心理解\n\n${body}\n`);
  };
  const context=async()=>({rawRoot,stateDir,rpc,inventory:await instance.core(
    "const {rawInventory}=await import('./lib/raw-inventory.mjs');console.log(JSON.stringify(await rawInventory(api,{withBlocks:false})));")});
  const status=op_id=>rpc("raw-status",{op_id});
  const recover=(backupOp,revision,transport=rpc)=>recoverRawOperation({stateDir,identity,backupOp,revision,rpc:transport});
  const get=id=>instance.call("get-document",{id});
  const fault=async (method,arg)=>{
    const result=await instance.core(`
      const {rawWrite}=await import('./lib/raw-write.mjs');
      const request=api.api.bind(api);
      api.api=async(path,body,...rest)=>{
        // An acknowledged block update fails to persist. The rename succeeds,
        // leaving a real changed title and body for confirmSave to check.
        if(input.method==="raw-document" && path==="/api/block/updateBlock" && body.data==="漏写的第二段。") return [];
        // Restoring the native body succeeds before the rename loses contact.
        if(input.method==="raw-recover" && path==="/api/filetree/renameDocByID")
          throw Object.assign(new Error("injected interrupted rename"),{code:"transport_unknown"});
        return request(path,body,...rest);
      };
      try {console.log(JSON.stringify({value:await rawWrite(api,input.method,input.arg)}));}
      catch(error){console.log(JSON.stringify({error:{code:error.code,message:error.message}}));}
    `,{method,arg});
    if (result.error) throw Object.assign(new Error(result.error.message),{code:result.error.code});
    return result.value;
  };

  put("first-verified","同批已核对的卡","原先的正文。");
  put("second-partial","恢复前的标题","原先的第一段。\n\n原先的第二段。");
  const initial=planRawSync(await context());
  await applyRawSync({plan:initial,stateDir,rpc});
  put("first-verified","同批已核对的卡","已经完成的修改。");
  put("second-partial","部分写入的标题","已经改写的第一段。\n\n漏写的第二段。");
  const batch=planRawSync(await context());
  assert.deepEqual(batch.actions.map(a=>a.key),["first-verified","second-partial"]);
  const [done,interrupted]=batch.actions.map(a=>a.input);
  const before=await get(interrupted.id);
  const interruptSave=(method,arg)=>arg.op_id===interrupted.op_id ? fault(method,arg) : rpc(method,arg);
  await assert.rejects(applyRawSync({plan:batch,stateDir,rpc:interruptSave}),{code:"operation_pending"});
  const saved=await get(interrupted.id);
  assert.equal(saved.title,interrupted.title);
  assert.match(saved.markdown,/已经改写的第一段。/);
  assert.match(saved.markdown,/原先的第二段。/);
  const pending=await settleRawSync(await context());
  assert.equal(pending.pending,true);
  assert.equal(pending.partial[0].op_id,interrupted.op_id);
  const originalStatus=await status(interrupted.op_id);
  assert.equal(originalStatus.state,"unknown");
  assert.equal(originalStatus.recovery_revision,saved.revision);

  const verified=await status(done.op_id);
  assert.equal(verified.state,"verified");
  await assert.rejects(recover(done.op_id,verified.result.revision),/此操作已完成/);
  const unrelated=initial.actions[0].input.op_id;
  await assert.rejects(recover(unrelated,(await status(unrelated)).result.revision),/当前批次的原操作 ID/);
  let recoveryId;
  await assert.rejects(recover(interrupted.op_id,saved.revision,fault),error=>{
    recoveryId=/恢复操作 ID (raw-recover-[a-f0-9]{64})/.exec(error.message)?.[1];
    return error.code==="transport_unknown" && Boolean(recoveryId);
  });
  const recovery=await status(recoveryId);
  const partial=await get(interrupted.id);
  assert.equal(recovery.state,"unknown");
  assert.equal(recovery.recovery_revision,partial.revision);
  assert.notEqual(partial.revision,saved.revision);
  assert.equal(partial.title,saved.title);
  assert.equal(partial.markdown,before.markdown);
  await assert.rejects(recover(recoveryId,partial.revision),/当前批次的原操作 ID/);
  assert.equal((await get(interrupted.id)).revision,partial.revision);
  const restored=await recover(interrupted.op_id,saved.revision);
  assert.equal(restored.op_id,recoveryId);
  assert.equal((await status(recoveryId)).state,"verified");
  const native=await get(interrupted.id);
  assert.equal(native.title,before.title);
  assert.deepEqual(native.blocks,before.blocks);
  const closed=await settleRawSync(await context());
  assert.equal(closed.pending,false);
  assert.deepEqual(closed.applied.map(item=>item.op_id),[done.op_id]);
  assert.deepEqual(closed.unstarted.map(item=>item.op_id),[interrupted.op_id]);
  const next=planRawSync(await context());
  assert.deepEqual(next.conflicts,[]);
  assert.deepEqual(next.actions.map(a=>a.key),["second-partial"]);
  await applyRawSync({plan:next,stateDir,rpc});
  const final=await get(interrupted.id);
  assert.equal(final.title,interrupted.title);
  assert.match(final.markdown,/漏写的第二段。/);
  assert.deepEqual(final.blocks.map(b=>b.id),before.blocks.map(b=>b.id));
  assert.equal((await get(done.id)).revision,verified.result.revision);
  assert.equal(planRawSync(await context()).actions.length,0);
  instance.record("raw-interrupted-recovery",{sameRecoveryId:true,settled:true,protectedOtherReceipts:true,nativeBlockIdsPreserved:true});
}

async function recoverAcrossLostWrites(instance,rpc,identity,backupOp,revision,writePath) {
  const attempts=[];
  const recover=phase=>recoverRawOperation({
    stateDir:join(instance.root,"raw-sync"),identity,backupOp,revision,
    rpc:async(method,arg)=>{
      if (method!=="raw-recover") return rpc(method,arg);
      const report=await instance.core(`
        const {rawWrite}=await import('./lib/raw-write.mjs');
        const request=api.api.bind(api);
        let calls=0,writes=0;
        api.api=async(path,...args)=>{
          if (path!==input.writePath) return request(path,...args);
          calls++;
          if (input.phase==="after") {
            await request(path,...args);
            writes++;
            await api.flush();
          }
          throw Object.assign(new Error("injected "+input.phase+" at "+path),{code:"transport_unknown"});
        };
        let result,error;
        try {result=await rawWrite(api,"raw-recover",input.arg);}
        catch (e) {error={code:e.code,message:e.message};}
        console.log(JSON.stringify({result,error,calls,writes}));
      `,{phase,writePath,arg});
      attempts.push({id:arg.op_id,calls:report.calls,writes:report.writes});
      if (report.error) throw Object.assign(new Error(report.error.message),{code:report.error.code});
      return report.result;
    }
  });
  for (const phase of ["before","after"]) {
    await assert.rejects(recover(phase),error=>{
      assert.ok(error.code==="transport_unknown" || (writePath==="/api/attr/setBlockAttrs" && error.code==="operation_pending"),error.message);
      assert.ok(error.message.includes(attempts.at(-1).id),error.message);
      return true;
    });
    if (phase==="before") {
      const ordinary=await instance.admin("recover",{op_id:attempts[0].id,backup_op_id:backupOp,
        expected_revision:revision,expected_hash:revision},false);
      assert.equal(ordinary.code,"operation_pending");
    }
  }
  // Querying operation status can itself confirm the receipt. Retry directly
  // so this third invocation must reconcile the native result on its own.
  const result=await recover("confirm");
  const id=result.op_id;
  assert.match(id,/^raw-recover-[a-f0-9]{64}$/);
  assert.deepEqual(attempts,[{id,calls:1,writes:0},{id,calls:1,writes:1},{id,calls:0,writes:0}]);
  assert.equal((await rpc("raw-status",{op_id:id})).state,"verified");
  return result;
}

async function verifyLegacyBlockRecoveries(instance,rpc,identity) {
  const original="追加和块修改前的正文。";
  const card=await instance.createDocument({title:"旧回执恢复合成卡", markdown:original});
  const children=async()=>(await instance.kernel("/api/block/getChildBlocks",{id:card.id})).map(row=>row.id);
  const originalIds=await children();
  const before=await instance.call("get",{id:card.id});
  const oldAppend = {op_id:"legacy-recovery-append", id:card.id, expected_hash:before.hash,
    field:"note", markdown:"只在恢复前存在的追加段落。"};
  await seedLegacyAppend(instance, identity, oldAppend, oldAppend.markdown);
  const status = await rpc("raw-status", {op_id:oldAppend.op_id});
  assert.equal(status.state, "verified");
  const appended = status.result;
  assert.equal(appended.id, card.id);
  assert.equal(appended.hash, (await instance.call("get", {id:card.id})).hash);
  assert.ok((await children()).length>originalIds.length);
  const undoneAppend=await recoverAcrossLostWrites(instance,rpc,identity,appended.op_id,appended.hash,"/api/block/deleteBlock");
  assert.equal(undoneAppend.id,card.id);
  assert.deepEqual(await children(),originalIds);
  const restoredCard=await instance.call("get",{id:card.id});
  assert.equal(restoredCard.hash,undoneAppend.hash);
  assert.equal(restoredCard.markdown,before.markdown);

  const block=restoredCard.sections.find(section=>normalize(section.markdown)===original);
  assert.ok(block);
  const changed=await instance.admin("update-block",{op_id:"legacy-recovery-block",id:block.id,expected_hash:block.hash,markdown:"块已经修改。"});
  assert.equal(normalize(changed.markdown),"块已经修改。");
  const undoneBlock=await recoverAcrossLostWrites(instance,rpc,identity,changed.op_id,changed.hash,"/api/block/updateBlock");
  assert.equal(undoneBlock.id,block.id);
  const {kramdown}=await instance.kernel("/api/block/getBlockKramdown",{id:block.id});
  assert.equal(normalize(kramdown),original);
  assert.equal(hash(kramdown),undoneBlock.hash);
  assert.deepEqual(await children(),originalIds);
  instance.record("raw-legacy-block-recoveries",{appendRecovery:undoneAppend.op_id,blockRecovery:undoneBlock.op_id,
    nativeWritesPerRecovery:1,originalBlockIds:originalIds});
}

async function verifyArchiveRecovery(instance,rpc,identity) {
  const rawRoot=join(instance.dir,"archive-restore-input");
  const card=join(rawRoot,"方法","archived-card");
  mkdirSync(card,{recursive:true});
  writeFileSync(join(card,"article.md"),"---\nname: 归档恢复合成卡\n---\n\n## 核心理解\n\n保存原稿。\n");
  const config=join(instance.root,"compose.env"), original=readFileSync(config);
  const cli=fileURLToPath(new URL("../../scripts/raw.mjs",import.meta.url));
  const run=promisify(execFile);
  const call=async (...args)=>JSON.parse((await run(process.execPath,[cli,...args,"--private-root",instance.root,
    "--raw-root",rawRoot,"--json"],{encoding:"utf8",timeout:120000})).stdout);
  try {
    appendFileSync(config,"\nCOMPOSE_PROJECT_NAME="+instance.name+"\n");
    await call("sync");
    const archived=await call("archive","archived-card");
    assert.equal((await call("status",archived.op_id)).state,"verified");
    const [entry] = await call("archives");
    assert.equal(entry.state,"needs-marker");
    assert.equal(entry.documentId,archived.id);
    assert.equal(entry.revision,archived.revision);
    const archiveEvidence = await rpc("raw-archive-evidence", { id:archived.id, op_id:archived.op_id });
    assert.match(archiveEvidence.signature, /^[0-9a-f]{64}$/);
    await assert.rejects(rpc("raw-recover", { op_id:"wrong-archive-signature", backup_op_id:archived.op_id,
      expected_revision:archived.revision, expected_signature:"0".repeat(64) }), /归档|恢复|content_conflict/);
    await assert.rejects(call("recover",archived.op_id,"--revision","0".repeat(64)));
    assert.equal((await instance.call("list",{query:"归档恢复合成卡"})).total,0);
    const restored=await recoverAcrossLostWrites(instance,rpc,identity,archived.op_id,archived.revision,"/api/attr/setBlockAttrs");
    assert.equal(restored.deleted,false); assert.equal(restored.id,archived.id);
    assert.deepEqual(await call("recover",archived.op_id,"--revision",archived.revision),restored);
    assert.equal((await instance.call("get-document",{id:restored.id})).title,"归档恢复合成卡");
    assert.deepEqual(await call("archives"),[]);
    const plan=await call("sync","--dry-run");
    assert.equal(plan.actions,0); assert.deepEqual(plan.conflicts,[]);
    appendFileSync(join(card,"article.md"),"\n恢复后继续在原稿中维护。\n");
    assert.equal((await call("sync")).writes,1);
    assert.match((await instance.call("get-document",{id:restored.id})).markdown,/恢复后继续/);
    instance.record("raw-local-archive-recovery",{stableId:true,repeatable:true,rawBindingRestored:true});
  } finally {writeFileSync(config,original);}
}

async function verifyUnwrittenRetry(instance,rpc) {
  const rawRoot=join(instance.dir,"unwritten-raw"), stateDir=join(instance.dir,"unwritten-state");
  const card=join(rawRoot,"方法","safe-retry");
  mkdirSync(card,{recursive:true});
  const put=body=>writeFileSync(join(card,"article.md"),"---\nname: 写前恢复合成卡\n---\n\n## 核心理解\n\n"+body);
  const inventory=()=>instance.core("const {rawInventory}=await import('./lib/raw-inventory.mjs');console.log(JSON.stringify(await rawInventory(api,{withBlocks:false})));");
  const context=async()=>({rawRoot,stateDir,rpc,inventory:await inventory()});
  put("第一次保存。");
  await applyRawSync({plan:planRawSync(await context()),stateDir,rpc});
  put("第二次保存。");
  const before=planRawSync(await context());
  const [action]=before.actions;
  assert.equal(before.actions.length,1);assert.ok(action.input.expected_revision);
  // The first getChildBlocks is reached from Documents.snapshot, after
  // Siyuan.operate has persisted its receipt. No native block has been written.
  const failSnapshot=(method,input)=>method!=="raw-document" ? rpc(method,input) : instance.core(`
    const {rawWrite}=await import('./lib/raw-write.mjs');
    const request=api.api.bind(api);
    api.api=async (path,...args)=>{
      if(path==='/api/block/getChildBlocks') throw Object.assign(new Error('injected snapshot 503'),{code:'http_503'});
      return request(path,...args);
    };
    console.log(JSON.stringify(await rawWrite(api,'raw-document',input)));
  `,input);
  await assert.rejects(applyRawSync({plan:before,stateDir,rpc:failSnapshot}),/injected snapshot 503/);
  const receipt=()=>instance.core("console.log(JSON.stringify((await api.receipt(input.op_id)).value));",{op_id:action.input.op_id});
  const failed=await receipt();
  assert.equal(failed.state,"failed");assert.equal(failed.error.code,"http_503");assert.equal(failed.documentId,undefined);
  const closed=await settleRawSync(await context());
  assert.equal(closed.pending,false);assert.equal(closed.unstarted[0].op_id,action.input.op_id);
  const retry=planRawSync(await context());
  assert.equal(retry.actions[0].input.op_id,action.input.op_id);
  await assert.rejects(rpc("raw-document",{...action.input,title:"不属于该回执的请求"}),/another request|operation_conflict/);
  await applyRawSync({plan:retry,stateDir,rpc});
  const saved=await receipt();
  assert.equal(saved.state,"verified");assert.equal(saved.retryHistory.length,1);
  assert.equal(saved.retryHistory[0].error.code,"http_503");assert.equal(saved.retryHistory[0].writeStarted,false);
  assert.equal(saved.completed,1);
  assert.equal((await instance.call("get-document",{id:action.input.id})).markdown.includes("第二次保存"),true);
  assert.equal(planRawSync(await context()).actions.length,0);
  instance.record("raw-retry-before-write",{failedBeforeSnapshot:true,settled:true,sameOperation:true,
    mismatchedRequestRejected:true,nativeSteps:saved.completed,priorFailureRetained:true,nextWrites:0});
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const instance = await runtime("raw-admin",{build:false});
  let passed=false;
  try {await verifyRawAdmin(instance);passed=true;}
  finally {await instance.finish(passed);}
}
