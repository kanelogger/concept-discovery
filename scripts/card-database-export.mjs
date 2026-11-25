import { exportDatabaseCard } from './raw-export.mjs';
import { listBoundRawCards,readRawExportLinks } from './raw-sync.mjs';
import { loadRawTree,setRawArchive } from '../lib/raw-format.mjs';
import { fail } from '../lib/siyuan.mjs';

/** Collect card snapshots for the database-first export queue. */
export function createDatabaseCardExport({queue,git,stateDir,library,rpc,origin,collectPurge,settlePurge,
  verifyPurgeBeforePush,verifyPublishedPurges}) {
  const bound=()=>new Map(listBoundRawCards(stateDir,library).map(card=>[card.rawId,card]));
  const baseline=rawId=>queue.published(library,rawId) ?? bound().get(rawId);
  function pathLinks(tree) {
    const cards=bound();
    for (const live of queue.liveCards(library)) {
      if (live.action==='purge') cards.delete(live.rawId);
      else cards.set(live.rawId,live);
    }
    const documents=new Map([...cards.values()].flatMap(card=>{
      const path=tree.byId.get(card.rawId)?.path ?? card.path;
      return path ? [[card.documentId,path]] : [];
    }));
    const raw=readRawExportLinks(stateDir,library);
    for (const [id,path] of raw.readings) if (tree.files.has(path)) documents.set(id,path);
    const assets=new Map(raw.assets.filter(([,path])=>tree.files.has(path)));
    const sources=new Map(raw.sources.filter(([,path])=>tree.files.has(path)));
    return {origin,documentPath:id=>documents.get(id),assetPath:id=>assets.get(id),sourcePath:id=>sources.get(id)};
  }
  async function collect(change,context) {
    const {rawRoot}=context;
    const tree=loadRawTree(rawRoot,{references:true});
    const previous=tree.byId.get(change.rawId);
    const expected=baseline(change.rawId);
    if (expected?.rawHash) {
      if ((!previous && change.action!=='purge') ||
          (previous && (previous.hash!==expected.rawHash || (expected.path && expected.path!==previous.path))))
        fail('content_conflict','Git 原稿在最后一次同步后独立变更。');
    } else if (previous || !queue.createdInDatabase(library,change.rawId)) {
      fail('content_conflict','缺少可核实的原稿发布基线。');
    }
    if (!previous && expected?.path && change.path && expected.path!==change.path)
      fail('content_conflict','缺失原稿的路径与已核实的绑定不符。');
    const path=previous?.path ?? expected?.path ?? change.path;
    if (!path) fail('content_conflict','卡片缺少可核实的原稿路径。');
    if (change.action==='purge') {
      if (!collectPurge) fail('content_conflict','待删除卡片尚未完成清理预检。');
      const patch=await collectPurge({...change,path},{...context,previous});
      for (const filename of patch.keys()) {
        const sibling=filename.startsWith('raw/') && tree.byPath.get(filename.slice(4));
        if (!sibling || sibling.id===change.rawId) continue;
        const current=baseline(sibling.id);
        if (!current || current.rawHash!==sibling.hash || !/^[a-f0-9]{64}$/.test(current.revision ?? ''))
          fail('content_conflict','共享附件迁移涉及有独立改动的原稿。');
      }
      return patch;
    }
    if (!previous && tree.files.has(path)) fail('content_conflict','待写原稿路径已被其他文件占用。');
    const document=await rpc('raw-database-card',{identity:library,id:change.documentId,
      includeArchived:change.action==='archive',body:true});
    if (document.id!==change.documentId || document.revision!==change.revision ||
        Boolean(document.archiveOp)!==(change.action==='archive'))
      fail('content_conflict','当前原生卡片与冻结版本不符。');
    const original=tree.files.get(path);
    const rebound=previous?.metadata.status==='archived' &&
      queue.recoveredOriginal(library,change.rawId,change.documentId)===previous.hash;
    let bytes;
    try {
      bytes=change.fromRaw && rebound ? setRawArchive(original,null,document.id) :
        exportDatabaseCard({path,original,rawId:change.rawId,document,
          archivedAt:document.archiveOp ? new Date(change.dueAt).toISOString() : null,links:pathLinks(tree),
          ...(rebound && {previousId:previous.metadata.siyuan_id})});
    } catch (error) {
      fail('content_conflict',error.message);
    }
    return new Map([['raw/'+path,bytes]]);
  }
  function readPublished(batch,commit) {
    return git.inspect(commit,rawRoot=>{
      const tree=loadRawTree(rawRoot,{references:true});
      const newest=new Map(batch.changes.map(change=>[change.rawId,change]));
      const originals=[...newest.values()].filter(change=>change.action!=='purge' && batch.filePlanVersion===1).map(change=>{
        const original=tree.byId.get(change.rawId);
        if (!original) fail('content_conflict','发布候选缺少已同步卡片。');
        return {rawId:change.rawId,path:original.path,revision:change.revision,rawHash:original.hash};
      });
      const relocated=[];
      for (const filename of git.changedPaths(batch.parent,commit)) {
        if (batch.compensatedPaths.includes(filename)) continue;
        const original=filename.startsWith('raw/') && tree.byPath.get(filename.slice(4));
        if (!original || newest.has(original.id)) continue;
        const prior=baseline(original.id);
        if (!prior) fail('content_conflict','缺少共享附件迁移前的已发布版本。');
        relocated.push({rawId:original.id,path:original.path,revision:prior.revision,rawHash:original.hash});
      }
      return {originals,relocated};
    });
  }
  return {queue,git,library,collect,readPublished,settlePurge,verifyPublishedPurges,
    async verifyBeforePush(batch) {
      if (await rpc('raw-target')!==library) fail('outside_scope','同步目标库已经变化。');
      if (verifyPurgeBeforePush) await verifyPurgeBeforePush(batch);
    },
  };
}
