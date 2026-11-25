import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeLifecyclePatch,lifecycleFileIdentity,sameLifecycleFile,verifyLifecycleCandidate } from './card-lifecycle-git.mjs';
import { loadRawTree } from '../lib/raw-format.mjs';
import { canonical,fail,hash } from '../lib/siyuan.mjs';

const catalogPath='server/share-materials/catalog.json';
const published=new Set(['published','published-conflict']);
function isColdArchive(operation,originalId) {
  const prefix='db-pending-cold-'+originalId+'-';
  return operation?.startsWith(prefix) && /^[a-f0-9]{12}$/.test(operation.slice(prefix.length));
}

/** Settle only a single confirmed deletion, keeping its original batch candidate as evidence. */
export function createDatabaseCompensation({tasks,queue,git,purge,rpc,shares,library,manual}) {
  function inverse(plan,head) {
    if (!plan.batchId) return new Map();
    const evidence=tasks.databasePurgeContribution(plan.originalId,plan.batchId);
    if (!evidence) fail('operation_conflict','缺少逐卡删除证据。');
    return git.inspect(plan.parent,(_,base)=>git.inspect(plan.candidate,(_,candidate)=>git.inspect(head,(rawRoot,current)=>{
      const edits=new Map();
      const tree=loadRawTree(rawRoot,{references:true});
      const touched=new Set(evidence.files.map(({path})=>path));
      for (const {path,before,after} of evidence.files) {
        if (!sameLifecycleFile(lifecycleFileIdentity(base,path),before) ||
            !sameLifecycleFile(lifecycleFileIdentity(candidate,path),after))
          fail('content_conflict','原删除候选与冻结证据不一致。');
        const existing=lifecycleFileIdentity(current,path);
        if (path===catalogPath && before && after && existing) {
          const read=from=>JSON.parse(readFileSync(join(from,path),'utf8'));
          const old=read(base), removed=read(candidate), latest=read(current);
          const entry=Object.hasOwn(old,plan.rawId) && old[plan.rawId];
          if (entry?.id!==plan.rawId || Object.hasOwn(removed,plan.rawId) ||
              Object.hasOwn(latest,plan.rawId) || existing.executable!==before.executable)
            fail('content_conflict','目标分享素材已被独立修改。');
          latest[plan.rawId]=entry;
          edits.set(path,Buffer.from(JSON.stringify(latest,null,2)+'\n'));
          continue;
        }
        if (!sameLifecycleFile(existing,after) || (before && before.executable!==(existing?.executable ?? false)))
          fail('content_conflict','撤销涉及独立修改过的原稿或文件属性。');
        if (!before && path.startsWith('raw/') &&
            [...tree.inbound.get(path.slice(4)) ?? []].some(source=>!touched.has('raw/'+source)))
          fail('content_conflict','迁移后的附件已有新的原稿引用。');
        edits.set(path,before ? readFileSync(join(base,path)) : null);
      }
      return edits;
    })));
  }

  async function readArchive(plan) {
    const input={identity:library,id:plan.documentId,op_id:plan.archiveOp};
    const evidence=await rpc('raw-archive-evidence',input);
    if (!evidence.verified || evidence.id!==plan.documentId || evidence.signature!==plan.signature)
      fail('content_conflict','无法核实待删卡片的原归档回执。');
    return evidence;
  }

  async function preview(originalId) {
    // The site has one owner, with a new session identity after sign-in.
    const original=tasks.get(originalId);
    const change=queue.get(originalId);
    if (!original || change?.library!==library || change.action!=='purge' || change.cleanupHead ||
        !['pending','batched','needs-review'].includes(change.state) || original.progress.irreversible ||
        !['awaiting-export','running'].includes(original.state) || purge.committed(original) ||
        tasks.databaseCompensations(library).some(item=>item.plan.originalId===originalId && item.state!=='complete'))
      fail('operation_conflict','该待删项不能撤销。');
    const batch=change.batchId ? queue.batch(library,change.batchId) : null;
    const originalPlan=batch ? tasks.frozenDatabasePurge(originalId,batch.id) : null;
    const initial=batch ? tasks.databasePurgeContribution(originalId,batch.id)?.initial :
      {state:original.plan.archiveOp===null?'active':'archived',archiveOp:original.plan.archiveOp,signature:original.plan.signature};
    if (!initial?.signature || !['active','archived'].includes(initial.state) || (batch && !originalPlan))
      fail('operation_conflict','缺少确认删除前的原生证据。');
    const snapshot=await rpc('raw-database-card',{identity:library,id:change.documentId,includeArchived:true});
    const archiveOp=snapshot.archiveOp;
    if (snapshot.id!==change.documentId || (originalPlan && originalPlan.archiveOp!==archiveOp) ||
        (archiveOp!==(initial.archiveOp ?? 'db-card-'+originalId) && !isColdArchive(archiveOp,originalId)))
      fail('content_conflict','归档回执与原删除操作不一致。');
    let observed=batch ? git.status(batch.id,batch.parent) : {head:git.snapshot()};
    manual?.requireReversible(originalId,observed.head);
    if (batch?.candidate && !observed.commit &&
        git.restorePublishedCandidate(batch.id,batch.parent,batch.candidate,observed.head))
      observed=git.status(batch.id,batch.parent);
    if (batch && (observed.commit!==batch.candidate || !published.has(observed.state)))
      fail('content_conflict','先核实该批次的发布结果。');
    const plan={action:'compensate',library,originalId,documentId:change.documentId,rawId:change.rawId,
      initial:initial.state,signature:initial.signature,archiveOp,head:observed.head,
      batchId:batch?.id ?? null,parent:batch?.parent ?? null,candidate:batch?.candidate ?? null};
    const evidence=await readArchive(plan);
    if (evidence.revision!==change.revision) fail('content_conflict','线上归档已变化。');
    const files=[...inverse(plan,observed.head).keys()];
    return {plan:{...plan,revision:evidence.revision,paths:files},files,rawId:change.rawId};
  }

  async function restoreNative(id,plan) {
    if (plan.initial==='archived') return (await readArchive(plan)).revision;
    const restored=await rpc('raw-recover',{identity:library,id:plan.documentId,op_id:'db-compensate-'+id,
      backup_op_id:plan.archiveOp,expected_revision:plan.revision,expected_signature:plan.signature});
    if (restored.id!==plan.documentId || restored.deleted!==false)
      fail('operation_pending','撤销后的卡片尚未读回。');
    return restored.revision;
  }

  async function restoreColdNative(id,plan,snapshot) {
    if (snapshot.id!==plan.documentId || snapshot.signature!==plan.signature)
      fail('content_conflict','恢复副本中的卡片与撤销证据不符。');
    if (plan.initial==='active' && snapshot.archiveOp) {
      if (snapshot.archiveOp!==plan.archiveOp && !isColdArchive(snapshot.archiveOp,plan.originalId))
        fail('content_conflict','恢复副本包含另一次归档操作。');
      const evidence=await readArchive({...plan,archiveOp:snapshot.archiveOp});
      const restored=await rpc('raw-recover',{identity:library,id:plan.documentId,
        op_id:'db-compensate-cold-'+id+'-'+evidence.revision.slice(0,12),backup_op_id:snapshot.archiveOp,
        expected_revision:evidence.revision,expected_signature:plan.signature});
      if (restored.id!==plan.documentId || restored.deleted!==false)
        fail('operation_pending','恢复副本中已撤销的归档尚未解除。');
      return restored.revision;
    }
    if (plan.initial==='archived' && !snapshot.archiveOp) {
      const archived=await rpc('raw-archive',{identity:library,id:plan.documentId,
        op_id:'db-compensate-archive-'+id+'-'+snapshot.revision.slice(0,12),
        expected_revision:snapshot.revision,expected_signature:plan.signature});
      if (archived.id!==plan.documentId || !archived.deleted)
        fail('operation_pending','恢复副本中的归档尚未读回。');
      return archived.revision;
    }
    return snapshot.revision;
  }

  function verifyPublishedInverse(plan,attempt) {
    if (!attempt) return;
    let result=git.status(attempt.id,attempt.parent);
    if (!result.commit && git.restorePublishedCandidate(attempt.id,attempt.parent,attempt.commit,result.head))
      result=git.status(attempt.id,attempt.parent);
    if (result.commit!==attempt.commit || !published.has(result.state))
      fail('operation_pending','撤销提交尚未从主分支完整读回。');
    const catalogEntry=from=>JSON.parse(readFileSync(join(from,catalogPath),'utf8'))[plan.rawId] ?? null;
    const expectedCatalog=attempt.files.some(({path})=>path===catalogPath)
      ? git.inspect(attempt.commit,(_,tree)=>hash(canonical(catalogEntry(tree)))) : null;
    git.inspect(result.head,(rawRoot,tree)=>{
      loadRawTree(rawRoot,{references:true});
      for (const {path,after} of attempt.files) {
        const actual=lifecycleFileIdentity(tree,path);
        if (path===catalogPath && actual && after && expectedCatalog &&
            actual.executable===after.executable && hash(canonical(catalogEntry(tree)))===expectedCatalog) continue;
        if (!sameLifecycleFile(actual,after)) fail('content_conflict','撤销提交发布后原稿又有独立改动。');
      }
    });
  }

  async function run({id,plan,progress},{cold=false}={}) {
    if (manual && (plan.batchId || plan.paths.length || progress.attempt))
      fail('operation_conflict','旧删除补偿需要人工核对。');
    const save=changes=>{
      progress={...progress,...changes};
      tasks.update(id,'running',progress);
    };
    if (!progress.phase) {
      const checked=await inspectAuthorized(id,plan);
      if (checked.revision!==plan.revision) fail('content_conflict','线上归档在预览后变化。');
      save({phase:'ledger',minimumGeneration:shares.state(plan.documentId).generation+1});
    }
    if (progress.phase==='ledger') {
      const original=tasks.get(plan.originalId);
      try { await purge.cancel(original); }
      catch (error) {
        if (purge.committed(original)) return tasks.update(id,'cancelled',{stage:'deletion-committed'});
        throw error;
      }
      save({phase:'git'});
    }
    if (progress.phase==='git') {
      if (manual) {
        const head=git.snapshot();
        try { manual.requireReversible(plan.originalId,head); }
        catch (error) {
          const original=tasks.get(plan.originalId), pending=queue.pendingPurge(library,plan.rawId);
          // No inverse Git patch exists in manual mode. At this durable phase neither native
          // recovery nor share release has started. The original purge still owns both.
          if (error.code==='content_conflict' && original?.state==='awaiting-export' && original.plan.manualOriginal &&
              pending?.id===plan.originalId && pending.state==='pending' && !pending.cleanupHead && !progress.attempt &&
              !plan.batchId && !plan.paths.length)
            return tasks.update(id,'cancelled',{stage:'manual-original-changed',originalId:plan.originalId});
          throw error;
        }
      }
      let attempt=progress.attempt;
      if (!attempt && plan.paths.length) {
        const parent=git.snapshot();
        const edits=inverse(plan,parent);
        const files=git.inspect(parent,(_,tree)=>describeLifecyclePatch(tree,edits));
        attempt={id:randomUUID(),parent,files};
        save({attempt});
      }
      if (attempt) {
        let result=git.status(attempt.id,attempt.parent);
        if (!result.commit && attempt.commit &&
            (git.restorePublishedCandidate(attempt.id,attempt.parent,attempt.commit,result.head) ||
             git.restorePreparedCandidate(attempt.id,attempt.parent,attempt.commit,result.head)))
          result=git.status(attempt.id,attempt.parent);
        if (!result.commit && attempt.commit && (!attempt.sendStarted || result.head!==attempt.parent)) {
          inverse(plan,result.head);
          save({attempt:null});
          fail('operation_pending','旧撤销引用无法发布，将重新准备候选。');
        }
        if (result.state==='conflict' && (!attempt.commit || attempt.commit===result.commit)) {
          // The remote has moved off the exact lease and cannot accept that old attempt.
          inverse(plan,result.head);
          save({attempt:null});
          fail('operation_pending','撤销候选未发布，将在新主分支头部重新核对。');
        }
        if (attempt.commit && result.commit!==attempt.commit)
          fail('operation_pending','撤销候选无法核实。');
        if (result.state==='unstaged') {
          git.stage(attempt.id,attempt.parent,()=>inverse(plan,attempt.parent));
          result=git.status(attempt.id,attempt.parent);
        }
        if (!result.commit || !(result.state==='prepared' || published.has(result.state)))
          fail('content_conflict','撤销候选与最新原稿可能冲突。');
        git.inspect(result.commit,rawRoot=>loadRawTree(rawRoot,{references:true}));
        verifyLifecycleCandidate(git,{parent:attempt.parent,candidate:result.commit,filePlanVersion:1,
          filePlan:JSON.stringify(attempt.files)},result.commit);
        if (!attempt.commit) save({attempt:{...attempt,commit:result.commit}});
        if (result.state==='prepared') {
          if (!progress.attempt.sendStarted) save({attempt:{...progress.attempt,sendStarted:true}});
          result=git.publish(attempt.id,attempt.parent);
        }
        if (!published.has(result.state) || result.commit!==progress.attempt.commit)
          fail('operation_pending','撤销提交尚未完整读回。');
      }
      save({phase:'native'});
    }
    verifyPublishedInverse(plan,progress.attempt);
    if (cold) {
      const snapshot=await rpc('raw-database-card',{identity:library,id:plan.documentId,includeArchived:true});
      save({phase:'queue',revision:await restoreColdNative(id,plan,snapshot)});
    } else if (progress.phase==='native') save({phase:'queue',revision:await restoreNative(id,plan)});
    if (progress.phase==='queue') {
      queue.cancelPurge(plan.originalId,{...plan,revision:progress.revision});
      save({phase:'shares'});
    }
    if (!shares.releasePendingDeletion(plan.documentId,progress.minimumGeneration))
      fail('operation_conflict','卡片分享已获永久删除标记。');
    verifyPublishedInverse(plan,progress.attempt);
    return tasks.finishDatabaseCompensation(id,plan.originalId,{...progress,phase:'complete',stage:'deletion-compensated',
      shareGeneration:shares.state(plan.documentId).generation});
  }

  async function inspectAuthorized(id,plan) {
    const original=tasks.get(plan.originalId), change=queue.get(plan.originalId);
    if (change?.library!==library || change.documentId!==plan.documentId || change.batchId!==plan.batchId ||
        change.cleanupHead || !['pending','batched','needs-review'].includes(change.state) ||
        tasks.databaseCompensations(library).some(item=>item.id!==id && item.plan.originalId===plan.originalId && item.state!=='complete') ||
        original.progress.irreversible || purge.committed(original) || git.snapshot()!==plan.head)
      fail('content_conflict','删除状态或主分支在预览后变化。');
    manual?.requireReversible(plan.originalId,plan.head);
    inverse(plan,plan.head);
    return readArchive(plan);
  }

  async function verifyRecovery({reconcile=false}={}) {
    const attempts=tasks.databaseCompensations(library);
    // When Git needs review no native rollback has started; the purge fence still owns the target.
    if (attempts.some(task=>task.state!=='complete' &&
        (reconcile || task.state!=='needs-review' || task.progress.phase!=='git')))
      fail('operation_pending','删除撤销尚未读回。');
    const newest=new Map(attempts.filter(task=>task.state==='complete').map(task=>[task.plan.rawId,task]));
    const live=new Map(queue.liveCards(library).map(change=>[change.rawId,change]));
    for (const {id,plan,progress} of newest.values()) {
      if (queue.pendingPurge(library,plan.rawId) || shares.purged(plan.documentId)) continue;
      const present=await rpc('raw-purge-documents-present',{identity:library,documents:[plan.documentId]});
      if (present && !(live.get(plan.rawId)?.sequence>queue.get(plan.originalId)?.sequence)) {
        const snapshot=await rpc('raw-database-card',{identity:library,id:plan.documentId,includeArchived:true});
        const revertedArchive=plan.initial==='active' && (snapshot.archiveOp===plan.archiveOp ||
          isColdArchive(snapshot.archiveOp,plan.originalId));
        if (revertedArchive || (plan.initial==='archived' && !snapshot.archiveOp)) {
          if (!reconcile) fail('operation_pending','恢复副本尚未重放已撤销的归档状态。');
          queue.refreshCompensatedRevision(plan.originalId,await restoreColdNative(id,plan,snapshot));
        }
      }
      if (reconcile) {
        if (!shares.releasePendingDeletion(plan.documentId,progress.shareGeneration))
          fail('operation_conflict','恢复副本出现意外的永久删除标记。');
      } else if (shares.fencedForDeletion(plan.documentId) || shares.state(plan.documentId).generation<progress.shareGeneration) {
        fail('operation_pending','恢复副本尚有已撤销的分享暂停状态。');
      }
    }
  }

  async function reconcileRecovery() {
    for (const task of tasks.databaseCompensations(library)) {
      if (task.state==='complete') continue;
      tasks.update(task.id,'running',task.progress);
      await run(tasks.get(task.id),{cold:true});
    }
    await verifyRecovery({reconcile:true});
  }

  return {preview,run,verifyRecovery,reconcileRecovery};
}
