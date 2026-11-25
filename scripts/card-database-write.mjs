import { canonical,fail,hash } from '../lib/siyuan.mjs';

const sha = /^[a-f0-9]{64}$/;
const operation = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const document = /^\d{14}-[a-z0-9]{7}$/;
const archiveOperation = /^[a-zA-Z0-9_-]{1,100}$/;
const actions = new Set(['create','edit','archive','restore','purge']);

export async function abandonUnwrittenDatabaseCard({queue,rpc},id) {
  const intent=queue.get(id);
  if (!intent || intent.action==='purge' || intent.state!=='prepared')
    fail('operation_conflict','此操作无法作为未写入的修改取消。');
  const proof=await rpc('raw-seal-unstarted',{identity:intent.library,op_id:'db-card-'+id});
  return queue.abandonUnwritten(id,proof);
}

/** Apply an owner-approved frozen request without reading or writing Git. */
export async function applyDatabaseCardWrite({queue,rpc,shares,resolveDocument}, request) {
  const {id,library,rawId,action,documentId,path=null,revision=null,signature=null,archiveOp=null,title,markdown} = request;
  if (!operation.test(id ?? '') || !document.test(documentId ?? '') || !actions.has(action) ||
      (action!=='create' && !sha.test(signature ?? '')) ||
      (archiveOp!==null && (!['archive','purge','restore'].includes(action) || !archiveOperation.test(archiveOp))) ||
      (action==='restore' && !archiveOp) ||
      (['create','edit'].includes(action) && (typeof title!=='string' || typeof markdown!=='string')))
    fail('invalid_input','数据库写入需要有效的冻结请求和修订。');
  if (library!==await rpc('raw-target')) fail('outside_scope','待写入卡片属于其他知识库。');

  const known=queue.get(id);
  if (!known && action!=='create' && await resolveDocument(rawId)!==documentId)
    fail('outside_scope','卡片与原稿标识的绑定不一致。');
  const op_id='db-card-'+id;
  const evidenceFor = async previous => {
    const actual=previous ? await rpc('raw-archive-evidence',{identity:library,id:documentId,op_id:previous})
      : await rpc('raw-active-card-evidence',{identity:library,id:documentId});
    if (actual?.id!==documentId || actual.revision!==revision || actual.signature!==signature)
      fail('content_conflict','卡片原生版本在确认后已变化。');
    return actual;
  };
  if (!known && action!=='create') await evidenceFor(archiveOp);
  const intent=queue.prepare({id,library,rawId,action,path,expectedRevision:revision,documentId,requestHash:hash(canonical({
    library,rawId,action,documentId,path,revision,signature,archiveOp,title:title ?? null,markdown:markdown ?? null,
  }))});
  if (intent.state!=='prepared') return intent;
  const input={identity:library,id:documentId,op_id,expected_revision:revision,...(signature && {expected_signature:signature})};
  try {
    let result;
    if (action==='create' || action==='edit') {
      // Mark new main documents with their stable raw identifier.
      result=await rpc('raw-document',{...input,kind:'card',title,markdown,...(action==='create' && {legacyId:rawId})});
    } else if (action==='restore') {
      result=await rpc('raw-recover',{...input,backup_op_id:archiveOp});
      if (result?.deleted!==false) fail('readback_conflict','恢复状态未读回。');
    } else {
      if (action==='purge' && !shares.suspendForDeletion(documentId))
        fail('operation_pending','分享暂停状态尚未读回。');
      if (archiveOp) result=await evidenceFor(archiveOp);
      else {
        result=await rpc('raw-archive',input);
        if (result?.deleted!==true) fail('readback_conflict','归档状态未读回。');
      }
    }
    if (result?.id!==documentId) fail('readback_conflict','写后文档与冻结目标不一致。');
    return queue.acknowledge(id,{documentId,revision:result.revision});
  } catch (error) {
    const code=typeof error.code==='string' && /^[a-z][a-z0-9_]{0,60}$/.test(error.code)
      ? error.code : 'native_outcome_unknown';
    if (queue.get(id)?.state==='prepared') queue.reportWriteError(id,code);
    throw error;
  }
}
