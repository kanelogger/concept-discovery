import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync,mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createDatabaseCardWorker } from '../../scripts/card-database-worker.mjs';
import { openCardExportQueue } from '../../scripts/card-export-queue.mjs';
import { openCardLifecycleTasks } from '../../scripts/card-lifecycle-tasks.mjs';
import { openCardLifecycleGit } from '../../scripts/card-lifecycle-git.mjs';
import { runCardExportBatch } from '../../scripts/card-export-batch.mjs';
import { createDatabaseCardExport } from '../../scripts/card-database-export.mjs';
import { createDatabasePurgeExport,verifyDatabasePurgeVisibility } from '../../scripts/card-database-purge.mjs';
import { createDatabaseWorkflow } from '../../scripts/card-database-workflow.mjs';
import { createCardLifecyclePurge } from '../../scripts/card-lifecycle-purge.mjs';
import { openGitDeletionLedger } from '../../scripts/git-deletion-ledger.mjs';
import { removeCardOriginal } from '../../scripts/remove-card-original.mjs';
import { loadRawTree } from '../../lib/raw-format.mjs';
import { hash } from '../../lib/siyuan.mjs';
import { authHTTPSFixture,agentToken,owner } from './auth-https-fixture.mjs';
import { cardShareStore } from '../../server/card-share-store.mjs';

const library='synthetic-library', signature='b'.repeat(64), time=Date.parse('2026-11-25T00:00:00+08:00');
const body='## 核心理解\n\n合成卡文本。';

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'cd-database-worker-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const file=join(root,'tasks.sqlite');
  let clock=time;
  const tasks=openCardLifecycleTasks(file,{databaseFirst:true,now:()=>clock});
  const queue=openCardExportQueue(join(root,'exports.sqlite'),{now:()=>clock});
  t.after(()=>{tasks.close();queue.close();});
  const cards=new Map(), archived=new Set(), shares=new Set();
  let revision=0;
  const next=()=>String(++revision).padStart(64,'a');
  async function rpc(method,input) {
    if (method==='raw-target') return library;
    assert.equal(input.identity,library);
    if (method==='raw-database-card') return {...cards.get(input.id)};
    if (method==='raw-purge-documents-present') return input.documents.some(id=>cards.has(id));
    if (method==='raw-inspect-purge') return {
      native:{documents:[{id:input.id}],archiveOp:input.archiveOp,expectedRevision:input.expectedRevision},
      copies:{ids:[input.id],assets:[],receipts:[]},
    };
    if (method==='raw-remove-purge') { cards.delete(input.native.documents[0].id); return {}; }
    if (method==='raw-verify-purge') return !cards.has(input.native.documents[0].id);
    if (method==='raw-active-card-evidence') {
      assert.ok(!archived.has(input.id));
      return {...cards.get(input.id)};
    }
    if (method==='raw-archive-evidence') return {verified:true,...cards.get(input.id)};
    if (method==='raw-document') {
      assert.equal(input.expected_revision,cards.get(input.id)?.revision ?? null);
      const value={id:input.id,title:input.title,markdown:input.markdown,revision:next(),signature,editable:true,archiveOp:null};
      cards.set(input.id,value);
      return value;
    }
    const card=cards.get(input.id);
    assert.equal(input.expected_revision,card.revision);
    card.revision=next();
    if (method==='raw-archive') {
      archived.add(input.id);
      card.archiveOp=input.op_id;
      return {...card,deleted:true};
    }
    assert.equal(method,'raw-recover');
    assert.equal(input.backup_op_id,card.archiveOp);
    archived.delete(input.id);
    card.archiveOp=null;
    return {...card,deleted:false};
  }
  const shareStore={suspendForDeletion(id){shares.add(id);return true;},fencedForDeletion:id=>shares.has(id),
    purge(id){shares.add(id);return {unpublished:true,checkpointed:true};},purged:id=>shares.has(id)};
  const worker=createDatabaseCardWorker({tasks,queue,stateDir:root,library,rpc,shares:shareStore});
  return {worker,tasks,cards,archived,shares,shareStore,root,queue,rpc,advance:()=>{clock+=14400000;}};
}

function rawGitFixture(root) {
  const exec=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const origin=join(root,'remote.git'), writer=join(root,'writer');
  exec(root,'init','--bare',origin);
  exec(root,'init','-b','main',writer);
  exec(writer,'config','user.name','合成出站');
  exec(writer,'config','user.email','synthetic@example.invalid');
  const seed='raw/合成学科/retained/article.md';
  mkdirSync(join(writer,'raw/合成学科/retained'),{recursive:true});
  writeFileSync(join(writer,seed),'---\nname: 保留原稿\n---\n\n## 核心理解\n\n现有内容。\n');
  exec(writer,'add',seed);
  exec(writer,'commit','-m','合成基线');
  exec(writer,'remote','add','origin',origin);
  exec(writer,'push','origin','main');
  return {exec,origin,writer,git:openCardLifecycleGit({cwd:writer,remote:'origin'})};
}

test('站主 HTTPS 写到数据库，旧稿不能覆盖并发修改，待删不阻塞其他卡片',async t=>{
  const {worker,tasks,cards,archived,shares}=fixture(t);
  const app=await authHTTPSFixture({lifecycle:worker});
  t.after(()=>app.close());
  const path='/api/card-lifecycle';
  const post=(pathname,data,headers={})=>app.request(pathname,{method:'POST',data,headers:{Origin:app.url,...headers}});
  const input={action:'create',title:'合成新增',markdown:body};
  assert.equal((await post(path+'/database-preview',input)).status,401);
  assert.equal((await post(path+'/database-preview',input,{Authorization:'Bearer '+agentToken})).status,401);
  const login=await post('/api/session/login',owner);
  const Cookie=login.headers['set-cookie'][0].split(';')[0];
  const headers={Cookie};
  assert.equal((await post(path+'/database-preview',input,{Cookie,Origin:'https://untrusted.invalid'})).status,403);
  async function mutation(request,previewPath='/preview') {
    const preview=await post(path+previewPath,request,headers);
    assert.equal(preview.status,200,preview.text);
    const p=preview.json().data;
    const confirm=await post(path+'/confirm',{id:p.id,password:owner.password},headers);
    assert.equal(confirm.status,200,confirm.text);
    return {preview:p,result:confirm.json().data};
  }
  const created=await mutation(input,'/database-preview');
  assert.equal(created.result.state,'complete');
  const documentId=created.result.progress.documentId;
  assert.match(cards.get(documentId).markdown,/合成卡文本。/);
  assert.equal(tasks.get(created.result.id).plan.markdown,undefined);
  const getDraft=()=>app.request(path+'/draft/'+documentId,{headers});
  const old=(await getDraft()).json().data;
  assert.equal(old.markdown,cards.get(documentId).markdown);
  cards.get(documentId).revision='e'.repeat(64);
  const edit={action:'edit',id:documentId,title:'合成修改',markdown:body+'\n\n新正文。'};
  assert.equal((await post(path+'/database-preview',{...edit,revision:old.revision,signature:old.signature},headers)).status,409);
  const current=(await getDraft()).json().data;
  assert.equal((await mutation({...edit,revision:current.revision,signature:current.signature},'/database-preview')).result.state,'complete');
  const rawId=created.preview.rawId;
  assert.equal((await mutation({action:'archive',id:documentId})).result.state,'complete');
  assert.equal(archived.has(documentId),true);
  assert.equal((await app.request(path+'/archives',{headers})).json().data[0].state,'archived');
  assert.equal((await mutation({action:'restore',id:rawId})).result.state,'complete');
  assert.equal(archived.has(documentId),false);
  const removal=await mutation({action:'purge',id:rawId});
  assert.equal(removal.result.state,'awaiting-export');
  assert.equal(archived.has(documentId),true);
  assert.equal(shares.has(documentId),true);
  assert.equal((await post(path+'/preview',{action:'restore',id:rawId},headers)).status,409);
  assert.equal((await mutation({...input,title:'不相关的合成卡'},'/database-preview')).result.state,'complete');
  const report=(await app.request(path+'/sync-status',{headers})).json().data;
  assert.equal(report.pendingCount,6);
});

test('四小时批次将数据库内容快进到真实 Git，原稿外部改动只阻塞冲突卡',async t=>{
  const f=fixture(t);
  const {exec:gitExec,origin,writer,git}=rawGitFixture(f.root);
  const exportOptions=createDatabaseCardExport({queue:f.queue,git,stateDir:f.root,library,rpc:f.rpc});
  const write=async input=>{
    const preview=await f.worker.databasePreview('owner',input);
    return {preview,task:await f.worker.confirm('owner',preview.id)};
  };
  const a=await write({action:'create',title:'数据库第一张合成卡',markdown:body});
  const path='raw/未分类/'+a.preview.rawId+'/article.md';
  assert.equal(await runCardExportBatch(exportOptions),null);
  assert.throws(()=>gitExec(origin,'show','main:'+path));
  f.advance();
  assert.equal((await runCardExportBatch(exportOptions)).state,'complete');
  assert.match(gitExec(origin,'show','main:'+path),/数据库第一张合成卡/);
  const draft=await f.worker.draft('owner',a.task.progress.documentId);
  await write({...draft,action:'edit',title:'数据库的第二版'});
  // Simulate a verified, independent author change to the already published file.
  gitExec(writer,'pull','--ff-only','origin','main');
  writeFileSync(join(writer,path),gitExec(origin,'show','main:'+path).replace('数据库第一张合成卡','Git 作者的版本')+'\n');
  gitExec(writer,'add','--',path);
  gitExec(writer,'commit','-m','合成并发修改');
  gitExec(writer,'push','origin','main');
  const b=await write({action:'create',title:'同期无冲突的合成卡',markdown:body});
  f.advance();
  assert.equal((await runCardExportBatch(exportOptions)).state,'complete');
  assert.match(gitExec(origin,'show','main:'+path),/Git 作者的版本/);
  assert.match(gitExec(origin,'show','main:raw/未分类/'+b.preview.rawId+'/article.md'),/同期无冲突的合成卡/);
  assert.equal(f.cards.get(a.task.progress.documentId).title,'数据库的第二版');
  assert.deepEqual(f.worker.syncStatus().issues,[{rawId:a.preview.rawId,code:'git_content_conflict',retryable:true}]);
  f.queue.requeueReviewed(library,a.preview.rawId);
  assert.deepEqual(f.worker.syncStatus().issues,[]);
  assert.equal(await runCardExportBatch(exportOptions),null);
  f.advance();
  assert.equal((await runCardExportBatch(exportOptions)).state,'complete');
  assert.match(gitExec(origin,'show','main:'+path),/Git 作者的版本/);
  assert.equal(f.worker.syncStatus().issues[0].retryable,true);
});

