// Export a frozen, read-only inventory. The destination must be new.
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { stringify } from 'yaml';
import { hash } from '../lib/siyuan.mjs';
import { sourceSnapshotId } from '../lib/wiki-store.mjs';
import { exportRawMarkdown, loadRawTree, writeRawCardBody } from '../lib/raw-format.mjs';
import { rawLegacyMeta } from '../lib/raw-write.mjs';
import { sealRawBindings, verifiedUpdated } from './raw-sync.mjs';
import { documentTags } from '../lib/card-list.mjs';

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const documentId = /^\d{14}-[a-z0-9]{7}$/;
const byText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const unique = values => [...new Set(values.filter(Boolean))];
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const arrayMap = (map, key, value) => {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
};
const demand = (condition, message) => { if (!condition) throw new Error(message); };
const quoteLabel = value => value.replace(/([\\\[\]])/g, '\\$1').replace(/\r?\n/g, ' ');
const link = (title, path) => '[' + quoteLabel(title) + '](<' + path.replaceAll('>', '%3E') + '>)';
const article = (meta, body) => '---\n' + stringify(meta, { lineWidth: 0 }) + '---\n\n' + body + (body.endsWith('\n') ? '' : '\n');
const names = new Set(['README.md', '.', '..']);
const headingName = node => node.children.map(n => n.value ?? '').join('').trim().replace(/^中文\s*[·・]\s*/, '');
const sentence = new Intl.Segmenter('zh', { granularity: 'sentence' });
const trimBlank = text => text.replace(/^(?:[ \t]*\r?\n)+|(?:\r?\n[ \t]*)+$/g, '');

// Move only structurally recognized sections. Slicing original ranges keeps
// literal headings in code and rich content in mixed metadata sections intact.
export function normalizeRawCard(markdown, { description } = {}) {
  const nodes = fromMarkdown(markdown).children, sections = [];
  for (const [i, heading] of nodes.entries()) {
    if (heading.type !== 'heading' || heading.depth !== 2) continue;
    let j = i + 1;
    while (j < nodes.length && !(nodes[j].type === 'heading' && nodes[j].depth <= heading.depth)) j++;
    sections.push({ name: headingName(heading), start: heading.position.start.offset, textStart: heading.position.end.offset,
      end: nodes[j]?.position.start.offset ?? markdown.length, nodes: nodes.slice(i + 1, j) });
  }
  const core = ['核心理解', '理解', '原理与用法'].flatMap(name => sections.filter(s => s.name === name && s.nodes.length))[0];
  const introductory = nodes[0]?.type === 'paragraph' ? nodes[0] : undefined;
  demand(core || introductory, '找不到可以保真的核心理解段落');
  const coreText = core ? trimBlank(markdown.slice(core.textStart, core.end))
    : markdown.slice(introductory.position.start.offset, introductory.position.end.offset);
  demand(coreText.trim(), '核心理解为空');
  const remove = [core ?? { start: introductory.position.start.offset, end: introductory.position.end.offset }];
  function metadata(name) {
    const values = [];
    for (const s of sections.filter(s => s.name === name)) {
      const entries = s.nodes.flatMap(n => n.type === 'list' ? n.children.flatMap(item =>
        item.children.length === 1 && !item.checked ? item.children : [null]) : [n]);
      if (!entries.length || !entries.every(n => n?.type === 'paragraph' && n.children.every(c => c.type === 'text'))) continue;
      const simple = entries.map(n => n.children.map(c => c.value).join('').replaceAll('\u200b', '').trim());
      if (simple.some(v => !v || v.includes('\n'))) continue;
      values.push(...simple);
      remove.push(s);
    }
    return unique(values);
  }
  const aliases = metadata('别名');
  const tags = metadata('标签').filter(tag => !/^学科\s*[:：]/.test(tag));
  let remainder = markdown;
  for (const { start, end } of remove.sort((a, b) => b.start - a.start)) {
    remainder = remainder.slice(0, start) + remainder.slice(end);
  }
  const paragraph = (core?.nodes ?? [introductory]).find(n => n.type === 'paragraph' && n.children.every(c => c.type === 'text'));
  const plain = paragraph?.children.map(c => c.value).join('').trim() ?? '';
  const summary = [description, sentence.segment(plain).containing(0)?.segment].find(s => typeof s === 'string' &&
    /\p{Script=Han}/u.test(s) && !/[\r\n]/.test(s.trim()))?.trim();
  return { markdown: ['## 核心理解', coreText, trimBlank(remainder)].filter(Boolean).join('\n\n'),
    ...(summary && { description: summary }), ...(aliases.length && { aliases }), ...(tags.length && { tags }) };
}

