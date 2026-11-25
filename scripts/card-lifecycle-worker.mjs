import { join, posix } from 'node:path';
import { loadRawTree } from '../lib/raw-format.mjs';
import { canonical, fail, hash } from '../lib/siyuan.mjs';
import { planCardRawChange } from './raw-lifecycle-plan.mjs';
import { applyRawSync, archiveRawCard, findBoundRawCard, listRawArchives, readPendingRawSync,
  recoverRawOperation, selectRawSyncPlan, settleRawSync, restrictRawSyncPlan } from './raw-sync.mjs';

function requireClearPatch(patch) {
  if (patch.blockers.length) fail('content_conflict', '原稿存在阻塞项，请重新预览。');
}

function syncScope(tree, rawId) {
  const card = tree.byId.get(rawId);
  if (!card) fail('content_conflict', '提交中缺少所选归档原稿。');
  const paths = new Set([card.path, ...card.readings.map(reading => reading.path)]);
  for (const path of [...paths]) for (const source of tree.inbound.get(path) ?? []) paths.add(source);
  const cards = new Set(tree.cards.filter(article => paths.has(article.path)).map(article => article.id));
  const dependencies = new Set([...tree.inbound].filter(([,sources])=>[...sources].some(path=>paths.has(path))).map(([path])=>path));
  const cardDependencies = new Set([...dependencies].map(path=>tree.byPath.get(path)?.id).filter(Boolean));
  const owned = path => path.startsWith(posix.dirname(card.path) + '/');
  return {
    reads: new Set([...paths].filter(path => tree.readingPaths.has(path))),
    cards, owned, paths, dependencies, cardDependencies,
  };
}

