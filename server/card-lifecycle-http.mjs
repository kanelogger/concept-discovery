import { fail } from '../lib/read-contract.mjs';
import { confirmSessionPassword, readSession } from './auth-http.mjs';

const prefix = '/api/card-lifecycle';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const rawId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const documentId = /^\d{14}-[a-z0-9]{7}$/;

export async function cardLifecycleEndpoint({ req, res, path, authStore, lifecycle, originCheck, json, send, trustedProxyAddress }) {
  if (!path.startsWith(`${prefix}/`)) return false;
  if (req.headers.authorization !== undefined) fail('unauthorized', '请使用站主网页会话。');
  const session = readSession(req, authStore);
  if (!session) fail('unauthorized', '请登录后继续。');
  const owner = session.publicId;
  let data;
  if (req.method === 'GET' && path === `${prefix}/archives`) data = await lifecycle.archives(owner);
  else if (req.method === 'GET' && path === `${prefix}/sync-status`)
    data = lifecycle.syncStatus ? await lifecycle.syncStatus(owner) : {enabled:false};
  else if (req.method === 'GET' && path.startsWith(`${prefix}/draft/`)) {
    const id=path.slice(`${prefix}/draft/`.length);
    if (!documentId.test(id) || !lifecycle.draft) fail('not_found','编辑入口不可用。');
    data=await lifecycle.draft(owner,id);
  } else if (req.method === 'POST' && path === `${prefix}/sync-resume`) {
    originCheck(req);
    if (!lifecycle.resumeSync) fail('not_found','同步重试入口不可用。');
    if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] ?? ''))
      fail('invalid_input','需要 JSON 请求。');
    const {batchId,rawId:cardId}=await json(req,8192);
    if (readSession(req,authStore)?.publicId!==owner) fail('unauthorized','请重新登录后继续。');
    const validBatch=typeof batchId==='string' && uuid.test(batchId) && cardId===undefined;
    const validCard=typeof cardId==='string' && cardId.length<=180 && rawId.test(cardId) && batchId===undefined;
    if (!validBatch && !validCard) fail('invalid_input','需要一个批次或卡片标识。');
    data=await lifecycle.resumeSync(owner,batchId ?? null,cardId ?? null);
  } else if (req.method === 'POST' && path === `${prefix}/database-preview`) {
    originCheck(req);
    if (!lifecycle.databasePreview) fail('not_found','编辑入口不可用。');
    if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] ?? ''))
      fail('invalid_input','需要 JSON 请求。');
    const body=await json(req,4*1024*1024);
    if (readSession(req,authStore)?.publicId!==owner) fail('unauthorized','请重新登录后继续。');
    const {action,id,title,markdown,revision,signature}=body;
    if (!['create','edit'].includes(action) ||
        (action==='edit' && (typeof id!=='string' || !documentId.test(id) ||
          !/^[a-f0-9]{64}$/.test(revision ?? '') || !/^[a-f0-9]{64}$/.test(signature ?? ''))))
      fail('invalid_input','需要已读取的卡片版本。');
    data=await lifecycle.databasePreview(owner,{action,id,title,markdown,revision,signature});
  }
  else if (req.method === 'GET' && path.startsWith(`${prefix}/operations/`)) {
    const id = path.slice(`${prefix}/operations/`.length);
    if (!uuid.test(id)) fail('not_found', '操作不存在。');
    data = await lifecycle.status(owner, id);
  } else if (req.method === 'POST' && [`${prefix}/preview`, `${prefix}/confirm`].includes(path)) {
    originCheck(req);
    if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] ?? '')) fail('invalid_input', '需要 JSON 请求。');
    const body = await json(req, 8192);
    if (readSession(req, authStore)?.publicId !== owner) fail('unauthorized', '请重新登录后继续。');
    if (path.endsWith('/preview')) {
      const { action, id } = body;
      const idPattern = action === 'archive' ? documentId : ['resume','compensate'].includes(action) ? uuid : rawId;
      const validId = typeof id === 'string' && id.length <= 180 && idPattern.test(id);
      if (!['archive', 'restore', 'purge', 'mark-archive', 'resume', 'compensate'].includes(action) || !validId)
        fail('invalid_input', '卡片或操作无效。');
      data = await lifecycle.preview(owner, { action, id });
    } else {
      if (typeof body.id !== 'string' || !uuid.test(body.id)) fail('invalid_preview', '请重新预览操作。');
      const confirmation = await lifecycle.confirmation(owner, body.id);
      if (confirmation.task) data = confirmation.task;
      else {
        if (['purge','resume','compensate'].includes(confirmation.action)) await confirmSessionPassword(req, authStore,
          { publicId:owner, password:body.password, trustedProxyAddress });
        if (readSession(req, authStore)?.publicId !== owner) fail('unauthorized', '请重新登录后继续。');
        data = await lifecycle.confirm(owner, body.id);
      }
    }
  } else fail('not_found', '操作不存在。');
  if (!res.destroyed) send(res, 200, { ok:true, data });
  return true;
}
