import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { compileContentCards, loadContentTree } from '../lib/content-cards.mjs';
import { compileContentMaterials } from '../lib/content-materials.mjs';
import { documentMarkdown, documentRevision } from '../lib/documents.mjs';
import { readableMarkdown } from '../lib/compact.mjs';
import { loadRawTree } from '../lib/raw-format.mjs';
import { rawLegacyMeta } from '../lib/raw-write.mjs';
import { canonical, deletedAttr, hash, normalize } from '../lib/siyuan.mjs';
import { createWikiStore } from '../lib/wiki-store.mjs';
import { historyInventory } from './build-content.mjs';
import { connectRaw } from './raw-connection.mjs';
import { activeArchiveBindings, archiveReservations, readArchiveApproval } from './frozen-archives.mjs';

const nativeId = /^\d{14}-[a-z0-9]{7}$/;
const own = (obj, key) => Object.hasOwn(obj, key) ? obj[key] : undefined;
const map = () => Object.create(null);

function check(condition, message) {
  if (!condition) throw new Error(message);
}
function same(actual, expected, label) {
  check(isDeepStrictEqual(canonical(actual), canonical(expected)), label + ' 不符');
}
function json(path) {
  check(lstatSync(path).isFile(), '输入必须为普通 JSON 文件');
  return JSON.parse(readFileSync(path, 'utf8'));
}
function byId(rows, label) {
  const entries = new Map();
  for (const row of rows) {
    check(typeof row?.id === 'string' && row.id && !entries.has(row.id), label + ' 标识缺失或重复');
    entries.set(row.id, row);
  }
  return entries;
}
function compareInventory(left, right, label) {
  const a = byId(left, label), b = byId(right, label);
  check(a.size === b.size, label + ' 数量不符');
  for (const [id, row] of a) same(row, b.get(id), label + '/' + id);
}
function within(root, path) {
  const tail = relative(root, path);
  return !isAbsolute(tail) && tail !== '..' && !tail.startsWith('..' + sep);
}
function outputPath(output, protectedRoots) {
  const destination = resolve(output);
  check(!lstatSync(destination, { throwIfNoEntry: false }), '输出目录已存在，请选择新目录');
  const parent = realpathSync(dirname(destination));
  const physical = join(parent, relative(dirname(destination), destination));
  check(protectedRoots.every(root => !within(root, physical)), '输出必须位于原稿与冻结副本之外');
  return physical;
}

function settledState(copy, libraryId, archives, tree) {
  const stateDir = join(copy, 'raw-sync', hash(libraryId));
  check(!lstatSync(join(stateDir, 'pending.json'), { throwIfNoEntry: false }), '副本存在未结算的原稿同步');
  const file = join(stateDir, 'state.json');
  if (!lstatSync(file, { throwIfNoEntry: false })) return null;
  check(realpathSync(file) === file, '副本绑定目录不符');
  const state = json(file);
  check(state.identity === libraryId && state.version === 1, '副本本地绑定与库身份不符');
  const active = activeArchiveBindings(state,archives,tree);
  const documents = [...Object.values(active.cards), ...Object.values(active.readings)];
  check(documents.every(b => !b.archived && !b.archiveOp && !b.reserved && !b.needsSync && !b.forceApply &&
    b.legacyMeta?.lifecycle_status !== 'archived'), '副本本地绑定仍有归档或未结算文档');
  return hash(canonical(state));
}

async function publicCards(call) {
  const items = [];
  let total;
  for (;;) {
    const page = await call('list', { offset: items.length, limit: 100 });
    check(Array.isArray(page.items) && page.offset === items.length && page.limit === 100 &&
      Number.isSafeInteger(page.total) && page.total >= 0 && (total === undefined || total === page.total),
    '公开活动卡分页库存不稳定');
    total = page.total;
    check(page.items.length === Math.min(100, total - items.length), '公开活动卡分页缺项');
    items.push(...page.items);
    check(page.hasMore === (items.length < total), '公开活动卡分页末尾不符');
    if (!page.hasMore) return items;
  }
}

