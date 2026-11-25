import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openCardLifecycleGit } from '../../scripts/card-lifecycle-git.mjs';
import { openCardLifecycleTasks } from '../../scripts/card-lifecycle-tasks.mjs';
import { createCardLifecycleWorker } from '../../scripts/card-lifecycle-worker.mjs';
import { createCardLifecyclePurge } from '../../scripts/card-lifecycle-purge.mjs';
import { cardShareStore } from '../../server/card-share-store.mjs';
import { openGitDeletionLedger } from '../../scripts/git-deletion-ledger.mjs';
import { applyRawSync, archiveRawCard, selectRawSyncPlan } from '../../scripts/raw-sync.mjs';
import { runtime } from './runtime.mjs';
import { nativeLifecycleRuntime } from './lifecycle-native-runtime.mjs';
import { canonical, hash } from '../../lib/siyuan.mjs';
import { planCardRawChange } from '../../scripts/raw-lifecycle-plan.mjs';

const nativeMode = Boolean(process.env.CONCEPT_SIYUAN_KERNEL);
const startRuntime = nativeMode ? nativeLifecycleRuntime : runtime;
const instance = await startRuntime('card-lifecycle');
let passed = false, recovered, fresh;
try {
  if (!nativeMode) {
    const lockDrill = await instance.core(`
    const {spawn}=await import('node:child_process');
    const {once}=await import('node:events');
    const code="const {requireInstanceFlock}=await import('./lib/instance-flock.mjs');"
      +"requireInstanceFlock('/state/operations/drill.lock'); console.log('locked'); setInterval(()=>{},1000);";
    const args=['--exclusive','--nonblock','--no-fork','/state/operations/drill.lock',process.execPath,'--input-type=module','-e',code];
    const start=()=>spawn('flock',args,{cwd:'/app',stdio:['ignore','pipe','inherit']});
    const ready=child=>Promise.race([once(child.stdout,'data').then(([line])=>String(line).includes('locked')),
      once(child,'exit').then(()=>false)]);
    const first=start();
    if(!await ready(first))throw new Error('未取得真实内核写入锁');
    const second=start();
    const denied=(await once(second,'exit'))[0]===1;
    const killed=once(first,'exit');first.kill('SIGKILL');await killed;
    const third=start();
    const reclaimed=await ready(third);
    if(reclaimed){const stopped=once(third,'exit');third.kill('SIGKILL');await stopped;}
    console.log(JSON.stringify({denied,reclaimed}));
  `);
    assert.deepEqual(lockDrill,{denied:true,reclaimed:true});
    instance.record('managed-kernel-flock',lockDrill);
  }
  const repo = join(instance.dir, 'repo'), remote = join(instance.dir, 'origin.git');
  const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding:'utf8', stdio:['ignore','pipe','pipe']}).trim();
  git(instance.dir, 'init', '--bare', remote);
  git(instance.dir, 'init', '-b', 'main', repo);
  git(repo, 'config', 'user.name', '合成维护');
  git(repo, 'config', 'user.email', 'synthetic@example.invalid');
  for (const [id, title, body] of [['one','归档合成卡','合成测试正文。'], ['two','引用合成卡','参考 [[one]]。'],
    ['three','彻底删除合成卡','![专属图](assets/only.png)'], ['four','保留合成卡','![共享图](../three/assets/shared.png)'],
    ['old','旧链路合成卡','只供隔离删除验收。![旧专属图](assets/old.png)'], ['early','提前写入的合成入链','参考 [[seeded]]。'],
    ['seeded','仅 Git 归档合成卡','只供隔离恢复验收。']]) {
    const path = join(repo,'raw/方法',id);
    mkdirSync(path, {recursive:true});
    const reading = ['one','seeded'].includes(id) ? 'readings:\n  - title: 合成补读\n    path: assets/extra.md\n' : '';
    const archive = id === 'seeded' ? 'status: archived\n' : '';
    writeFileSync(join(path,'article.md'), `---\nname: ${title}\n${reading}${archive}---\n## 核心理解\n\n${body}\n`);
    if (reading) {
      mkdirSync(join(path,'assets'));
      writeFileSync(join(path,'assets/extra.md'), '合成补读内容。\n');
    }
  }
  const assets = join(repo,'raw/方法/three/assets');
  mkdirSync(assets);
  writeFileSync(join(assets,'only.png'),'合成专属附件');
  const sharedPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64');
  writeFileSync(join(assets,'shared.png'),sharedPng);
  mkdirSync(join(repo,'raw/方法/old/assets'));
  writeFileSync(join(repo,'raw/方法/old/assets/old.png'),'合成旧专属附件');
  const sourceMaterials = join(repo,'server/share-materials'), materialsRoot = join(instance.dir,'share-materials');
  mkdirSync(join(sourceMaterials,'covers'),{recursive:true});
  writeFileSync(join(sourceMaterials,'catalog.json'),JSON.stringify({three:{id:'three',title:'彻底删除合成卡'}}));
  writeFileSync(join(sourceMaterials,'covers/three.png'),'合成封面');
  cpSync(sourceMaterials,materialsRoot,{recursive:true});
  git(repo, 'add', 'raw', 'server');
  git(repo, 'commit', '-m', '合成原稿');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', 'origin', 'main');
  const forInstance = service => async (method,input) => {
    const response = await service.core(`
    const { rawInventory } = await import('./lib/raw-inventory.mjs');
    const { rawWrite } = await import('./lib/raw-write.mjs');
    try {
      const data = input.method === 'inventory'
        ? await rawInventory(api,input.args)
        : await rawWrite(api,input.method,input.args);
      console.log(JSON.stringify({data}));
    } catch (error) {
      console.log(JSON.stringify({error:{code:error.code,message:error.message}}));
    }
  `, {method,args:input ?? {}});
    if (response.error) throw Object.assign(new Error(method+': '+response.error.message),{code:response.error.code});
    return response.data;
  };
  const rpc = forInstance(instance);
  const rawRoot = join(repo,'raw'), stateDir = join(instance.root,'raw-sync');
  const seed = await selectRawSyncPlan({rawRoot,stateDir,rpc});
  await applyRawSync({plan:seed.plan,stateDir,rpc});
  const [one] = (await instance.call('list',{query:'归档合成卡'})).items.filter(item => item.title === '归档合成卡');
  const [two] = (await instance.call('list',{query:'引用合成卡'})).items;
  assert.match((await instance.call('get-document',{id:two.id})).markdown, new RegExp(one.id));

  const gitWorker = openCardLifecycleGit({cwd:repo,remote:'origin'});
  const taskFile = join(instance.dir,'control.sqlite');
  let tasks = openCardLifecycleTasks(taskFile);
  const service = (connection=rpc) => createCardLifecycleWorker({git:gitWorker,tasks,stateDir,rpc:connection});
  try {
    const inboundPath = 'raw/方法/two/article.md';
    const originalInbound = git(remote,'show','main:' + inboundPath) + '\n';
    function updateContent(path, contents) {
      git(repo, 'pull', '--ff-only', 'origin', 'main');
      writeFileSync(join(repo,path),contents);
      git(repo,'add','--',path);
      git(repo,'commit','-m','合成入链并发修改');
      git(repo,'push','origin','main');
    }
    const updateInbound = contents => updateContent(inboundPath, contents);
    updateInbound(originalInbound + '\n这段尚未同步。\n');
    const blocked = await service().preview('synthetic-owner',{action:'archive',id:one.id});
    assert.deepEqual(blocked.blockers,[{reason:'raw_sync_pending'}]);
    assert.equal(blocked.id,undefined);
    assert.doesNotMatch((await instance.call('get-document',{id:two.id})).markdown,/尚未同步/);
    updateInbound(originalInbound);

    const preview = await service().preview('synthetic-owner',{action:'archive',id:one.id});
    assert.deepEqual(preview.blockers,[]);
    service().confirm('synthetic-owner',preview.id);
    tasks.close();
    tasks = openCardLifecycleTasks(taskFile);
    const archived = await service().runOnce();
    assert.equal(archived.state,'complete',JSON.stringify(archived.progress));
    assert.equal((await instance.call('list',{query:'归档合成卡'})).items.some(item => item.id === one.id),false);
    assert.doesNotMatch((await instance.call('get-document',{id:two.id})).markdown, new RegExp(one.id));
    assert.match(git(remote,'show','main:raw/方法/one/article.md'),/status: archived/);
    const [entry] = await service().archives();
    assert.equal(entry.state,'archived');
    const native = await instance.core(`
      const {inspectArchivedNative}=await import('./lib/card-lifecycle-native.mjs');
      console.log(JSON.stringify(await inspectArchivedNative(api,input)));
    `, { id:entry.documentId, archiveOp:entry.archiveOp, expectedRevision:entry.revision });
    assert.equal(native.documents.length, 2);
    assert.equal(native.documents[0].id, one.id);
    assert.ok(native.documents.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
    const restore = await service().preview('synthetic-owner',{action:'restore',id:entry.rawId});
    assert.deepEqual(restore.blockers,[]);
    service().confirm('synthetic-owner',restore.id);
    const restored = await service().runOnce();
    assert.equal(restored.state,'complete',JSON.stringify(restored.progress));
    assert.equal((await instance.call('get-document',{id:one.id})).id,one.id);
    assert.match((await instance.call('get-document',{id:two.id})).markdown, new RegExp(one.id));
    assert.doesNotMatch(git(remote,'show','main:raw/方法/one/article.md'),/status: archived/);
    const drift = await service().preview('synthetic-owner',{action:'archive',id:one.id});
    service().confirm('synthetic-owner',drift.id);
    const {plan:driftPlan} = tasks.next();
    gitWorker.stage(drift.id,driftPlan.base,tree => new Map([...planCardRawChange({...driftPlan,rawRoot:join(tree,'raw')}).edits]
      .map(([path,bytes]) => ['raw/' + path,bytes])));
    assert.equal(gitWorker.publish(drift.id,driftPlan.base).state,'published');
    updateInbound(originalInbound + '\n发布后并发修改。\n');
    assert.equal((await service().runOnce()).state,'needs-review');
    assert.equal((await instance.call('get-document',{id:one.id})).id,one.id);
    const compensation = await service().preview('synthetic-owner',{action:'compensate',id:drift.id});
    service().confirm('synthetic-owner',compensation.id);
    assert.equal((await service().runOnce()).state,'complete');
    assert.match(git(remote,'show','main:' + inboundPath), /发布后并发修改/);
    assert.equal(tasks.get(drift.id).state,'cancelled');
    updateInbound(originalInbound);
    async function archiveBeforeSyncFailure() {
      const draft=await service().preview('synthetic-owner',{action:'archive',id:one.id});
      assert.deepEqual(draft.blockers,[]);
      service().confirm('synthetic-owner',draft.id);
      let native = false;
      const interrupted=service(async (method,input)=>{
        if (native && method==='inventory') throw Object.assign(new Error('模拟线上归档后同步冲突'),{code:'content_conflict'});
        const response=await rpc(method,input);
        if (method==='raw-archive') native=true;
        return response;
      });
      const result=await interrupted.runOnce();
      assert.equal(result.state,'needs-review',JSON.stringify(result.progress));
      assert.equal(result.progress.stage,'syncing');
      assert.equal((await instance.call('list',{query:'归档合成卡'})).items.some(card=>card.id===one.id),false);
      return draft;
    }
    const halfUndo=await archiveBeforeSyncFailure();
    const undo=await service().preview('synthetic-owner',{action:'compensate',id:halfUndo.id});
    service().confirm('synthetic-owner',undo.id);
    const undoBlocked=await service((method,input)=>{
      if (method==='raw-recover') throw Object.assign(new Error('模拟补偿提交推送后线上冲突'),{code:'content_conflict'});
      return rpc(method,input);
    }).runOnce();
    assert.equal(undoBlocked.state,'needs-review');
    assert.equal(undoBlocked.progress.stage,'compensation-native');
    const undoCommit=undoBlocked.progress.commit;
    const remaining=await service().preview('synthetic-owner',{action:'resume',id:undo.id});
    service().confirm('synthetic-owner',remaining.id);
    assert.equal((await service().runOnce()).state,'complete');
    assert.equal(tasks.get(undo.id).state,'queued');
    const undone=await service().runOnce();
    assert.equal(undone.state,'complete',JSON.stringify(undone.progress));
    assert.equal(undone.progress.commit,undoCommit);
    assert.equal(tasks.get(halfUndo.id).state,'cancelled');
    assert.equal((await instance.call('get-document',{id:one.id})).id,one.id);
    assert.doesNotMatch(git(remote,'show','main:raw/方法/one/article.md'),/status: archived/);
    const halfResume=await archiveBeforeSyncFailure();
    const unrelatedPath='raw/方法/four/article.md';
    const preservedOriginal=git(remote,'show','main:'+unrelatedPath)+'\n';
    const [untouched]=(await instance.call('list',{query:'保留合成卡'})).items;
    updateInbound(originalInbound+'\n确认继续时的并发正文。\n');
    updateContent(unrelatedPath,preservedOriginal+'\n本次不批准同步的正文。\n');
    const resume=await service().preview('synthetic-owner',{action:'resume',id:halfResume.id});
    assert.ok(resume.files.includes(inboundPath));
    assert.ok(!resume.files.includes(unrelatedPath));
    service().confirm('synthetic-owner',resume.id);
    const resumed=await service().runOnce();
    assert.equal(resumed.state,'complete',JSON.stringify(resumed.progress));
    assert.equal(tasks.get(halfResume.id).state,'complete');
    const revised=await instance.call('get-document',{id:two.id});
    assert.doesNotMatch(revised.markdown,new RegExp(one.id));
    assert.match(revised.markdown,/确认继续时的并发正文/);
    assert.doesNotMatch((await instance.call('get-document',{id:untouched.id})).markdown,/本次不批准同步的正文/);
    updateContent(unrelatedPath,preservedOriginal);
    updateInbound(originalInbound);
    const settledBase=gitWorker.snapshot();
    await gitWorker.inspect(settledBase,async rawRoot=>{
      const {plan}=await selectRawSyncPlan({rawRoot,stateDir,rpc});
      await applyRawSync({plan,stateDir,rpc});
    });
    const restoreAfterResume=await service().preview('synthetic-owner',{action:'restore',id:'one'});
    service().confirm('synthetic-owner',restoreAfterResume.id);
    assert.equal((await service().runOnce()).state,'complete');
    const fromRaw=await service().preview('synthetic-owner',{action:'restore',id:'seeded'});
    service().confirm('synthetic-owner',fromRaw.id);
    const startupInterrupted=await service((method,input)=>{
      if (method==='inventory' && !git(remote,'show','main:raw/方法/seeded/article.md').includes('status: archived') &&
          tasks.get(fromRaw.id).progress.stage==='syncing')
        throw Object.assign(new Error('模拟空库恢复尚未开始线上写入'),{code:'content_conflict'});
      return rpc(method,input);
    }).runOnce();
    assert.equal(startupInterrupted.state,'needs-review');
    const undoFromRaw=await service().preview('synthetic-owner',{action:'compensate',id:fromRaw.id});
    service().confirm('synthetic-owner',undoFromRaw.id);
    assert.equal((await service().runOnce()).state,'complete');
    assert.equal(tasks.get(fromRaw.id).state,'cancelled');
    assert.match(git(remote,'show','main:raw/方法/seeded/article.md'),/status: archived/);
    assert.equal((await instance.call('list',{query:'仅 Git 归档合成卡'})).items.some(card=>card.title==='仅 Git 归档合成卡'),false);
    const early = (await instance.call('list',{query:'提前写入的合成入链'})).items.find(card=>card.title==='提前写入的合成入链');
    assert.ok(early);
    const linkFirst = await service().preview('synthetic-owner',{action:'restore',id:'seeded'});
    service().confirm('synthetic-owner',linkFirst.id);
    const blockedCreate = await service((method,input)=>{
      if (method==='raw-document' && input.legacyId==='seeded' && !input.expected_revision)
        throw Object.assign(new Error('模拟入链已写、待恢复卡尚未创建'),{code:'content_conflict'});
      return rpc(method,input);
    }).runOnce();
    assert.equal(blockedCreate.state,'needs-review',JSON.stringify(blockedCreate.progress));
    assert.match((await instance.call('get-document',{id:early.id})).markdown,new RegExp(blockedCreate.progress.creation.id));
    const undoLink = await service().preview('synthetic-owner',{action:'compensate',id:linkFirst.id});
    service().confirm('synthetic-owner',undoLink.id);
    const reversedLink=await service().runOnce();
    assert.equal(reversedLink.state,'complete',JSON.stringify(reversedLink.progress));
    assert.doesNotMatch((await instance.call('get-document',{id:early.id})).markdown,new RegExp(blockedCreate.progress.creation.id));
    await assert.rejects(instance.call('get-document',{id:blockedCreate.progress.creation.id}));
    const createFirst = await service().preview('synthetic-owner',{action:'restore',id:'seeded'});
    service().confirm('synthetic-owner',createFirst.id);
    let createdReading = false;
    const blockedReadback = await service(async(method,input)=>{
      if (createdReading && method==='raw-probe')
        throw Object.assign(new Error('模拟创建卡片及补读后的读回冲突'),{code:'content_conflict'});
      const response = await rpc(method,input);
      if (method==='raw-document' && input.kind==='reading') createdReading=true;
      return response;
    }).runOnce();
    assert.equal(blockedReadback.state,'needs-review',JSON.stringify(blockedReadback.progress));
    assert.ok(createdReading);
    const createdId = blockedReadback.progress.creation.id;
    assert.equal((await instance.call('get-document',{id:createdId})).readings.length,1);
    const undoCreated = await service().preview('synthetic-owner',{action:'compensate',id:createFirst.id});
    service().confirm('synthetic-owner',undoCreated.id);
    const reversedCreate=await service().runOnce();
    assert.equal(reversedCreate.state,'complete',JSON.stringify(reversedCreate.progress));
    await assert.rejects(instance.call('get-document',{id:createdId}));
    assert.doesNotMatch((await instance.call('get-document',{id:early.id})).markdown,new RegExp(createdId));
    instance.record('new-card-partial-compensation',{incomingRestoredBeforeCreation:true,createdArchiveProven:true,createdReading:true});
    instance.record('card-lifecycle-conflict-settlement',{concurrentProsePreserved:true,gitAndNativeCompensation:true,
      nativeResume:true,unrelatedRawNotSynced:true,oneCompensationCommitAfterConflict:true});
    instance.record('card-lifecycle-archive-restore',{sameDocument:true, restartBeforeWorker:true, inboundRecompiled:true, gitReadback:true, archivedNativeChildrenChecked:true});
    const parent = git(repo, 'mktree');
    const anchor = git(repo, 'commit-tree', parent, '-m', '隔离删除账本');
    git(repo, 'push', 'origin', anchor + ':refs/heads/deletion-drill');
    const nativeLedger = openGitDeletionLedger({cwd:repo,remote:'origin',branch:'deletion-drill',anchor,
      journalPath:join(instance.dir,'native-deletion.sqlite'),initialHead:anchor});
    git(repo, 'push', 'origin', anchor + ':refs/heads/recovery-drill');
    const ledger = openGitDeletionLedger({cwd:repo,remote:'origin',branch:'recovery-drill',anchor,
      journalPath:join(instance.dir,'deletion.sqlite'),initialHead:anchor});
    try {
      const archiveAgain = await service().preview('synthetic-owner',{action:'archive',id:one.id});
      service().confirm('synthetic-owner',archiveAgain.id);
      const result = await service().runOnce();
      assert.equal(result.state,'complete',JSON.stringify(result.progress));
      const [archivedForPurge] = await service().archives();
      assert.equal(archivedForPurge.state,'archived');
      assert.notEqual(archivedForPurge.archiveOp,entry.archiveOp);
      const frozen = await instance.core(`
        const {inspectArchivedNative}=await import('./lib/card-lifecycle-native.mjs');
        console.log(JSON.stringify(await inspectArchivedNative(api,input)));
      `, {id:archivedForPurge.documentId,archiveOp:archivedForPurge.archiveOp,expectedRevision:archivedForPurge.revision});
      const library = await rpc('raw-target');
      const operation = {opId:'native-synthetic',previewDigest:hash(canonical(frozen)),mainCommit:result.progress.commit};
      nativeLedger.prepare({version:1, ...operation, library, rawId:'one',documents:frozen.documents.map(doc=>doc.id)});
      const authority = await nativeLedger.publish('native-synthetic',()=>{});
      const remove = decision => instance.core(`
        const {removeArchivedNative}=await import('./lib/card-lifecycle-native.mjs');
        console.log(JSON.stringify(await removeArchivedNative(api,input.frozen,{authorize:()=>input.decision,operation:input.operation})));
      `, {frozen,decision,operation});
      await assert.rejects(remove({...authority.decision,library:'wrong-instance'}));
      await assert.rejects(remove({...authority.decision,opId:'wrong-operation'}));
      await assert.rejects(remove({...authority.decision,previewDigest:'0'.repeat(64)}));
      const removed = await remove(authority.decision);
      assert.deepEqual(removed.documents, frozen.documents.map(doc=>doc.id));
      assert.ok(removed.historyRemoved > 0);
      assert.equal((await remove(authority.decision)).historyRemoved, 0);
      assert.equal((await instance.call('get-document',{id:two.id})).id,two.id);
      instance.record('native-purge-authority',{wrongLibraryRejected:true, historyCleared:true, readback:true, safeRetry:true});
      nativeLedger.complete('native-synthetic');
      const three = (await instance.call('list',{query:'彻底删除合成卡'})).items.find(card=>card.title==='彻底删除合成卡');
      const four = (await instance.call('list',{query:'保留合成卡'})).items.find(card=>card.title==='保留合成卡');
      const shareDb = new DatabaseSync(join(instance.dir,'purge-shares.sqlite'));
      try {
        const shares = cardShareStore(shareDb);
        const share = shares.create(three.id,0,{title:'合成删除分享'});
        const purge = createCardLifecyclePurge({git:gitWorker,ledger,stateDir,rpc,shares,materialsRoot});
        const worker = createCardLifecycleWorker({git:gitWorker,tasks,stateDir,rpc,purge});
        async function execute(action,id) {
          const preview = await worker.preview('synthetic-owner',{action,id});
          assert.deepEqual(preview.blockers,[]);
          worker.confirm('synthetic-owner',preview.id);
          let result = await worker.runOnce();
          for (let retry=0;result.state==='running' && retry<3;retry++) result=await worker.runOnce();
          assert.equal(result.state,'complete',JSON.stringify(result.progress));
          return result;
        }
        await execute('archive',four.id);
        const cold = join(instance.dir,'cold');
        const shareCopy = join(instance.dir,'cold-shares.sqlite');
        const materialsCopy = join(instance.dir,'cold-materials');
        cpSync(join(instance.dir,'purge-shares.sqlite'),shareCopy);
        cpSync(materialsRoot,materialsCopy,{recursive:true});
        await instance.stop();
        cpSync(instance.root,cold,{recursive:true});
        await instance.restart();
        await execute('archive',three.id);
        const result = await execute('purge','three');
        assert.equal(ledger.snapshot().decisions.get(result.id).decision.rawId,'three');
        assert.equal(shares.cardFor(share),undefined);
        assert.equal(shares.create(three.id,0,{title:'迟到分享'}),undefined);
        assert.equal(existsSync(join(materialsRoot,'covers/three.png')),false);
        assert.doesNotMatch(git(remote,'ls-tree','-r','--name-only','main','raw/方法/three','server/share-materials/covers'),/three/);
        assert.equal(await rpc('raw-verify-purge',{
          identity:library,native:tasks.get(result.id).plan.deletion.native,copies:tasks.get(result.id).plan.deletion.copies,
        }),true);
        const bindings = (await worker.archives()).map(card=>card.rawId);
        assert.ok(!bindings.includes('three'));
        await execute('restore','four');
        const survivor = await instance.call('get-document',{id:four.id});
        const survivingAsset = survivor.markdown.match(/assets\/raw-[a-f0-9]{64}\.png/)?.[0];
        assert.ok(survivingAsset);
        const image = await fetch(new URL('/'+survivingAsset,instance.url),{signal:AbortSignal.timeout(5000)});
        assert.equal(image.status,200);
        assert.match(image.headers.get('content-type'),/^image\/png/);
        assert.deepEqual(Buffer.from(await image.arrayBuffer()),sharedPng);
        assert.equal(existsSync(join(instance.root,'workspace/data/assets/raw-'+hash('合成专属附件')+'.png')),false);
        instance.record('worker-purge-shared-assets',{gitDeleted:true,shareRemoved:true,exclusiveAssetRemoved:true,sharedAssetPreserved:true});
        const verified = await purge.verifyRecovery(tasks).catch(async error=>{
          const observed = await instance.core(`
            const {verifyNativePurged}=await import('./lib/card-lifecycle-native.mjs');
            const {verifyPurgeCopies}=await import('./lib/card-lifecycle-copies.mjs');
            const {quote}=await import('./lib/siyuan.mjs');
            const fs=await import('node:fs');
            const path=await import('node:path');
            const {native,copies}=input.deletion;
            const ids=native.documents.map(doc=>doc.id);
            const live=await api.sql('SELECT id FROM blocks WHERE root_id IN ('+ids.map(quote).join(',')+') LIMIT 1');
            const history=await Promise.all(ids.map(id=>api.api('/api/history/searchHistory',{query:id,notebook:native.notebookId,op:'all',type:3,page:1})));
            console.log(JSON.stringify({native:await verifyNativePurged(api,native), copies:verifyPurgeCopies(api,input.identity,copies),
              live:live.length, history:history.map(result=>result?.totalCount ?? null),
              files:native.documents.filter(doc=>fs.existsSync(path.join(path.dirname(api.c.dataDir),'workspace','data',doc.path))).length}));
          `,{identity:library,deletion:tasks.get(result.id).plan.deletion});
          throw Object.assign(error,{message:error.message+' '+JSON.stringify(observed)});
        });
        if (nativeMode) await instance.stop();
        recovered = await startRuntime("lifecycle-recovery",{build:false,kernelPort:instance.kernelPort,initialize(root) {
          cpSync(cold,root,{recursive:true});
          const env = join(root,'compose.env');
          writeFileSync(env,readFileSync(env,'utf8').replace(/^CONCEPT_PRIVATE_ROOT=.*$/m,'CONCEPT_PRIVATE_ROOT='+root)
            .replace(/^CONCEPT_PORT=.*$/m,'CONCEPT_PORT=6806'),{mode:0o600});
        }});
        const restoredDb = new DatabaseSync(shareCopy);
        try {
          assert.equal((await recovered.call('get-document',{id:three.id})).id,three.id);
          const restoredShares = cardShareStore(restoredDb);
          assert.equal(restoredShares.cardFor(share),three.id);
          const replay = createCardLifecyclePurge({git:gitWorker,ledger,stateDir:join(recovered.root,'raw-sync'),
            rpc:forInstance(recovered),shares:restoredShares,materialsRoot:materialsCopy});
          git(remote,'update-ref','refs/heads/recovery-drill',anchor);
          await assert.rejects(replay.verifyRecovery(tasks),{code:'ledger_changed'});
          git(remote,'update-ref','refs/heads/recovery-drill',verified.ledgerHead);
          await assert.rejects(replay.verifyRecovery(tasks),{code:'operation_pending'});
          try {
            assert.deepEqual(await replay.reconcileRecovery(tasks),verified);
          } catch (error) {
            const frozen = tasks.get(result.id).plan.deletion.native;
            const actual = frozen.documents.map(doc=>({
              id:doc.id,
              exists:existsSync(join(recovered.root,'workspace','data',doc.path)),
              beforeRecovery:existsSync(join(cold,'workspace','data',doc.path)),
            }));
            recovered.record('cold-native-file-diagnostic',{code:error.code,documents:actual});
            throw error;
          }
          assert.equal(restoredShares.cardFor(share),undefined);
          assert.equal(existsSync(join(materialsCopy,'covers/three.png')),false);
          await assert.rejects(recovered.call('get-document',{id:three.id}));
          recovered.record('cold-purge-replayed-before-open',{olderLedgerRejected:true,restoredCopiesCleared:true,shareRevoked:true});
        } finally { restoredDb.close(); }
        if (nativeMode) {
          await recovered.finish(true);
          recovered = null;
          await instance.restart();
        }
        const legacy=await archiveRawCard({rawId:'old',stateDir,rpc});
        const unmarked = (await worker.archives()).find(row=>row.rawId==='old');
        assert.equal(unmarked.state,'needs-marker');
        await execute('mark-archive','old');
        const upgraded = (await worker.archives()).find(row=>row.rawId==='old');
        assert.equal(upgraded.state,'archived');
        assert.equal(upgraded.archiveOp,unmarked.archiveOp);
        instance.record('legacy-archive-marker-upgrade',{existingReceiptPreserved:true});
        git(repo,'pull','--ff-only','origin','main');
        const legacyPath='raw/方法/old/article.md';
        git(repo,'rm','--',legacyPath);
        git(repo,'commit','-m','模拟旧流程仅移走已归档合成原稿正文');
        git(repo,'push','origin','main');
        const orphanBase=git(remote,'rev-parse','main');
        const orphan=await worker.preview('synthetic-owner',{action:'purge',id:'old'});
        assert.deepEqual(orphan.blockers,[{path:'方法/old/assets/old.png',reason:'asset_ownership_unverified'}]);
        assert.equal(git(remote,'rev-parse','main'),orphanBase);
        assert.equal(orphan.id,undefined);
        git(repo,'rm','--','raw/方法/old/assets/old.png');
        writeFileSync(join(repo,'raw/.sync.json'),JSON.stringify({version:1,identity:library,cards:{old:{path:'方法/old/article.md'}}}));
        git(repo,'add','raw/.sync.json');
        git(repo,'commit','-m','模拟旧流程已移走原稿包并保留原路径的同步清单');
        git(repo,'push','origin','main');
        const statePath = join(stateDir,hash(library),'state.json');
        const legacyState = JSON.parse(readFileSync(statePath,'utf8'));
        delete legacyState.cards.old.path;
        writeFileSync(statePath,JSON.stringify(legacyState));
        const missingBase=git(remote,'rev-parse','main');
        assert.equal((await worker.archives()).find(row=>row.rawId==='old').state,'missing-raw');
        await execute('purge','old');
        const newHead=git(remote,'rev-parse','main');
        assert.equal(git(remote,'rev-parse',newHead+'^'),missingBase);
        assert.equal(git(remote,'diff','--name-only',missingBase,newHead),'raw/.sync.json');
        assert.doesNotMatch(git(remote,'show','main:raw/.sync.json'),/"old"/);
        const commits = git(remote,'rev-list',orphanBase+'..main').split('\n');
        for (const commit of commits) assert.throws(()=>git(remote,'show',commit+':'+legacyPath));
        assert.equal(existsSync(join(instance.root,'workspace/data/assets/raw-'+hash('合成旧专属附件')+'.png')),false);
        await assert.rejects(instance.call('get-document',{id:legacy.id}));
        assert.ok(!(await worker.archives()).some(row=>row.rawId==='old'));
        instance.record('legacy-missing-original-purge',{noResurrection:true,orphanBlockedBeforePush:true,
          trackedCommitOnlyClearedBinding:true,legacyExclusiveAssetRemoved:true});
        fresh = await startRuntime('lifecycle-from-git',{build:false});
        const freshRpc = forInstance(fresh), freshState = join(fresh.root,'raw-sync');
        const head = gitWorker.snapshot();
        await gitWorker.inspect(head,async rawRoot=>{
          const {plan}=await selectRawSyncPlan({rawRoot,stateDir:freshState,rpc:freshRpc});
          await applyRawSync({plan,stateDir:freshState,rpc:freshRpc});
        });
        const freshWorker=createCardLifecycleWorker({git:gitWorker,tasks,stateDir:freshState,rpc:freshRpc});
        assert.equal((await freshWorker.archives()).find(row=>row.rawId==='seeded').state,'from-raw');
        const restoredFromGit = await freshWorker.preview('synthetic-owner',{action:'restore',id:'seeded'});
        assert.deepEqual(restoredFromGit.blockers,[]);
        freshWorker.confirm('synthetic-owner',restoredFromGit.id);
        const freshResult = await freshWorker.runOnce();
        assert.equal(freshResult.state,'complete',JSON.stringify(freshResult.progress));
        const freshRead = async title => (await fresh.call('list',{query:title})).items.find(row=>row.title===title);
        const freshSeeded = await freshRead('仅 Git 归档合成卡');
        const freshEarly = await freshRead('提前写入的合成入链');
        assert.notEqual(freshSeeded.id,createdId);
        assert.equal((await fresh.call('get-document',{id:freshSeeded.id})).readings.length,1);
        assert.match((await fresh.call('get-document',{id:freshEarly.id})).markdown,new RegExp(freshSeeded.id));
        fresh.record('fresh-git-archive-restore',{gitOnlyCatalogue:true,newDocument:true,inboundRecompiled:true});
      } finally { shareDb.close(); }
    } finally { nativeLedger.close(); ledger.close(); }
  } finally { tasks.close(); }
  passed = true;
} finally {
  const cleanup = await Promise.allSettled([instance,recovered,fresh].filter(Boolean).map(runtime=>runtime.finish(passed)));
  if (cleanup.some(result=>result.status==='rejected')) throw new AggregateError(
    cleanup.filter(result=>result.status==='rejected').map(result=>result.reason),'隔离验收清理失败。');
}