/** One host worker per library. Callers hold the deployment's process lock. */
export function createCardLifecycleWorker({ git, tasks, stateDir, rpc, purge, manualOriginals=false, now = () => new Date() }) {
  const archivesAt = head => git.inspect(head, rawRoot => listRawArchives({rawRoot, stateDir, rpc}));
  const fingerprint = value => hash(canonical(value));
  const settling = action => action === 'resume' || action === 'compensate';
  const scopeFingerprint = (head,rawId) => git.inspect(head,rawRoot=>{
    const tree = loadRawTree(rawRoot,{references:true}), scope = syncScope(tree,rawId);
    return fingerprint([...new Set([...scope.paths,...scope.dependencies])].sort().map(path=>[path,hash(tree.files.get(path))]));
  });

  async function requireCleanBase(plan) {
    if (!['archive','restore'].includes(plan.action)) return;
    await git.inspect(plan.base, async rawRoot => {
      const sync = await selectRawSyncPlan({stateDir, rpc, rawRoot});
      if (sync.pending || sync.plan.identity !== plan.library || sync.plan.actions.length ||
          sync.plan.conflicts.length || sync.plan.missing.length)
        fail('content_conflict', '线上原稿和确认基线不一致，请先完成现有同步。');
    });
  }

  function blockHistoricalRemoval(plan) {
    if (!manualOriginals) return;
    let source=plan;
    while (source && settling(source.action)) source=tasks.get(source.originalId)?.plan;
    if (source?.action==='purge') fail('operation_conflict','请在数据库优先模式核对手工删除原稿。');
  }
  async function preview(owner, { action, id }) {
    blockHistoricalRemoval({action,originalId:id});
    if (settling(action)) return previewSettlement(owner, action, id);
    const base = git.snapshot();
    const library = await rpc('raw-target');
    if (readPendingRawSync(stateDir,library)) fail('operation_pending', '先完成待处理的原稿同步。');
    let rawId = id, evidence = null, entry = null;
    if (action === 'archive') {
      rawId = findBoundRawCard(stateDir, library, id);
      if (!rawId) fail('outside_scope', '卡片需先通过原稿同步建立绑定。');
      evidence = await rpc('raw-active-card-evidence', {identity:library, id});
    } else {
      entry = (await archivesAt(base)).find(card => card.rawId === rawId);
      if (!entry || entry.state === 'needs-review') fail('outside_scope', '无法核实该归档记录。');
      const allowed = action === 'restore' ? ['archived','from-raw']
        : action === 'mark-archive' ? ['needs-marker'] : action === 'purge' ? ['archived','missing-raw'] : [];
      if (!allowed.includes(entry.state)) fail('outside_scope', '当前归档记录不能执行所选操作。');
      if (entry.documentId) evidence = { id:entry.documentId, revision:entry.revision, signature:entry.signature };
    }
    const archivedAt = action === 'mark-archive' && entry.archivedAt ? entry.archivedAt : now().toISOString();
    const plan = { action, library, rawId, base, archivedAt, evidence, archiveOp:entry?.archiveOp ?? null,
      ...(action === 'purge' && {sourcePath:entry.path ?? entry.boundPath}) };
    const patch = git.inspect(base, rawRoot => planCardRawChange({...plan, rawRoot}));
    if (action === 'purge' && patch.packagePath) plan.sourcePath = patch.packagePath;
    const blockers = [...patch.blockers];
    const files = [...patch.edits.keys()];
    try { await requireCleanBase(plan); }
    catch (error) {
      if (error.code !== 'content_conflict') throw error;
      blockers.push({ reason:'raw_sync_pending' });
    }
    if (action === 'purge') {
      if (!purge) blockers.push({ reason:'purge_unavailable' });
      else if (!blockers.length) {
        const assessment = await purge.preview(plan, patch);
        blockers.push(...assessment.blockers);
        plan.deletion = assessment.deletion;
        files.push(...(assessment.files ?? []));
      }
    }
    const result = { action, title:evidence?.title ?? entry?.title ?? rawId, rawId,
      files, moves:[...patch.moves], blockers };
    return blockers.length ? result : { ...result, ...tasks.preview(owner, plan) };
  }

  async function compensableNative(task) {
    const {plan,progress} = task;
    if (!['archive','restore'].includes(plan.action) || !['applying','syncing'].includes(progress.stage))
      return null;
    if (!plan.evidence) {
      if (!progress.syncPlan && !readPendingRawSync(stateDir,plan.library)) return null;
      if (!progress.creation) fail('operation_conflict','原恢复任务没有已记录的创建操作。');
      const native = await rpc('raw-created-card-evidence',{identity:plan.library,rawId:plan.rawId,...progress.creation});
      return native.state === 'unstarted' ? null : {kind:'archive',id:native.id,revision:native.revision,signature:native.signature};
    }
    const {id,revision,signature} = plan.evidence;
    const identity = plan.library;
    const archiveOp = plan.action === 'archive' ? 'raw-archive-web-' + task.id : plan.archiveOp;
    const archived = await rpc('raw-archive-evidence',{identity,id,op_id:archiveOp});
    if (archived.verified) {
      if (archived.signature !== signature) fail('content_conflict','归档卡片已有独立修改。');
      return plan.action === 'archive' ? {kind:'restore',archiveOp,id,revision:archived.revision,signature} : null;
    }
    const active = await rpc('raw-active-card-evidence',{identity,id});
    if (active.signature !== signature ||
        (plan.action === 'archive' && active.revision !== revision) ||
        (progress.native?.revision && plan.action === 'restore' && active.revision !== progress.native.revision))
      fail('content_conflict','卡片在确认后已有独立修改。');
    if (plan.action === 'restore' && !progress.native)
      fail('operation_conflict','恢复写入尚未读回，须先继续原操作。');
    return plan.action === 'restore' ? {kind:'archive',id,revision:active.revision,signature} : null;
  }

  async function previewSettlement(owner, action, id) {
    const original = tasks.owned(owner,id);
    if (original.state !== 'needs-review')
      fail('operation_conflict','只有待核对的原操作可以结算。');
    if (settling(original.plan.action)) {
      if (action !== 'resume' || original.plan.action !== 'compensate' || !original.progress.commit)
        fail('operation_conflict','结算尚未取得可续跑的 Git 提交。');
      const parent = tasks.owned(owner,original.plan.originalId);
      const status = git.status(original.id,original.plan.base);
      if (status.state !== 'published' || status.commit !== original.progress.commit || parent.state !== 'needs-review' ||
          fingerprint(await compensableNative(parent)) !== fingerprint(original.plan.inverse) ||
          (original.plan.inverse && scopeFingerprint(status.commit,parent.plan.rawId) !== scopeFingerprint(status.head,parent.plan.rawId)))
        fail('content_conflict','撤销的剩余步骤仍有冲突，请核对线上版本和受影响的原稿。');
      return {action,title:parent.plan.evidence?.title ?? parent.plan.rawId,rawId:parent.plan.rawId,files:[],blockers:[],
        ...tasks.preview(owner,{action,library:parent.plan.library,base:status.head,originalId:id,
          originalProgress:fingerprint(original.progress),remainingCompensation:true})};
    }
    const {plan} = original;
    if (plan.library !== await rpc('raw-target')) fail('outside_scope','原操作属于另一知识库。');
    if (plan.action === 'purge' && (original.progress.irreversible || purge?.committed(original)))
      fail('operation_conflict','不可逆删除须按原操作继续。');
    const status = git.status(id,plan.base);
    if (status.state === 'published-conflict') fail('content_conflict','目标原稿有后续修改，须先核对原稿。');
    if (action === 'resume' && status.state !== 'published' && status.state !== 'prepared')
      fail('content_conflict','原稿尚未发布且基线已变化，请重新预览原操作。');
    if (action === 'resume' && plan.action === 'purge' && status.state === 'published') git.assertRawUnchanged(status.commit);
    const pending = readPendingRawSync(stateDir,plan.library);
    if (pending && pending.id !== original.progress.syncPlan)
      fail('operation_pending','冻结同步缺少归属证明。');
    const inverse = action === 'compensate' ? await compensableNative(original) : null;
    const files = new Set(status.commit ? git.changedPaths(plan.base,status.commit) : []);
    if (action === 'resume' && ['archive','restore'].includes(plan.action))
      git.inspect(status.head,rawRoot => {
        const scope = syncScope(loadRawTree(rawRoot,{references:true}),plan.rawId);
        for (const path of scope.paths) files.add('raw/' + path);
      });
    const settlement = {action,library:plan.library,base:status.head,originalId:id,originalProgress:fingerprint(original.progress),
      gitState:status.state,commit:status.commit ?? null,inverse,pendingId:pending?.id ?? null};
    if (action === 'compensate' && (inverse || pending) && status.commit) {
      if (scopeFingerprint(status.commit,plan.rawId) !== scopeFingerprint(status.head,plan.rawId))
        fail('content_conflict','受影响的引用或资料已有新提交，请先核对这些原稿。');
    }
    return {action,title:plan.evidence?.title ?? plan.rawId,rawId:plan.rawId,files:[...files],blockers:[],
      ...tasks.preview(owner,settlement)};
  }

  async function confirmEvidence(plan) {
    if (plan.library !== await rpc('raw-target')) fail('outside_scope', '操作属于另一个知识库。');
    if (readPendingRawSync(stateDir,plan.library)) fail('operation_pending', '先完成待处理的原稿同步。');
    if (!plan.evidence) return;
    const { id, revision, signature } = plan.evidence;
    const input = { identity:plan.library, id, ...(plan.archiveOp && {op_id:plan.archiveOp}) };
    const actual = await rpc(plan.archiveOp ? 'raw-archive-evidence' : 'raw-active-card-evidence', input);
    if (actual.id !== id || actual.revision !== revision || actual.signature !== signature)
      fail('content_conflict', '线上卡片在确认后已变化。');
  }

  async function syncApproved(plan, commit, progress, update, scoped = false) {
    const args = {stateDir, rpc, identity:plan.library};
    await git.inspect(commit, async rawRoot => {
      const tree = loadRawTree(rawRoot, {references:true});
      const scope = syncScope(tree, plan.rawId);
      const sync = await selectRawSyncPlan({...args, rawRoot});
      const allows = (kind,key) => kind === 'cards' ? scope.cards.has(key)
        : kind === 'readings' ? scope.reads.has(key) : ['assets','sources'].includes(kind) && scope.owned(key);
      if (sync.plan.identity !== plan.library || (sync.pending && sync.plan.id !== progress.syncPlan))
        fail('operation_conflict', '同步批次归属不符。');
      if (scoped && [...sync.plan.actions,...sync.plan.conflicts].some(item=>
        ['assets','sources'].includes(item.kind) && !allows(item.kind,item.key) && scope.dependencies.has(item.key)))
        fail('operation_conflict','有引用资料需要单独同步。');
      if (scoped && sync.plan.actions.some(action=>!allows(action.kind,action.key) && action.method==='raw-document' &&
          !action.input.expected_revision && (scope.dependencies.has(action.key) || scope.cardDependencies.has(action.key))))
        fail('operation_conflict','有被引用的知识卡尚未导入线上库。');
      const approved = scoped && !sync.pending ? restrictRawSyncPlan(sync.plan,stateDir,allows) : sync.plan;
      if (approved.conflicts.length || approved.actions.some(action=>!allows(action.kind,action.key)))
        fail('operation_conflict', '原稿同步包含其他未确认的变更或冲突。');
      git.assertRawUnchanged(commit);
      const create = !plan.evidence && plan.action === 'restore' && approved.actions.find(action=>
        action.kind==='cards' && action.key===plan.rawId && action.method==='raw-document' && !action.input.expected_revision);
      const order = create && approved.actions.find(action=>action.method==='raw-order-readings' &&
        action.input.expected_operation === create.input.op_id);
      const creation = create ? {id:create.input.id,op_id:create.input.op_id,...(order && {orderOp:order.input.op_id})} : progress.creation;
      update('running',{...progress,syncPlan:approved.id,...(creation && {creation})});
      await applyRawSync({stateDir, rpc, plan:approved});
    });
  }

  async function applyArchiveOrRestore(task, commit, update, scoped = false) {
    const { plan } = task;
    if (plan.action === 'mark-archive') return;
    const args = {stateDir, rpc, identity:plan.library};
    let progress = task.progress;
    if (progress.stage !== 'syncing') {
      let native;
      if (plan.action === 'archive') native = await archiveRawCard({...args, rawId:plan.rawId, expected:{...plan.evidence,operationId:task.id}});
      else if (plan.archiveOp) native = await recoverRawOperation({...args, backupOp:plan.archiveOp,
        revision:plan.evidence.revision, signature:plan.evidence.signature});
      progress = {stage:'syncing',commit,native};
      update('running',progress);
    }
    await syncApproved(plan,commit,progress,update,scoped);
  }

  async function settleOwnedBatch(original, expected) {
    const pending = readPendingRawSync(stateDir,original.plan.library);
    if (!pending) return;
    if (pending.id !== expected || pending.id !== original.progress.syncPlan)
      fail('operation_pending','同步批次不属于原操作。');
    const inventory = await rpc('inventory',{withBlocks:false});
    const settled = await settleRawSync({inventory,stateDir,rpc});
    if (settled.pending || settled.conflicts?.length || settled.unconfirmed?.length)
      fail('operation_conflict','原操作仍有未核实的线上写入。');
  }

  async function applySettlement(task, update) {
    const {plan, id} = task;
    const original = tasks.get(plan.originalId);
    if (!original || original.state !== 'needs-review' || fingerprint(original.progress) !== plan.originalProgress)
      fail('content_conflict','原操作状态已变化，请重新预览。');
    if (plan.remainingCompensation) {
      git.assertRawUnchanged(plan.base);
      update('running',{stage:'requeueing'});
      return tasks.finishSettlement(id,original.id,'queued',{...original.progress,reviewedHead:plan.base,error:undefined},
        {stage:'settled',originalId:original.id});
    }
    if (original.plan.action === 'purge' && purge?.committed(original))
      fail('operation_conflict','不可逆删除须按原操作继续。');
    if (plan.action === 'resume') {
      const status = git.status(original.id,original.plan.base);
      if (status.head !== plan.base || status.commit !== plan.commit ||
          !['published','prepared'].includes(status.state))
        fail('content_conflict','原稿状态已变化，请重新预览。');
      if (status.state === 'prepared' || original.plan.action === 'purge') {
        if (status.state === 'published') git.assertRawUnchanged(status.commit);
        update('running',{stage:'requeueing'});
        return tasks.finishSettlement(id,original.id,'queued',{...original.progress,error:undefined},
          {stage:'settled',originalId:original.id});
      } else {
        git.assertRawUnchanged(plan.base);
        if (!task.progress.online) await settleOwnedBatch(original,plan.pendingId);
        const forward = {...original,progress:task.progress.online ?? original.progress};
        const commit = plan.base;
        const mirror = (state, online) => update(state,{stage:'resuming',commit,online});
        await applyArchiveOrRestore(forward,commit,mirror,true);
        if (original.plan.action === 'mark-archive') update('running',{stage:'resuming',commit});
        return tasks.finishSettlement(id,original.id,'complete',{stage:'readback',commit},
          {stage:'settled',originalId:original.id,commit});
      }
    }
    let progress = task.progress;
    if (!progress.stage) {
      if (git.snapshot() !== plan.base ||
          fingerprint(await compensableNative(original)) !== fingerprint(plan.inverse))
        fail('content_conflict','撤销预览后原稿或线上卡片发生变化。');
      if (original.plan.action === 'purge') await purge.cancel(original);
      await settleOwnedBatch(original,plan.pendingId);
      progress = {stage:'compensating'};
      update('running',progress);
    }
    const published = plan.gitState === 'published';
    let commit = plan.base;
    if (published) {
      let status = git.status(id,plan.base);
      if (status.state === 'unstaged') {
        git.stageCompensation(id,original.id,original.plan.base,plan.base);
        status = git.status(id,plan.base);
      }
      if (status.state === 'prepared') status = git.publish(id,plan.base);
      if (status.state === 'prepared') fail('operation_pending','撤销提交尚未读回。');
      if (status.state !== 'published') fail('content_conflict','撤销提交与当前原稿状态冲突。');
      commit = status.commit;
    }
    if (progress.stage === 'compensating') {
      progress = {...progress,stage:'compensation-native',commit};
      update('running',progress);
    }
    const reviewed = progress.reviewedHead ?? commit;
    git.assertRawUnchanged(reviewed);
    if (progress.stage !== 'compensation-sync') {
      if (plan.inverse) {
        const args = {stateDir,identity:plan.library,rpc};
        if (plan.inverse.kind === 'restore') await recoverRawOperation({...args,backupOp:plan.inverse.archiveOp,
          revision:plan.inverse.revision,signature:plan.inverse.signature});
        else await archiveRawCard({...args,rawId:original.plan.rawId,expected:{...plan.inverse,operationId:id}});
      }
      progress = {...progress,stage:'compensation-sync',commit};
      update('running',progress);
    }
    if (plan.inverse || plan.pendingId) await syncApproved(original.plan,reviewed,progress,update,true);
    return tasks.finishSettlement(id,original.id,'cancelled',{stage:'compensated',commit,settlementId:id},
      {stage:'settled',originalId:original.id,commit});
  }

  async function runOnce() {
    const task = tasks.next();
    if (!task) return null;
    const { id, plan } = task;
    let progress = task.progress;
    const update = (state, next) => {
      const persisted = tasks.update(id, state, next);
      progress = persisted.progress;
      return persisted;
    };
    try {
      if (plan.library !== await rpc('raw-target')) fail('outside_scope', '操作属于另一个知识库。');
      if (settling(plan.action)) {
        blockHistoricalRemoval(plan);
        return await applySettlement(task,update);
      }
      const committed = plan.action === 'purge' && purge?.committed(task);
      if (committed) {
        update('running',{...progress,stage:'purging',irreversible:true});
        await purge.finish(task,committed);
        tasks.invalidateRestorePreviews(plan.library,plan.rawId);
        return update('complete',{stage:'readback',commit:committed.mainCommit});
      }
      blockHistoricalRemoval(plan);
      let result = git.status(id, plan.base);
      if (result.state === 'unstaged') {
        await confirmEvidence(plan);
        await requireCleanBase(plan);
        if (plan.action === 'purge') await purge.recheck(plan,git.inspect(plan.base,rawRoot=>planCardRawChange({...plan,rawRoot})));
        update('running', {stage:'staging'});
        git.stage(id, plan.base, tree => {
          const patch = planCardRawChange({...plan, rawRoot:join(tree,'raw')});
          requireClearPatch(patch);
          const edits = new Map([...patch.edits].map(([path, bytes]) => ['raw/' + path, bytes]));
          if (plan.action === 'purge') {
            for (const [path,bytes] of purge.stage(tree,plan)) edits.set(path,bytes);
          }
          return edits;
        });
        result = git.status(id, plan.base);
      }
      if (result.state === 'prepared') {
        await confirmEvidence(plan);
        await requireCleanBase(plan);
        if (plan.action === 'purge') await purge.recheck(plan,git.inspect(plan.base,rawRoot=>planCardRawChange({...plan,rawRoot})));
        update('running', {stage:'publishing', commit:result.commit});
        result = git.publish(id, plan.base);
        if (result.state === 'prepared') fail('operation_pending', '远端尚未读回已提交原稿。');
        if (result.state === 'refused') fail('operation_conflict', '远端拒绝更新原稿分支，请核对分支权限。');
      }
      if (result.state !== 'published') fail('content_conflict', 'Git 原稿存在并发变更。');
      git.assertRawUnchanged(result.commit);
      if (!['applying','syncing'].includes(task.progress.stage)) await requireCleanBase(plan);
      if (task.progress.stage !== 'syncing') update('running', {stage:'applying', commit:result.commit});
      if (plan.action === 'purge') {
        if (!purge) fail('operation_conflict', '彻底删除执行器不可用。');
        await purge.apply(task, result.commit,()=>git.inspect(plan.base, rawRoot=>planCardRawChange({...plan,rawRoot})),
          ()=>update('running',{...progress,stage:'purging',irreversible:true}));
        tasks.invalidateRestorePreviews(plan.library,plan.rawId);
      } else await applyArchiveOrRestore(task, result.commit, update);
      return update('complete', {stage:'readback', commit:result.commit});
    } catch (error) {
      const conflict = !progress.irreversible && /conflict|scope/.test(error.code ?? '');
      const state = conflict ? 'needs-review' : 'running';
      return update(state, {...progress, error:error.code ?? 'worker_unavailable'});
    }
  }

  return {
    archives: () => archivesAt(git.snapshot()), preview, runOnce,
    confirmation: tasks.confirmation, confirm:tasks.confirm, status:tasks.status,
  };
}
