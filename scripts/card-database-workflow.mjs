import { createDatabaseCardWorker } from './card-database-worker.mjs';
import { createDatabaseCardExport } from './card-database-export.mjs';
import { createDatabasePurgeExport,verifyDatabasePurgeVisibility } from './card-database-purge.mjs';
import { runCardExportBatch } from './card-export-batch.mjs';
import { listRawArchives,readPendingRawSync } from './raw-sync.mjs';
import { createDatabaseRawRecovery } from './card-database-raw-recovery.mjs';
import { createDatabaseCompensation } from './card-database-compensation.mjs';
import { createManualOriginals } from './card-manual-originals.mjs';
import { fail } from '../lib/siyuan.mjs';

const transient = new Set(['git_pending','ledger_pending','operation_pending','export_unavailable']);

/** Drive the database-first source and its separate scheduled Git outbox. */
export function createDatabaseWorkflow({tasks,legacyTasks,queue,stateDir,library,rpc,shares,git,purge,origin,
  manualOriginals=true,monotonicNow=()=>performance.now()}) {
  const manual=manualOriginals ? createManualOriginals({tasks,queue,stateDir,library,rpc,git,purge,monotonicNow}) : null;
  if (manual) queue.enableManualOriginals();
  const purgeExport=createDatabasePurgeExport({tasks,git,purge,rpc});
  const exportOptions=createDatabaseCardExport({queue,git,stateDir,library,rpc,origin,
    ...purgeExport});
  async function inspectPublished(batchId) {
    const batch=queue.activeBatch(library);
    if (batch?.id!==batchId || batch.state!=='blocked' || !batch.candidate || !batch.sendStarted)
      fail('content_conflict','当前批次没有可重新预览的发布结果。');
    const result=git.status(batch.id,batch.parent);
    if (result.commit!==batch.candidate || !['published','published-conflict'].includes(result.state))
      fail('content_conflict','原稿状态已变化，可先重新核对批次。');
    const purges=batch.changes.filter(change=>change.action==='purge' && !change.cleanupHead);
    if (!purges.length) fail('content_conflict','没有据此重新确认的待清理卡片。');
    const files=new Set();
    for (const change of purges)
      for (const path of await purgeExport.reviewPublishedPurge(change,batch,result.head)) files.add(path);
    if (git.snapshot()!==result.head) fail('content_conflict','重新预览期间主分支已前进。');
    return {rawId:purges[0].rawId,files:[...files].sort(),plan:{batchId,candidate:batch.candidate,head:result.head}};
  }
  const review={
    preview:inspectPublished,
    async confirm({batchId,candidate,head}) {
      const batch=queue.batch(library,batchId);
      if (batch?.candidate===candidate && batch.reviewedHead===head) return;
      const current=await inspectPublished(batchId);
      if (current.plan.candidate!==candidate || current.plan.head!==head)
        fail('content_conflict','主分支在预览后已变化，请重新核对。');
      queue.approvePublishedHead(batchId,candidate,head);
    },
  };
  const compensation=createDatabaseCompensation({tasks,queue,git,purge,rpc,shares,library,manual});
  const worker=createDatabaseCardWorker({tasks,queue,stateDir,library,rpc,shares,review,compensation,manual,
    restoreOriginal:createDatabaseRawRecovery({tasks,queue,git,stateDir,library,rpc}),
    async legacyArchives() {
      const head=git.observedHead();
      const entries=head ? await git.inspect(head,rawRoot=>listRawArchives({rawRoot,stateDir,rpc})) : [];
      return {head,entries};
    }});
  const pendingScope={tasks,queue,stateDir,library,rpc,shares};
  const target = id=>tasks.get(id) ? tasks : legacyTasks;
  const recoveryTasks={
    get:id=>target(id).get(id),
    update:(id,state,progress)=>target(id).update(id,state,progress),
    invalidateRestorePreviews(libraryId,rawId) {
      tasks.invalidateRestorePreviews(libraryId,rawId);
      legacyTasks.invalidateRestorePreviews(libraryId,rawId);
    },
  };
  let nextRetry=0, nextRawReview=0, nextCompensationReview=0;
  const pendingCompensations=()=>tasks.databaseCompensations(library).filter(task=>task.state!=='complete');
  async function verifyRecovery(verifyPurge) {
    await verifyPurge(recoveryTasks,{allowUnsent:true});
    await compensation.verifyRecovery();
    await verifyDatabasePurgeVisibility(pendingScope);
    const pending=readPendingRawSync(stateDir,library);
    const recovering=tasks.rawRecoveryTasks(library);
    if (pending && !recovering.some(task=>task.progress.syncPlan===pending.id))
      fail('operation_pending','存在尚未核实的原稿恢复。');
    for (const task of recovering) {
      const evidence=await rpc('raw-created-card-evidence',{identity:library,rawId:task.plan.rawId,...task.progress.creation});
      if (evidence.state!=='unstarted') fail('operation_pending','原稿恢复已开始，等待完整读回后开放。');
    }
  }
  const workflow={
    worker,
    databaseWriteOnly(plan) {
      return Boolean(manual && plan && !plan.rawBase && (['create','edit','archive','restore'].includes(plan.action) ||
        (plan.action==='purge' && plan.manualOriginal)));
    },
    pollManualOriginals:options=>manual && manual.poll(options),
    maySettlePurge:()=>Boolean(manual && manual.ready().length) || queue.maySettlePurge(library),
    hasExport() {
      if (pendingCompensations().length) return false;
      if (manual && manual.ready().length && monotonicNow()>=nextRetry) return true;
      const batch=queue.activeBatch(library);
      if (!batch) return queue.hasDue(library);
      const possibleCommittedPurge=batch.changes.some(change=>{
        if (change.action!=='purge') return false;
        const task=tasks.get(change.id);
        return ['running','complete'].includes(task?.state) && task.progress.commit===batch.candidate;
      });
      return batch.state==='running' || ((transient.has(batch.errorCode) || possibleCommittedPurge) && monotonicNow()>=nextRetry);
    },
    resumeBatch(id,rawId) {
      if (rawId) {
        queue.requeueReviewed(library,rawId);
        return worker.syncStatus();
      }
      const active=queue.activeBatch(library);
      if (active?.id!==id) fail('not_found','找不到当前需核对的批次。');
      if (active.state==='blocked') queue.resume(id);
      return worker.syncStatus();
    },
    acceptanceHasWork(rawIds) {
      if (queue.activeBatch(library) || manual?.ready({rawIds,acceptance:true}).length) return true;
      return queue.outstanding(library,rawIds).some(change=>!queue.pendingPurge(library,change.rawId));
    },
    async exportOnce({acceptanceRawIds,poll=true}={}) {
      if (pendingCompensations().length) fail('operation_pending','先完成已确认的删除撤销。');
      const batch=queue.activeBatch(library);
      if (batch && acceptanceRawIds && JSON.stringify(batch.scope)!==JSON.stringify([...new Set(acceptanceRawIds)].sort()))
        fail('operation_pending','先结算现有批次。');
      if (manual && acceptanceRawIds && (!Array.isArray(acceptanceRawIds) || !acceptanceRawIds.length ||
          acceptanceRawIds.length>8 || acceptanceRawIds.some(rawId=>!queue.createdInDatabase(library,rawId))))
        fail('outside_scope','验收只能处理本库创建并读回的合成卡。');
      if (manual && poll) await manual.poll({ids:acceptanceRawIds,force:true});
      if (manual && acceptanceRawIds && !workflow.acceptanceHasWork(acceptanceRawIds)) return null;
      const cleanup=manual && await manual.settleReady({rawIds:acceptanceRawIds,acceptance:Boolean(acceptanceRawIds)});
      if (batch?.state==='blocked') queue.resume(batch.id);
      const result=await runCardExportBatch({...exportOptions,manualOriginals:Boolean(manual),tasks,purge},{acceptanceRawIds}) || cleanup || null;
      if (result?.state==='blocked' || cleanup?.state==='blocked') nextRetry=monotonicNow()+60000;
      return result;
    },
    async runScheduledExport() {
      return workflow.hasExport() ? workflow.exportOnce({poll:false}) : null;
    },
    async resumeInterruptedOriginal(beforeWrite=()=>{}) {
      const compensating=pendingCompensations().find(task=>task.state==='needs-review');
      if (compensating) {
        if (monotonicNow()<nextCompensationReview) return null;
        nextCompensationReview=monotonicNow()+60000;
        beforeWrite();
        return worker.resumeCompensation(compensating);
      }
      const pending=readPendingRawSync(stateDir,library);
      const interrupted=tasks.rawRecoveryTasks(library).filter(task=>task.state==='needs-review' &&
        Array.isArray(task.progress.originalPaths) && (!pending || task.progress.syncPlan===pending.id));
      if (!interrupted.length || performance.now()<nextRawReview) return null;
      nextRawReview=performance.now()+60000;
      const head=git.snapshot();
      const task=interrupted.find(task=>git.pathsUnchanged(task.plan.rawBase,head,task.progress.originalPaths));
      if (!task) return null;
      beforeWrite();
      return worker.resumeOriginal(task);
    },
    verifyRecovery:()=>verifyRecovery(purge.verifyRecovery),
    verifyReadiness:()=>verifyRecovery(purge.verifyReadiness),
    async reconcileRecovery() {
      await compensation.reconcileRecovery();
      await verifyDatabasePurgeVisibility(pendingScope,{reconcile:true});
      await purge.reconcileRecovery(recoveryTasks,{allowUnsent:true});
    },
  };
  return workflow;
}
