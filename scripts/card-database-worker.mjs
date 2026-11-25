import { fail, id as newDocumentId } from '../lib/siyuan.mjs';
import { markdownChunks } from '../lib/documents.mjs';
import { documentTags } from '../lib/card-list.mjs';
import { applyDatabaseCardWrite } from './card-database-write.mjs';
import { listBoundRawCards } from './raw-sync.mjs';
import { normalizeRawCard } from './raw-export.mjs';

const bodyActions = new Set(['create','edit']);

/** Source-side owner operations. Callers serialize access with the host lock. */
export function createDatabaseCardWorker({ tasks,queue,stateDir,library,rpc,shares,legacyArchives,restoreOriginal,review,compensation,manual }) {
  function bindings() {
    const cards = new Map(listBoundRawCards(stateDir,library).map(card=>[card.rawId,card]));
    for (const change of queue.liveCards(library)) {
      if (change.action==='purge' && change.state==='complete') cards.delete(change.rawId);
      else cards.set(change.rawId,{rawId:change.rawId,documentId:change.documentId,
        path:change.path ?? cards.get(change.rawId)?.path ?? null,archived:['archive','purge'].includes(change.action)});
    }
    return cards;
  }

  function byDocument(documentId) {
    const binding=[...bindings().values()].find(card=>card.documentId===documentId);
    if (!binding) fail('not_found','找不到已绑定的卡片。');
    return binding;
  }

  function requireAvailable(rawId) {
    if (pendingDeletion(rawId)) fail('operation_conflict','卡片正在等待彻底删除。');
  }
  const pendingDeletion=rawId=>queue.pendingPurge(library,rawId);

  function visibleTask(task) {
    const change=task.state==='complete' ? queue.get(task.id) : null;
    return change?.action==='purge' && change.state!=='complete' ? {...task,state:'awaiting-export'} : task;
  }

  const readCard=(documentId,includeArchived=false,body=false)=>
    rpc('raw-database-card',{identity:library,id:documentId,includeArchived,body});

  async function draft(_owner,documentId) {
    const binding=byDocument(documentId);
    requireAvailable(binding.rawId);
    const snapshot=await readCard(documentId,false,true);
    if (!snapshot.editable) fail('unsupported_structure','卡片当前包含无法保真的结构。');
    return {id:documentId,title:snapshot.title,markdown:snapshot.markdown,
      revision:snapshot.revision,signature:snapshot.signature};
  }

  async function preview(owner,input) {
    const {action,id,revision,signature,title,markdown}=input;
    if (action==='compensate' && compensation) {
      const result=await compensation.preview(id);
      return {action,files:result.files,rawId:result.rawId,blockers:[],...tasks.preview(owner,result.plan)};
    }
    if (action==='resume' && review) {
      const assessment=await review.preview(id);
      return {action,rawId:assessment.rawId,files:assessment.files,blockers:[],
        ...tasks.preview(owner,{action,library,...assessment.plan})};
    }
    if (!['create','edit','archive','restore','purge','mark-archive'].includes(action))
      fail('invalid_input','未知数据库维护操作。');
    if (bodyActions.has(action)) {
      if (typeof title!=='string' || !title.trim() || title.length>1000 || /[\r\n\0]/u.test(title))
        fail('invalid_input','请输入有效的卡片标题。');
      markdownChunks(markdown);
      try { normalizeRawCard(markdown); }
      catch { fail('invalid_input','请保留一段可导出的核心理解。'); }
    }
    let plan;
    if (action==='create') {
      const documentId=newDocumentId(), rawId='card-'+documentId;
      const sections=documentTags(markdown,{proseOnly:true}).filter(tag=>/^学科\s*[:：]/.test(tag));
      if (sections.length>1) fail('invalid_input','新增卡片需要一个明确的原稿主学科。');
      const discipline=sections[0]?.replace(/^学科\s*[:：]\s*/,'') ?? '未分类';
      if (!discipline || discipline.startsWith('.') || /[\\/\x00-\x1f]/.test(discipline))
        fail('invalid_input','新增卡片的学科不能作为原稿目录。');
      const initial=sections.length ? markdown : `${markdown.trimEnd()}\n\n## 标签\n\n- 学科：${discipline}\n`;
      plan={library,action,rawId,documentId,path:`${discipline}/${rawId}/article.md`,title,markdown:initial};
    } else {
      const boundByRawId=['restore','purge','mark-archive'].includes(action);
      const binding=boundByRawId ? bindings().get(id) : byDocument(id);
      if (!binding && action==='restore' && restoreOriginal) {
        requireAvailable(id);
        const {head,entries}=await legacyArchives();
        const original=entries.find(card=>card.rawId===id && card.state==='from-raw');
        if (original) {
          plan={library,action,rawId:id,path:original.path,title:original.title,rawBase:head};
          return {action,title:plan.title,rawId:id,files:[],blockers:[],...tasks.preview(owner,plan)};
        }
      }
      if (!binding) fail('not_found','找不到已绑定的卡片。');
      requireAvailable(binding.rawId);
      const snapshot=await readCard(binding.documentId,boundByRawId);
      if (action==='restore' && !snapshot.archiveOp) fail('content_conflict','目标卡片尚未归档。');
      if (snapshot.archiveOp && !queue.liveCards(library).some(card=>card.rawId===binding.rawId) && legacyArchives) {
        const {entries}=await legacyArchives();
        const verified=entries.find(card=>card.rawId===binding.rawId);
        if (!verified || verified.documentId!==binding.documentId || verified.revision!==snapshot.revision)
          fail('content_conflict','旧归档的实例绑定与原稿需要核对。');
        if (action==='restore' && verified.state==='missing-raw')
          fail('content_conflict','原稿缺失，需要补齐可核实的原稿后才能恢复。');
        if (action==='mark-archive' && verified.state!=='needs-marker')
          fail('content_conflict','该归档无需补记原稿。');
      } else if (action==='mark-archive') {
        fail('content_conflict','缺少可核实的旧归档回执。');
      }
      if (action==='edit' && (!snapshot.editable || revision!==snapshot.revision || signature!==snapshot.signature))
        fail('content_conflict','原生正文已变化，请重新打开编辑器。');
      plan={...binding,library,...(manual && action==='purge' && {manualOriginal:true}),action:action==='mark-archive' ? 'archive' : action,
        revision:snapshot.revision,signature:snapshot.signature,archiveOp:snapshot.archiveOp,
        title:action==='edit' ? title : snapshot.title,...(action==='edit' && {markdown})};
    }
    return {action,title:plan.title,rawId:plan.rawId,files:[],blockers:[],
      ...(action==='purge' && {deferred:true}),...tasks.preview(owner,plan)};
  }

  async function run(task) {
    const {plan,id}=task;
    const stage=plan.action==='compensate' ? 'database-purge-compensation' :
      plan.action==='resume' ? 'resume-git-batch' : plan.rawBase ? 'restore-from-raw' : 'database-write';
    tasks.update(id,'running',{...task.progress,stage});
    try {
      if (plan.action==='compensate') return await compensation.run(tasks.get(id));
      if (plan.action==='resume') {
        await review.confirm(plan);
        return tasks.update(id,'complete',{stage,batchId:plan.batchId});
      }
      const written=plan.rawBase ? await restoreOriginal(task) : await applyDatabaseCardWrite({queue,rpc,shares,
        resolveDocument:async rawId=>bindings().get(rawId)?.documentId}, {...plan,id});
      if (manual && plan.action==='purge') queue.registerManual(id,plan.title ?? plan.rawId);
      const completed=tasks.finishDatabaseWrite(id,{stage:'database-readback',dueAt:written.dueAt,
        documentId:written.documentId,revision:written.revision});
      if (manual && plan.action==='purge') await manual.poll({ids:[plan.rawId],force:true});
      return completed;
    } catch (error) {
      const code=error.code ?? 'native_outcome_unknown';
      return tasks.update(id,/conflict|outside_scope|unsupported_structure|invalid_/.test(code) ? 'needs-review' : 'running',
        {...tasks.get(id).progress,stage,error:code});
    }
  }

  return {
    draft,preview,databasePreview:preview,
    async confirm(owner,id) {
      const accepted=tasks.confirm(owner,id);
      return accepted.state==='queued' ? run(tasks.owned(owner,id)) : visibleTask(accepted);
    },
    confirmation(owner,id) {
      const confirmation=tasks.confirmation(owner,id);
      return confirmation.task ? {task:visibleTask(confirmation.task)} : confirmation;
    },
    status:(owner,id)=>visibleTask(tasks.status(owner,id)),
    async runOnce() {
      const task=tasks.next();
      return task ? run(task) : null;
    },
    resumeOriginal(task) {
      if (task?.state!=='needs-review' || task.plan.action!=='restore' || !task.plan.rawBase)
        fail('operation_conflict','原操作没有可续跑的归档恢复。');
      return run(task);
    },
    resumeCompensation(task) {
      if (task?.state!=='needs-review' || task.plan.action!=='compensate' || !task.progress.phase)
        fail('operation_conflict','原任务没有可续跑的删除撤销。');
      return run(task);
    },
    async archives() {
      const result=[];
      const local=new Set(queue.liveCards(library).map(card=>card.rawId));
      const {entries:legacy}=legacyArchives ? await legacyArchives() : {entries:[]};
      const legacyById=new Map(legacy.map(card=>[card.rawId,card]));
      for (const binding of bindings().values()) {
        const deleting=pendingDeletion(binding.rawId);
        if (!binding.archived && !deleting) continue;
        const prior=legacyById.get(binding.rawId);
        if (!local.has(binding.rawId) && prior) {
          const {rawId,title,discipline,state,archivedAt}=prior;
          result.push({rawId,title,discipline,state,archivedAt});
          continue;
        }
        try {
          const card=await readCard(binding.documentId,true);
          const state=deleting ? 'awaiting-export' : card.archiveOp ? 'archived' : 'needs-review';
          const canCompensate=deleting && (!manual || manual.canOfferCancel(deleting.id)) && !deleting.cleanupHead && !tasks.get(deleting.id)?.progress.irreversible;
          result.push({rawId:binding.rawId,title:card.title,state,...(canCompensate && {purgeOperation:deleting.id})});
        } catch (error) {
          if (!['not_found','outside_scope'].includes(error.code)) throw error;
          result.push({rawId:binding.rawId,title:binding.rawId,state:'needs-review'});
        }
      }
      const bound=bindings();
      const handled=new Set(result.map(card=>card.rawId));
      for (const {rawId,title,discipline,state,archivedAt} of legacy) {
        if (handled.has(rawId) || local.has(rawId)) continue;
        if (!bound.has(rawId) || state==='needs-review') result.push({rawId,title,discipline,state,archivedAt});
      }
      return result;
    },
    syncStatus:()=>({enabled:true,...queue.summary(library),...(manual && {manualDeletions:manual.status()})}),
  };
}