async function collectHistory(call, wikiRoot, libraryId, inventory) {
  const wiki = createWikiStore(wikiRoot, libraryId, { readOnly: true });
  const sources = wiki.listSources(), proposals = wiki.listProposals(), events = wiki.events();
  const sourceList = await call('sources-list', {});
  const proposalList = await call('wiki-proposals', {});
  const eventList = await call('wiki-events', {});
  compareInventory(inventory.sources, sources, '原生与磁盘来源库存');
  compareInventory(sourceList.items, sources.map(({ markdown, ...row }) => ({
    ...row, characters: [...markdown].length,
  })), '公开与磁盘来源库存');
  for (const source of sources) same(await call('source-get', { id: source.id }), source, '公开原文 ' + source.id);
  const visibleProposals = proposals.filter(row => row.kind === 'proposal');
  compareInventory(proposalList.items, visibleProposals, '公开与磁盘提案库存');
  for (const row of visibleProposals) same(await call('wiki-proposal', { id: row.id }), row, '公开提案 ' + row.id);
  compareInventory(eventList.items, events, '公开与磁盘事件库存');
  return { version: 1, libraryId, sources, proposals, events };
}

function checkMaterials(tree, original, bindings, inventory, history) {
  history.sourceFiles = map();
  history.assets = map();
  const sources = byId(history.sources, '来源');
  same(Object.keys(bindings.sources).sort(), [...tree.sourceFiles].sort(), '原稿与绑定来源路径');
  same(Object.keys(bindings.assets).sort(), [...tree.assets].sort(), '原稿与绑定附件路径');
  for (const path of tree.sourceFiles) {
    const binding = own(bindings.sources, path);
    const sidecar = tree.sourceMetadata.get(path);
    const record = sources.get(binding?.id);
    check(record && (!sidecar || sidecar.id === record.id), '原稿来源没有匹配的旧库版本 ' + path);
    const { markdown, ...meta } = record;
    same(markdown, tree.byPath.get(path)?.markdown ?? tree.files.get(path).toString('utf8'), '来源正文 ' + path);
    if (sidecar) same(sidecar, meta, '来源旁注 ' + path);
    for (const [key, value] of Object.entries(binding)) {
      same(value, key === 'digest' ? hash(canonical(record)) : record[key], '来源绑定 ' + path + '/' + key);
    }
    history.sourceFiles[path] = meta;
  }
  const assets = new Map(inventory.assets.map(({ path, sha256 }) => [path, sha256]));
  check(assets.size === inventory.assets.length, '旧库附件库存重复');
  same([...assets.keys()].sort(), [...new Set(Object.values(bindings.assets).map(row => row.remotePath))].sort(),
    '副本与原稿绑定的附件库存');
  for (const path of tree.assets) {
    const binding = own(bindings.assets, path);
    check(binding && binding.sha256 === assets.get(binding.remotePath) && binding.sha256 === hash(tree.files.get(path)),
      '旧库附件与原稿绑定不符 ' + path);
    const historical = original?.assets?.[path];
    if (historical) {
      same([binding.remotePath, binding.sha256], [historical.remotePath, historical.sha256], '历史附件绑定 ' + path);
    }
    history.assets[path] = { remotePath: binding.remotePath, sha256: binding.sha256 };
  }
  // Exported rows preserve the original integer relation IDs. Settled private
  // bindings store string keys with digests of those exact rows.
  function relations(rows) {
    const entries = map();
    for (const row of rows) {
      check((Number.isSafeInteger(row.id) || (typeof row.id === 'string' && row.id)) &&
        !Object.hasOwn(entries, row.id), '结构化关系标识缺失或重复');
      entries[row.id] = { id: String(row.id), digest: hash(canonical(row)) };
    }
    return entries;
  }
  const nativeRelations = relations(inventory.relations);
  same(nativeRelations, relations(original?.relations ?? []), '原稿与原生结构化关系');
  same(nativeRelations, Array.isArray(bindings.relations) ? relations(bindings.relations) : bindings.relations,
    '绑定与原生结构化关系');
}