test('同卡删除遇到结果未明的前次推送时退出任务队列，前次批次结算后可重新确认',async t=>{
  const {worker,tasks,queue,shares,advance}=fixture(t);
  const preview=await worker.preview(owner,{action:'create',title:'合成待删',markdown:body});
  await worker.confirm(owner,preview.id);
  const parent='1'.repeat(40), candidate='2'.repeat(40);
  advance();
  const batch=queue.claimDue(library,parent);
  queue.recordCandidate(batch.id,candidate);
  queue.beginSend(batch.id,candidate);
  queue.block(batch.id,'git_pending');

  const pending=await worker.preview(owner,{action:'purge',id:preview.rawId});
  const blocked=await worker.confirm(owner,pending.id);
  assert.equal(blocked.state,'needs-review');
  assert.equal(blocked.progress.error,'previous_export_conflict');
  assert.equal(tasks.next(),null);
  assert.equal(queue.pendingPurge(library,preview.rawId),null);
  assert.equal(shares.size,0);

  queue.resume(batch.id);
  queue.complete(batch.id,candidate);
  const retried=await worker.preview(owner,{action:'purge',id:preview.rawId});
  assert.equal((await worker.confirm(owner,retried.id)).state,'awaiting-export');
});

test('已发布批次有一张原稿再被编辑时保留该改动并结算其他卡',async t=>{
  const f=fixture(t), {git,origin,writer,exec}=rawGitFixture(f.root);
  const create=async title=>{
    const preview=await f.worker.preview(owner,{action:'create',title,markdown:body});
    const task=await f.worker.confirm(owner,preview.id);
    return {id:task.id,rawId:preview.rawId,path:'raw/未分类/'+preview.rawId+'/article.md'};
  };
  const conflicted=await create('合成原稿待并发改写');
  const unaffected=await create('合成原稿保持已发布');
  const options=createDatabaseCardExport({queue:f.queue,library,stateDir:f.root,rpc:f.rpc,git:{
    ...git,
    publish(id,parent) {
      const initial=git.publish(id,parent);
      assert.equal(initial.state,'published');
      exec(writer,'pull','--ff-only','origin','main');
      writeFileSync(join(writer,conflicted.path),exec(origin,'show','main:'+conflicted.path).replace(
        '合成原稿待并发改写','保留推送后的并发改写')+'\n');
      exec(writer,'add','--',conflicted.path);
      exec(writer,'commit','-m','合成推送后冲突');
      exec(writer,'push','origin','main');
      return git.status(id,parent);
    },
  }});
  f.advance();
  assert.equal((await runCardExportBatch(options)).state,'complete');
  assert.equal(f.queue.get(conflicted.id).state,'needs-review');
  assert.equal(f.queue.get(unaffected.id).state,'complete');
  assert.match(exec(origin,'show','main:'+conflicted.path),/保留推送后的并发改写/);
  assert.match(exec(origin,'show','main:'+unaffected.path),/合成原稿保持已发布/);
});

test('候选对原稿没有差异也核对主分支的独立修改',async t=>{
  const f=fixture(t),{git,origin,writer,exec}=rawGitFixture(f.root);
  const options=createDatabaseCardExport({queue:f.queue,git,library,stateDir:f.root,rpc:f.rpc});
  const created=await f.worker.preview(owner,{action:'create',title:'字节不变的合成卡',markdown:body});
  const card=await f.worker.confirm(owner,created.id);
  const path='raw/未分类/'+created.rawId+'/article.md';
  f.advance();
  assert.equal((await runCardExportBatch(options)).state,'complete');
  const draft=await f.worker.draft(owner,card.progress.documentId);
  const edit=await f.worker.preview(owner,{...draft,action:'edit'});
  await f.worker.confirm(owner,edit.id);
  const other=await f.worker.preview(owner,{action:'create',title:'同批新增合成卡',markdown:body});
  const otherTask=await f.worker.confirm(owner,other.id);
  f.advance();
  const result=await runCardExportBatch({...options,git:{...git,publish(id,parent) {
    const candidate=git.publish(id,parent);
    assert.equal(candidate.state,'published');
    assert.ok(!git.changedPaths(parent,candidate.commit).includes(path));
    exec(writer,'pull','--ff-only','origin','main');
    const original=exec(origin,'show','main:'+path);
    writeFileSync(join(writer,path),original.replace('合成卡文本','外部独立改动')+'\n');
    exec(writer,'add',path);
    exec(writer,'commit','-m','合成无差异导出并发改动');
    exec(writer,'push','origin','main');
    const observed=git.status(id,parent);
    assert.equal(observed.state,'published');
    return observed;
  }}});
  assert.equal(result.state,'complete');
  assert.equal(f.queue.get(edit.id).state,'needs-review');
  assert.equal(f.queue.get(otherTask.id).state,'complete');
  assert.match(exec(origin,'show','main:'+path),/外部独立改动/);
});

test('逐卡删除记录只能授权批次里的精确候选',async t=>{
  for (const scenario of [
    {name:'尚未推送',published:false},
    {name:'已发布、未签决定',published:true},
    {name:'同批普通编辑被遗漏',published:true,omitEdit:true},
  ]) await t.test(scenario.name,async t=>{
    const {published,omitEdit}=scenario;
    const f=fixture(t),{git,origin,writer,exec}=rawGitFixture(f.root);
    const retained='raw/合成学科/retained/assets/retained.png';
    mkdirSync(join(writer,'raw/合成学科/retained/assets'),{recursive:true});
    writeFileSync(join(writer,retained),Buffer.from([0,255,16]));
    exec(writer,'add',retained);
    exec(writer,'commit','-m','合成保留附件');
    exec(writer,'push','origin','main');
    const anchor=exec(writer,'commit-tree',exec(writer,'mktree'),'-m','合成账本根');
    exec(writer,'push','origin',anchor+':refs/heads/deletion-drill');
    const ledger=openGitDeletionLedger({cwd:writer,remote:'origin',branch:'deletion-drill',anchor,initialHead:anchor,
      journalPath:join(f.root,'ledger-contribution.sqlite')});
    t.after(()=>ledger.close());
    const materialsRoot=join(f.root,'materials');
    mkdirSync(materialsRoot);
    const purge=createCardLifecyclePurge({git,ledger,stateDir:f.root,rpc:f.rpc,shares:f.shareStore,materialsRoot,
      removeUnpublishedCopies:git.clearUnpublishedCardCopies});
    let inject=false, ordinaryPath;
    const deploymentGit={...git,stage(id,parent,makePatch) {
      if (!inject) return git.stage(id,parent,makePatch);
      const candidate=git.stage(id,parent,tree=>{
        const files=makePatch(tree);
        if (omitEdit) assert.ok(files.delete(ordinaryPath));
        else files.set(retained,null);
        return files;
      });
      if (published) assert.equal(git.publish(id,parent).state,'published');
      return candidate;
    }};
    const legacyTasks=openCardLifecycleTasks(join(f.root,'legacy.sqlite'));
    t.after(()=>legacyTasks.close());
    const workflow=createDatabaseWorkflow({manualOriginals:false,tasks:f.tasks,legacyTasks,queue:f.queue,stateDir:f.root,library,rpc:f.rpc,
      shares:f.shareStore,git:deploymentGit,purge});
    const created=await workflow.worker.preview(owner,{action:'create',title:'合成删除目标',markdown:body});
    const card=await workflow.worker.confirm(owner,created.id);
    let ordinary;
    if (omitEdit) {
      const preview=await workflow.worker.preview(owner,{action:'create',title:'同批正常原稿',markdown:body});
      const task=await workflow.worker.confirm(owner,preview.id);
      ordinary={rawId:preview.rawId,...task.progress};
      ordinaryPath='raw/未分类/'+preview.rawId+'/article.md';
    }
    f.advance();
    assert.equal((await workflow.runScheduledExport()).state,'complete');
    const originalHead=git.snapshot();
    if (ordinary) {
      const draft=await workflow.worker.draft(owner,ordinary.documentId);
      const edit=await workflow.worker.preview(owner,{...draft,action:'edit',title:'合成待发布编辑'});
      ordinary.update=await workflow.worker.confirm(owner,edit.id);
    }
    const requested=await workflow.worker.preview(owner,{action:'purge',id:created.rawId});
    await workflow.worker.confirm(owner,requested.id);
    f.advance();
    inject=true;
    const blocked=await workflow.runScheduledExport();
    assert.equal(blocked.state,'blocked');
    assert.equal(blocked.errorCode,'content_conflict');
    assert.equal(git.snapshot(),published ? blocked.candidate : originalHead);
    assert.equal(ledger.snapshot().decisions.size,0);
    assert.ok(f.cards.has(card.progress.documentId));
    const evidence=f.tasks.databasePurgeContribution(requested.id,blocked.id);
    assert.equal(evidence.initial.state,'active');
    assert.equal(evidence.initial.archiveOp,null);
    assert.equal(evidence.initial.revision,card.progress.revision);
    assert.deepEqual(evidence.files.map(({path,after})=>[path,after]),[['raw/未分类/'+created.rawId+'/article.md',null]]);
    assert.match(evidence.files[0].before.sha256,/^[a-f0-9]{64}$/);
    if (ordinary) {
      assert.equal(f.queue.published(library,ordinary.rawId).revision,ordinary.revision);
      assert.equal(f.queue.get(ordinary.update.id).state,'batched');
      assert.match(exec(origin,'show','main:'+ordinaryPath),/同批正常原稿/);
      const db=new DatabaseSync(join(f.root,'exports.sqlite'));
      try {
        db.prepare('UPDATE card_export_batches SET filePlan=NULL,filePlanVersion=0 WHERE id=?').run(blocked.id);
      } finally { db.close(); }
      assert.equal((await workflow.exportOnce()).state,'complete');
      assert.equal(f.queue.get(ordinary.update.id).state,'needs-review');
      assert.equal(f.queue.published(library,ordinary.rawId).revision,ordinary.revision);
      assert.equal(f.cards.has(card.progress.documentId),false);
      assert.equal(ledger.snapshot().decisions.size,1);
    }
    if (!published) {
      const db=new DatabaseSync(join(f.root,'tasks.sqlite'));
      try {
        db.prepare('DELETE FROM lifecycle_database_purge_contributions WHERE id=? AND batchId=?')
          .run(requested.id,blocked.id);
        assert.throws(()=>f.tasks.databasePurgeContribution(requested.id,blocked.id),{code:'operation_conflict'});
        db.prepare('UPDATE lifecycle_database_purges SET contributionVersion=0 WHERE id=? AND batchId=?')
          .run(requested.id,blocked.id);
        const exportDb=new DatabaseSync(join(f.root,'exports.sqlite'));
        try {
          exportDb.prepare('UPDATE card_export_batches SET filePlan=NULL,filePlanVersion=0 WHERE id=?').run(blocked.id);
        } finally { exportDb.close(); }
        assert.equal(f.tasks.databasePurgeContribution(requested.id,blocked.id),null);
        // A legitimate pre-upgrade frozen row still protects the publication path.
        assert.equal((await workflow.exportOnce()).errorCode,'content_conflict');
      } finally { db.close(); }
      exec(writer,'update-ref','-d','refs/concept-lifecycle-candidate/'+blocked.id);
      const missingPin=await workflow.exportOnce();
      assert.equal(missingPin.errorCode,'export_candidate_unavailable');
      assert.equal(git.snapshot(),originalHead);
    }
  });
});

