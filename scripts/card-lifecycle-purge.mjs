import { join, posix } from 'node:path';
import { canonical, fail, hash } from '../lib/siyuan.mjs';
import { archiveRawCard, baseline, findBoundRawCard, inspectPurgeBindings, listRawArchives, purgeRawBindings,
  verifyPurgeBindings } from './raw-sync.mjs';
import { inspectShareMaterials, removeRuntimeShareMaterials, stageShareRemoval } from './card-lifecycle-materials.mjs';
import { loadRawTree } from '../lib/raw-format.mjs';

const fingerprint = value => hash(canonical(value));

/** The worker owns the instance lock while assessing and executing a purge. */
export function createCardLifecyclePurge({git, ledger, stateDir, rpc, shares, materialsRoot,removeUnpublishedCopies}) {
  const gitReadback={ledger:ledger.readySnapshot,main:git.snapshot};
  const readiness={ledger:ledger.readReadySnapshot,main:git.readSnapshot};
  function checkOriginalsRemoved(head,plans) {
    git.inspect(head,(rawRoot,tree)=>{
      const originals = loadRawTree(rawRoot);
      const manifest = originals.files.get('.sync.json');
      const bindings = manifest ? baseline(JSON.parse(manifest)) : {};
      const paths = [...originals.files.keys(),...Object.keys(bindings.readings ?? {}),...Object.keys(bindings.assets ?? {})];
      for (const {rawId,sourcePath} of plans) {
        const prefix = sourcePath ? posix.dirname(sourcePath)+'/' : null;
        if (originals.byId.has(rawId) || Object.hasOwn(bindings.cards ?? {},rawId) ||
            (prefix && paths.some(path=>path.startsWith(prefix))))
          fail('content_conflict','当前主分支重新出现目标原稿或绑定。');
        const material = inspectShareMaterials(join(tree,'server/share-materials'),rawId).fingerprint;
        if (material.entry || material.cover) fail('content_conflict','当前主分支重新出现目标分享素材。');
      }
    });
  }
  async function capture(plan, patch) {
    if (plan.databaseFirst && !removeUnpublishedCopies)
      fail('outside_scope','尚未配置待发布原稿副本的清理方式。');
    const input = {identity:plan.library, rawId:plan.rawId,id:plan.evidence.id,archiveOp:plan.archiveOp,expectedRevision:plan.evidence.revision};
    const {native} = await rpc('raw-inspect-purge',input);
    const bindings = inspectPurgeBindings({stateDir,identity:plan.library,rawId:plan.rawId,
      ids:native.documents.map(doc=>doc.id),patch,sourcePath:plan.sourcePath,databaseOnly:plan.databaseFirst===true});
    const inspected = await rpc('raw-inspect-purge',{...input,bindings});
    if (fingerprint(native) !== fingerprint(inspected.native)) fail('content_conflict','线上清单在预览期间变化。');
    const gitMaterials = git.inspect(plan.base,(_,tree)=>inspectShareMaterials(join(tree,'server/share-materials'),plan.rawId).fingerprint);
    const runtimeMaterials = inspectShareMaterials(materialsRoot,plan.rawId).fingerprint;
    return {native,bindings,copies:inspected.copies,gitMaterials,runtimeMaterials};
  }
  async function recoveryContext(tasks,options,refs,reconcile=false) {
    const {head:ledgerHead,decisions} = await refs.ledger(options);
    const records = [...decisions.values()].map(record=>record.decision).filter(decision=>decision.outcome !== 'cancelled');
    if (!records.length) return {ledgerHead,entries:[]};
    const identity = await rpc('raw-target');
    const main = await refs.main();
    const entries = records.map(decision=>{
      const task = tasks.get(decision.opId);
      const plan = task?.plan;
      if (decision.library !== identity || (task?.state !== 'complete' && (!reconcile || task?.state !== 'running')) ||
          plan?.action !== 'purge' || fingerprint(plan) !== decision.previewDigest || task.progress.commit !== decision.mainCommit)
        fail('operation_pending','控制账本或线上删除读回尚未核实。');
      return {decision,plan,task};
    });
    checkOriginalsRemoved(main,entries.map(entry=>entry.plan).filter(plan=>!reconcile || !plan.databaseFirst));
    return {ledgerHead,identity,entries,main};
  }
  async function clearOnline(decision,plan) {
    const {deletion} = plan;
    const shareResult = shares.purge(plan.evidence.id);
    if (!shareResult?.unpublished || !shareResult.checkpointed) fail('operation_pending','分享副本尚未完成读回。');
    removeRuntimeShareMaterials(materialsRoot,plan.rawId,deletion.runtimeMaterials);
    const {opId,previewDigest,mainCommit} = decision;
    await rpc('raw-remove-purge',{identity:plan.library,native:deletion.native,copies:deletion.copies,
      operation:{opId,previewDigest,mainCommit},decision});
    await purgeRawBindings({stateDir,identity:plan.library,rawId:plan.rawId,frozen:deletion.bindings});
    if (!await rpc('raw-verify-purge',{identity:plan.library,native:deletion.native,copies:deletion.copies}))
      fail('operation_pending','线上副本仍在清理或核对。');
    if (plan.databaseFirst) await removeUnpublishedCopies(plan,decision);
  }
  async function verifyRecovery(tasks,options,refs) {
    const {ledgerHead,identity,entries,main} = await recoveryContext(tasks,options,refs);
    for (const {decision,plan} of entries) {
      const materials = inspectShareMaterials(materialsRoot,decision.rawId).fingerprint;
      const bindings = verifyPurgeBindings({stateDir,identity,rawId:decision.rawId,frozen:plan.deletion.bindings});
      if (!shares.purged(plan.evidence.id) || materials.entry || materials.cover)
        fail('operation_pending','恢复的知识库中仍有待清理的分享状态。');
      if (!bindings) fail('operation_pending','恢复的知识库中仍有待清理的同步绑定。');
      if (!await rpc('raw-verify-purge',{identity,native:plan.deletion.native,copies:plan.deletion.copies}))
        fail('operation_pending','恢复的知识库中仍有待清理的思源文件、历史或回执。');
    }
    if ((await refs.ledger(options)).head !== ledgerHead) fail('operation_pending','核对期间权威账本已变化。');
    if (main && await refs.main() !== main) fail('operation_pending','核对期间原稿分支已变化。');
    return {ledgerHead};
  }
  function committed(task) {
    const decision = ledger.snapshot().decisions.get(task.id)?.decision;
    if (!decision || decision.outcome === 'cancelled') return null;
    if (decision.previewDigest !== fingerprint(task.plan) || decision.mainCommit !== task.progress.commit ||
        decision.library !== task.plan.library || decision.rawId !== task.plan.rawId)
      fail('operation_conflict','权威记录与原任务预览不符。');
    return decision;
  }
  async function finish(task, decision) {
    if (!task.plan.databaseFirst) checkOriginalsRemoved(git.snapshot(),[task.plan]);
    await clearOnline(decision,task.plan);
    checkOriginalsRemoved(git.snapshot(),[task.plan]);
    ledger.complete(task.id);
  }
  async function restoreCopies(decision,plan) {
    const {library:identity,rawId} = plan, id = plan.evidence.id;
    const rawKey = findBoundRawCard(stateDir,identity,id);
    if (rawKey && rawKey !== rawId) fail('content_conflict','恢复副本中的绑定与权威删除记录不同。');
    const obsolete = plan.deletion;
    const runtimeMaterials = inspectShareMaterials(materialsRoot,rawId).fingerprint;
    if (!rawKey && !plan.databaseFirst) return { ...obsolete, runtimeMaterials };
    if (await rpc('raw-purge-documents-present',{identity,documents:decision.documents}) === false)
      return { ...obsolete, runtimeMaterials };
    const archivedEntry = () => git.inspect(git.snapshot(),async rawRoot=>
      (await listRawArchives({rawRoot,stateDir,rpc})).find(entry=>entry.rawId === rawId));
    let record;
    if (plan.databaseFirst) {
      const current=await rpc('raw-database-card',{identity,id,includeArchived:true});
      if (current.id!==id || (!rawKey && current.rawId!==rawId))
        fail('content_conflict','恢复副本的原生文档身份与删除决定不符。');
      const archiveOp=current.archiveOp ?? decision.opId+'-cold-'+current.revision.slice(0,12);
      if (!current.archiveOp) await rpc('raw-archive',{identity,id,op_id:archiveOp,
        expected_revision:current.revision,expected_signature:current.signature});
      const evidence=await rpc('raw-archive-evidence',{identity,id,op_id:archiveOp});
      if (evidence.verified) record={documentId:id,archiveOp,revision:evidence.revision};
    } else {
      record=await archivedEntry();
    }
    if (!record && !plan.databaseFirst) {
      // The proxy remains closed. An older image may predate the archive.
      const active = await rpc('raw-active-card-evidence',{identity,id});
      await archiveRawCard({stateDir,rpc,rawId,expected:{...active,operationId:decision.opId+'-cold-'+active.revision.slice(0,12)}});
      record = await archivedEntry();
    }
    if (!record?.archiveOp || record.documentId !== id) fail('content_conflict','无法核实恢复副本中的归档卡。');
    const input = {identity,rawId,id,archiveOp:record.archiveOp,expectedRevision:record.revision};
    const {native} = await rpc('raw-inspect-purge',input);
    const ids = native.documents.map(doc=>doc.id);
    if (fingerprint([...ids].sort()) !== fingerprint([...decision.documents].sort()))
      fail('content_conflict','恢复副本的补读清单与权威记录不同。');
    const emptyPatch = {edits:new Map(),moves:new Map(),rawMissing:true};
    const historical = inspectPurgeBindings({stateDir,identity,rawId,ids,patch:emptyPatch,sourcePath:plan.sourcePath,
      databaseOnly:plan.databaseFirst===true});
    const moves = obsolete.bindings.assets.filter(asset=>asset.nextPath &&
      historical.assets.some(old=>old.path === asset.path && fingerprint(old.binding) === fingerprint(asset.binding)));
    const bindings = inspectPurgeBindings({stateDir,identity,rawId,ids,
      patch:{...emptyPatch,moves:new Map(moves.map(asset=>[asset.path,asset.nextPath]))},sourcePath:plan.sourcePath,
      databaseOnly:plan.databaseFirst===true});
    const actual = await rpc('raw-inspect-purge',{...input,bindings});
    if (fingerprint(actual.native) !== fingerprint(native)) fail('content_conflict','恢复副本清点期间文档发生变化。');
    return {...obsolete,native,bindings,copies:actual.copies,runtimeMaterials};
  }
  return {
    verifyRecovery:(tasks,options)=>verifyRecovery(tasks,options,gitReadback),
    verifyReadiness:(tasks,options)=>verifyRecovery(tasks,options,readiness),
    verifyOriginalsRemoved:(head,plan)=>checkOriginalsRemoved(head,[plan]),
    committed, finish,
    async cancel(task) {
      if (committed(task)) fail('operation_conflict','不可逆删除已获确认，不能撤销。');
      if (!ledger.pending().some(pending=>pending.opId === task.id)) return;
      const result = await ledger.cancelPrepared(task.id);
      if (result.state !== 'cancelled') fail('operation_conflict','不可逆决定已经先行提交，不能撤销。');
      ledger.complete(task.id);
    },
    async reconcileRecovery(tasks,options) {
      const {entries} = await recoveryContext(tasks,options,{ledger:ledger.recoverySnapshot,main:git.snapshot},true);
      for (const {decision,plan,task} of entries) {
        const deletion = await restoreCopies(decision,plan);
        await clearOnline(decision,{...plan,deletion});
        if (plan.databaseFirst) checkOriginalsRemoved(git.snapshot(),[plan]);
        tasks.invalidateRestorePreviews(plan.library,plan.rawId);
        ledger.complete(decision.opId);
        if (task.state === 'running') tasks.update(task.id,'complete',{stage:'readback',commit:decision.mainCommit});
      }
      return verifyRecovery(tasks,options,gitReadback);
    },
    async preview(plan, patch) {
      if (!plan.evidence || !plan.archiveOp) return {blockers:[{reason:'verified_archive_required'}]};
      try {
        const deletion = await capture(plan,patch);
        return {
          blockers:[], deletion,
          files:[...(deletion.gitMaterials.entry ? ['server/share-materials/catalog.json'] : []),
            ...(deletion.gitMaterials.cover ? ['server/share-materials/covers/' + plan.rawId + '.png'] : [])],
        };
      } catch (error) {
        if (!/conflict|scope|pending/.test(error.code ?? '')) throw error;
        return {blockers:[{reason:error.code,message:error.message}]};
      }
    },
    stage(tree,plan) { return stageShareRemoval(tree,plan.rawId,plan.deletion.gitMaterials); },
    async recheck(plan, patch) {
      if (fingerprint(await capture(plan,patch)) !== fingerprint(plan.deletion))
        fail('content_conflict','删除清单在确认后已变化。');
    },
    async apply(task, commit, recheckInputs, markIrreversible, recheckPublished) {
      const {id,plan} = task;
      const {deletion} = plan;
      checkOriginalsRemoved(git.snapshot(),[plan]);
      const operation = {opId:id,previewDigest:fingerprint(plan),mainCommit:commit};
      const decision = {version:1,...operation,library:plan.library,rawId:plan.rawId,
        documents:deletion.native.documents.map(doc=>doc.id)};
      const prepared = ledger.prepare(decision);
      const confirmed = prepared.state === 'prepared' ? await ledger.publish(id,async () => {
        if (plan.databaseFirst) checkOriginalsRemoved(git.snapshot(),[plan]);
        else git.assertRawUnchanged(commit);
        const originalPatch = await recheckInputs();
        // The live bindings and all copy identities are frozen at confirmation.
        const current = await capture(plan,originalPatch);
        if (fingerprint(current) !== fingerprint(deletion)) fail('content_conflict','删除清单在确认后已变化。');
        if (recheckPublished) checkOriginalsRemoved(recheckPublished(),[plan]);
        else git.assertRawUnchanged(commit);
      }) : prepared;
      if (confirmed.state !== 'committed') fail('operation_conflict','永久删除未获权威账本确认。');
      markIrreversible();
      await finish(task,confirmed.decision);
    },
  };
}
