import { posix } from 'node:path';
import { parseFragment } from 'parse5';
import { renderMarkdown } from '../server/render.mjs';
import { compileRawCard } from './raw-format.mjs';
import { canonical, hash } from './siyuan.mjs';
import { validateSourceSnapshot } from './wiki-store.mjs';

const digest = value => hash(canonical(value));
const byId = (a, b) => a.id.localeCompare(b.id, 'en');
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const hasDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const legacyId = /^(prop|evt)_(?:[a-f0-9]{16,64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;

function addRecord(records, record) {
  const previous = records.get(record.id);
  if (previous && digest(previous) !== digest(record)) throw new Error('相同 ID 对应不同记录：' + record.id);
  records.set(record.id, record);
}

function compileSources(tree, baseline, original) {
  const records = new Map(), paths = new Map();
  const add = (record, path) => {
    if (typeof record?.sourceId !== 'string') throw new Error('来源标识无效：' + path);
    try { validateSourceSnapshot(record); }
    catch (error) { throw new Error(path + '：' + error.message, { cause: error }); }
    addRecord(records, record);
  };
  for (const source of baseline.sources) add(source, source?.id ?? 'sources');
  const bindings = baseline.sourceFiles ?? {};
  if (!isObject(bindings)) throw new Error('sourceFiles 需要原稿路径到快照元数据的映射。');
  for (const path of Object.keys(bindings)) {
    if (!tree.sourceFiles.has(path)) throw new Error('来源映射的原稿文件缺失：' + path);
  }
  for (const path of tree.sourceFiles) {
    const sidecar = tree.sourceMetadata.get(path);
    const sidecarPath = posix.join(posix.dirname(path), posix.parse(path).name + '.json');
    if (!sidecar && sidecarPath !== path && tree.files.has(sidecarPath))
      throw new Error('来源旁注缺少快照标识或标题：' + sidecarPath);
    const supplied = Object.hasOwn(bindings, path) ? bindings[path] : undefined;
    if (sidecar && supplied && digest(sidecar) !== digest(supplied))
      throw new Error('来源映射与原稿旁注不符：' + path);
    const meta = sidecar ?? supplied;
    if (!isObject(meta)) throw new Error('来源缺少版本化元数据，请添加同名 JSON 或 baseline.sourceFiles 条目：' + path);
    // A source article exports its body. Ordinary text files preserve their exact bytes,
    // including BOM, newlines and trailing whitespace, as in the original snapshot API.
    const markdown = tree.byPath.get(path)?.markdown ?? tree.files.get(path).toString('utf8');
    if (Object.hasOwn(meta, 'markdown') && meta.markdown !== markdown)
      throw new Error('原稿内容与来源元数据不符：' + path);
    const record = { ...meta, markdown };
    add(record, path);
    paths.set(path, record.id);
  }

  // An old binding is evidence that the immutable version was published, even if
  // its raw file was moved or now describes a newer version.
  for (const [path, old] of Object.entries(original.sources ?? {})) {
    const found = records.get(old?.id);
    if (!found || Object.entries(old).some(([key, value]) => found[key] !== value))
      throw new Error('已发布的原文版本缺失或元数据不符：' + path);
  }
  const versions = new Map();
  for (const source of records.values()) {
    const group = versions.get(source.sourceId) ?? new Set();
    if (group.has(source.version)) throw new Error('同一来源版本对应不同快照：' + source.sourceId);
    group.add(source.version);
    versions.set(source.sourceId, group);
  }
  for (const [id, group] of versions) {
    for (let expected = 1; expected <= group.size; expected++) {
      if (!group.has(expected)) throw new Error('来源缺少历史版本 ' + expected + '：' + id);
    }
  }
  return { sources: [...records.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt) || b.version - a.version || byId(a, b)),
    sourceUrl(path) {
      if (!paths.has(path)) throw new Error('无法解析来源文件：' + path);
      return '/wiki?source=' + paths.get(path);
    } };
}

function archive(records, prefix) {
  const unique = new Map();
  for (const row of records) {
    if (!isObject(row) || typeof row.id !== 'string' || legacyId.exec(row.id)?.[1] !== prefix || !hasDate(row.createdAt))
      throw new Error('历史记录的标识或日期无效：' + prefix);
    if (prefix === 'prop') {
      const { revision, ...record } = row;
      if (!hasDate(row.updatedAt) || revision !== digest(record))
        throw new Error('提案修订校验失败：' + row.id);
    }
    addRecord(unique, row);
  }
  return [...unique.values()].sort((a, b) =>
    (prefix === 'prop' ? b.updatedAt.localeCompare(a.updatedAt) : a.createdAt.localeCompare(b.createdAt)) || byId(a, b));
}

// Only links and images that the reader can reach own a published binary. In
// particular, an unused Markdown reference definition does not publish a file.
function assetOwners(tree, sourceUrl) {
  const owners = new Map(), referenced = new Set();
  const archivedReadings = new Set(tree.cards.filter(card => card.metadata.status === 'archived')
    .flatMap(card => card.readings.map(reading => reading.path)));
  for (const card of tree.cards) {
    if (card.metadata.status === 'archived') continue;
    const tokens = new Map(), paths = new Map();
    const compiled = compileRawCard(tree, card, {
      cardUrl: id => tree.byId.get(id)?.metadata.status === 'archived' ? null : '/cards/' + id,
      readingUrl: path => archivedReadings.has(path) ? null : '/cards/reading',
      sourceUrl,
      assetUrl(path) {
        if (!tokens.has(path)) {
          const token = '/assets/candidate-' + tokens.size;
          tokens.set(path, token);
          paths.set(token, path);
          referenced.add(path);
        }
        return tokens.get(path);
      },
    });
    if (!tokens.size) continue;
    function collect(markdown, owner) {
      function visit(node) {
        const key = node.tagName === 'img' ? 'src' : node.tagName === 'a' ? 'href' : null;
        const url = key && node.attrs.find(attr => attr.name === key)?.value;
        const path = url && paths.get(url.split(/[?#]/, 1)[0]);
        if (path) {
          const set = owners.get(path) ?? new Set();
          set.add(owner);
          owners.set(path, set);
        }
        for (const child of node.childNodes ?? []) visit(child);
      }
      visit(parseFragment(renderMarkdown(markdown)));
    }
    collect(compiled.markdown, card.id);
    for (const reading of compiled.readings) collect(reading.markdown, reading.path);
  }
  return { owners, referenced };
}

const assetTypes = {
  '.png': ['image/png', bytes => bytes.length >= 45 &&
    bytes.subarray(0, 16).toString('hex') === '89504e470d0a1a0a0000000d49484452' &&
    bytes.subarray(-12).toString('hex') === '0000000049454e44ae426082'],
  '.jpg': ['image/jpeg', bytes => bytes.subarray(0, 3).toString('hex') === 'ffd8ff' &&
    bytes.lastIndexOf(Buffer.from([0xff, 0xd9])) >= 3],
  '.gif': ['image/gif', bytes => bytes.length > 13 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6)) &&
    bytes.at(-1) === 0x3b],
  '.webp': ['image/webp', bytes => bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length],
  '.avif': ['image/avif', bytes => bytes.length >= 16 && bytes.toString('ascii', 4, 8) === 'ftyp' &&
    (bytes.toString('ascii', 8, 12) === 'avif' || bytes.toString('ascii', 8, 12) === 'avis') &&
    bytes.readUInt32BE(0) <= bytes.length],
  '.svg': ['image/svg+xml', bytes => {
    const document = parseFragment(bytes.toString('utf8'));
    const roots = document.childNodes.filter(node => node.tagName);
    return roots.length === 1 && roots[0].tagName === 'svg' &&
      roots[0].namespaceURI === 'http://www.w3.org/2000/svg';
  }],
  '.pdf': ['application/pdf', bytes => bytes.toString('ascii', 0, 5) === '%PDF-' &&
    bytes.subarray(-1024).includes('%%EOF')],
};

function assetFile(path, bytes) {
  let ext = posix.extname(path).toLowerCase();
  if (ext === '.jpeg') ext = '.jpg';
  const known = assetTypes[ext];
  if (known) {
    if (!known[1](bytes)) throw new Error('附件类型与文件内容不符或文件不完整：' + path);
    return { ext, mime: known[0] };
  }
  // Other files (including CSV and plain text) keep their download semantics.
  // Source snapshots, sidecars and reading Markdown use dedicated contracts.
  if (['.md', '.markdown', '.json'].includes(ext) || !bytes.length)
    throw new Error('该文件不是可分发的阅读附件：' + path);
  return { ext: '.bin', mime: 'application/octet-stream' };
}

function compileAssets(tree, baseline, original, sourceUrl) {
  const { owners, referenced } = assetOwners(tree, sourceUrl);
  const assets = new Map(), routes = new Map();
  const legacyAssets = baseline.assets ?? original.assets ?? {};
  if (!isObject(legacyAssets)) throw new Error('assets 需要原稿路径到旧附件绑定的映射。');
  function route(path, sha256) {
    if (routes.has(path) && routes.get(path) !== sha256) throw new Error('附件 URL 映射冲突：' + path);
    routes.set(path, sha256);
  }
  for (const path of [...owners.keys()].sort()) {
    const bytes = tree.files.get(path);
    const { ext, mime } = assetFile(path, bytes);
    const sha256 = hash(bytes), filename = sha256 + ext;
    route('assets/' + filename, sha256);
    const asset = {path, hash: sha256, filename, mime, bytes, owners: [...owners.get(path)].sort()};
    const legacy = Object.hasOwn(legacyAssets, path) ? legacyAssets[path] : original.assets?.[path];
    if (legacy !== undefined) {
      if (legacy?.sha256 !== sha256) throw new Error('旧附件绑定的哈希与文件内容不符：' + path);
      if (typeof legacy.remotePath !== 'string' || !legacy.remotePath.startsWith('assets/') ||
          legacy.remotePath.split('/').some(part => !part || part.startsWith('.') || /[\\\x00-\x1f%?#]/.test(part)))
        throw new Error('旧附件路径无效：' + path);
      route(legacy.remotePath, sha256);
      asset.legacyPath = legacy.remotePath;
    }
    assets.set(path, asset);
  }
  return {assets: [...assets.values()], assetUrl(path) {
    if (assets.has(path)) return '/assets/' + assets.get(path).filename;
    if (referenced.has(path)) return null; // An unused definition, stripped from the compiled Markdown.
    throw new Error('无法解析活动附件：' + path);
  }};
}

export function compileContentMaterials(tree, baseline) {
  if (baseline?.version !== 1 || !['sources', 'proposals', 'events'].every(key => Array.isArray(baseline[key])))
    throw new Error('需要版本 1 的历史资料基线和显式 sources、proposals、events 数组。');
  const original = tree.files.has('.sync.json') ? JSON.parse(tree.files.get('.sync.json').toString('utf8')) : {};
  const {sources, sourceUrl} = compileSources(tree, baseline, original);
  const proposals = archive(baseline.proposals, 'prop');
  const snapshots = new Set(sources.map(record => record.id));
  for (const proposal of proposals) {
    if (proposal.kind === 'proposal' && proposal.sourceId !== undefined && !snapshots.has(proposal.sourceId))
      throw new Error('历史提案引用的原文快照缺失：' + proposal.id);
  }
  return {sources, sourceUrl, ...compileAssets(tree, baseline, original, sourceUrl),
    proposals, events: archive(baseline.events, 'evt')};
}