test('同一个批次执行器可提前验收指定新合成卡，常规批次时钟和其他卡片不变',async t=>{
  const f=fixture(t),{git,origin,exec}=rawGitFixture(f.root);
  const options=createDatabaseCardExport({queue:f.queue,git,library,stateDir:f.root,rpc:f.rpc});
  const create=async label=>{
    const draft=await f.worker.preview('owner',{action:'create',title:label,markdown:body});
    return {draft,result:await f.worker.confirm('owner',draft.id)};
  };
  const selected=await create('指定验收合成卡');
  const other=await create('不在本次验收范围的合成卡');
  const before=f.queue.summary(library).nextBatchAt;
  assert.equal(await runCardExportBatch(options),null);
  await assert.rejects(runCardExportBatch(options,{acceptanceRawIds:['retained']}),{code:'outside_scope'});
  const emitted=await runCardExportBatch(options,{acceptanceRawIds:[selected.draft.rawId]});
  assert.equal(emitted.state,'complete');
  assert.deepEqual(emitted.scope,[selected.draft.rawId]);
  assert.match(exec(origin,'show','main:raw/未分类/'+selected.draft.rawId+'/article.md'),/指定验收合成卡/);
  assert.throws(()=>exec(origin,'show','main:raw/未分类/'+other.draft.rawId+'/article.md'));
  assert.equal(f.queue.get(other.result.id).state,'pending');
  assert.equal(f.queue.summary(library).nextBatchAt,before);
});

test('手动验收只接受准确移除选中合成卡的专属封面与目录项',async t=>{
  const f=fixture(t), {git,origin,writer,exec}=rawGitFixture(f.root);
  const card=await f.worker.preview(owner,{action:'create',title:'合成素材卡',markdown:body});
  await f.worker.confirm(owner,card.id);
  const selected=card.rawId, other='retained';
  const folder='server/share-materials';
  const catalog=folder+'/catalog.json';
  const cover=folder+'/covers/'+selected+'.png';
  const retainedCover=folder+'/covers/'+other+'.png';
  const retainedEntry={id:other,summary:'保留合成素材'};
  mkdirSync(join(writer,folder,'covers'),{recursive:true});
  writeFileSync(join(writer,catalog),JSON.stringify({[selected]:{id:selected,summary:'待删专属摘要'},[other]:retainedEntry}));
  writeFileSync(join(writer,cover),'待删合成封面');
  writeFileSync(join(writer,retainedCover),'保留合成封面');
  exec(writer,'add','--',folder);
  exec(writer,'commit','-m','合成分享目录');
  exec(writer,'push','origin','main');

  const requested=await f.worker.preview(owner,{action:'purge',id:selected});
  assert.equal((await f.worker.confirm(owner,requested.id)).state,'awaiting-export');
  const opts={queue:f.queue,git,library,verifyBeforePush:async()=>{},settlePurge:async()=>{}};
  const batch=f.queue.claimAcceptance(library,git.snapshot(),[selected]);
  git.stage(batch.id,batch.parent,()=>new Map([
    [catalog,Buffer.from(JSON.stringify({[other]:{...retainedEntry,summary:'不允许变更'}}))],
    [cover,null],
  ]));
  const result=await runCardExportBatch(opts,{acceptanceRawIds:[selected]});
  assert.equal(result.state,'blocked');
  assert.equal(result.errorCode,'outside_scope');
  assert.match(exec(origin,'show','main:'+catalog),/待删专属摘要/);
  f.queue.supersede(batch.id,git.status(batch.id,batch.parent));
  const valid=await runCardExportBatch({...opts,collect:async()=>new Map([
    [catalog,Buffer.from(JSON.stringify({[other]:retainedEntry}))],[cover,null],
  ])},{acceptanceRawIds:[selected]});
  assert.equal(valid.state,'complete');
  assert.deepEqual(JSON.parse(exec(origin,'show','main:'+catalog)),{[other]:retainedEntry});
  assert.equal(exec(origin,'show','main:'+retainedCover),'保留合成封面');
  assert.throws(()=>exec(origin,'show','main:'+cover));
});

