// Owner-side evidence for migrating an archived document with no current raw original.
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { inspectArchivedNative } from '../lib/card-lifecycle-native.mjs';
import { documentRevision } from '../lib/documents.mjs';
import { rawWrite } from '../lib/raw-write.mjs';
import { canonical, deletedAttr, hash, quote } from '../lib/siyuan.mjs';

const nativeId = /^\d{14}-[a-z0-9]{7}$/;
const rawId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const digest = /^[a-f0-9]{64}$/;
const operation = /^[a-zA-Z0-9_-]{1,100}$/;
const valid = (pattern, value) => typeof value === 'string' && pattern.test(value);
function requireProof(ok, message) {
  if (!ok) throw new Error('旧归档核验失败：' + message);
}
function same(a, b) { return isDeepStrictEqual(canonical(a), canonical(b)); }
function pinned(file, expected) {
  requireProof(valid(digest, expected) && lstatSync(file).isFile(), '必须独立指定普通文件及其 SHA-256');
  const bytes = readFileSync(file);
  requireProof(hash(bytes) === expected, '文件摘要不符');
  return JSON.parse(bytes);
}
function checkApproval(record, libraryId) {
  requireProof(record?.version === 1 && record.libraryId === libraryId && typeof libraryId === 'string' && libraryId &&
    Array.isArray(record.archives) && record.archives.length > 0, '缺少同库保留归档决定');
  const unique = new Set();
  for (const row of record.archives) {
    requireProof(valid(rawId,row?.rawId) && valid(nativeId,row.documentId) && valid(operation,row.archiveOp) &&
      valid(operation,row.operationId) && valid(digest,row.revision) && valid(digest,row.signature), '操作或归档身份无效');
    for (const field of ['rawId','documentId','archiveOp','operationId']) {
      const key = field + '/' + row[field];
      requireProof(!unique.has(key), '同一身份或操作被重复认领');
      unique.add(key);
    }
  }
  return record;
}
export function readArchiveApproval(file, sha, libraryId) {
  return checkApproval(pinned(file, sha), libraryId);
}

async function pages(api, select) {
  const rows = [];
  let after = '';
  for (;;) {
    const page = await api.sql(select(quote(after)));
    if (!page.length) return rows;
    for (const row of page) {
      requireProof(valid(nativeId,row.id) && row.id > after, '原生库存重复或无效');
      rows.push(row);
      after = row.id;
    }
  }
}
function diskBlocks(file, sha256, documentId) {
  const bytes = readFileSync(file);
  requireProof(hash(bytes) === sha256, '原生文件在读取时发生变化');
  const doc = JSON.parse(bytes);
  requireProof(doc.ID === documentId && doc.Type === 'NodeDocument', '磁盘原生文档归属不符');
  const ids = [];
  function walk(node) {
    if (node.ID !== undefined) {
      requireProof(valid(nativeId,node.ID), '磁盘块 ID 无效');
      ids.push(node.ID);
    }
    for (const child of node.Children ?? []) walk(child);
  }
  walk(doc);
  return ids.sort();
}

// Executed only inside the isolated read-only container. No public response,
// native content, tokens or file paths are included in the result.
export async function observeFrozenArchives(api, approval) {
  const identity = await api.identity();
  checkApproval(approval, identity);
  const {notebookId, libraryRootId, dataDir} = api.c;
  requireProof(valid(nativeId,notebookId) && valid(nativeId,libraryRootId), '旧库根身份无效');
  const marked = await pages(api, after => `SELECT b.id,a.value AS marker FROM blocks b JOIN attributes a ON a.block_id=b.id
    WHERE b.box=${quote(notebookId)} AND b.type='d' AND a.name=${quote(deletedAttr)} AND a.value<>''
    AND (b.id=${quote(libraryRootId)} OR instr(b.path,${quote('/'+libraryRootId+'/')})=1)
    AND b.id>${after} ORDER BY b.id LIMIT 128`);
  const approvedMarkers = approval.archives.map(row=>({id:row.documentId,marker:row.archiveOp})).sort((a,b)=>a.id.localeCompare(b.id,'en'));
  requireProof(same(marked,approvedMarkers), '原生归档标记与核准清单不符');
  const archives = [];
  for (const row of approval.archives) {
    const id = row.documentId, op = row.archiveOp;
    const receipt = join(dataDir,op+'.json');
    requireProof(realpathSync(receipt) === receipt && lstatSync(receipt).isFile(), '原生归档回执路径不符');
    const proof = await rawWrite(api, 'raw-archive-evidence', {identity,id,op_id:op});
    requireProof(proof?.verified && proof.id === id && proof.revision === row.revision && proof.signature === row.signature,
      '归档回执、原生签名或写后修订不符');
    const native = await inspectArchivedNative(api,{id,archiveOp:op,expectedRevision:row.revision});
    const documents = [];
    for (const item of native.documents) {
      const indexed = await pages(api, after => `SELECT id,content,markdown FROM blocks WHERE box=${quote(notebookId)}
        AND root_id=${quote(item.id)} AND id>${after} ORDER BY id LIMIT 128`);
      const ids = indexed.map(block=>block.id);
      const file = join(dirname(dataDir),'workspace/data',item.path);
      requireProof(same(ids,diskBlocks(file,item.sha256,item.id)) && ids.includes(item.id), '原生块索引和文件清单不符');
      const attrs = await api.attrs(item.id);
      const revision = documentRevision({title:indexed.find(block=>block.id===item.id).content,
        raw:await api.markdown(item.id),attrs});
      const aliases = [attrs['custom-cd-legacy-id'],attrs['custom-cd-meta'] && JSON.parse(attrs['custom-cd-meta']).id].filter(Boolean);
      const anchorDigests = Object.fromEntries(indexed.filter(block=>block.id!==item.id && typeof block.markdown==='string')
        .map(block=>[block.id,hash(block.markdown)]));
      documents.push({id:item.id,sha256:item.sha256,revision,blocks:ids.filter(block=>block!==item.id),anchorDigests,aliases:[...new Set(aliases)].sort()});
    }
    const previousRevision = (await api.receipt(op)).value?.beforeDocument?.revision;
    requireProof(valid(digest,previousRevision), '归档前置修订缺失');
    archives.push({...row,previousRevision,documents});
  }
  return archives;
}