function boundDocument(tree, entry, binding, oldBinding, native, parent) {
  const path = entry.path;
  check(native && binding && nativeId.test(binding.remoteId) && binding.remoteId === native.id,
    '需要当前副本的文档绑定 ' + path);
  check(!binding.archived && !binding.archiveOp && !native.attrs[deletedAttr] &&
    !binding.reserved && !binding.needsSync && !binding.forceApply, '绑定未结算或已归档 ' + path);
  check(!oldBinding || (oldBinding.remoteId === native.id && !oldBinding.archived && !oldBinding.archiveOp),
    '历史绑定归属或归档状态冲突 ' + path);
  check(binding.parent === parent && native.parent === parent, '补读父卡不符 ' + path);
  if (!parent) {
    check(binding.path === path, '当前文档绑定的原稿路径不符 ' + path);
    check(!entry.metadata.siyuan_id || entry.metadata.siyuan_id === native.id, 'siyuan_id 与原生归属冲突 ' + path);
    check(oldBinding || entry.metadata.siyuan_id === native.id,
      '原稿缺少既有公开 ID，请从冻结副本另行导出含 siyuan_id 的隔离原稿 ' + path);
  }
  const legacy = native.attrs['custom-cd-meta'] && rawLegacyMeta(JSON.parse(native.attrs['custom-cd-meta']));
  check(!native.legacyFixedFields || legacy, '旧固定字段卡缺少原生概念元数据 ' + path);
  for (const record of [oldBinding, binding]) {
    check(record?.legacyMeta?.lifecycle_status !== 'archived' && legacy?.lifecycle_status !== 'archived',
      '原生或历史概念已归档 ' + path);
    if (record?.legacyId) same(record.legacyId, native.legacyId ?? legacy?.id, '概念绑定身份 ' + path);
    if (record?.legacyMeta) same(record.legacyMeta, legacy, '概念绑定元数据 ' + path);
  }
  const rawHash = parent ? hash(tree.files.get(path)) : entry.hash;
  check(binding.rawHash === rawHash && binding.revision === native.revision &&
    native.revision === documentRevision(native), '原稿或原生修订与冻结绑定不符 ' + path);
  check((entry.name ?? entry.title) === native.title, '原稿与原生文档标题不符 ' + path);
  return { id: native.id, legacyMeta: legacy };
}

function documentRecord(tree, entry, native, data, anchors) {
  const { id, title, markdown, revision, updated } = data;
  check(id === native.id && title === native.title && revision === native.revision &&
    markdown === documentMarkdown(native.raw) && /^\d{14}$/.test(updated), '公开文档与原生库存不符 ' + entry.path);
  check(data.editable === false && data.deletable === false && !data.anchor &&
    !data.shareable && !data.canArchive, '必须使用独立 Agent 的文档只读结果 ' + entry.path);
  const blocks = byId(native.blocks, '原生块');
  for (const block of data.blocks) check(blocks.has(block.id), '公开文档块归属不符 ' + block.id);
  for (const block of blocks.values()) {
    check(typeof block.content === 'string' || block.content === null, '缺少原生块搜索文本 ' + block.id);
  }
  const searchText = [native.title, ...native.blocks.map(block => block.content)].join('\n');
  const located = [];
  for (const [id, evidence] of Object.entries(anchors)) {
    const block = blocks.get(id);
    check(block && hash(block.markdown) === evidence.sha256, '旧锚点摘要或原生归属不符 ' + id);
    located.push({ id, markdown: block.markdown });
  }
  return { id, updated, revision, ...(located.length && { blocks: located }),
    frozenDocument: { rawSha256: hash(tree.files.get(entry.path)), data, blockIds: [...blocks.keys()].sort(), searchText } };
}

function frozenGet(native, data, owners, readingIds) {
  check(data.id === native.id && data.documentId === native.id && data.hash === hash(native.raw) &&
    data.markdown === readableMarkdown(normalize(native.raw)) &&
    data.schema === (native.legacyFixedFields ? 1 : 2), '旧 get 的公开身份、正文或原生哈希不符 ' + native.id);
  same(data.readings.map(row => row.id), readingIds, '旧 get 补读归属');
  for (const [index, reading] of data.readings.entries()) {
    const nativeReading = native.readings[index];
    same([reading.title, reading.markdown], [nativeReading.title, normalize(nativeReading.raw)], '旧 get 补读原文');
  }
  const sectionOwners = map();
  for (const section of data.sections) {
    const owner = owners.get(section.id);
    check(owner && !Object.hasOwn(sectionOwners, section.id) && section.hash === hash(section.markdown) &&
      (section.key === 'reading' ? readingIds.includes(owner) : owner === native.id), '旧 get 章节哈希或原生归属不符 ' + section.id);
    sectionOwners[section.id] = owner;
  }
  return { nativeMarkdown: native.raw, data, sectionOwners };
}