test('删除候选推送后目录有并发修改，可重新预览并保留其他合成卡的内容',async t=>{
  const f=fixture(t),{git,origin,writer,exec}=rawGitFixture(f.root);
  const anchor=exec(writer,'commit-tree',exec(writer,'mktree'),'-m','空合成账本');
  exec(writer,'push','origin',anchor+':refs/heads/deletion-drill');
  const ledger=openGitDeletionLedger({cwd:writer,remote:'origin',branch:'deletion-drill',anchor,initialHead:anchor,
    journalPath:join(f.root,'ledger-review.sqlite')});
  t.after(()=>ledger.close());
  const materialsRoot=join(f.root,'materials');
  mkdirSync(materialsRoot);
  const legacyTasks=openCardLifecycleTasks(join(f.root,'legacy-tasks.sqlite'));
  t.after(()=>legacyTasks.close());
  let simulateConflict=false;
  let moveDuringReadback=false;
  let afterDecision;
  let afterFinalReadback;
  let armLateReintroduction=false;
  let retryClock=0;
  const catalog='server/share-materials/catalog.json';
  const later='保留后来更新的合成摘要';
  const latest='保留最后一次核对期间更新的合成摘要';
  const overwriteRetained=summary=>{
    exec(writer,'pull','--ff-only','origin','main');
    writeFileSync(join(writer,catalog),JSON.stringify({retained:{id:'retained',summary}}));
    exec(writer,'add','--',catalog);
    exec(writer,'commit','-m','推送后更新保留卡的合成分享摘要');
    exec(writer,'push','origin','main');
  };
  const rpc=async(method,input)=>{
    const data=await f.rpc(method,input);
    if (moveDuringReadback && method==='raw-inspect-purge' && input.bindings) {
      moveDuringReadback=false;
      overwriteRetained(latest);
    }
    return data;
  };
  const observedLedger={...ledger,async publish(...args) {
    const result=await ledger.publish(...args);
    if (result.state==='committed' && afterDecision) afterDecision();
    return result;
  }};
  const purge=createCardLifecyclePurge({git,ledger:observedLedger,stateDir:f.root,rpc,shares:f.shareStore,materialsRoot,
    removeUnpublishedCopies(plan,decision) {
      git.clearUnpublishedCardCopies(plan,decision);
      if (armLateReintroduction) {
        armLateReintroduction=false;
        afterFinalReadback=afterDecision;
        afterDecision=null;
      }
    }});
  const deploymentGit={...git,status(id,parent) {
    if (afterFinalReadback) {
      const reintroduce=afterFinalReadback;
      afterFinalReadback=null;
      reintroduce();
    }
    return git.status(id,parent);
  },publish(id,parent) {
    const published=git.publish(id,parent);
    if (!simulateConflict) return published;
    simulateConflict=false;
    assert.equal(published.state,'published');
    overwriteRetained(later);
    return git.status(id,parent);
  }};
  const workflow=createDatabaseWorkflow({manualOriginals:false,tasks:f.tasks,legacyTasks,queue:f.queue,stateDir:f.root,library,rpc,
    shares:f.shareStore,git:deploymentGit,purge,monotonicNow:()=>retryClock});
  const create=await workflow.worker.preview(owner,{action:'create',title:'待重新核对的合成卡',markdown:body});
  const card=await workflow.worker.confirm(owner,create.id);
  f.advance();
  assert.equal((await workflow.runScheduledExport()).state,'complete');
  exec(writer,'pull','--ff-only','origin','main');
  mkdirSync(join(writer,'server/share-materials'),{recursive:true});
  writeFileSync(join(writer,catalog),JSON.stringify({
    [create.rawId]:{id:create.rawId,summary:'待删专属摘要'},retained:{id:'retained',summary:'旧保留摘要'},
  }));
  exec(writer,'add','--',catalog);
  exec(writer,'commit','-m','合成分享摘要');
  exec(writer,'push','origin','main');

  const requested=await workflow.worker.preview(owner,{action:'purge',id:create.rawId});
  await workflow.worker.confirm(owner,requested.id);
  const source='raw/未分类/'+create.rawId+'/article.md';
  const original=exec(origin,'show','main:'+source);
  f.advance();
  simulateConflict=true;
  const blocked=await workflow.runScheduledExport();
  assert.equal(blocked.state,'blocked');
  assert.equal(workflow.worker.syncStatus().issue.canReviewPublished,true);
  assert.equal(ledger.snapshot().decisions.size,0);
  assert.ok(f.cards.has(card.progress.documentId));
  const resumed=await workflow.worker.preview(owner,{action:'resume',id:blocked.id});
  assert.ok(resumed.files.includes(catalog));
  assert.equal((await workflow.worker.confirm(owner,resumed.id)).state,'complete');
  moveDuringReadback=true;
  assert.equal((await workflow.runScheduledExport()).state,'blocked');
  assert.equal(ledger.snapshot().decisions.size,0);
  assert.ok(f.cards.has(card.progress.documentId));
  const reviewedAgain=await workflow.worker.preview(owner,{action:'resume',id:blocked.id});
  assert.equal((await workflow.worker.confirm(owner,reviewedAgain.id)).state,'complete');
  const reintroduceOriginal=()=>{
    exec(writer,'pull','--ff-only','origin','main');
    mkdirSync(join(writer,'raw/未分类',create.rawId),{recursive:true});
    writeFileSync(join(writer,source),original+'\n');
    exec(writer,'add','--',source);
    exec(writer,'commit','-m','合成反例，权威决定提交后原稿重新出现');
    exec(writer,'push','origin','main');
  };
  afterDecision=()=>{
    afterDecision=null;
    reintroduceOriginal();
  };
  const postDecision=await workflow.runScheduledExport();
  assert.equal(postDecision.state,'blocked');
  assert.equal(ledger.snapshot().decisions.get(requested.id).decision.mainCommit,blocked.candidate);
  await assert.rejects(workflow.worker.preview(owner,{action:'compensate',id:requested.id}),{code:'operation_conflict'});
  assert.equal(f.cards.has(card.progress.documentId),false);
  await assert.rejects(workflow.verifyRecovery(),{code:'ledger_pending'});
  assert.notEqual(blocked.candidate,blocked.parent);
  const pin='refs/concept-lifecycle-candidate/'+blocked.id;
  exec(writer,'update-ref','-d',pin);
  assert.equal(git.status(blocked.id,blocked.parent).commit,undefined);
  exec(writer,'revert','--no-edit','HEAD');
  exec(writer,'push','origin','main');
  workflow.resumeBatch(postDecision.id);
  armLateReintroduction=true;
  afterDecision=reintroduceOriginal;
  const lateConflict=await workflow.runScheduledExport();
  assert.equal(lateConflict.state,'blocked');
  assert.equal(f.tasks.get(requested.id).state,'complete');
  assert.equal(workflow.worker.status(owner,requested.id).state,'awaiting-export');
  assert.equal(workflow.worker.confirmation(owner,requested.id).task.state,'awaiting-export');
  assert.equal(f.cards.has(card.progress.documentId),false);
  await assert.rejects(workflow.verifyRecovery(),{code:'content_conflict'});
  exec(writer,'revert','--no-edit','HEAD');
  exec(writer,'push','origin','main');
  assert.equal(workflow.hasExport(),false);
  retryClock+=60_000;
  assert.equal(workflow.hasExport(),true);
  const result=await workflow.runScheduledExport();
  assert.equal(result.state,'complete',result.errorCode);
  assert.equal(workflow.worker.status(owner,requested.id).state,'complete');
  assert.equal(exec(writer,'rev-parse',pin),blocked.candidate);
  assert.equal(ledger.snapshot().decisions.get(requested.id).decision.mainCommit,blocked.candidate);
  assert.equal(f.cards.has(card.progress.documentId),false);
  assert.deepEqual(JSON.parse(exec(origin,'show','main:'+catalog)),{retained:{id:'retained',summary:latest}});
  await workflow.verifyRecovery();
});

test('已发布后只撤销指定待删卡，保留目录并发修改及同批其他卡',async t=>{
  const f=fixture(t),{git,origin,writer,exec}=rawGitFixture(f.root);
  const anchor=exec(writer,'commit-tree',exec(writer,'mktree'),'-m','合成账本');
  exec(writer,'push','origin',anchor+':refs/heads/deletion-drill');
  let available=false;
  let loseCompensationResponse=false;
  let losePreparedPin=false;
  const ledger=openGitDeletionLedger({cwd:writer,remote:'origin',branch:'deletion-drill',anchor,initialHead:anchor,
    journalPath:join(f.root,'ledger-compensate.sqlite'),beforePush:()=>{
      if (!available) throw Object.assign(new Error('合成未发送故障'),{code:'ledger_pending'});
    }});
  const shareDb=new DatabaseSync(':memory:');
  const shares=cardShareStore(shareDb);
  const legacyTasks=openCardLifecycleTasks(join(f.root,'legacy.sqlite'));
  t.after(()=>{ledger.close();shareDb.close();legacyTasks.close();});
  const materialsRoot=join(f.root,'materials');
  mkdirSync(materialsRoot);
  const purge=createCardLifecyclePurge({git,ledger,stateDir:f.root,rpc:f.rpc,shares,materialsRoot,
    removeUnpublishedCopies:git.clearUnpublishedCardCopies});
  const deploymentGit={...git,publish(id,parent) {
    if (losePreparedPin) {
      losePreparedPin=false;
      exec(writer,'update-ref','-d','refs/concept-lifecycle-candidate/'+id);
      throw Object.assign(new Error('合成中断，发送前丢失候选引用'),{code:'lifecycle_transport_closed'});
    }
    const observed=git.publish(id,parent);
    if (loseCompensationResponse && observed.state==='published') {
      loseCompensationResponse=false;
      throw Object.assign(new Error('合成补偿推送结果丢失'),{code:'lifecycle_transport_closed'});
    }
    return observed;
  }};
  const options={manualOriginals:false,tasks:f.tasks,legacyTasks,queue:f.queue,stateDir:f.root,library,rpc:f.rpc,shares,git:deploymentGit,purge};
  const workflow=createDatabaseWorkflow(options);
  const {worker}=workflow;
  const write=async(input,actor=owner)=>{
    const preview=await worker.preview(actor,input);
    return {preview,result:await worker.confirm(actor,preview.id)};
  };
  const target=await write({action:'create',title:'待撤销合成卡',markdown:body});
  const documentId=target.result.progress.documentId;
  const path='raw/未分类/'+target.preview.rawId+'/article.md';
  f.advance();
  assert.equal((await workflow.runScheduledExport()).state,'complete');
  exec(writer,'pull','--ff-only','origin','main');
  const catalog='server/share-materials/catalog.json';
  const retained={id:'retained',summary:'保留初版'};
  const old={id:target.preview.rawId,summary:'待撤销目标封面摘要'};
  mkdirSync(join(writer,'server/share-materials'),{recursive:true});
  writeFileSync(join(writer,catalog),JSON.stringify({retained,[target.preview.rawId]:old}));
  exec(writer,'add',catalog);
  exec(writer,'commit','-m','合成分享目录');
  exec(writer,'push','origin','main');
  const share=shares.create(documentId,0,{body:'旧分享'});
  const targetEdit=await write({...await worker.draft(owner,documentId),action:'edit',title:'待同步的新标题'});
  const requested=await write({action:'purge',id:target.preview.rawId});
  const coldSnapshot={...f.cards.get(documentId)};
  const other=await write({action:'create',title:'同批保留合成卡',markdown:body});
  f.advance();
  const blocked=await workflow.runScheduledExport();
  assert.equal(blocked.errorCode,'ledger_pending');
  f.queue.block(blocked.id,'content_conflict');
  assert.throws(()=>exec(origin,'show','main:'+path));
  exec(writer,'pull','--ff-only','origin','main');
  retained.summary='外部并发更新';
  writeFileSync(join(writer,catalog),JSON.stringify({retained}));
  exec(writer,'add',catalog);
  exec(writer,'commit','-m','外部独立目录更改');
  exec(writer,'push','origin','main');
  const originalPin='refs/concept-lifecycle-candidate/'+blocked.id;
  exec(writer,'update-ref','-d',originalPin);
  const nextOwner='synthetic-new-session';
  const preview=await worker.preview(nextOwner,{action:'compensate',id:requested.preview.id});
  assert.equal(exec(writer,'rev-parse',originalPin),blocked.candidate);
  assert.ok(preview.files.includes(catalog));
  available=true;
  loseCompensationResponse=true;
  losePreparedPin=true;
  const prepared=await worker.confirm(nextOwner,preview.id);
  assert.equal(prepared.state,'running');
  assert.equal(prepared.progress.error,'lifecycle_transport_closed');
  assert.equal(git.status(prepared.progress.attempt.id,prepared.progress.attempt.parent).state,'unstaged');
  const interrupted=await createDatabaseWorkflow(options).worker.runOnce();
  assert.equal(interrupted.state,'running');
  assert.equal(interrupted.progress.error,'lifecycle_transport_closed');
  assert.equal(f.archived.has(documentId),true);
  assert.equal(shares.fencedForDeletion(documentId),true);
  await assert.rejects(workflow.exportOnce(),{code:'operation_pending'});
  const restarted=createDatabaseWorkflow(options);
  // Reattach a pre-fence copy of the share database while keeping the control journal.
  shareDb.prepare('DELETE FROM card_share_pending_deletions WHERE card_id=?').run(documentId);
  shareDb.prepare('UPDATE card_shares SET generation=0 WHERE card_id=?').run(documentId);
  await restarted.reconcileRecovery();
  const result=restarted.worker.status(nextOwner,preview.id);
  assert.equal(result.state,'complete',JSON.stringify(result.progress));
  assert.deepEqual(result.progress.attempt,interrupted.progress.attempt);
  assert.equal(f.archived.has(documentId),false);
  assert.equal(f.cards.get(documentId).title,'待同步的新标题');
  assert.equal(shares.contentFor(share),undefined);
  assert.equal(shares.create(documentId,0,{body:'迟到分享'}),undefined);
  assert.ok(shares.create(documentId,shares.state(documentId).generation,{body:'新分享'}));
  assert.equal(ledger.snapshot().decisions.get(requested.preview.id).decision.outcome,'cancelled');
  assert.deepEqual(JSON.parse(exec(origin,'show','main:'+catalog)),{retained,[target.preview.rawId]:old});
  assert.match(exec(origin,'show','main:'+path),/待撤销合成卡/);
  assert.equal(f.queue.get(targetEdit.preview.id).state,'pending');
  assert.equal(f.queue.get(other.preview.id).state,'batched');
  assert.equal(workflow.hasExport(),true);
  assert.equal((await workflow.runScheduledExport()).state,'complete');
  assert.equal(f.queue.get(other.preview.id).state,'complete');
  assert.equal(f.queue.get(requested.preview.id).state,'cancelled');
  f.archived.add(documentId);
  f.cards.set(documentId,coldSnapshot);
  shares.suspendForDeletion(documentId);
  await assert.rejects(workflow.verifyRecovery(),{code:'operation_pending'});
  await workflow.reconcileRecovery();
  assert.equal(f.archived.has(documentId),false);
  assert.equal(f.queue.get(targetEdit.preview.id).revision,f.cards.get(documentId).revision);
  assert.equal(shares.contentFor(share),undefined);
  f.advance();
  assert.equal((await workflow.runScheduledExport()).state,'complete');
  assert.match(exec(origin,'show','main:'+path),/待同步的新标题/);
  assert.equal((await worker.draft(nextOwner,documentId)).title,'待同步的新标题');
  await workflow.verifyRecovery();
});

