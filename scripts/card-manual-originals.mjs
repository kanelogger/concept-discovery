import { canonical,fail,hash } from '../lib/siyuan.mjs';
import { loadRawFiles,loadRawTree } from '../lib/raw-format.mjs';
import { lifecycleFileIdentity,sameLifecycleFile } from './card-lifecycle-git.mjs';
import { listBoundRawCards } from './raw-sync.mjs';
import { isOriginalCatalogue,planManualOriginal } from './manual-original-plan.mjs';
import { planCardRawChange } from './raw-lifecycle-plan.mjs';

const conflict=message=>fail('content_conflict',message);
const blocked=reason=>{ throw Object.assign(new Error(reason),{manualReason:reason,code:'content_conflict'}); };

function projected(raw,edits) {
  const files=new Map(raw.files);
  for (const [path,bytes] of edits) {
    if (!path.startsWith('raw/')) continue;
    if (bytes===null) files.delete(path.slice(4));
    else files.set(path.slice(4),bytes);
  }
  return loadRawFiles(files,{references:true});
}

function catalogueCounts(files) {
  const overview=files.get('README.md')?.toString() ?? '';
  return {total:Number(overview.match(/学科导读共收录 (\d+) 张知识卡/)?.[1] ?? -1),
    sections:Object.fromEntries([...overview.matchAll(/^\| \[[^\]\n]+\]\(<([^<>\n]+)>\) \| (\d+) \|$/gm)]
      .map(([,path,count])=>[path,Number(count)])),
    entries:Object.fromEntries([...files].filter(([path])=>/^[^/]+\/README\.md$/.test(path))
      .map(([path,bytes])=>[path,(bytes.toString().match(/\]\(<?[^\n)]*\/article\.md>?\)/g) ?? []).length]))};
}

function checkCatalogueCounts(actual,frozen) {
  const delta=path=>(actual.entries[path] ?? 0)-(frozen.entries[path] ?? 0);
  const paths=new Set([...Object.keys(actual.entries),...Object.keys(frozen.entries)]);
  for (const path of paths) {
    if (Object.hasOwn(frozen.sections,path) && actual.sections[path]!==frozen.sections[path]+delta(path))
      conflict('学科导读中的收录数量与卡片条目不符。');
  }
  if (frozen.total>=0 && actual.total!==frozen.total+[...paths].reduce((sum,path)=>sum+delta(path),0))
    conflict('总导读中的收录数量与卡片条目不符。');
}