/** The incremental exporter supplies a frozen snapshot and real link bindings. */
export function exportDatabaseCard({path,original,rawId,document,archivedAt,links,previousId}) {
  const body=exportRawMarkdown(document.markdown,{...links,cardPath:path});
  const {markdown,aliases,tags}=normalizeRawCard(body);
  const nodes=fromMarkdown(markdown).children;
  const heading = section => nodes.findIndex(node=>node.type==='heading' && node.depth===2 && headingName(node)===section);
  function field(section,index=heading(section)) {
    if (index===-1) return undefined;
    const next=nodes[index+1];
    return next && (next.type!=='heading' || next.depth>2) ? next : null;
  }
  const summary=field('摘要');
  const simpleSummary=summary?.type==='paragraph' && summary.children.every(child=>child.type==='text')
    ? summary.children.map(child=>child.value).join('').trim() : undefined;
  const description=summary===null ? null : simpleSummary && !/[\r\n]/.test(simpleSummary) ? simpleSummary : undefined;
  const aliasValues=aliases?.flatMap(value=>value.split('、').map(part=>part.trim()).filter(Boolean));
  const nativeTags=documentTags(body,{proseOnly:true});
  const disciplinePattern=/^学科\s*[:：]\s*/;
  const tagDisciplines=nativeTags.filter(value=>disciplinePattern.test(value)).map(value=>value.replace(disciplinePattern,''));
  // An existing raw path has a primary discipline. Losing the last native
  // tag must be surfaced instead of silently recreating it on a rebuild.
  const disciplines=document.disciplines ?? (original!=null || tagDisciplines.length ? tagDisciplines : undefined);
  return writeRawCardBody(path,original,{rawId,id:document.id,title:document.title,markdown,archivedAt,previousId,
    aliases:aliasValues??(field('别名')?undefined:[]),
    tags:tags ? nativeTags.filter(value=>!disciplinePattern.test(value)) : (field('标签')?undefined:[]),description,disciplines});
}