test('同一窗口新增后待删不会发布正文，旧冷备重放后仍等账本决定才清理',async t=>{
  const f=fixture(t);
  const {exec:gitExec,origin,writer,git}=rawGitFixture(f.root);
  const anchor=gitExec(writer,'commit-tree',gitExec(writer,'mktree'),'-m','空合成账本');
  gitExec(writer,'push','origin',anchor+':refs/heads/deletion-drill');
  let authorityAvailable=false, removed=false,loseDecisionReply=true;
  const ledger=openGitDeletionLedger({cwd:writer,remote:'origin',branch:'deletion-drill',anchor,initialHead:anchor,
    journalPath:join(f.root,'ledger.sqlite'),beforePush:()=>{
      if (!authorityAvailable) throw Object.assign(new Error('合成账本不可用'),{code:'ledger_pending'});
    }});
  let ledgerClosed=false;
  t.after(()=>{if (!ledgerClosed) ledger.close();});
  const materialsRoot=join(f.root,'materials');
  mkdirSync(materialsRoot);
  const interruptedLedger={...ledger,async publish(...args) {
    const result=await ledger.publish(...args);
    if (result.state==='committed' && loseDecisionReply) {
      loseDecisionReply=false;
      throw Object.assign(new Error('合成故障，签名决定已提交但维护进程未收到结果。'),{code:'lifecycle_transport_closed'});
    }
    return result;
  }};
  const purge=createCardLifecyclePurge({git,ledger:interruptedLedger,stateDir:f.root,rpc:f.rpc,shares:f.shareStore,materialsRoot,
    removeUnpublishedCopies(_plan,decision) {
      assert.equal(ledger.snapshot().decisions.get(decision.opId).decision.mainCommit,decision.mainCommit);
      removed=true;
    }});
  const purgeExport=createDatabasePurgeExport({tasks:f.tasks,git,purge,rpc:f.rpc});
  const exportOptions=createDatabaseCardExport({queue:f.queue,git,stateDir:f.root,library,rpc:f.rpc,...purgeExport});
  const originalMain=git.snapshot();
  const created=await f.worker.preview('owner',{action:'create',title:'永不推送的合成正文',markdown:body});
  const {progress:{documentId}}=await f.worker.confirm('owner',created.id);
  const cold={...f.cards.get(documentId),rawId:created.rawId};
  const preview=await f.worker.preview('owner',{action:'purge',id:created.rawId});
  assert.equal((await f.worker.confirm('owner',preview.id)).state,'awaiting-export');
  f.cards.set(documentId,cold);
  f.shares.clear();
  const replay={tasks:f.tasks,queue:f.queue,stateDir:f.root,library,rpc:f.rpc,shares:f.shareStore};
  await assert.rejects(verifyDatabasePurgeVisibility(replay),{code:'operation_pending'});
  await verifyDatabasePurgeVisibility(replay,{reconcile:true});
  assert.equal(f.archived.has(documentId),true);
  assert.equal(f.shares.has(documentId),true);
  assert.equal(await runCardExportBatch(exportOptions),null);
  f.advance();
  const blocked=await runCardExportBatch(exportOptions);
  assert.equal(blocked.state,'blocked');
  assert.equal(blocked.errorCode,'ledger_pending');
  assert.equal(removed,false);
  assert.equal(f.cards.has(documentId),true);
  assert.equal(git.snapshot(),originalMain);
  await purge.reconcileRecovery(f.tasks,{allowUnsent:true});
  assert.equal(removed,false);
  authorityAvailable=true;
  f.queue.resume(blocked.id);
  const interrupted=await runCardExportBatch(exportOptions);
  assert.equal(interrupted.errorCode,'lifecycle_transport_closed');
  assert.equal(interrupted.candidate,originalMain);
  assert.equal(removed,false);
  assert.equal(ledger.snapshot().decisions.size,1);
  const path='raw/未分类/'+created.rawId+'/article.md';
  mkdirSync(join(writer,'raw/未分类',created.rawId),{recursive:true});
  writeFileSync(join(writer,path),'---\nname: 外部推送的合成正文\n---\n\n'+body+'\n');
  gitExec(writer,'add','--',path);
  gitExec(writer,'commit','-m','合成恢复期间重新引入原稿');
  gitExec(writer,'push','origin','main');
  assert.equal(git.status(blocked.id,blocked.parent).state,'published');
  const pin='refs/concept-lifecycle-candidate/'+blocked.id;
  gitExec(writer,'update-ref','-d',pin);
  assert.equal(git.status(blocked.id,blocked.parent).commit,undefined);
  f.queue.resume(blocked.id);
  assert.equal((await runCardExportBatch(exportOptions)).state,'blocked');
  assert.equal(gitExec(writer,'rev-parse',pin),interrupted.candidate);
  assert.equal(removed,true);
  assert.equal(f.cards.has(documentId),false);
  gitExec(writer,'revert','--no-edit','HEAD');
  gitExec(writer,'push','origin','main');
  f.queue.resume(blocked.id);
  assert.equal((await runCardExportBatch(exportOptions)).state,'complete');
  assert.equal(removed,true);
  assert.equal(f.cards.has(documentId),false);
  assert.throws(()=>gitExec(origin,'show','main:'+path));
  assert.equal(f.tasks.get(preview.id).state,'complete');
  assert.equal(ledger.snapshot().decisions.size,1);
  await purge.verifyRecovery(f.tasks);
  // Inspect one settled purge through the passive gate. A ref advancing after
  // live copies were inspected must keep the gate closed.
  for (const changing of ['ledger','main',null]) {
    const calls=[];
    const observed=async (name,read)=>{
      const second=calls.includes(name);
      calls.push(name);
      const result=await read();
      if (name!==changing || !second) return result;
      return name==='main' ? 'f'.repeat(40) : {...result,head:'f'.repeat(40)};
    };
    const checking=createCardLifecyclePurge({stateDir:f.root,rpc:f.rpc,shares:f.shareStore,materialsRoot,
      ledger:{...ledger,readySnapshot:assert.fail,readReadySnapshot:()=>observed('ledger',ledger.readReadySnapshot),
        recoverySnapshot(){throw new Error('主动重放须由 Git 批准');}},
      git:{...git,snapshot:assert.fail,readSnapshot:()=>observed('main',git.readSnapshot)}});
    if (changing) await assert.rejects(checking.verifyReadiness(f.tasks),{code:'operation_pending'});
    else await checking.verifyReadiness(f.tasks);
    assert.deepEqual(calls,changing==='ledger' ? ['ledger','main','ledger'] : ['ledger','main','ledger','main']);
    await assert.rejects(checking.reconcileRecovery(f.tasks),/主动重放须由 Git 批准/);
  }
  // Replay succeeds through cleanup and completion. Drop the Git transport
  // on the very last sample, after the final online inspection succeeded.
  let completed=false;
  const readback=[];
  const finalReplay=createCardLifecyclePurge({stateDir:f.root,rpc:f.rpc,shares:f.shareStore,materialsRoot,
    removeUnpublishedCopies:(_plan,decision)=>assert.equal(decision.opId,preview.id),
    ledger:{...ledger,readReadySnapshot:assert.fail,complete(id){ledger.complete(id);completed=true;},
      readySnapshot(options) {
        assert.equal(completed,true);
        readback.push('ledger');
        return ledger.readySnapshot(options);
      }},
    git:{...git,readSnapshot:assert.fail,snapshot() {
      if (completed) {
        if (readback.includes('main')) gitExec(writer,'remote','set-url','origin',join(f.root,'offline.git'));
        readback.push('main');
      }
      return git.snapshot();
    }}});
  const restartInput={root:f.root,library,materialsRoot,taskId:preview.id,ledgerHead:ledger.snapshot().head,main:git.snapshot(),
    ledger:{cwd:writer,remote:'origin',branch:'deletion-drill',anchor,journalPath:join(f.root,'ledger.sqlite')}};
  ledger.beginGitReadback();
  await assert.rejects(ledger.finishGitReadback(()=>finalReplay.reconcileRecovery(f.tasks)),/fetch/);
  assert.deepEqual(readback,['ledger','main','ledger','main']);
  ledger.close();
  ledgerClosed=true;
  const restart=new URL('./lifecycle-readback-restart.mjs',import.meta.url);
  const run=mode=>execFileSync(process.execPath,[restart.pathname,mode],{input:JSON.stringify(restartInput),encoding:'utf8'});
  run('offline');
  gitExec(writer,'remote','set-url','origin',origin);
  run('reconnected');
  gitExec(writer,'remote','set-url','origin',join(f.root,'offline.git'));
  run('passive');
});

