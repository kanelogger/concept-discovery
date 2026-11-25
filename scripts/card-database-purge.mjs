import { planCardRawChange } from './raw-lifecycle-plan.mjs';
import { describeLifecyclePatch,lifecycleFileIdentity,sameLifecycleFile,verifyLifecycleCandidate } from './card-lifecycle-git.mjs';
import { loadRawTree } from '../lib/raw-format.mjs';
import { findBoundRawCard } from './raw-sync.mjs';
import { fail } from '../lib/siyuan.mjs';

/** An already hidden card can be cleared only by its eligible export batch. */
export function createDatabasePurgeExport({tasks,git,purge,rpc}) {
  function patch(rawRoot,plan) {
    const result=planCardRawChange({rawRoot,action:'purge',rawId:plan.rawId,
      sourcePath:plan.sourcePath,documentIds:[plan.evidence.id]});
    if (result.blockers.length) fail('content_conflict','待删卡的原稿、引用或共享附件需要核对。');
    return result;
  }
  function editsFor(tree,plan,changes) {
    return new Map([...changes.edits].map(([path,bytes])=>['raw/'+path,bytes]).concat([...purge.stage(tree,plan)]));
  }
  function verifyCandidate(batch,commit) {
    const purges=batch.changes.filter(change=>change.action==='purge');
    if (!purges.length) return;
    if (commit!==batch.candidate) fail('operation_conflict','删除补丁证据未绑定到当前批次候选。');
    verifyLifecycleCandidate(git,batch,commit);
    const {files,writes}=git.inspect(batch.parent,(rawRoot,tree)=>{
      const files=new Map();
      for (const change of purges) {
        const plan=tasks.frozenDatabasePurge(change.id,batch.id);
        if (!plan || plan.base!==batch.parent || plan.rawId!==change.rawId || plan.evidence.id!==change.documentId)
          fail('operation_conflict','删除清单与该批次成员不一致。');
        const stored=tasks.databasePurgeContribution(change.id,batch.id);
        const contribution=stored?.files ?? describeLifecyclePatch(tree,editsFor(tree,plan,patch(rawRoot,plan)));
        for (const entry of contribution) {
          if (files.has(entry.path) || !sameLifecycleFile(lifecycleFileIdentity(tree,entry.path),entry.before))
            fail('content_conflict','删除补丁归属或父提交文件不一致。');
          files.set(entry.path,entry.after);
        }
      }
      const originals=loadRawTree(rawRoot);
      const newest=new Map(batch.changes.map(change=>[change.rawId,change]));
      const writes=new Map();
      for (const change of newest.values()) {
        if (change.action==='purge') continue;
        const path=originals.byId.get(change.rawId)?.path ?? change.path;
        if (path) writes.set('raw/'+path,lifecycleFileIdentity(tree,'raw/'+path));
      }
      return {files,writes};
    });
    git.inspect(commit,(_,tree)=>{
      for (const [path,expected] of files) {
        if (!sameLifecycleFile(lifecycleFileIdentity(tree,path),expected))
          fail('content_conflict','删除候选的原稿或附件与冻结补丁不一致。');
      }
      for (const path of git.changedPaths(batch.parent,commit)) {
        if (files.has(path) || batch.compensatedPaths.includes(path)) continue;
        const actual=writes.has(path) && lifecycleFileIdentity(tree,path);
        if (!actual || actual.executable!==(writes.get(path)?.executable ?? false))
          fail('content_conflict','删除候选涉及未冻结的文件或类型变化。');
      }
    });
  }
  async function collectPurge(change,{rawRoot,tree,batch}) {
    const snapshot=await rpc('raw-database-card',{identity:change.library,id:change.documentId,includeArchived:true});
    if (snapshot.id!==change.documentId || snapshot.revision!==change.revision || !snapshot.archiveOp)
      fail('content_conflict','待删卡片的原生版本或归档状态已变化。');
    const evidence=await rpc('raw-archive-evidence',{identity:change.library,id:snapshot.id,op_id:snapshot.archiveOp});
    if (!evidence.verified || evidence.revision!==snapshot.revision || evidence.signature!==snapshot.signature)
      fail('content_conflict','无法核实待删卡片的归档回执。');
    const plan={action:'purge',library:change.library,rawId:change.rawId,sourcePath:change.path,
      databaseFirst:true,base:batch.parent,archiveOp:snapshot.archiveOp,
      evidence:{id:evidence.id,revision:evidence.revision,signature:evidence.signature}};
    const changes=patch(rawRoot,plan);
    const assessment=await purge.preview(plan,changes);
    if (assessment.blockers.length) fail('content_conflict','线上删除范围需要核对。');
    plan.deletion=assessment.deletion;
    const edits=editsFor(tree,plan,changes);
    tasks.freezeDatabasePurge(change.id,batch.id,plan,describeLifecyclePatch(tree,edits));
    return edits;
  }
  async function settlePurge(change,batch,commit) {
    if (await continueCommittedPurge(change,commit)) return;
    verifyCandidate(batch,commit);
    const frozen=tasks.frozenDatabasePurge(change.id,batch.id);
    if (!frozen) fail('operation_pending','缺少待删卡片的冻结清单。');
    const affected=await git.inspect(frozen.base,(rawRoot,tree)=>{
      const original=patch(rawRoot,frozen);
      return [...new Set([...original.edits.keys(),...original.moves.values()])].map(path=>'raw/'+path)
        .concat([...purge.stage(tree,frozen).keys()]);
    });
    const checkPublishedScope=()=>{
      const head=git.snapshot();
      if (!git.pathsUnchanged(commit,head,affected) && head!==batch.reviewedHead)
        fail('content_conflict','Git 上的删除或共享附件范围出现后续修改。');
      return head;
    };
    checkPublishedScope();
    const task=tasks.beginDatabasePurge(change.id,batch.id,commit);
    const {plan}=task;
    if (task.state==='complete') return;
    await purge.apply(task,commit,()=>git.inspect(plan.base,rawRoot=>patch(rawRoot,plan)),()=>{
      tasks.update(task.id,'running',{stage:'database-purge-cleanup',commit,irreversible:true});
    },checkPublishedScope);
    tasks.update(task.id,'complete',{stage:'readback',commit});
  }
  async function reviewPublishedPurge(change,batch,head) {
    const frozen=tasks.frozenDatabasePurge(change.id,batch.id);
    if (!frozen) fail('content_conflict','缺少已发布删除的冻结范围。');
    const prior=tasks.get(change.id);
    if (prior?.progress.irreversible || (prior?.state==='running' && purge.committed(prior)))
      fail('operation_conflict','权威决定已提交，按原操作继续清理。');
    verifyCandidate(batch,batch.candidate);
    const expected=await git.inspect(frozen.base,async(rawRoot,tree)=>{
      const original=patch(rawRoot,frozen);
      await purge.recheck(frozen,original);
      const {files}=loadRawTree(rawRoot);
      return {
        paths:[...original.edits.keys()].map(path=>'raw/'+path).concat([...purge.stage(tree,frozen).keys()]),
        moves:[...original.moves].map(([from,to])=>[to,files.get(from)]),
      };
    });
    purge.verifyOriginalsRemoved(head,frozen);
    git.inspect(head,rawRoot=>{
      const current=patch(rawRoot,frozen);
      if (current.edits.size) fail('content_conflict','主分支仍有目标索引或绑定，请先核对原稿。');
      const {files}=loadRawTree(rawRoot,{references:true});
      if (expected.moves.some(([to,bytes])=>!files.has(to) || !bytes?.equals(files.get(to))))
        fail('content_conflict','已迁移的共享附件发生变化，请先保留并核实附件。');
    });
    return expected.paths;
  }
  async function verifyPurgeBeforePush(batch) {
    verifyCandidate(batch,batch.candidate);
    for (const change of batch.changes.filter(item=>item.action==='purge')) {
      const plan=tasks.frozenDatabasePurge(change.id,batch.id);
      if (!plan) fail('operation_pending','缺少待删卡片的冻结清单。');
      await git.inspect(plan.base,rawRoot=>purge.recheck(plan,patch(rawRoot,plan)));
    }
  }
  function verifyPublishedPurges(batch,head) {
    for (const change of batch.changes.filter(item=>item.action==='purge')) {
      const plan=tasks.frozenDatabasePurge(change.id,batch.id);
      if (!plan) fail('operation_pending','缺少已清理卡片的冻结清单。');
      purge.verifyOriginalsRemoved(head,plan);
    }
  }
  async function continueCommittedPurge(change,commit) {
    const task=tasks.get(change.id);
    if (!task || !['running','complete'].includes(task.state) || task.progress.commit!==commit) return false;
    const decision=purge.committed(task);
    if (!decision) return false;
    await purge.finish(task,decision);
    if (task.state!=='complete') tasks.update(task.id,'complete',{stage:'readback',commit});
    return true;
  }
  return {collectPurge,settlePurge,verifyPurgeBeforePush,verifyPublishedPurges,reviewPublishedPurge};
}

