import { posix } from 'node:path';
import { loadRawTree } from '../lib/raw-format.mjs';
import { fail } from '../lib/siyuan.mjs';
import { applyRawSync,baseline,listBoundRawCards,planRawSync,readPendingRawSync,restrictRawSyncPlan } from './raw-sync.mjs';

/** Rebuild a verified raw-only archive in this instance before queuing its export. */
export function createDatabaseRawRecovery({tasks,queue,git,stateDir,library,rpc}) {
  async function restore(task) {
    const {id,plan,progress}=task;
    const {rawId,rawBase,path}=plan;
    let {creation,syncPlan,originalPaths}=progress;
    const verifyOriginalPaths=()=>{
      if (!Array.isArray(originalPaths) || !git.pathsUnchanged(rawBase,git.snapshot(),originalPaths))
        fail('content_conflict','冻结导入使用的原稿或引用已变化。');
    };
    const pending=readPendingRawSync(stateDir,library);
    let bound=listBoundRawCards(stateDir,library).find(card=>card.rawId===rawId);
    if (pending) {
      if (pending.id!==syncPlan || !creation || !Array.isArray(progress.originalPaths))
        fail('content_conflict','已有另一项原稿导入待核对。');
      verifyOriginalPaths();
      await applyRawSync({stateDir,rpc,plan:pending});
    } else if (!bound) {
      await git.inspect(rawBase,async rawRoot=>{
        const tree=loadRawTree(rawRoot,{references:true});
        const card=tree.byId.get(rawId);
        if (card?.path!==path || card.metadata.status!=='archived')
          fail('content_conflict','归档原稿已变化。');
        const inventory=await rpc('inventory',{withBlocks:false});
        if (inventory.identity!==library) fail('outside_scope','归档原稿的目标实例不符。');
        const produced=planRawSync({rawRoot,stateDir,inventory,restoreRawId:rawId});
        const articles=new Set([path,...card.readings.map(reading=>reading.path)]);
        const dependencies=new Set([...tree.inbound].filter(([,sources])=>
          [...sources].some(source=>articles.has(source))).map(([target])=>target));
        const dependencyCards=new Set([...dependencies].map(target=>tree.byPath.get(target)?.id).filter(Boolean));
        const writes=(group,key)=>group==='cards' ? key===rawId : group==='readings' ? articles.has(key) :
          ['assets','sources'].includes(group) && dependencies.has(key) && key.startsWith(posix.dirname(path)+'/');
        const isDependency=({kind,key})=>kind==='cards' ? dependencyCards.has(key) : dependencies.has(key);
        if ([...produced.actions,...produced.conflicts].some(item=>!writes(item.kind,item.key) && isDependency(item)))
          fail('content_conflict','有引用资料尚未在当前实例核实。');
        const allows=(group,key)=>writes(group,key) || isDependency({kind:group,key});
        const manifest=tree.files.get('.sync.json');
        const initial=manifest ? baseline(JSON.parse(manifest)) : null;
        const approved=restrictRawSyncPlan(produced,stateDir,allows,
          {initialBindings:initial?.identity===library ? initial : null});
        const create=approved.actions.find(item=>item.kind==='cards' && item.key===rawId &&
          item.method==='raw-document' && !item.input.expected_revision);
        const order=create && approved.actions.find(item=>item.method==='raw-order-readings' &&
          item.input.expected_operation===create.input.op_id);
        if (!create || create.input.legacyId!==rawId || approved.conflicts.length)
          fail('content_conflict','无法核实归档原稿的重新创建范围。');
        creation={id:create.input.id,op_id:create.input.op_id,...(order && {orderOp:order.input.op_id})};
        originalPaths=[...new Set([...articles,...dependencies,'.sync.json'])].map(path=>'raw/'+path).sort();
        verifyOriginalPaths();
        tasks.update(id,'running',{stage:'restore-from-raw',creation,syncPlan:approved.id,originalPaths});
        await applyRawSync({stateDir,rpc,plan:approved});
      });
    }
    bound=listBoundRawCards(stateDir,library).find(card=>card.rawId===rawId);
    if (!creation || bound?.documentId!==creation.id || bound.archived || bound.path!==path)
      fail('content_conflict','恢复后的卡片绑定与创建回执不符。');
    const evidence=await rpc('raw-created-card-evidence',{identity:library,rawId,...creation});
    if (evidence.id!==bound.documentId || evidence.revision!==bound.revision)
      fail('content_conflict','恢复的卡片尚未按原请求读回。');
    verifyOriginalPaths();
    queue.prepare({id,library,rawId,action:'restore',documentId:bound.documentId,path,
      expectedRevision:evidence.revision,requestHash:bound.rawHash,fromRaw:true});
    return queue.acknowledge(id,{documentId:bound.documentId,revision:evidence.revision});
  }
  return restore;
}
