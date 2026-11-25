import { lstatSync,readFileSync } from 'node:fs';
import { join,posix } from 'node:path';
import { canonical,fail } from '../lib/siyuan.mjs';
import { describeLifecyclePatch,verifyLifecycleCandidate } from './card-lifecycle-git.mjs';

const shareCatalog='server/share-materials/catalog.json';
const shareCover=rawId=>'server/share-materials/covers/'+rawId+'.png';

function readCatalog(tree) {
  const path=join(tree,shareCatalog);
  const entry=lstatSync(path,{throwIfNoEntry:false});
  if (!entry) return {};
  if (!entry.isFile()) fail('outside_scope','验收分享目录必须是普通文件。');
  const catalog=JSON.parse(readFileSync(path,'utf8'));
  if (!catalog || typeof catalog!=='object' || Array.isArray(catalog))
    fail('outside_scope','验收分享目录格式无效。');
  return catalog;
}

function latestPerCard(changes) {
  const cards=new Map();
  for (const change of changes) cards.set(change.rawId,change);
  return [...cards.values()];
}

/**
 * Publish frozen database snapshots. collect and verify must use the native
 * revision and the previously published paths, including ownership of links.
 */
export async function runCardExportBatch({queue,git,library,collect,verifyBeforePush,settlePurge,verifyPublishedPurges,readPublished,manualOriginals,tasks,purge},
  {acceptanceRawIds}={}) {
  let batch=queue.activeBatch(library);
  if (batch && acceptanceRawIds && JSON.stringify(batch.scope)!==JSON.stringify([...new Set(acceptanceRawIds)].sort()))
    fail('operation_pending','先结算现有批次。');
  if (!batch && (acceptanceRawIds || queue.hasDue(library))) {
    let parent;
    try { parent=git.snapshot(); }
    catch { queue.reportPreflight(library,'git_unavailable'); return null; }
    batch=acceptanceRawIds ? queue.claimAcceptance(library,parent,acceptanceRawIds) : queue.claimDue(library,parent);
    queue.reportPreflight(library,null);
  }
  if (!batch || batch.state==='blocked') return batch;
  const scope=batch.scope && batch.changes.filter(change=>change.path)
    .map(change=>'raw/'+posix.dirname(change.path)+'/');
  const allowedByScope=(path,purges)=>!scope || scope.some(prefix=>path.startsWith(prefix)) ||
    (purges.length>0 && (path===shareCatalog || purges.some(rawId=>path===shareCover(rawId))));
  const legacyWrites=()=>readPublished && batch.filePlanVersion===0
    ? latestPerCard(batch.changes).filter(change=>change.action!=='purge').map(change=>change.rawId)
    : [];
  async function finishPublished(result) {
    if (result.commit!==batch.candidate) return queue.block(batch.id,'git_content_conflict');
    for (const change of batch.changes) {
      if (change.action!=='purge' || change.cleanupHead===result.commit) continue;
      await settlePurge(change,batch,result.commit);
      queue.recordPurgeCleanup(change.id,result.commit);
    }
    verifyLifecycleCandidate(git,batch,result.commit);
    const observed=git.status(batch.id,batch.parent);
    if (observed.commit!==result.commit || !['published','published-conflict'].includes(observed.state))
      return queue.block(batch.id,'git_content_conflict');
    await verifyPublishedPurges?.(batch,observed.head);
    const published=readPublished ? await readPublished(batch,result.commit) : {};
    const conflictingRawIds=(published.originals ?? []).filter(({path})=>
      !git.pathsUnchanged(result.commit,observed.head,['raw/'+posix.dirname(path)])).map(({rawId})=>rawId);
    if (readPublished && git.snapshot()!==observed.head) return queue.block(batch.id,'git_content_conflict');
    return queue.complete(batch.id,result.commit,{...published,conflictingRawIds:[...legacyWrites(),...conflictingRawIds]});
  }
  try {
    let result=git.status(batch.id,batch.parent);
    if (batch.candidate && !result.commit &&
        git.restorePublishedCandidate?.(batch.id,batch.parent,batch.candidate,result.head))
      result=git.status(batch.id,batch.parent);
    if (batch.candidate && result.commit!==batch.candidate)
      return queue.block(batch.id,'export_candidate_unavailable');
    // Git can pin the candidate just before a crash prevents recording it
    // in SQLite. Recover that pin before evaluating the new remote head.
    if (!batch.candidate && result.commit) batch=queue.recordCandidate(batch.id,result.commit);
    const historicalPurges=manualOriginals && batch.changes.filter(change=>change.action==='purge');
    if (historicalPurges?.length) {
      // Frozen candidates may predate manual ownership. Only finish already signed decisions.
      if (!['published','published-conflict'].includes(result.state) || historicalPurges.some(change=>{
        const task=tasks.get(change.id);
        return !change.cleanupHead && (!task?.progress.commit || !purge.committed(task));
      })) return queue.block(batch.id,'manual_original_review');
    }
    if (result.state==='unstaged') {
      const patch=await git.inspect(batch.parent,async(rawRoot,tree)=>{
        const combined=new Map();
        const changes=latestPerCard(batch.changes).sort((a,b)=>Number(a.action==='purge')-Number(b.action==='purge'));
        for (const change of changes) {
          try {
            const item=await collect(change,{rawRoot,tree,batch});
            if (!(item instanceof Map)) fail('invalid_input','同步计划需要按路径登记冻结补丁。');
            for (const [path,bytes] of item) {
              if (!allowedByScope(path,change.action==='purge' ? [change.rawId] : []))
                fail('content_conflict','验收补丁涉及合成卡以外的文件。');
              if (combined.has(path)) fail(change.action==='purge' ? 'shared_dependency_pending' : 'content_conflict',
                '两张卡申请修改同一原稿路径。');
              if (bytes!==null && !Buffer.isBuffer(bytes)) fail('invalid_input','原稿补丁需要冻结字节。');
            }
            for (const [path,bytes] of item) combined.set(path,bytes);
          } catch (error) {
            if (error.code==='shared_dependency_pending')
              batch=queue.deferCard(batch.id,change.rawId,error.code,{nextBoundary:true});
            else if (error.code==='content_conflict') batch=queue.deferCard(batch.id,change.rawId,'git_content_conflict');
            else throw error;
          }
        }
        queue.freezeBatchFiles(batch.id,describeLifecyclePatch(tree,combined));
        return combined;
      });
      batch=queue.recordCandidate(batch.id,git.stage(batch.id,batch.parent,()=>patch));
      result=git.status(batch.id,batch.parent);
    }
    if (scope && result.commit) {
      const purges=batch.changes.filter(change=>change.action==='purge').map(change=>change.rawId)
        .concat(batch.compensatedRawIds);
      const paths=git.changedPaths(batch.parent,result.commit);
      if (paths.some(path=>!allowedByScope(path,purges) && !batch.compensatedPaths.includes(path)))
        return queue.block(batch.id,'outside_scope');
      const covers=purges.map(shareCover).filter(path=>paths.includes(path));
      if (covers.length && git.inspect(result.commit,(_,tree)=>covers.some(path=>lstatSync(join(tree,path),{throwIfNoEntry:false}))))
        return queue.block(batch.id,'outside_scope');
      if (paths.includes(shareCatalog)) {
        const before=git.inspect(batch.parent,(_,tree)=>readCatalog(tree));
        const after=git.inspect(result.commit,(_,tree)=>readCatalog(tree));
        for (const rawId of purges) delete before[rawId];
        if (JSON.stringify(canonical(before))!==JSON.stringify(canonical(after)))
          return queue.block(batch.id,'outside_scope');
      }
    }
    if (result.state==='conflict') return queue.supersede(batch.id,result);
    if (result.state==='published-conflict') return await finishPublished(result);
    if (!['prepared','published'].includes(result.state))
      return queue.block(batch.id,result.state==='refused' ? 'git_refused' : 'git_content_conflict');
    batch=queue.recordCandidate(batch.id,result.commit);
    if (result.state==='prepared') {
      if (legacyWrites().length)
        return batch.sendStarted===null ? queue.supersede(batch.id,result) : queue.block(batch.id,'export_candidate_unavailable');
      // The final check must reject a queued tombstone newer than an edit snapshot.
      verifyLifecycleCandidate(git,batch,result.commit);
      await verifyBeforePush(batch);
      batch=queue.beginSend(batch.id,batch.candidate);
      result=git.publish(batch.id,batch.parent);
    }
    if (result.state==='conflict') return queue.supersede(batch.id,result);
    if (result.state==='published-conflict') return await finishPublished(result);
    if (result.state!=='published' || result.commit!==batch.candidate)
      return queue.block(batch.id,result.state==='prepared' ? 'git_pending'
        : result.state==='refused' ? 'git_refused' : 'git_content_conflict');
    return await finishPublished(result);
  } catch(error) {
    if (error.code==='newer_purge_pending' && batch.sendStarted===null) {
      try { return queue.supersede(batch.id,git.status(batch.id,batch.parent)); }
      catch { return queue.block(batch.id,'export_outcome_unknown'); }
    }
    return queue.block(batch.id,typeof error.code==='string' && /^[a-z][a-z0-9_]{0,60}$/.test(error.code)
      ? error.code : 'export_unavailable');
  }
}