/** Restore the durable pending-delete fence before re-opening a cold copy. */
export async function verifyDatabasePurgeVisibility({tasks,queue,stateDir,library,rpc,shares},{reconcile=false}={}) {
  for (const {id,plan} of tasks.pendingDatabasePurges()) {
    const pending=queue.pendingPurge(library,plan.rawId);
    // A confirmation interrupted before its version check is not a deletion
    // decision. The source worker may retry it, but recovery cannot hide it.
    if (pending?.id!==id) continue;
    const documentId=plan.documentId ?? plan.evidence?.id;
    if (library!==plan.library || !documentId) fail('outside_scope','待删操作属于其他知识库。');
    const present=await rpc('raw-purge-documents-present',{identity:library,documents:[documentId]});
    const snapshot=present===false ? null : await rpc('raw-database-card',{identity:library,id:documentId,includeArchived:true});
    const rawId=snapshot ? findBoundRawCard(stateDir,library,documentId) ?? snapshot.rawId : plan.rawId;
    if (snapshot && (snapshot.id!==documentId || rawId!==plan.rawId))
      fail('content_conflict','恢复副本的待删目标身份不符。');
    if (reconcile) shares.suspendForDeletion(documentId);
    if (!shares.fencedForDeletion(documentId)) fail('operation_pending','待删卡片的分享暂停状态尚未核实。');
    if (!snapshot) continue;
    let archiveOp=snapshot.archiveOp;
    if (!archiveOp) {
      if (!reconcile) fail('operation_pending','待删卡片尚未隐藏。');
      archiveOp='db-pending-cold-'+id+'-'+snapshot.revision.slice(0,12);
      const archived=await rpc('raw-archive',{identity:library,id:documentId,op_id:archiveOp,
        expected_revision:snapshot.revision,expected_signature:snapshot.signature});
      if (!archived.deleted || archived.id!==documentId) fail('operation_pending','待删卡片隐藏尚未读回。');
    }
    const intent=reconcile && queue.get(id);
    if (intent?.state==='pending') {
      const evidence=await rpc('raw-archive-evidence',{identity:library,id:documentId,op_id:archiveOp});
      if (evidence.verified && evidence.signature===plan.signature && evidence.revision!==intent.revision)
        queue.refreshPendingPurge(id,{documentId,previousRevision:intent.revision,revision:evidence.revision});
    }
  }
}