export function archiveReservations(approval, archives) {
  requireProof(Array.isArray(archives) && archives.length === approval.archives.length, '归档观察记录不完整');
  const targets = new Map();
  for (const [i, archived] of archives.entries()) {
    const {documents,previousRevision,...record} = archived;
    requireProof(same(record,approval.archives[i]) && valid(digest,previousRevision) && Array.isArray(documents) && documents.length &&
      documents.some(doc=>doc.id===record.documentId), '观察记录与站主核准不一致');
    for (const doc of documents) {
      requireProof(valid(nativeId,doc.id) && valid(digest,doc.sha256) && valid(digest,doc.revision) &&
        (doc.id!==record.documentId || doc.revision===record.revision) &&
        Array.isArray(doc.blocks) && Array.isArray(doc.aliases) && doc.anchorDigests &&
        Object.entries(doc.anchorDigests).every(([block,sha])=>doc.blocks.includes(block) && valid(digest,sha)),
        '受核实文档清单无效');
      const parent = doc.id === record.documentId ? '' : record.documentId;
      function add(ref, anchor) {
        requireProof(typeof ref === 'string' && ref.trim()===ref && ref.length && !/[\u0000-\u001f\u007f]/u.test(ref) &&
          !targets.has(ref), '历史身份重复、无效或归属冲突');
        targets.set(ref,[ref,doc.id,anchor,parent]);
      }
      for (const ref of new Set([doc.id,...doc.aliases,...(!parent ? [record.rawId] : [])])) add(ref,'');
      for (const id of doc.blocks) {
        requireProof(valid(nativeId,id), '块 ID 无效');
        add(id,id);
      }
    }
  }
  return [...targets.values()].sort(([a],[b])=>a<b?-1:a>b?1:0);
}

export function readFrozenArchives({file,sha256,libraryId,metadataSha256,baselineSha256,rawSha256,approvalSha256,inventorySha256}) {
  const frozen = pinned(file,sha256);
  requireProof(frozen?.version===1 && frozen.libraryId===libraryId &&
    [metadataSha256,baselineSha256,rawSha256,approvalSha256].every(value=>valid(digest,value)) &&
    same(frozen.inputs,{metadataSha256,baselineSha256,rawSha256,approvalSha256}), '归档收据未绑定本次冻结输入');
  requireProof(typeof frozen.approvalBytes==='string' && hash(frozen.approvalBytes)===approvalSha256, '站主决定原件不符');
  const approval = checkApproval(JSON.parse(frozen.approvalBytes),libraryId);
  requireProof(valid(digest,inventorySha256) && hash(canonical(frozen.archives))===inventorySha256,'原生归档见证已改变');
  return {targets:archiveReservations(approval,frozen.archives)};
}

// Work on a projection; the original private state is hashed and compared in full.
export function activeArchiveBindings(bindings, archives, tree) {
  if (!archives) return bindings;
  const entries = new Map(archives.flatMap(row => row.documents.map(doc => [doc.id,{row,doc}])));
  const claimedSlugs = new Set(archives.map(row=>row.rawId));
  for (const row of archives) requireProof(!tree.byId.has(row.rawId),'原稿中仍有待保留归档的卡');
  const active = {...bindings,cards:{...bindings.cards},readings:{...bindings.readings}};
  for (const group of ['cards','readings']) {
    const seen = new Set();
    for (const [key,b] of Object.entries(active[group])) {
      const owner = entries.get(b.remoteId);
      if (!owner) {
        requireProof(!(group==='cards' && claimedSlugs.has(key)) && !entries.has(b.parent), '绑定中的原稿标识或补读归属冲突');
        continue;
      }
      const {row,doc} = owner;
      const main = doc.id===row.documentId;
      requireProof(!seen.has(doc.id) && !b.reserved && !b.needsSync && !b.forceApply &&
        (!b.archiveOp || b.archiveOp===row.archiveOp) &&
        (main ? group==='cards' && key===row.rawId && !b.parent && !tree.files.has(b.path) &&
          [row.revision,row.previousRevision].includes(b.revision) :
          group==='readings' && b.parent===row.documentId && b.revision===doc.revision && !tree.files.has(key)), '归档绑定未结算或归属冲突');
      for (const alias of [b.legacyId,b.legacyMeta?.id].filter(Boolean))
        requireProof((main && alias===row.rawId) || doc.aliases.includes(alias),'归档绑定的旧别名未经核实');
      requireProof(Object.entries(b.anchors ?? {}).every(([block,evidence])=>Object.hasOwn(doc.anchorDigests,block) &&
        doc.anchorDigests[block]===evidence?.sha256),'归档绑定的块归属或摘要不符');
      seen.add(doc.id);
      delete active[group][key];
    }
  }
  return active;
}