test('失效的删除预览未建立待删意图，冷备重放不会隐藏后来编辑的卡片',async t=>{
  const f=fixture(t);
  const created=await f.worker.preview('owner',{action:'create',title:'合成初稿',markdown:body});
  const {progress:{documentId}}=await f.worker.confirm('owner',created.id);
  const purge=await f.worker.preview('owner',{action:'purge',id:created.rawId});
  const draft=await f.worker.draft('owner',documentId);
  const edit=await f.worker.preview('owner',{...draft,action:'edit',title:'合成修改'});
  await f.worker.confirm('owner',edit.id);
  const stale=await f.worker.confirm('owner',purge.id);
  assert.equal(stale.state,'needs-review');
  assert.equal(f.queue.pendingPurge(library,created.rawId),null);
  const replay={tasks:f.tasks,queue:f.queue,stateDir:f.root,library,rpc:f.rpc,shares:f.shareStore};
  await verifyDatabasePurgeVisibility(replay);
  await verifyDatabasePurgeVisibility(replay,{reconcile:true});
  assert.equal(f.archived.has(documentId),false);
  assert.equal(f.shares.has(documentId),false);
});

test('同批归档和共享附件迁移顺延后，保留卡原稿基线仍可用于恢复',async t=>{
  const f=fixture(t),{exec,origin,writer,git}=rawGitFixture(f.root);
  const a='20261125010000-shareaa', b='20261125010000-sharebb';
  const aPath='合成学科/keep/article.md',bPath='合成学科/target/article.md';
  const sharedPath='合成学科/target/assets/image.png';
  const bytes=Buffer.from('合成共享字节');
  const moved='raw/合成学科/keep/assets/shared-'+hash(bytes)+'.png';
  const remoteAsset='assets/raw-'+hash(bytes)+'.png';
  mkdirSync(join(writer,'raw/合成学科/keep/assets'),{recursive:true});
  mkdirSync(join(writer,'raw/合成学科/target/assets'),{recursive:true});
  writeFileSync(join(writer,'raw',aPath),'---\nname: 归档后保留的合成卡\n---\n\n## 核心理解\n\n![共用图片](../target/assets/image.png)\n');
  writeFileSync(join(writer,'raw',bPath),'---\nname: 待删合成卡\n---\n\n## 核心理解\n\n![共用图片](assets/image.png)\n');
  writeFileSync(join(writer,'raw',sharedPath),bytes);
  writeFileSync(join(writer,moved),bytes);
  exec(writer,'add','raw');exec(writer,'commit','-m','合成共享附件');exec(writer,'push','origin','main');
  const seed=loadRawTree(join(writer,'raw'));
  const originalRevision='d'.repeat(64);
  for (const [id,title] of [[a,'归档后保留的合成卡'],[b,'待删合成卡']]) f.cards.set(id,{id,title,
    markdown:'## 核心理解\n\n![共用图片]('+remoteAsset+')\n\n## 标签\n\n- 学科：合成学科',revision:originalRevision,signature,archiveOp:null,editable:true});
  const state=join(f.root,hash(library));
  mkdirSync(state);
  writeFileSync(join(state,'state.json'),JSON.stringify({version:1,identity:library,
    cards:{keep:{remoteId:a,path:aPath,revision:originalRevision,rawHash:seed.byId.get('keep').hash},
      target:{remoteId:b,path:bPath,revision:originalRevision,rawHash:seed.byId.get('target').hash}},
    assets:{[sharedPath]:{remotePath:remoteAsset,sha256:hash(bytes)}},readings:{},sources:{},relations:{}}));
  const anchor=exec(writer,'commit-tree',exec(writer,'mktree'),'-m','空合成账本');
  exec(writer,'push','origin',anchor+':refs/heads/deletion-drill');
  const ledger=openGitDeletionLedger({cwd:writer,remote:'origin',branch:'deletion-drill',anchor,initialHead:anchor,
    journalPath:join(f.root,'ledger.sqlite')});
  t.after(()=>ledger.close());
  const materialsRoot=join(f.root,'materials');
  mkdirSync(materialsRoot);
  const purge=createCardLifecyclePurge({git,ledger,stateDir:f.root,rpc:f.rpc,shares:f.shareStore,materialsRoot,
    removeUnpublishedCopies:git.clearUnpublishedCardCopies});
  const options=createDatabaseCardExport({queue:f.queue,git,stateDir:f.root,library,rpc:f.rpc,
    ...createDatabasePurgeExport({tasks:f.tasks,git,purge,rpc:f.rpc})});
  const write=async (action,id)=>{
    const preview=await f.worker.preview('owner',{action,id});
    return f.worker.confirm('owner',preview.id);
  };
  await write('archive',a);
  const deleting=await write('purge','target');
  f.advance();
  assert.equal((await runCardExportBatch(options)).state,'complete');
  assert.equal(f.queue.get(deleting.id).state,'pending');
  assert.deepEqual(f.queue.summary(library).issues,[{rawId:'target',code:'shared_dependency_pending'}]);
  f.advance();
  const sharedConflict=await runCardExportBatch({...options,git:{...git,publish(id,parent) {
    const result=git.publish(id,parent);
    assert.equal(result.state,'published');
    assert.ok(!git.changedPaths(parent,result.commit).includes(moved));
    exec(writer,'pull','--ff-only','origin','main');
    writeFileSync(join(writer,moved),'不同的合成共享字节');
    exec(writer,'add','--',moved);
    exec(writer,'commit','-m','改变候选未触及的共享附件迁入文件');
    exec(writer,'push','origin','main');
    return git.status(id,parent);
  }}});
  assert.equal(sharedConflict.state,'blocked');
  assert.equal(ledger.snapshot().decisions.size,0);
  assert.ok(f.cards.has(b));
  exec(writer,'revert','--no-edit','HEAD');
  exec(writer,'push','origin','main');
  f.queue.resume(sharedConflict.id);
  assert.equal((await runCardExportBatch(options)).state,'complete');
  assert.equal(f.cards.has(b),false);
  assert.match(exec(origin,'show','main:raw/'+aPath),/assets\/shared-/);
  assert.equal(exec(origin,'show','main:'+moved),bytes.toString());
  await write('restore','keep');
  f.advance();
  assert.equal((await runCardExportBatch(options)).state,'complete');
  assert.doesNotMatch(exec(origin,'show','main:raw/'+aPath),/status: archived/);
  assert.match(exec(origin,'show','main:raw/'+aPath),/assets\/shared-/);
});