// Bracket the public reads with independent inventories of the selected copy.
export async function freezeObservedContent({ rawRoot, bindingsFile, wikiRoot, libraryId, origin, readInventory, call, output,
  archiveApproval, archiveApprovalSha256, readArchives, progress = () => {} }) {
  const raw = realpathSync(rawRoot);
  const copy = realpathSync(dirname(wikiRoot));
  const destination = outputPath(output, [raw, copy]);
  check(Boolean(archiveApproval) === Boolean(archiveApprovalSha256),'旧归档交割需要批准文件及独立摘要');
  const approval = archiveApproval && readArchiveApproval(archiveApproval,archiveApprovalSha256,libraryId);
  if (approval) progress('archive-inventory');
  const archives = approval && await readArchives(approval);
  const archiveTargets = approval && archiveReservations(approval,archives);
  const tree = loadRawTree(raw);
  const settlement = settledState(copy, libraryId, archives, tree);
  const completeBindings = json(bindingsFile);
  const bindings = activeArchiveBindings(completeBindings,archives,tree);
  progress('native-inventory');
  const inventory = await readInventory();
  check(libraryId && libraryId === inventory.identity && libraryId === bindings.identity && bindings.version === 1,
    '所选绑定与冻结副本的库身份不符');
  const originUrl = new URL(origin);
  check(origin === originUrl.origin && ['http:', 'https:'].includes(originUrl.protocol), '需要不含凭据的公开源地址');
  const original = tree.files.has('.sync.json') ? JSON.parse(tree.files.get('.sync.json')) : undefined;
  check(!original || (original.version === 1 && original.identity === libraryId), '原稿历史绑定属于另一知识库');
  check(!tree.cards.some(card => card.metadata.status === 'archived') &&
    ![...Object.values(bindings.cards), ...Object.values(bindings.readings)].some(row => row.archived),
  '活动库存不能证明已归档卡的更新时间、正文或身份，需另行核对归档副本');
  const nativeCards = byId(inventory.cards, '原生主卡');
  progress('public-list');
  const list = byId(await publicCards(call), '公开主卡');
  const metadata = { version: 1, libraryId, origin, cards: map(), readings: map(),
    ...(approval && {archiveApprovalSha256,archiveInventorySha256:hash(canonical(archives))}) };
  progress('public-history');
  const history = await collectHistory(call, wikiRoot, libraryId, inventory);
  metadata.history = historyInventory(history);
  checkMaterials(tree, original, bindings, inventory, history);
  const nativeBlockOwners = new Map();
  for (const card of inventory.cards) {
    for (const native of [card, ...card.readings]) {
      for (const block of native.blocks) {
        check(nativeId.test(block.id) && !nativeBlockOwners.has(block.id), '重复或无效的原生块身份');
        nativeBlockOwners.set(block.id, native.id);
      }
    }
  }
  for (const [index, card] of tree.cards.entries()) {
    if (index % 25 === 0) progress('public-cards', index, tree.cards.length);
    const binding = own(bindings.cards, card.id), oldBinding = original && own(original.cards, card.id);
    const native = nativeCards.get(binding?.remoteId);
    const { id, legacyMeta } = boundDocument(tree, card, binding, oldBinding, native);
    check(list.has(id) && !Object.hasOwn(metadata.cards, id), '活动卡缺失或身份重复 ' + card.path);
    const children = native.readings.map(r => r.id);
    const data = await call('get-document', { id });
    const legacy = await call('get', { id });
    same(legacy.legacyId, native.legacyId || (native.legacyFixedFields ? legacyMeta.id : undefined),
      '旧 get 概念身份 ' + id);
    check(data.updated === list.get(id).updated && data.title === list.get(id).title, '列表与文档更新时间或标题不符 ' + id);
    same(data.readings.map(r => r.id), children, '公开与原生补读顺序');
    same(card.readings.map(r => own(bindings.readings, r.path)?.remoteId), children, '原稿与原生补读顺序');
    const record = documentRecord(tree, card, native, data, { ...oldBinding?.anchors, ...binding.anchors });
    const snapshot = frozenGet(native, legacy, nativeBlockOwners, children);
    metadata.cards[id] = { ...record, ...(legacy.legacyId && { legacyId: legacy.legacyId }), ...(legacyMeta && { legacyMeta }),
      ...(native.legacyFixedFields && { legacyFixedFields: true, content: legacy.content }), frozenGet: snapshot };
    for (const [index, reading] of card.readings.entries()) {
      const bound = own(bindings.readings, reading.path), old = original && own(original.readings, reading.path);
      const child = native.readings[index];
      const { id: childId } = boundDocument(tree, reading, bound, old, child, id);
      const childData = await call('get-document', { id: childId });
      check(childData.readings.length === 0, '不支持嵌套补读 ' + reading.path);
      const childRecord = documentRecord(tree, reading, child, childData, { ...old?.anchors, ...bound.anchors });
      metadata.readings[reading.path] = childRecord;
    }
  }
  check(Object.keys(metadata.cards).length === nativeCards.size && list.size === nativeCards.size &&
    Object.keys(bindings.cards).length === nativeCards.size &&
    Object.keys(metadata.readings).length === Object.keys(bindings.readings).length, '活动原稿、公开卡或绑定库存不完整');
  progress('native-inventory-readback');
  same(await readInventory(), inventory, '冻结前后原生库存');
  compareInventory(await publicCards(call), [...list.values()], '冻结前后公开活动卡库存');
  const documents = [...Object.values(metadata.cards), ...Object.values(metadata.readings)];
  for (const [index, doc] of documents.entries()) {
    if (index % 25 === 0) progress('public-readback', index, documents.length);
    const { id } = doc;
    same(await call('get-document', { id }), doc.frozenDocument.data, '冻结前后公开投影 get-document/' + id);
    if (doc.frozenGet) same(await call('get', { id }), doc.frozenGet.data, '冻结前后公开投影 get/' + id);
  }
  const wiki = createWikiStore(wikiRoot, libraryId, { readOnly: true });
  same(historyInventory({ sources: wiki.listSources(), proposals: wiki.listProposals(), events: wiki.events() }),
    metadata.history, '冻结前后磁盘历史库存');
  same(json(bindingsFile), completeBindings, '冻结前后绑定');
  same(settledState(copy, libraryId, archives, tree), settlement, '冻结前后副本本地绑定');
  progress('compile-check');
  const compiledTree = loadContentTree(raw, metadata, history);
  check(tree.files.size === compiledTree.files.size &&
    [...tree.files].every(([path, bytes]) => compiledTree.files.get(path)?.equals(bytes)), '读取期间原稿文件发生变化');
  // Validate the re-read bytes with the real compiler before publishing either input.
  const materials = compileContentMaterials(compiledTree, history);
  const compiled = compileContentCards(compiledTree, metadata, materials);
  same(historyInventory(materials), metadata.history, '冻结与可编译的历史库存');
  const encoded = value=>JSON.stringify(value,null,2)+'\n';
  let frozenArchives;
  if (approval) {
    same(await readArchives(approval),archives,'冻结前后归档证据');
    const current = new Set(compiled.reservedIdentities.map(row=>row.ref));
    check(archiveTargets.every(([ref])=>!current.has(ref)), '归档身份与当前原稿或活动文档冲突');
    const approvalBytes = readFileSync(archiveApproval,'utf8');
    check(hash(approvalBytes)===archiveApprovalSha256, '归档决定在冻结时发生变化');
    frozenArchives = {version:1,libraryId,approvalBytes,archives,inputs:{
      approvalSha256:archiveApprovalSha256,metadataSha256:hash(encoded(metadata)),baselineSha256:hash(encoded(history)),
      rawSha256:hash([...tree.files.keys()].sort().map(path=>[path,hash(tree.files.get(path))]))}};
  }
  const coverage = { version: 1, libraryId, cards: list.size, readings: Object.keys(metadata.readings).length,
    sources: history.sources.length, proposals: history.proposals.length, events: history.events.length,
    nativeBlockOwners: nativeBlockOwners.size,
    ...(frozenArchives && {archivedCards:archives.length,frozenArchivesSha256:hash(encoded(frozenArchives))}),
    unverified: [frozenArchives ? '待删、删除账本及分享撤销状态须另行核对。' : '归档、待删、删除账本及分享撤销状态须另行核对。'] };
  const staged = mkdtempSync(join(dirname(destination), '.freeze-content-'));
  try {
    for (const [name, value] of Object.entries({ metadata, history, coverage, ...(frozenArchives && {'frozen-archives':frozenArchives}) })) {
      writeFileSync(join(staged, name + '.json'), encoded(value), { mode: 0o600, flag: 'wx' });
    }
    mkdirSync(destination, { mode: 0o700 });
    try { renameSync(staged, destination); }
    catch (error) { rmdirSync(destination); throw error; }
  } finally { rmSync(staged, { recursive: true, force: true }); }
  return coverage;
}