/** Observe the owner's main commits. This coordinator has no Git write operations. */
export function createManualOriginals({tasks,queue,stateDir,library,rpc,git,purge,monotonicNow}) {
  const items=()=>queue.manualPurges(library);
  const baseline=rawId=>queue.published(library,rawId) ?? listBoundRawCards(stateDir,library).find(card=>card.rawId===rawId);
  const readMain=()=>git.readSnapshot();
  let nextPoll=0;
  function requireOwnership(change,raw) {
    const bound=listBoundRawCards(stateDir,library).find(card=>card.rawId===change.rawId);
    const expected=baseline(change.rawId), target=raw.byId.get(change.rawId);
    if (!change.path || (bound && bound.documentId!==change.documentId) || (expected && expected.path!==change.path))
      blocked('原稿路径与这张卡的实例绑定不一致。');
    if (target) {
      if (!expected?.rawHash || expected.rawHash!==target.hash || target.path!==change.path)
        blocked('Git 原稿与上次核实的路径或内容不一致。');
    } else if (expected || raw.byPath.has(change.path) || !queue.createdWithoutOriginal(library,change.rawId,change.documentId,change.path)) {
      blocked('原稿在冻结前已缺失，需要核对原始删除范围。');
    }
  }
  async function archivePlan(change,base) {
    const {rawId,documentId}=change;
    const snapshot=await rpc('raw-database-card',{identity:library,id:documentId,includeArchived:true});
    if (snapshot.id!==documentId || !snapshot.archiveOp || snapshot.revision!==change.revision)
      conflict('待删卡的原生归档版本已变化。');
    const proof=await rpc('raw-archive-evidence',{identity:library,id:documentId,op_id:snapshot.archiveOp});
    if (!proof.verified || proof.id!==documentId || proof.signature!==snapshot.signature || proof.revision!==snapshot.revision)
      conflict('无法核实待删卡片的归档回执。');
    return {action:'purge',library,rawId,sourcePath:change.path,base,databaseFirst:true,manualOriginal:true,
      archiveOp:snapshot.archiveOp,evidence:{id:documentId,revision:proof.revision,signature:proof.signature}};
  }
  const originalPatch=(rawRoot,change)=>planCardRawChange({rawRoot,action:'purge',rawId:change.rawId,
    sourcePath:change.path,documentIds:[change.documentId]});
  async function freeze(change,head) {
    let base=head;
    const expected=baseline(change.rawId);
    if (expected && git.inspect(head,(_rawRoot,tree)=>!lifecycleFileIdentity(tree,'raw/'+change.path))) {
      base=git.originalBeforeRemoval(head,change.path);
      if (!base) blocked('主分支缺少可核实的原稿删除前版本。');
    }
    const plan=await archivePlan(change,base);
    const evidence=await git.inspect(base,async(rawRoot,tree)=>{
      const raw=loadRawTree(rawRoot,{references:true});
      requireOwnership(change,raw);
      const original=planManualOriginal({tree,rawId:change.rawId,documentId:change.documentId,sourcePath:change.path});
      if (original.blockers.length) blocked('原稿引用、附件或分享材料的归属需要核对。');
      if (!raw.byId.has(change.rawId) && original.files.some(file=>!file.path.startsWith('server/share-materials/')))
        blocked('新卡的原稿目录或同步绑定出现未证实的材料。');
      const native=await purge.preview(plan,originalPatch(rawRoot,change));
      if (native.blockers.length) blocked('线上归档、引用或备份的归属需要核对。');
      const expected=projected(raw,original.edits);
      const relocated=[];
      for (const sibling of expected.cards) {
        const before=raw.byId.get(sibling.id);
        if (!before || before.hash===sibling.hash) continue;
        const basis=baseline(sibling.id);
        if (!basis || basis.path!==before.path || basis.rawHash!==before.hash || !/^[a-f0-9]{64}$/.test(basis.revision ?? ''))
          blocked('共享附件涉及尚未核实的保留卡片。');
        relocated.push({rawId:sibling.id,path:sibling.path,previousHash:before.hash,rawHash:sibling.hash,revision:basis.revision});
      }
      const manifest=JSON.parse(raw.files.get('.sync.json') ?? '{}');
      const originalIds=[...new Set([change.rawId,change.documentId,raw.byId.get(change.rawId)?.metadata.siyuan_id,
        manifest.cards?.[change.rawId]?.remoteId,manifest.cards?.[change.rawId]?.legacyId].filter(Boolean))];
      const moves=[...original.moves].map(([from,to])=>({from,to,sha:hash(raw.files.get(from)),
        references:[...(expected.inbound.get(to) ?? [])].sort(),
        binding:JSON.parse(expected.files.get('.sync.json') ?? '{}').assets?.[to] ?? null}));
      return {base,originalIds,missingAtFreeze:!raw.byId.has(change.rawId),signature:plan.evidence.signature,
        files:original.files,paths:original.paths,command:original.command,digest:original.digest,moves,relocated,...(original.edits.has('raw/README.md') && {catalogue:catalogueCounts(expected.files)})};
    });
    // A historical main deletion must already have preserved the complete reviewed scope.
    if (base!==head) verifyRemoved(change,evidence,head);
    queue.freezeManual(change.id,evidence);
    return evidence;
  }
  function verifyRemoved(change,evidence,head) {
    purge.verifyOriginalsRemoved(head,{rawId:change.rawId,sourcePath:change.path});
    git.inspect(head,(rawRoot,tree)=>{
      const raw=loadRawTree(rawRoot,{references:true});
      const remaining=originalPatch(rawRoot,change);
      if (remaining.blockers.length || remaining.edits.size) conflict('Git 中仍有目标卡片的导读、引用或绑定。');
      for (const {path,after} of evidence.files) {
        const actual=lifecycleFileIdentity(tree,path);
        if (!isOriginalCatalogue(path)) {
          if (!sameLifecycleFile(actual,after)) conflict('Git 中的原稿或保留资料与冻结清单不符。');
        } else if (after && (!actual || actual.executable!==after.executable)) {
          conflict('保留的原稿索引或分享目录发生类型变化。');
        }
      }
      if (evidence.catalogue) checkCatalogueCounts(catalogueCounts(raw.files),evidence.catalogue);
      const bindings=JSON.parse(raw.files.get('.sync.json') ?? '{}');
      const ids=new Set(evidence.originalIds);
      if ([...ids].some(id=>raw.byDocument.has(id)) || bindings.relations?.some(relation=>
          ids.has(relation.source_concept_id) || ids.has(relation.target_concept_id)))
        conflict('Git 中仍有目标文档身份或关系绑定。');
      for (const {to,sha,references,binding} of evidence.moves) {
        if (!raw.files.has(to) || hash(raw.files.get(to))!==sha ||
            references.some(path=>!raw.inbound.get(to)?.has(path)) ||
            (binding && hash(canonical(bindings.assets?.[to] ?? null))!==hash(canonical(binding))))
          conflict('共享附件字节、引用或绑定未完整保留。');
      }
      for (const sibling of evidence.relocated) {
        const actual=raw.byId.get(sibling.rawId);
        if (actual?.path!==sibling.path || actual.hash!==sibling.rawHash)
          conflict('受附件迁移影响的保留卡片与冻结清单不符。');
      }
    });
  }
  function verifyBefore(change,evidence,head) {
    if (head===evidence.base) return;
    git.inspect(head,(rawRoot,tree)=>{
      requireOwnership(change,loadRawTree(rawRoot));
      const current=planManualOriginal({tree,rawId:change.rawId,documentId:change.documentId,sourcePath:change.path});
      if (current.blockers.length || current.digest!==evidence.digest)
        conflict('手工删除涉及的文件已变化。');
    });
  }
  async function poll({ids,force=false}={}) {
    const changes=items().filter(change=>!ids || ids.includes(change.rawId));
    if (!changes.length || (!force && monotonicNow()<nextPoll)) return;
    nextPoll=monotonicNow()+60000;
    let head;
    try { head=await readMain(); } catch { /* report a retryable per-card reminder below */ }
    for (const change of changes) {
      const task=tasks.get(change.id);
      queue.registerManual(change.id,task?.plan.title ?? change.rawId);
      if (!head) { queue.reportManual(change.id,null,'暂时无法读取 GitHub main，正在等待重试。'); continue; }
      try {
        if (!task?.plan.manualOriginal || change.batchId)
          blocked('旧流程的待删记录需要人工核对。');
        if (change.evidence && (task.state==='complete' || task.progress.stage==='database-purge-cleanup')) {
          // The native archive can already be gone. Recheck the frozen original against today's main.
          try { verifyRemoved(change,change.evidence,head); }
          catch {
            const current=git.inspect(head,(_rawRoot,tree)=>planManualOriginal({tree,rawId:change.rawId,
              documentId:change.documentId,sourcePath:change.path}));
            const retryable=current.command && !current.blockers.length && current.digest===change.evidence.digest;
            queue.reportManual(change.id,null,retryable ? null : 'main 再次出现原稿或相关文件发生变化，请核对后重新推送。',true);
            continue;
          }
          queue.reportManual(change.id,head,null,Boolean(change.evidence.files.length));
          continue;
        }
        if (change.state!=='pending' || task.state!=='awaiting-export')
          blocked('正在核对线上归档与分享暂停状态。');
        const evidence=change.evidence ?? await freeze(change,head);
        if (change.evidence && (await archivePlan(change,evidence.base)).evidence.signature!==evidence.signature)
          conflict('待删原生文档与冻结时的内容不一致。');
        const targetExists=git.inspect(head,(_rawRoot,tree)=>Boolean(lifecycleFileIdentity(tree,'raw/'+change.path)));
        if (targetExists) {
          verifyBefore(change,evidence,head);
          queue.reportManual(change.id,null);
        } else if (evidence.missingAtFreeze && evidence.files.length && git.inspect(head,(_rawRoot,tree)=>
            planManualOriginal({tree,rawId:change.rawId,documentId:change.documentId,sourcePath:change.path}).digest===evidence.digest)) {
          queue.reportManual(change.id,null);
        } else {
          verifyRemoved(change,evidence,head);
          queue.reportManual(change.id,head,null,Boolean(evidence.files.length));
        }
      } catch (error) {
        queue.reportManual(change.id,null,error.manualReason ??
          (error.code==='content_conflict' ? error.message : '删除范围暂未核实，正在等待重试。'));
      }
    }
  }
  function status() {
    return items().filter(change=>!change.verifiedHead).map(change=>({rawId:change.rawId,title:change.title ?? change.rawId,
      paths:change.evidence?.paths ?? [],command:change.reason ? null : change.evidence?.command ?? null,
      ...(change.reason ? {reason:change.reason} : change.observedRemoval ?
        {reason:'原稿在 main 上再次出现，请核对并重新执行删除命令。'} : {})}));
  }
  function ready({rawIds,acceptance=false}={}) {
    return items().filter(change=>{
      if ((rawIds && !rawIds.includes(change.rawId)) || change.state!=='pending' || change.batchId || !change.evidence)
        return false;
      const task=tasks.get(change.id), plan=task?.plan;
      if (task?.id!==change.id || plan?.manualOriginal!==true || plan.action!=='purge' ||
          plan.library!==library || plan.rawId!==change.rawId) return false;
      if (task.state==='awaiting-export')
        return plan.documentId===change.documentId && change.verifiedHead && (acceptance || queue.manualEligible(change));

      // A scoped batch can start before dueAt. Only its already frozen operation may resume early.
      const cleanup=task.state==='running' && task.progress.stage==='database-purge-cleanup';
      const readback=task.state==='complete' && task.progress.stage==='readback' && change.verifiedHead;
      if ((!cleanup && !readback) || typeof task.progress.commit!=='string' || !/^[a-f0-9]{40}$/.test(task.progress.commit) ||
          plan.databaseFirst!==true || !plan.deletion || plan.evidence?.id!==change.documentId ||
          plan.evidence.revision!==change.revision || plan.evidence.signature!==change.evidence.signature ||
          plan.sourcePath!==change.path || plan.base!==change.evidence.base) return false;
      const frozen=tasks.frozenDatabasePurge(change.id,'manual');
      return frozen && JSON.stringify(frozen)===JSON.stringify(plan);
    });
  }
  async function settle(change) {
    const {id,evidence}=change;
    const head=git.snapshot();
    let task=tasks.get(id);
    const started=task.progress.stage==='database-purge-cleanup' || task.state==='complete';
    const decision=started && purge.committed(task);
    const commit=started ? task.progress.commit : head;
    if (decision) {
      queue.forgetManualTitle(id);
      if (task.state!=='complete') await purge.finish(task,decision);
    } else {
      verifyRemoved(change,evidence,head);
      const plan=started ? task.plan : await archivePlan(change,evidence.base);
      if (!started) {
        const assessment=await git.inspect(evidence.base,rawRoot=>purge.preview(plan,originalPatch(rawRoot,change)));
        if (assessment.blockers.length) conflict('线上清理范围需要核对。');
        plan.deletion=assessment.deletion;
        tasks.freezeDatabasePurge(id,'manual',plan,evidence.files);
        task=tasks.beginDatabasePurge(id,'manual',commit);
      }
      queue.forgetManualTitle(id);
      const checkMain=()=>{
        const latest=git.snapshot();
        verifyRemoved(change,evidence,latest);
        return latest;
      };
      await purge.apply(task,commit,()=>git.inspect(evidence.base,rawRoot=>originalPatch(rawRoot,change)),()=>{
        tasks.update(id,'running',{stage:'database-purge-cleanup',commit,irreversible:true});
      },checkMain);
    }
    if (tasks.get(id).state!=='complete') tasks.update(id,'complete',{stage:'readback',commit});
    // A crash can leave only the export row unfinished. The ledger's human commit remains
    // immutable, but it cannot stand in for a fresh readback before closing the reminder.
    const current=git.snapshot();
    verifyRemoved(change,evidence,current);
    if (git.snapshot()!==current) conflict('最终读回期间 main 已前进。');
    queue.reportManual(id,current,null,Boolean(evidence.files.length));
    queue.completeManual(id,commit,evidence.relocated,current);
    return {id,state:'complete',commit};
  }
  async function settleReady(options) {
    let result;
    for (const change of ready(options)) {
      // An unsent older candidate can still own this card. Retire its lease before cleaning its pin.
      if (queue.outstanding(library,[change.rawId]).some(item=>item.id!==change.id && item.state==='batched')) continue;
      try { result=await settle(change); }
      catch (error) {
        const task=tasks.get(change.id);
        const afterCleanup=task?.state==='complete';
        // A pending signed decision is still scheduled if the human-removal check conflicts.
        queue.reportManual(change.id,null,afterCleanup ? '线上清理已读回，正在重新核对 main 上的原稿。' :
          '线上清理或原稿状态正在核对。',Boolean(afterCleanup && change.evidence.files.length));
        result={id:change.id,state:'blocked',errorCode:error.code ?? 'operation_pending'};
      }
    }
    return result;
  }
  function requireReversible(id,head) {
    const change=items().find(item=>item.id===id);
    if (!change || !tasks.get(id)?.plan.manualOriginal || change.batchId || change.observedRemoval)
      conflict('此删除记录需要人工核对。');
    if (!change.evidence) {
      git.inspect(head,rawRoot=>requireOwnership(change,loadRawTree(rawRoot)));
      return;
    }
    // Another confirmed card may have migrated shared attachments in a retained article.
    // Cancelling only releases this card's native fence, without reversing that Git change.
    const evidence=change.evidence;
    git.inspect(head,(rawRoot,tree)=>{
      requireOwnership(change,loadRawTree(rawRoot));
      const current=planManualOriginal({tree,rawId:change.rawId,documentId:change.documentId,sourcePath:change.path});
      if (current.blockers.length || (!evidence.missingAtFreeze && !lifecycleFileIdentity(tree,'raw/'+change.path)))
        conflict('目标原稿缺失或已被其他资料占用，不能撤销删除。');
      for (const {path,before,after} of evidence.files) {
        if (after===null && path!=='raw/'+change.path && !sameLifecycleFile(lifecycleFileIdentity(tree,path),before))
          conflict('专属原稿或分享素材已被修改，不能撤销这项删除。');
        if (isOriginalCatalogue(path) && !current.edits.has(path))
          conflict('手工删除已变更目标的索引或分享目录，不能撤销。');
      }
    });
  }
  const canOfferCancel=id=>items().some(change=>change.id===id && !change.batchId && !change.observedRemoval &&
    tasks.get(id)?.plan.manualOriginal && tasks.get(id)?.state==='awaiting-export');
  return {poll,status,ready,settleReady,requireReversible,canOfferCancel};
}
