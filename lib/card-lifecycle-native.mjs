import { lstatSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { canonical, deletedAttr, fail, hash, quote } from './siyuan.mjs';
import { documentRevision } from './documents.mjs';

const blockId = /^\d{14}-[a-z0-9]{7}$/;
const revision = /^[a-f0-9]{64}$/;
const nodeFile = /^\d{14}-[a-z0-9]{7}\.sy$/;

function safeEntry(root, path) {
  let file = root;
  const rootStat = lstatSync(file, {throwIfNoEntry:false});
  if (!rootStat || !rootStat.isDirectory()) fail('outside_scope', '工作区目录不可核实。');
  for (const part of path.split('/')) {
    if (!part || part === '.' || part === '..' || /[\\\x00-\x1f]/.test(part))
      fail('outside_scope', '工作区路径无效。');
    file = join(file, part);
    const stat = lstatSync(file, {throwIfNoEntry:false});
    if (!stat) return null;
    if (!(stat.isFile() || stat.isDirectory())) fail('outside_scope', '工作区含无法核实的目录项。');
  }
  return file;
}

function enumerateChildren(data, path) {
  const pending = [path], files = [];
  while (pending.length) {
    const base = pending.pop(), absolute = safeEntry(data, base);
    if (!absolute) continue;
    for (const entry of readdirSync(absolute, {withFileTypes:true})) {
      const child = base + '/' + entry.name;
      if (entry.isDirectory() && blockId.test(entry.name)) pending.push(child);
      else if (entry.isFile() && nodeFile.test(entry.name)) files.push(child);
      else fail('outside_scope', '卡片目录含无法确认归属的文件。');
      if (pending.length + files.length > 1000) fail('outside_scope', '卡片附属文档过多。');
    }
  }
  return files;
}

/** Freeze exact native document bytes, including owned archived reading children. */
export async function inspectArchivedNative(api, { id, archiveOp, expectedRevision }) {
  const { notebookId, libraryRootId, dataDir } = api.c;
  if (![id, notebookId, libraryRootId].every(value => typeof value === 'string' && blockId.test(value)) ||
      typeof archiveOp !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(archiveOp) ||
      typeof expectedRevision !== 'string' || !revision.test(expectedRevision))
    fail('invalid_input', '需要已核实的归档文档和版本。');
  const parentPath = '/' + libraryRootId + '/' + id;
  const row = await api.inScope(id);
  if (row.type !== 'd' || row.id !== id || row.path !== parentPath + '.sy')
    fail('outside_scope', '目标不在受管主卡目录。');
  const data = join(dirname(dataDir), 'workspace', 'data');
  const parentAttrs = await api.attrs(id);
  if (parentAttrs[deletedAttr] !== archiveOp || parentAttrs['custom-cd-parent'] || parentAttrs['custom-cd-kind'] === 'article')
    fail('content_conflict', '无法证明主卡仍处于已确认的归档状态。');
  const rows = await api.sql(`SELECT id, path, content FROM blocks WHERE box=${quote(notebookId)} AND type='d'
    AND (id=${quote(id)} OR path LIKE ${quote(parentPath + '/%')}) ORDER BY path LIMIT 1001`);
  if (!rows.length || rows.length > 1000)
    fail('outside_scope', '无法完整列出目标卡片和附属阅读。');
  const physical = enumerateChildren(data, notebookId + parentPath).sort();
  const indexed = rows.filter(child => child.id !== id).map(child => notebookId + child.path).sort();
  if (JSON.stringify(physical) !== JSON.stringify(indexed))
    fail('content_conflict', '卡片附属文档的物理清单与索引不符。');
  const documents = [];
  for (const child of rows) {
    if (child.id === id) {
      const raw = await api.markdown(id);
      if (documentRevision({title:child.content,raw,attrs:parentAttrs}) !== expectedRevision)
        fail('content_conflict', '归档卡片修订已变化。');
    } else {
      if (!blockId.test(child.id) || child.path !== parentPath + '/' + child.id + '.sy')
        fail('outside_scope', '卡片含未登记的原生子文档。');
      const attrs = await api.attrs(child.id);
      if (attrs['custom-cd-parent'] !== id || attrs['custom-cd-kind'] !== 'article')
        fail('outside_scope', '卡片含归属不明确的附属文档。');
    }
    const path = notebookId + child.path, candidate = safeEntry(data, path);
    if (!candidate || !lstatSync(candidate).isFile()) fail('content_conflict', '原生文档文件缺失。');
    documents.push({ id:child.id, path, sha256:hash(readFileSync(candidate)) });
  }
  return { notebookId, id, archiveOp, expectedRevision, documents };
}

function historyFiles(workspace, notebookId, filenames) {
  const root = safeEntry(workspace, 'history');
  if (!root) return [];
  const found = [];
  for (const entry of readdirSync(root, {withFileTypes:true})) {
    if (!/^\d{4}-\d\d-\d\d-\d{6}-[a-z]+$/.test(entry.name)) continue;
    const path = 'history/' + entry.name + '/' + notebookId;
    const notebook = safeEntry(workspace, path);
    if (!notebook) continue;
    const pending = [notebook];
    while (pending.length) {
      const folder = pending.pop();
      for (const item of readdirSync(folder, {withFileTypes:true})) {
        if (item.isSymbolicLink()) fail('outside_scope', '笔记本历史含符号链接。');
        const file = join(folder, item.name);
        if (item.isDirectory() && blockId.test(item.name)) pending.push(file);
        if (item.isFile() && filenames.has(item.name)) found.push(file);
      }
    }
  }
  return found;
}

async function indexedHistoryPaths(api,notebookId,ids) {
  const matching = new Set();
  for (const id of ids) {
    const query = {query:id,notebook:notebookId,op:'all',type:3,page:1};
    const search = await api.api('/api/history/searchHistory',query);
    for (const created of search?.histories ?? []) {
      const data = await api.api('/api/history/getHistoryItems',{...query,created});
      for (const item of data?.items ?? []) if (ids.includes(item.id)) matching.add(item.path);
    }
  }
  return matching;
}

export async function verifyNativePurged(api, frozen) {
  if (frozen.notebookId !== api.c.notebookId || !frozen.documents?.length ||
      frozen.documents.some(doc=>!blockId.test(doc.id)))
    fail('outside_scope','待核对的文档不属于当前知识库。');
  const workspace = join(dirname(api.c.dataDir),'workspace');
  const ids = frozen.documents.map(doc=>doc.id);
  const live = await api.sql(`SELECT id FROM blocks WHERE box=${quote(frozen.notebookId)}
    AND root_id IN (${ids.map(quote).join(',')}) LIMIT 1`);
  if (live.length || frozen.documents.some(doc=>safeEntry(workspace,'data/'+doc.path)) ||
      historyFiles(workspace,frozen.notebookId,new Set(ids.map(id=>id+'.sy'))).length) return false;
  const matches = await Promise.all(ids.map(id=>api.api('/api/history/searchHistory',{
    query:id,notebook:frozen.notebookId,op:'all',type:3,page:1,
  })));
  return matches.every(result=>result?.totalCount === 0);
}

export async function removeArchivedNative(api, frozen, { authorize, operation }) {
  const library = await api.identity();
  const decision = await authorize();
  if (!decision || !operation?.opId || decision.outcome === 'cancelled' || decision.library !== library ||
      decision.opId !== operation.opId || decision.previewDigest !== operation.previewDigest ||
      decision.mainCommit !== operation.mainCommit ||
      frozen.notebookId !== api.c.notebookId || !blockId.test(frozen.id) ||
      !Array.isArray(decision.documents) || !Array.isArray(frozen.documents) || !frozen.documents.length ||
      frozen.documents.some(doc => !blockId.test(doc.id)) ||
      JSON.stringify([...decision.documents].sort()) !== JSON.stringify(frozen.documents.map(doc => doc.id).sort()))
    fail('outside_scope', '权威永久删除决定与原生文件清单不符。');

  const workspace = join(dirname(api.c.dataDir), 'workspace'), ids = frozen.documents.map(doc => doc.id);
  const filenames = new Set(ids.map(id => id + '.sy'));
  const live = () => api.sql(`SELECT id FROM blocks WHERE box=${quote(frozen.notebookId)}
    AND root_id IN (${ids.map(quote).join(',')}) LIMIT 1`);
  if ((await live()).length) {
    const confirmed = await inspectArchivedNative(api,frozen);
    if (JSON.stringify(canonical(confirmed)) !== JSON.stringify(canonical(frozen)))
      fail('content_conflict', '原生文档清单或内容在确认后已变化。');
    const previous = new Set(historyFiles(workspace,frozen.notebookId,filenames));
    await api.api('/api/filetree/removeDocByID', {id:frozen.id});
    await api.flush();
    const pending = historyFiles(workspace,frozen.notebookId,filenames).filter(file=>!previous.has(file))
      .map(file=>file.slice(workspace.length));
    // SiYuan queues the history rows before returning from removeDoc. Let
    // those writes drain before rebuilding, or they can repopulate the index.
    if (pending.length) for (let attempt=0;attempt<50;attempt++) {
      const indexed = await indexedHistoryPaths(api,frozen.notebookId,ids);
      if (pending.every(path=>indexed.has(path))) break;
      if (attempt===49) fail('operation_pending','原生删除历史尚待写入索引。');
      await wait(200);
    }
  }
  if ((await live()).length || frozen.documents.some(doc => safeEntry(workspace, 'data/' + doc.path)))
    fail('operation_pending', '线上文档尚未完成读回。');
  const copies = historyFiles(workspace, frozen.notebookId, filenames);
  for (const file of copies) unlinkSync(file);
  await api.api('/api/history/reindexHistory');
  for (let attempt = 0; attempt < 30; attempt++) {
    const matches = await Promise.all(ids.map(id => api.api('/api/history/searchHistory', {
      query:id, notebook:frozen.notebookId, op:'all', type:3, page:1,
    })));
    if (matches.every(result => result?.totalCount === 0) && !historyFiles(workspace, frozen.notebookId, filenames).length)
      return { documents:ids, historyRemoved:copies.length };
    await wait(200);
  }
  fail('operation_pending', '线上历史索引尚未完成读回。');
}