export async function freezeContentInputs({ rawRoot, bindingsFile, frozenRoot, libraryId, output, archiveApproval, archiveApprovalSha256, progress }) {
  const root = realpathSync(frozenRoot);
  const raw = realpathSync(rawRoot);
  const configured = fileURLToPath(new URL('../.local/knowledge', import.meta.url));
  const production = lstatSync(configured, { throwIfNoEntry: false }) ? realpathSync(configured) : configured;
  check(!within(production, root) && !within(root, production) && !within(raw, root) && !within(raw, production) &&
    !within(production, raw) && !within(production, realpathSync(bindingsFile)), '请选择隔离的冻结副本');
  outputPath(output, [root, raw, production]);
  const file = join(root, 'client.json');
  const client = json(file);
  const service = json(join(root, 'service.json'));
  const url = new URL(client.url);
  function privateFile(name) {
    if (!name || typeof name !== 'string' || isAbsolute(name)) return false;
    const file = resolve(root, name);
    return within(root, file) && realpathSync(file) === file && lstatSync(file).isFile();
  }
  check(['127.0.0.1', '[::1]'].includes(url.hostname) && client.url === url.origin &&
    client.tokenFile === service.agentTokenFile && privateFile(client.tokenFile),
  '冻结读取需要该副本的回环客户端和独立令牌文件');
  const kernel = json(join(root, 'kernel.json'));
  check(service.kernelConfig === 'kernel.json' && service.port === 3000 &&
    kernel.url === 'http://kernel:6806' && privateFile(kernel.tokenFile) &&
    resolve(root, kernel.tokenFile) !== resolve(root, client.tokenFile), '冻结读取需要 Compose 内核及其独立令牌');
  check(privateFile('compose.env'), '需要副本内的 Compose 环境文件');
  const envFile = join(root, 'compose.env');
  const port = /^CONCEPT_PORT=(\d+)\s*$/m.exec(readFileSync(envFile, 'utf8'))?.[1];
  check(service.publicUrl === client.url && url.protocol === 'http:' && port === (url.port || '80'),
    '回环客户端与所选 Compose 副本不符');
  const connection = connectRaw(root, { frozenReaderOrigin: client.url });
  try {
    return await freezeObservedContent({ rawRoot, bindingsFile, wikiRoot: join(root, 'wiki'), libraryId, origin: client.url,
      archiveApproval,archiveApprovalSha256,progress,readArchives:input=>connection.rpc('archive-inventory',input),
      readInventory: () => connection.rpc('inventory', { withBlocks: true }),
      call: (command, input) => connection.rpc('public-read', {command, input}), output });
  } finally { await connection.close(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const keys = ['raw-root', 'bindings', 'frozen-root', 'library-id', 'out'];
    const { values } = parseArgs({ options: { ...Object.fromEntries([...keys,'archive-approval','archive-approval-sha256'].map(key => [key, { type: 'string' }])), help: { type: 'boolean' }, progress: { type: 'boolean' } } });
    if (values.help) console.log('node scripts/freeze-content-inputs.mjs --raw-root RAW --bindings FILE --frozen-root ISOLATED_COMPOSE_ROOT --library-id ID --out NEW_DIR [--archive-approval FILE --archive-approval-sha256 SHA] [--progress]');
    else {
      for (const key of keys) check(values[key], '缺少显式参数 --' + key);
      const progress = values.progress ? (stage, done, total) => console.error(JSON.stringify({stage, done, total})) : undefined;
      const result = await freezeContentInputs({ rawRoot: values['raw-root'], bindingsFile: values.bindings, frozenRoot: values['frozen-root'], progress,
        libraryId: values['library-id'], output: values.out,archiveApproval:values['archive-approval'],archiveApprovalSha256:values['archive-approval-sha256'] });
      console.log(JSON.stringify({ cards: result.cards, readings: result.readings, sources: result.sources, proposals: result.proposals, events: result.events,
        ...(result.frozenArchivesSha256 && {archivedCards:result.archivedCards,frozenArchivesSha256:result.frozenArchivesSha256}) }));
    }
  } catch (error) {
    // Native JSON/argument/IO errors can quote credentials, input text or paths.
    const missing = /^缺少显式参数 --(raw-root|bindings|frozen-root|library-id|out)$/.test(error.message);
    const diagnostic = error.code === 'freeze_read_failed' && /^(?:http_[1-5]\d\d|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ABORT_ERR|EAI_AGAIN|invalid_read)$/.test(error.message);
    console.error(missing ? error.message : diagnostic ? '冻结失败。隔离读取返回 ' + error.message : '冻结失败。请核对隔离副本、原稿、绑定、公开库存与输出目录。');
    process.exitCode = 1;
  }
}