test('站主在 main 手删原稿，未发布卡不生成命令，单卡核对不妨碍同批普通卡',async t=>{
  const f=fixture(t),{git,origin,writer,exec}=rawGitFixture(f.root);
  const legacyTasks=openCardLifecycleTasks(join(f.root,'legacy.sqlite'));
  const shareDb=new DatabaseSync(join(f.root,'manual-shares.sqlite'));
  const shares=cardShareStore(shareDb);
  const anchor=exec(writer,'commit-tree',exec(writer,'mktree'),'-m','合成账本基线');
  exec(writer,'push','origin',anchor+':refs/heads/deletion-drill');
  const ledger=openGitDeletionLedger({cwd:writer,remote:'origin',branch:'deletion-drill',anchor,initialHead:anchor,
    journalPath:join(f.root,'manual-ledger.sqlite')});
  t.after(()=>{legacyTasks.close();shareDb.close();ledger.close();});
  const materialsRoot=join(f.root,'manual-materials');
  mkdirSync(materialsRoot);
  let offline=false, interrupt=false, interruptCancellation;
  const rpc=async(method,input)=>{
    if (interrupt && method==='raw-remove-purge') {
      interrupt=false;
      throw Object.assign(new Error('合成签决后中断'),{code:'operation_pending'});
    }
    const rawId=input?.legacyId ?? f.cards.get(input?.id)?.rawId;
    const result=await f.rpc(method,input);
    if (method==='raw-document') f.cards.get(input.id).rawId=rawId;
    return result;
  };
  const guardedGit={...git,snapshot() {
    if (interruptCancellation && f.tasks.get(interruptCancellation)?.progress.phase==='git') {
      interruptCancellation=null;
      throw Object.assign(new Error('合成撤销阶段中断'),{code:'content_conflict'});
    }
    return git.snapshot();
  },readSnapshot() {
    if (offline) throw new Error('合成读回超时');
    return git.readSnapshot();
  }};
  const purge=createCardLifecyclePurge({git:guardedGit,ledger,stateDir:f.root,rpc,shares,materialsRoot,
    removeUnpublishedCopies:git.clearUnpublishedCardCopies});
  const options={tasks:f.tasks,legacyTasks,queue:f.queue,stateDir:f.root,library,rpc,shares,git:guardedGit,purge};
  const workflow=createDatabaseWorkflow(options);
  const write=async input=>{
    const preview=await workflow.worker.preview(owner,input);
    const task=await workflow.worker.confirm(owner,preview.id);
    return {...preview,state:task.state,documentId:task.progress.documentId};
  };
  const create=title=>write({action:'create',title,markdown:body});
  const first=await create('手删的合成原稿');
  f.advance();
  assert.equal((await workflow.runScheduledExport()).state,'complete');
  const path='raw/未分类/'+first.rawId+'/article.md';
  const originalText=exec(origin,'show','main:'+path)+'\n';
  const share=shares.create(first.documentId,0,{body:'合成分享'});
  exec(writer,'pull','--ff-only','origin','main');
  const covers='server/share-materials/covers';
  mkdirSync(join(writer,covers),{recursive:true});
  const cover=covers+'/'+first.rawId+'.png';
  writeFileSync(join(writer,cover),'合成图片');
  exec(writer,'add',cover);
  exec(writer,'commit','-m','给合成卡添加分享图');
  exec(writer,'push','origin','main');
  await write({...await workflow.worker.draft(owner,first.documentId),action:'edit',title:'不得发布的旧意图'});
  const pending=await write({action:'purge',id:first.rawId});
  const notices=()=>workflow.worker.syncStatus().manualDeletions;
  assert.equal(pending.state,'awaiting-export');
  assert.equal(shares.contentFor(share),undefined);
  assert.equal(shares.fencedForDeletion(first.documentId),true);
  assert.equal(notices()[0].title,'不得发布的旧意图');
  assert.deepEqual(notices()[0].paths,[path]);
  assert.ok(notices()[0].command);
  const localOnly=await create('永不发布的合成卡');
  const unexported=await write({action:'purge',id:localOnly.rawId});
  assert.equal(notices().some(card=>card.rawId===localOnly.rawId),false);
  const sibling=await create('同批普通卡');
  offline=true;
  await workflow.pollManualOriginals({force:true});
  assert.match(notices().find(card=>card.rawId===first.rawId).reason,/main/);
  assert.equal(notices().find(card=>card.rawId===first.rawId).command,null);
  await workflow.verifyReadiness();
  await workflow.exportOnce({acceptanceRawIds:[first.rawId,sibling.rawId]});
  assert.equal(f.queue.published(library,sibling.rawId).revision,f.cards.get(sibling.documentId).revision);
  assert.doesNotMatch(exec(origin,'show','main:'+path),/不得发布的旧意图/);
  assert.equal(ledger.snapshot().decisions.size,0);
  offline=false;
  await workflow.pollManualOriginals({force:true});
  f.advance();
  await workflow.runScheduledExport();
  assert.equal(ledger.snapshot().decisions.get(unexported.id).decision.rawId,localOnly.rawId);
  assert.equal(f.queue.outstanding(library,[localOnly.rawId]).length,0);
  exec(writer,'pull','--ff-only','origin','main');
  const waitingOrdinary=await create('撤销重启后仍导出的普通卡');
  const undo=await workflow.worker.preview(owner,{action:'compensate',id:pending.id});
  interruptCancellation=undo.id;
  const interruptedUndo=await workflow.worker.confirm(owner,undo.id);
  assert.equal(interruptedUndo.state,'needs-review');
  assert.equal(interruptedUndo.progress.phase,'git');
  exec(writer,'rm','--',path);
  exec(writer,'commit','-m','合成不完整手删，仍有分享图');
  exec(writer,'push','origin','main');
  await workflow.pollManualOriginals({force:true});
  assert.equal(notices()[0].command,null);
  assert.ok(notices()[0].reason);
  const resumed=createDatabaseWorkflow(options);
  assert.equal((await resumed.resumeInterruptedOriginal()).state,'cancelled');
  assert.equal(f.queue.pendingPurge(library,first.rawId).id,pending.id);
  assert.equal(shares.fencedForDeletion(first.documentId),true);
  f.advance();
  assert.equal((await resumed.runScheduledExport()).state,'complete');
  assert.equal(f.queue.outstanding(library,[waitingOrdinary.rawId]).length,0);
  exec(writer,'pull','--ff-only','origin','main');
  await assert.rejects(workflow.worker.preview(owner,{action:'compensate',id:pending.id}),{code:'content_conflict'});
  assert.equal(ledger.snapshot().decisions.has(pending.id),false);
  exec(writer,'rm','--',cover);
  writeFileSync(join(writer,'unrelated.txt'),'同提交的独立修改');
  exec(writer,'add','unrelated.txt');
  exec(writer,'commit','-m','站主补齐合成卡分享素材移除');
  exec(writer,'push','origin','main');
  const human=git.snapshot();
  await workflow.pollManualOriginals({force:true});
  assert.equal(notices().length,0);
  assert.equal(ledger.snapshot().decisions.has(pending.id),false);
  await assert.rejects(workflow.worker.preview(owner,{action:'compensate',id:pending.id}),{code:'content_conflict'});
  interrupt=true;
  assert.equal((await workflow.exportOnce()).state,'blocked');
  assert.equal(ledger.snapshot().decisions.get(pending.id).decision.mainCommit,human);
  assert.equal(f.cards.has(first.documentId),true);
  const restarted=createDatabaseWorkflow(options);
  const finishQueue=f.queue.completeManual;
  f.queue.completeManual=()=>{throw new Error('合成任务清理已完成、落队列前断电');};
  assert.equal((await restarted.exportOnce()).state,'blocked');
  assert.equal(f.tasks.get(pending.id).state,'complete');
  assert.equal(f.queue.get(pending.id).state,'pending');
  assert.equal(f.cards.has(first.documentId),false);
  f.queue.completeManual=finishQueue;
  mkdirSync(join(writer,path,'..'),{recursive:true});
  writeFileSync(join(writer,path),originalText);
  exec(writer,'add',path);
  exec(writer,'commit','-m','停机期间原稿重新出现');
  exec(writer,'push','origin','main');
  const afterCrash=createDatabaseWorkflow(options);
  await afterCrash.exportOnce();
  assert.equal(f.queue.get(pending.id).state,'pending');
  assert.ok(afterCrash.worker.syncStatus().manualDeletions.some(card=>card.rawId===first.rawId && card.reason));
  assert.equal(ledger.snapshot().decisions.get(pending.id).decision.mainCommit,human);
  exec(writer,'rm','--',path);
  exec(writer,'commit','-m','站主再次移除停机期间出现的原稿');
  exec(writer,'push','origin','main');
  const latest=git.snapshot();
  assert.equal((await afterCrash.exportOnce()).state,'complete');
  assert.equal(shares.purged(first.documentId),true);
  assert.equal(f.queue.outstanding(library,[first.rawId]).length,0);
  await restarted.verifyRecovery();
  assert.equal(git.snapshot(),latest);
});

