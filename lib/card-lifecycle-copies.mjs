import { lstatSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { parseFragment } from 'parse5';
import { fail, hash, quote } from './siyuan.mjs';

const block = /^\d{14}-[a-z0-9]{7}$/;
const assetName = /^assets\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,240}$/;
const sha256 = /^[a-f0-9]{64}$/;
const receiptName = /^([a-zA-Z0-9_-]{1,100})\.json(?:\.tmp)?$/;

export function purgeAssetReferences(text) {
  const paths = new Set();
  if (!text.includes('assets/')) return paths;
  function collect(value) {
    if (!/^\/?assets\/[^\r\n]+$/.test(value)) return;
    const path = value.replace(/^\//,'').split(/[?#]/,1)[0];
    try { paths.add(decodeURIComponent(path)); } catch { paths.add(path); }
  }
  collect(text);
  const nodes = [fromMarkdown(text)];
  while (nodes.length) {
    const node = nodes.pop();
    if (typeof node.url === 'string') collect(node.url);
    for (const child of node.children ?? []) nodes.push(child);
  }
  const elements = /<[a-z]/i.test(text) ? [parseFragment(text)] : [];
  while (elements.length) {
    const element = elements.pop();
    for (const attribute of element.attrs ?? []) {
      if (['src','href','poster'].includes(attribute.name)) collect(attribute.value);
    }
    for (const child of element.childNodes ?? []) elements.push(child);
  }
  return paths;
}

function entry(path, directory = false) {
  const stat = lstatSync(path,{throwIfNoEntry:false});
  if (!stat) return false;
  if (directory ? !stat.isDirectory() : !stat.isFile())
    fail('outside_scope','删除副本路径不是普通文件或目录。');
  return true;
}

function requireNoOnlineSnapshots(api) {
  const workspace = join(dirname(api.c.dataDir),'workspace');
  if (!entry(workspace,true)) fail('outside_scope','线上工作区路径不可核实。');
  const repo = join(workspace,'repo');
  if (!entry(repo,true)) return;
  const directories = [repo];
  while (directories.length) {
    for (const item of readdirSync(directories.pop(),{withFileTypes:true})) {
      if (!item.isDirectory()) fail('outside_scope','发现无法逐卡清理的思源在线快照。');
      directories.push(join(item.parentPath,item.name));
    }
  }
}

function ownsReceipt(receipt, ids, assets, operations) {
  return [receipt.documentId, receipt.blockId, receipt.input?.id, receipt.input?.parent,
    receipt.result?.id, receipt.beforeDocument?.id].some(id => ids.has(id)) ||
    (receipt.command === 'raw-asset' && assets.has(receipt.input?.path)) ||
    [receipt.input?.backup_op_id, receipt.input?.expected_operation].some(id => operations.has(id));
}

function scanReceipts(api, identity, ids, assets) {
  if (!entry(api.c.dataDir,true)) return [];
  const all = [];
  for (const name of readdirSync(api.c.dataDir).sort()) {
    const operation = receiptName.exec(name)?.[1];
    if (!operation) continue;
    const path = join(api.c.dataDir,name);
    if (!entry(path)) continue;
    const bytes = readFileSync(path);
    let receipt;
    try { receipt = JSON.parse(bytes.toString('utf8')); }
    catch { fail('content_conflict','无法核对操作回执副本。'); }
    all.push({name,operation,receipt,sha256:hash(bytes)});
  }
  const operations = new Set(), selected = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of all) {
      if (selected.has(record) || !ownsReceipt(record.receipt,ids,assets,operations)) continue;
      if (record.receipt.target !== identity) fail('outside_scope','回执不属于目标知识库。');
      selected.add(record);
      operations.add(record.operation);
      changed = true;
    }
  }
  return all.filter(record => selected.has(record)).map(({name,sha256}) => ({name,sha256}));
}

function historicalAssetReferences(api, documents, receipts) {
  const paths = new Set();
  function collect(bytes) {
    const content = bytes.toString('utf8');
    if (!content.includes('assets/')) return;
    let root;
    try { root = JSON.parse(content); }
    catch { fail('content_conflict','无法解析含附件引用的历史副本。'); }
    const pending = [root];
    while (pending.length) {
      const value = pending.pop();
      if (typeof value === 'string') {
        for (const path of purgeAssetReferences(value)) paths.add(path);
      } else if (value && typeof value === 'object') {
        for (const child of Object.values(value)) pending.push(child);
      }
    }
  }
  for (const {name} of receipts) collect(readFileSync(join(api.c.dataDir,name)));
  const history = join(dirname(api.c.dataDir),'workspace','history');
  if (!entry(history,true)) return paths;
  const targets = new Set(documents.map(id=>id+'.sy'));
  for (const version of readdirSync(history,{withFileTypes:true})) {
    if (!/^\d{4}-\d\d-\d\d-\d{6}-[a-z]+$/.test(version.name)) continue;
    if (!version.isDirectory()) fail('outside_scope','历史文档路径无法核实。');
    const notebook = join(history,version.name,api.c.notebookId);
    if (!entry(notebook,true)) continue;
    const folders = [notebook];
    while (folders.length) {
      const folder = folders.pop();
      for (const item of readdirSync(folder,{withFileTypes:true})) {
        const path = join(folder,item.name);
        if (item.isSymbolicLink()) fail('outside_scope','笔记本历史含符号链接。');
        if (item.isDirectory() && block.test(item.name)) folders.push(path);
        else if (item.isFile() && targets.has(item.name)) collect(readFileSync(path));
      }
    }
  }
  return paths;
}