function safeDiscipline(name) {
  demand(typeof name === 'string' && name.trim() === name && name.length && !names.has(name) &&
    !/[\x00-\x1f\/\\#%<>]/u.test(name) && !name.startsWith('.'), '学科目录名无效');
  return name;
}

async function readLedger(dir) {
  const rows = [];
  for (const file of (await readdir(dir)).sort(byText)) {
    if (file.endsWith('.json')) rows.push(await json(join(dir, file)));
  }
  return rows;
}

export async function readExportCatalog(ledgerDir, modelsDir) {
  const [cards, sources, models, manifest] = await Promise.all([
    readLedger(join(ledgerDir, 'cards')), readLedger(join(ledgerDir, 'sources')),
    json(join(modelsDir, 'models.json')), json(join(modelsDir, 'manifest.json')),
  ]);
  return { cards, sources, models, disciplines: manifest.disciplines };
}

function cardIndex(inventory, catalog) {
  const keys = new Map(catalog.cards.map(({ id, key }) => [id, key]));
  const models = new Map();
  for (const model of catalog.models) arrayMap(models, model.id, model);
  const used = new Set();
  const cards = inventory.cards.map(doc => {
    const legacy = doc.legacyId?.replace(/^concept[:/]/, '');
    const key = keys.get(doc.id) ?? (slug.test(legacy ?? '') ? legacy : 'card-' + doc.id);
    demand(slug.test(key) && !used.has(key), '知识卡标识无效或重复 ' + key);
    demand(documentId.test(doc.id), '思源文档标识无效 ' + key);
    used.add(key);
    const rows = models.get(key) ?? [];
    const disciplines = unique([...doc.tags.flatMap(t => /^学科\s*[:：]\s*(.+)$/.exec(t)?.slice(1) ?? []),
      ...rows.map(row => row.discipline)]).map(safeDiscipline);
    const discipline = disciplines[0] ?? '未分类';
    const path = posix.join(discipline, key, 'article.md');
    return { doc, key, rows, disciplines, discipline, path, folder: posix.dirname(path), sources: new Set(), readings: [] };
  });
  return cards.sort((a, b) => byText(a.path, b.path));
}

function registerDocuments(cards) {
  const identifiers = new Map(), aliases = new Map();
  function add(id, ref) {
    demand(!identifiers.has(id), '重复文档或块标识 ' + id);
    identifiers.set(id, ref);
  }
  function register(doc, path) {
    add(doc.id, { path });
    if (doc.legacyId) aliases.set(doc.legacyId, aliases.has(doc.legacyId) ? null : { path });
    for (const block of doc.blocks ?? []) {
      add(block.id, { path, fragment: block.id, block });
    }
  }
  for (const card of cards) {
    register(card.doc, card.path);
    for (const doc of card.doc.readings) {
      demand(documentId.test(doc.id), '补充阅读文档标识无效');
      const path = posix.join(card.folder, 'assets', 'reading-' + doc.id + '.md');
      register(doc, path);
      card.readings.push({ doc, path });
    }
  }
  return id => identifiers.get(id) ?? aliases.get(id);
}

async function writeRelative(root, file, data) {
  const target = join(root, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data, { flag: 'wx' });
}

function sourceMetadata(source) {
  const { id, sourceId, title, author, url, createdAt, version, hash: digest } = source;
  demand(id === sourceSnapshotId(source) && /^src_(?:[a-f0-9]{16,64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(sourceId) &&
    Number.isSafeInteger(version) && version > 0 && hash(source.markdown) === digest, '原始资料身份或哈希无效 ' + id);
  return { id, sourceId, title, author, url, createdAt, version, hash: digest };
}

async function writeSources({ inventory, catalog, cards, root, bindings, origin }) {
  const byKey = new Map(cards.map(card => [card.key, card]));
  const sources = new Map(inventory.sources.map(s => [s.id, s]));
  const owners = new Map();
  for (const row of catalog.sources) {
    const source = sources.get(row.sourceId);
    if (!source) continue;
    demand(row.hash === source.hash, '来源章节哈希与快照不符 ' + row.sourceId);
    const card = byKey.get(row.key);
    if (card) arrayMap(owners, source.id, card);
  }
  for (const card of cards) {
    for (const doc of [card.doc, ...card.doc.readings]) {
      if (!doc.markdown.includes('/wiki')) continue;
      exportRawMarkdown(doc.markdown, {
        cardPath: card.path, origin, assetPath: () => card.path, documentPath: () => card.path,
        sourcePath(id) {
          demand(sources.has(id), '找不到卡片引用的原文 ' + id);
          if (!owners.get(id)?.includes(card)) arrayMap(owners, id, card);
          return card.path;
        },
      });
    }
  }
  const paths = new Map(), unfiled = [];
  for (const source of inventory.sources) {
    const meta = sourceMetadata(source);
    const ownersForSource = owners.get(source.id) ?? [];
    // IDs distinguish separate immutable imports even when their text is identical.
    const key = 'source-' + source.id.slice(4);
    const folder = ownersForSource[0]?.folder ?? posix.join('未归档', key);
    const file = posix.join(folder, 'assets', key + '.md');
    demand(!paths.has(source.id), '重复原文快照 ' + source.id);
    paths.set(source.id, file);
    bindings.sources[file] = meta;
    await writeRelative(root, file, source.markdown);
    await writeRelative(root, file.slice(0, -3) + '.json', JSON.stringify(meta, null, 2) + '\n');
    for (const card of ownersForSource) card.sources.add(file);
    if (!ownersForSource.length) {
      const path = posix.join(folder, 'article.md'), relative = posix.relative(folder, file);
      const lines = [link('阅读原始资料', relative)];
      if (meta.author) lines.push('作者：' + meta.author);
      if (meta.url) lines.push('出处：' + meta.url);
      await writeRelative(root, path, article({ kind: 'source', id: key, name: meta.title, sources: [relative] }, lines.join('\n\n')));
      unfiled.push({ path, title: meta.title });
    }
  }
  return { paths, unfiled };
}

function assetRegistry(assets) {
  const files = new Map();
  for (const asset of assets) {
    demand(typeof asset.path === 'string' && asset.path.startsWith('assets/') &&
      asset.path.split('/').every(part => part && !part.startsWith('.') && !/[\\\x00-\x1f]/.test(part)) &&
      /^[a-f0-9]{64}$/.test(asset.sha256) && !files.has(asset.path), '附件清单含无效或重复路径');
    files.set(asset.path, { ...asset });
  }
  return files;
}

async function copyAssets({ assets, assetsDir, bindings, root, unfiled }) {
  const folder = '未归档/library-attachments', unattached = [];
  const base = await realpath(assetsDir);
  for (const [remotePath, record] of assets) {
    if (!record.file) {
      record.file = posix.join(folder, remotePath);
      unattached.push(link(posix.basename(remotePath), remotePath));
    }
    const from = join(base, remotePath.slice('assets/'.length));
    // Recheck the frozen physical file. A symlink substitution must not escape the asset directory.
    demand(await realpath(from) === from && (await lstat(from)).isFile(), '附件文件无效 ' + remotePath);
    const bytes = await readFile(from);
    demand(hash(bytes) === record.sha256, '附件在冻结后发生变化 ' + remotePath);
    await writeRelative(root, record.file, bytes);
    bindings.assets[record.file] = { remotePath, sha256: record.sha256 };
  }
  if (unattached.length) {
    const path = posix.join(folder, 'article.md'), title = '未关联知识卡的附件';
    await writeRelative(root, path, article({ id: 'library-attachments', name: title, kind: 'source', attachments_only: true },
      '这些附件保存在知识库中。当前活跃卡和补充阅读均未引用它们。\n\n' + unattached.map(l => '- ' + l).join('\n')));
    unfiled.push({ path, title });
  }
  return unattached.length;
}

async function writeGuides(root, cards, catalog, unfiled) {
  const directories = new Map();
  const topics = new Map(catalog.disciplines.map(d => [d.title, d.description]));
  for (const card of cards) {
    for (const name of unique([card.discipline, ...card.disciplines])) {
      arrayMap(directories, name, { path: card.path, title: card.doc.title,
        order: card.rows.find(r => r.discipline === name)?.number ?? Infinity });
    }
  }
  for (const material of unfiled) arrayMap(directories, '未归档', material);
  const table = ['| 学科 | 收录 |', '| --- | ---: |'];
  for (const discipline of unique([...topics.keys(), ...directories.keys()]).filter(d => directories.has(d))) {
    const entries = directories.get(discipline).sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || byText(a.path, b.path));
    const intro = topics.get(discipline);
    const lines = ['# ' + discipline, ...(intro ? ['', intro] : []), '', discipline === '未归档' ? '## 材料' : '## 阅读顺序', ''];
    for (const [i, entry] of entries.entries()) lines.push((i + 1) + '. ' + link(entry.title, posix.relative(discipline, entry.path)));
    await writeRelative(root, posix.join(discipline, 'README.md'), lines.join('\n') + '\n');
    table.push('| ' + link(discipline, discipline + '/README.md') + ' | ' + entries.length + ' |');
  }
  const intro = '# 本地知识卡 Wiki\n\n从学科导读进入知识卡。兼属多个学科的卡可以从各学科导读打开。卡片目录中的 `assets/` 保存附件、原文和补充阅读。\n\n';
  const how = '\n\n## 编写原稿\n\n在学科目录下按英文标识建目录，编辑其中的 `article.md`。在 YAML 填写名称，在「核心理解」中写正文，本卡材料放在 `assets/`。\n';
  await writeRelative(root, 'README.md', intro + table.join('\n') + how);
}

// A new directory becomes visible only after every file, reference, hash and binding succeeds.
export async function exportInventory({ inventory, catalog = { cards: [], sources: [], models: [], disciplines: [] },
  assetsDir, outputDir, origin, assetCorrections = [] }) {
  const target = resolve(outputDir);
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, '.' + basename(target) + '-'));
  try {
    const bindings = { version: 1, identity: inventory.identity, cards: {}, readings: {}, assets: {}, sources: {}, relations: inventory.relations };
    const cards = cardIndex(inventory, catalog), lookup = registerDocuments(cards);
    const { paths, unfiled } = await writeSources({ inventory, catalog, cards, root, bindings, origin });
    const assets = assetRegistry(inventory.assets), anchors = new Map();
    const corrections = new Map(), corrected = new Set(), repairs = new Map();
    for (const entry of assetCorrections) {
      demand(!assets.has(entry.from) && assets.get(entry.to)?.sha256 === entry.sha256 && documentId.test(entry.documentId),
        '附件修正清单必须从缺失路径明确指到经 SHA-256 核实的文件');
      const key = entry.documentId + '/' + entry.from;
      demand(!corrections.has(key), '附件修正清单重复');
      corrections.set(key, entry);
      arrayMap(repairs, entry.documentId, { from: entry.from, to: entry.to });
    }
    function convert(doc, path, card) {
      const body = doc.markdown;
      return exportRawMarkdown(body, {
        cardPath: path, origin,
        documentPath(id, fragment) {
          const target = lookup(id);
          const anchor = documentId.test(fragment) ? lookup(fragment) : target;
          if (documentId.test(fragment)) demand(anchor?.block && target?.path === anchor.path, '引用的块不属于目标文档 ' + fragment);
          if (anchor?.block) {
            if (!anchors.has(anchor.path)) anchors.set(anchor.path, {});
            anchors.get(anchor.path)[anchor.fragment] = { sha256: hash(anchor.block.markdown ?? '') };
          }
          return target;
        },
        assetPath(remote) {
          const key = doc.id + '/' + remote;
          const correction = corrections.get(key);
          if (correction) corrected.add(key);
          const asset = assets.get(correction?.to ?? remote);
          if (!asset) return undefined;
          asset.file ??= posix.join(card.folder, asset.path);
          return asset.file;
        },
        sourcePath(id) {
          const path = paths.get(id);
          if (path) card.sources.add(path);
          return path;
        },
      });
    }
    for (const card of cards) {
      const { doc, key, folder, path } = card;
      const { markdown: body, ...fields } = normalizeRawCard(convert(doc, path, card), {
        description: card.rows.find(row => typeof row.description === 'string' && /\p{Script=Han}/u.test(row.description))?.description,
      });
      const meta = { id: key, name: doc.title, siyuan_id: doc.id, ...fields };
      if (card.disciplines.length > 1) meta.also_in = card.disciplines.slice(1);
      for (const reading of card.readings) {
        await writeRelative(root, reading.path, convert(reading.doc, reading.path, card));
        bindings.readings[reading.path] = { remoteId: reading.doc.id, revision: reading.doc.revision, updated: verifiedUpdated(reading.doc), parent: doc.id,
          ...(repairs.has(reading.doc.id) && { needsSync: true, repairs: repairs.get(reading.doc.id) }) };
      }
      if (card.sources.size) meta.sources = [...card.sources].map(s => posix.relative(folder, s));
      if (card.readings.length) meta.readings = card.readings.map(r => ({ title: r.doc.title, path: posix.relative(folder, r.path) }));
      await writeRelative(root, path, article(meta, body));
      const legacyMeta = doc.attrs?.['custom-cd-meta'];
      bindings.cards[key] = { remoteId: doc.id, revision: doc.revision, updated: verifiedUpdated(doc), path, ...(doc.legacyId && { legacyId: doc.legacyId }),
        ...(legacyMeta && { legacyMeta: rawLegacyMeta(JSON.parse(legacyMeta)) }),
        ...(repairs.has(doc.id) && { needsSync: true, repairs: repairs.get(doc.id) }) };
    }
    demand(corrected.size === corrections.size, '附件修正清单包含未遇到的地址');
    for (const record of Object.values(bindings.cards)) {
      if (anchors.has(record.path)) record.anchors = anchors.get(record.path);
    }
    for (const [file, record] of Object.entries(bindings.readings)) {
      if (anchors.has(file)) record.anchors = anchors.get(file);
    }
    const unreferencedAssets = await copyAssets({ assets, assetsDir, bindings, root, unfiled });
    await writeGuides(root, cards, catalog, unfiled);
    const tree = await loadRawTree(root);
    const sealed = await sealRawBindings(tree, bindings);
    await writeRelative(root, '.sync.json', JSON.stringify(sealed, null, 2) + '\n');
    await mkdir(target); // Exclusive claim, including parallel exporters.
    await rename(root, target);
    return { cards: cards.length, readings: Object.keys(bindings.readings).length,
      sources: paths.size, assets: assets.size, unreferencedAssets, correctedAssetPaths: corrected.size,
      referencedBlocks: [...anchors.values()].reduce((sum, group) => sum + Object.keys(group).length, 0) };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { positionals, values: { ledger, models, origin, 'asset-corrections': correctionFile } } = parseArgs({ allowPositionals: true,
      options: { ledger: { type: 'string' }, models: { type: 'string' }, origin: { type: 'string' }, 'asset-corrections': { type: 'string' } } });
    const [inventoryPath, assetsDir, outputDir] = positionals;
    demand(positionals.length === 3 && Boolean(ledger) === Boolean(models),
      '用法: node scripts/raw-export.mjs INVENTORY ASSET_DIR NEW_OUTPUT_DIR [--ledger=DIR --models=DIR] [--origin=URL] [--asset-corrections=FILE]');
    const [inventory, catalog, assetCorrections] = await Promise.all([
      json(inventoryPath), ledger && readExportCatalog(ledger, models), correctionFile && json(correctionFile),
    ]);
    console.log(JSON.stringify(await exportInventory({ inventory, catalog, assetsDir, outputDir, origin, assetCorrections })));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