test('限定批次签决后中断，常驻重启在四小时到期前仅继续已开始的手工删除',async t=>{
  const f=fixture(t),{git,writer,exec}=rawGitFixture(f.root);
  const anchor=exec(writer,'commit-tree',exec(writer,'mktree'),'-m','合成账本根');
  exec(writer,'push','origin',anchor+':refs/heads/deletion-drill');
  const materialsRoot=join(f.root,'materials');
  mkdirSync(materialsRoot);
  let interrupt=true;
  const rpc=async(method,input)=>{
    if (interrupt && method==='raw-remove-purge') {
      interrupt=false;
      throw Object.assign(new Error('合成签决后清理中断'),{code:'operation_pending'});
    }
    return f.rpc(method,input);
  };
  function start(initialHead) {
    const tasks=openCardLifecycleTasks(join(f.root,'manual-tasks.sqlite'),{databaseFirst:true,now:()=>time});
    const queue=openCardExportQueue(join(f.root,'manual-queue.sqlite'),{now:()=>time});
    const legacyTasks=openCardLifecycleTasks(join(f.root,'manual-legacy.sqlite'));
    const ledger=openGitDeletionLedger({cwd:writer,remote:'origin',branch:'deletion-drill',anchor,initialHead,
      journalPath:join(f.root,'manual-ledger.sqlite')});
    const purge=createCardLifecyclePurge({git,ledger,stateDir:f.root,rpc,shares:f.shareStore,materialsRoot,
      removeUnpublishedCopies:git.clearUnpublishedCardCopies});
    const workflow=createDatabaseWorkflow({tasks,legacyTasks,queue,stateDir:f.root,library,rpc,shares:f.shareStore,git,purge});
    return {workflow,tasks,queue,ledger,close(){tasks.close();queue.close();legacyTasks.close();ledger.close();}};
  }
  let run=start(anchor);
  t.after(()=>run.close());
  async function confirm(input) {
    const preview=await run.workflow.worker.preview(owner,input);
    const task=await run.workflow.worker.confirm(owner,preview.id);
    return {...preview,documentId:task.progress.documentId};
  }
  const a=await confirm({action:'create',title:'先清理的合成卡',markdown:body});
  const b=await confirm({action:'create',title:'等待到期的合成卡',markdown:body});
  assert.equal((await run.workflow.exportOnce({acceptanceRawIds:[a.rawId,b.rawId]})).state,'complete');
  const purgeA=await confirm({action:'purge',id:a.rawId}),purgeB=await confirm({action:'purge',id:b.rawId});
  exec(writer,'pull','--ff-only','origin','main');
  for (const card of [a,b]) {
    const {paths,command}=run.workflow.worker.syncStatus().manualDeletions.find(item=>item.rawId===card.rawId);
    const digest=command.match(/'([a-f0-9]{64})'$/)[1];
    removeCardOriginal(writer,[card.rawId,card.documentId,paths[0].slice(4),digest]);
  }
  exec(writer,'commit','-m','站主手工移除两张合成卡原稿');
  exec(writer,'push','origin','main');
  const ownerRemoval=git.snapshot();
  await run.workflow.pollManualOriginals({force:true});
  assert.ok(run.queue.manualPurges(library).every(row=>row.verifiedHead===ownerRemoval && row.dueAt>time));
  assert.equal(await run.workflow.runScheduledExport(),null);
  assert.equal((await run.workflow.exportOnce({acceptanceRawIds:[a.rawId]})).state,'blocked');
  const signed=run.ledger.snapshot();
  assert.equal(signed.decisions.size,1);
  assert.equal(signed.decisions.get(purgeA.id).decision.mainCommit,ownerRemoval);
  assert.deepEqual(run.tasks.get(purgeA.id).progress,{stage:'database-purge-cleanup',commit:ownerRemoval,irreversible:true});
  assert.equal(run.queue.manualPurges(library).find(row=>row.id===purgeA.id).verifiedHead,null);
  assert.ok(f.cards.has(a.documentId));
  run.close();

  run=start();
  const frozen=run.tasks.frozenDatabasePurge(purgeA.id,'manual');
  const mismatch=t.mock.method(run.tasks,'frozenDatabasePurge',()=>({...frozen,archiveOp:'other-archive'}));
  assert.equal(run.workflow.hasExport(),false);
  mismatch.mock.restore();
  // Interrupt a second time between the native readback and closing the outbox row.
  run.queue.completeManual=()=>{throw new Error('合成控制库写入中断');};
  assert.equal((await run.workflow.runScheduledExport())?.state,'blocked');
  assert.equal(f.cards.has(a.documentId),false);
  assert.equal(run.tasks.get(purgeA.id).state,'complete');
  assert.equal(run.queue.get(purgeA.id).state,'pending');
  run.close();

  run=start();
  exec(writer,'restore','--source=HEAD^','--staged','--worktree','--','raw/未分类/'+a.rawId+'/article.md');
  exec(writer,'commit','-m','停机期间重新出现原稿');
  exec(writer,'push','origin','main');
  await run.workflow.pollManualOriginals({force:true});
  assert.equal(run.workflow.hasExport(),false);
  assert.equal(await run.workflow.runScheduledExport(),null);
  assert.equal(run.queue.get(purgeA.id).state,'pending');
  exec(writer,'revert','--no-edit','HEAD');
  exec(writer,'push','origin','main');
  await run.workflow.pollManualOriginals({force:true});
  assert.deepEqual(await run.workflow.runScheduledExport(),{id:purgeA.id,state:'complete',commit:ownerRemoval});
  assert.equal(run.queue.get(purgeA.id).cleanupHead,ownerRemoval);
  assert.equal(run.ledger.snapshot().head,signed.head);
  assert.equal(run.tasks.get(purgeB.id).state,'awaiting-export');
  assert.equal(run.queue.get(purgeB.id).state,'pending');
  assert.equal(run.tasks.frozenDatabasePurge(purgeB.id,'manual'),null);
  assert.ok(f.cards.has(b.documentId));
  assert.equal(await run.workflow.runScheduledExport(),null);
});

test('两张待删卡共享同一保留原稿时可撤销并重做第二张，完整保留附件及引用',async t=>{
  const f=fixture(t),{git,origin,writer,exec}=rawGitFixture(f.root);
  const ids={first:'20261125111111-aaaaaaa',second:'20261125111111-bbbbbbb',keep:'20261125111111-ccccccc'};
  const content='## 核心理解\n\n', dir='合成学科/', article=key=>dir+key+'/article.md';
  const asset=key=>dir+key+'/assets/image.png';
  const image=key=>'!['+key+'](../'+key+'/assets/image.png)';
  const revision='d'.repeat(64), assets={},cards={};
  for (const [key,id] of Object.entries(ids)) {
    mkdirSync(join(writer,'raw',dir,key,'assets'),{recursive:true});
    let markdown=content;
    if (key==='keep') {
      markdown+=[image('first'),image('second')].join('\n\n');
    } else {
      markdown+='![图](assets/image.png)';
      writeFileSync(join(writer,'raw',asset(key)),key);
      assets[asset(key)]={remotePath:'assets/'+key+'.png',sha256:hash(Buffer.from(key))};
    }
    writeFileSync(join(writer,'raw',article(key)),'---\nname: '+key+'\n---\n\n'+markdown+'\n');
    f.cards.set(id,{id,title:key,markdown,revision,signature,archiveOp:null,editable:true});
  }
  exec(writer,'add','raw');
  exec(writer,'commit','-m','两个合成附件供同一保留卡片使用');
  exec(writer,'push','origin','main');
  const source=loadRawTree(join(writer,'raw'));
  for (const [key,id] of Object.entries(ids)) cards[key]={remoteId:id,path:article(key),revision,rawHash:source.byId.get(key).hash};
  const state=join(f.root,hash(library));
  mkdirSync(state);
  writeFileSync(join(state,'state.json'),JSON.stringify({version:1,identity:library,cards,assets,readings:{},sources:{},relations:{}}));
  const legacyTasks=openCardLifecycleTasks(join(f.root,'legacy.sqlite'));
  const shareDb=new DatabaseSync(join(f.root,'shares.sqlite')), shares=cardShareStore(shareDb);
  const anchor=exec(writer,'commit-tree',exec(writer,'mktree'),'-m','空合成账本');
  exec(writer,'push','origin',anchor+':refs/heads/deletion-drill');
  const ledger=openGitDeletionLedger({cwd:writer,remote:'origin',branch:'deletion-drill',anchor,initialHead:anchor,
    journalPath:join(f.root,'ledger.sqlite')});
  t.after(()=>{legacyTasks.close();shareDb.close();ledger.close();});
  const materialsRoot=join(f.root,'materials');
  mkdirSync(materialsRoot);
  const purge=createCardLifecyclePurge({git,ledger,stateDir:f.root,rpc:f.rpc,shares,materialsRoot,
    removeUnpublishedCopies:git.clearUnpublishedCardCopies});
  const workflow=createDatabaseWorkflow({tasks:f.tasks,queue:f.queue,legacyTasks,library,stateDir:f.root,shares,rpc:f.rpc,git,purge});
  const write=async(action,id)=>{
    const preview=await workflow.worker.preview(owner,{action,id});
    return workflow.worker.confirm(owner,preview.id);
  };
  const command=key=>workflow.worker.syncStatus().manualDeletions.find(item=>item.rawId===key)?.command;
  const ownerDelete=key=>{
    const digest=command(key).match(/'([a-f0-9]{64})'$/)[1];
    removeCardOriginal(writer,[key,ids[key],article(key),digest]);
    exec(writer,'commit','-m','手工删除合成卡 '+key);
    exec(writer,'push','origin','main');
  };
  const first=await write('purge','first'),second=await write('purge','second');
  assert.ok(command('second'));
  ownerDelete('first');
  const shared='raw/'+dir+'keep/assets/shared-'+hash(Buffer.from('first'))+'.png';
  writeFileSync(join(writer,shared),'合成改动');
  exec(writer,'add',shared);
  exec(writer,'commit','-m','误改迁移共享附件字节');
  exec(writer,'push','origin','main');
  f.advance();
  await workflow.exportOnce();
  assert.equal(ledger.snapshot().decisions.size,0);
  assert.equal(command('first'),null);
  exec(writer,'revert','--no-edit','HEAD');
  const keepPath='raw/'+article('keep');
  writeFileSync(join(writer,keepPath),'---\nname: keep\n---\n\n'+content+image('second')+'\n');
  exec(writer,'add',keepPath);
  exec(writer,'commit','-m','误删保留卡的附件引用');
  exec(writer,'push','origin','main');
  await workflow.exportOnce();
  assert.equal(ledger.snapshot().decisions.size,0);
  exec(writer,'revert','--no-edit','HEAD');
  exec(writer,'push','origin','main');
  await workflow.exportOnce();
  assert.equal(ledger.snapshot().decisions.get(first.id).decision.rawId,'first');
  assert.equal(command('second'),null);
  const head=git.snapshot();
  assert.equal((await write('compensate',second.id)).state,'complete');
  assert.equal(git.snapshot(),head);
  const renewed=await write('purge','second');
  assert.ok(command('second'));
  ownerDelete('second');
  f.advance();
  await workflow.exportOnce();
  assert.equal(ledger.snapshot().decisions.get(renewed.id).decision.rawId,'second');
  assert.equal(f.queue.published(library,'keep').rawHash,loadRawTree(join(writer,'raw')).byId.get('keep').hash);
  for (const key of ['first','second']) assert.match(exec(origin,'show','main:'+keepPath),
    new RegExp('shared-'+hash(Buffer.from(key))+'\\.png'));
});