function assetLocations(api, path) {
  const parts = path.split('/');
  if (parts.shift() !== 'assets' || !parts.length ||
      parts.some(part=>!part || part === '.' || part === '..' || /[\\\x00-\x1f]/.test(part)))
    fail('outside_scope','附件副本路径无法核实。');
  const workspace = join(dirname(api.c.dataDir),'workspace');
  const found = [];
  const segments = [['data']];
  const history = join(workspace,'history');
  if (!entry(workspace,true)) fail('outside_scope','缺少线上工作区。');
  if (entry(history,true)) {
    for (const version of readdirSync(history,{withFileTypes:true})) {
      if (!/^\d{4}-\d\d-\d\d-\d{6}-[a-z]+$/.test(version.name)) continue;
      if (!version.isDirectory()) fail('outside_scope','历史附件目录归属无法核实。');
      segments.push(['history',version.name]);
    }
  }
  for (const segment of segments) {
    let root = workspace;
    if (![...segment,'assets',...parts.slice(0,-1)].every(part => entry(root=join(root,part),true))) continue;
    const file = join(root,parts.at(-1));
    if (entry(file)) found.push(file);
  }
  return found;
}

function assetCopies(api, asset) {
  if (!assetName.test(asset.path) || !sha256.test(asset.sha256)) fail('outside_scope','附件绑定需要单个已校验的文件。');
  const copies = assetLocations(api, asset.path);
  if (copies.some(path=>asset.sha256 !== hash(readFileSync(path)))) fail('content_conflict','附件副本在确认后已变化。');
  return copies;
}

async function usedOutside(api, docs, asset) {
  const rows = await api.sql(`SELECT id FROM blocks WHERE root_id NOT IN (${docs.map(quote).join(',')})
    AND (instr(markdown,${quote(asset)})>0 OR instr(content,${quote(asset)})>0) LIMIT 1`);
  return rows.length > 0;
}

export async function inspectPurgeCopies(api, {identity, documents, assets, knownRemote}) {
  if (identity !== await api.identity() || !documents.length || documents.some(id => !block.test(id)))
    fail('outside_scope','无法识别该删除的库或文档。');
  requireNoOnlineSnapshots(api);
  const ids = new Set(documents);
  // Include native block edits stored against a child block ID rather than a document ID.
  for (const row of await api.sql(`SELECT id FROM blocks WHERE root_id IN (${documents.map(quote).join(',')}) LIMIT 10001`))
    ids.add(row.id);
  if (ids.size > 10000) fail('outside_scope','超出可完整核对的回执范围。');
  const exclusive = [];
  for (const asset of assets) {
    if (asset.shared || exclusive.some(item => item.path === asset.binding.remotePath)) continue;
    if (await usedOutside(api, documents, asset.binding.remotePath)) continue;
    const target = {path:asset.binding.remotePath,sha256:asset.binding.sha256};
    assetCopies(api,target);
    exclusive.push(target);
  }
  const receipts = scanReceipts(api,identity,ids,new Set(exclusive.map(asset=>asset.path)));
  const bound = new Set(knownRemote);
  for (const path of historicalAssetReferences(api,documents,receipts)) {
    if (bound.has(path)) continue;
    if (assetLocations(api,path).length) fail('outside_scope','历史中仍有归属待核对的线上附件：'+path);
  }
  return { ids:[...ids].sort(), assets:exclusive, receipts };
}

/** Deletes only copies listed in the confirmed operation. A restart may find a prefix already gone. */
export async function removePurgeCopies(api, { identity, documents, frozen, opId }) {
  if (identity !== await api.identity()) fail('outside_scope','回执不属于目标知识库。');
  return api.withReceipt('purge-copy-lock-' + opId, async () => {
    requireNoOnlineSnapshots(api);
    const receipts = scanReceipts(api,identity,new Set(frozen.ids),new Set(frozen.assets.map(asset=>asset.path)));
    const expected = new Map(frozen.receipts.map(record=>[record.name,record.sha256]));
    if (receipts.some(record=>expected.get(record.name) !== record.sha256))
      fail('content_conflict','目标回执出现未确认的变化。');
    const files = [];
    for (const asset of frozen.assets) {
      if (await usedOutside(api,documents,asset.path)) fail('content_conflict','发现其他文档引用待清理附件。');
      files.push(...assetCopies(api,asset));
    }
    for (const file of new Set(files)) unlinkSync(file);
    for (const {name} of receipts) unlinkSync(join(api.c.dataDir,name));
    if (frozen.assets.some(asset=>assetCopies(api,asset).length) ||
        scanReceipts(api,identity,new Set(frozen.ids),new Set(frozen.assets.map(asset=>asset.path))).length)
      fail('operation_pending','待删除副本未完成读回。');
    return {assets:frozen.assets.length, receipts:frozen.receipts.length};
  });
}

export function verifyPurgeCopies(api, identity, frozen) {
  requireNoOnlineSnapshots(api);
  return !frozen.assets.some(asset=>assetCopies(api,asset).length) &&
    !scanReceipts(api,identity,new Set(frozen.ids),new Set(frozen.assets.map(asset=>asset.path))).length;
}
