import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { parse, postprocess, preprocess } from 'micromark';
import { decodeString } from 'micromark-util-decode-string';
import { parseFragment } from 'parse5';
import { parse as parseYaml, parseDocument as parseYamlDocument } from 'yaml';
import { tagsFromNodes } from './card-list.mjs';
import { escapeText } from './markdown.mjs';

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const blockId = /^\d{14}-[a-z0-9]{7}$/;
const own = (object, key) => Object.hasOwn(object, key);
const plain = node => node.value ?? (node.children ?? []).map(plain).join('');
const unique = values => [...new Set(values)];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const labelText = s => s.replace(/[\\\[\]]/g, '\\$&');
const inactiveLabel = text => text.replace(/[!-/:-@\[-`{-~]/g, char => `&#${char.charCodeAt(0)};`);
const urlPath = path => path.split('/').map(encodeURIComponent).join('/').replace(/[()]/g, c => c === '(' ? '%28' : '%29');
const trimBlankLines = text => text.replace(/^(?:[ \t]*\r?\n)+|(?:\r?\n[ \t]*)+$/g, '');
const fail = (file, message) => { throw new Error(`${file}: ${message}`); };
const exportConflict = (file,message) => {
  throw Object.assign(new Error(`${file}: ${message}`),{code:'content_conflict'});
};
const frontMatter = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function textFile(files, file) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(files.get(file)); }
  catch { fail(file, '需要 UTF-8 文本'); }
}

function readFiles(root) {
  const files = new Map();
  function walk(relative) {
    const absolute = join(root, relative);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) fail(relative || root, '不支持符号链接');
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        // macOS may expose decomposed paths. Store one canonical spelling in the index.
        walk(posix.join(relative, name));
      }
    } else if (stat.isFile()) {
      if (!relative) fail(root, '需要原稿目录');
      const canonical = relative.normalize('NFC');
      if (files.has(canonical)) fail(relative, '文件路径重复');
      files.set(canonical, readFileSync(absolute));
    } else fail(relative, '需要普通文件或目录');
  }
  walk('');
  return files;
}

// Resolve only against the frozen inventory. No path taken from Markdown or YAML
// is passed back to the filesystem.
function localPath(files, base, value) {
  if (!value || /[\\\u0000-\u001f]/.test(value) || posix.isAbsolute(value) || /^[a-z][a-z\d+.-]*:/i.test(value))
    fail(base, `不支持的本地路径 ${value}`);
  const path = posix.join(posix.dirname(base), value).normalize('NFC');
  if (path === '..' || path.startsWith('../')) fail(base, `路径越过原稿目录 ${value}`);
  if (!files.has(path)) fail(base, `找不到本地文件 ${value}`);
  return path;
}

function validateCore(path, markdown) {
  const nodes = fromMarkdown(markdown).children;
  const cores = nodes.map((node, i) => node.type === 'heading' && node.depth === 2 && plain(node).trim() === '核心理解' ? i : -1)
    .filter(i => i >= 0);
  if (cores.length !== 1) fail(path, '卡片需要唯一的二级标题「核心理解」');
  const visible = value => typeof value === 'string' && /[^\s\u200b\uFEFF]/.test(value);
  function meaningfulHtml(node) {
    if (['script', 'style', 'template'].includes(node.tagName) || node.nodeName === '#comment') return false;
    if (node.nodeName === '#text') return visible(node.value);
    if (node.tagName === 'img' && node.attrs.some(a => a.name === 'src' && visible(a.value))) return true;
    return (node.childNodes ?? []).some(meaningfulHtml);
  }
  function meaningful(node) {
    if (['heading', 'definition', 'thematicBreak'].includes(node.type)) return false;
    if (node.type === 'html') return meaningfulHtml(parseFragment(node.value));
    if (node.type === 'image' || node.type === 'imageReference') return visible(node.url ?? node.identifier);
    if (typeof node.value === 'string') return visible(node.value);
    return (node.children ?? []).some(meaningful);
  }
  const start = cores[0] + 1;
  let end = start;
  while (end < nodes.length && !(nodes[end].type === 'heading' && nodes[end].depth <= 2)) end++;
  if (!nodes.slice(start, end).some(meaningful)) fail(path, '「核心理解」需要可阅读的实质正文');
}

function article(files, path) {
  const [discipline, directory] = path.split('/');
  if (!slug.test(directory)) fail(path, '目录名需要小写英文标识');
  const source = textFile(files, path);
  const match = frontMatter.exec(source);
  if (!match) fail(path, '缺少 YAML 元数据边界');
  let meta;
  try { meta = parseYaml(match[1]); } catch (error) { fail(path, error.message); }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) fail(path, 'YAML 元数据必须为对象');
  const line = value => typeof value === 'string' && value.trim() && !/[\r\n\u0000]/.test(value);
  if (!line(meta.name) || meta.name.length > 1000) fail(path, 'name 必须为单行标题');
  if (own(meta, 'kind') && !['source', 'card'].includes(meta.kind)) fail(path, '未知 kind');
  if (own(meta, 'attachments_only') && !(meta.kind === 'source' && typeof meta.attachments_only === 'boolean'))
    fail(path, 'attachments_only 需要材料索引标志');
  if (own(meta, 'description') && !line(meta.description)) fail(path, 'description 需要单行文字');
  for (const key of ['aliases', 'tags', 'also_in', 'sources']) {
    if (own(meta, key) && (!Array.isArray(meta[key]) || !meta[key].every(line))) fail(path, `${key} 需要文字列表`);
  }
  if (own(meta, 'readings') && (!Array.isArray(meta.readings) || !meta.readings.every(r => r && line(r.path) && line(r.title))))
    fail(path, 'readings 每项需要 title 与 path');
  const id = own(meta, 'id') ? meta.id : directory;
  if (typeof id !== 'string' || !slug.test(id)) fail(path, '无效的稳定标识 id');
  if (own(meta, 'siyuan_id') && !blockId.test(meta.siyuan_id)) fail(path, '无效的 siyuan_id');
  const markdown = trimBlankLines(source.slice(match[0].length));
  if (meta.kind !== 'source') validateCore(path, markdown);
  return { id, name: meta.name.trim(), path, discipline, metadata: meta, markdown,
    sources: unique((meta.sources ?? []).map(value => localPath(files, path, value))),
    readings: (meta.readings ?? []).map(({ title, path: value }) => {
      const target = localPath(files, path, value);
      return { title: title.trim(), path: target, markdown: textFile(files, target) };
    }),
  };
}

function htmlDestinations(node, input, destination, edit) {
  const start = node.position.start.offset, end = node.position.end.offset;
  const source = input.slice(start, end);
  const walk = element => {
    const key = element.tagName === 'a' ? 'href' : element.tagName === 'img' ? 'src' : '';
    const attribute = element.attrs?.find(a => a.name === key);
    if (attribute) {
      const location = element.sourceCodeLocation.attrs[key];
      const value = destination(attribute.value);
      if (value === null) edit(start + location.startOffset, start + location.endOffset, '');
      else if (value !== undefined && value !== attribute.value) {
        const escaped = value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
        edit(start + location.startOffset, start + location.endOffset, `${key}="${escaped}"`);
      }
    }
    if (!['code', 'pre', 'script', 'style'].includes(element.tagName))
      for (const child of element.childNodes ?? []) walk(child);
  };
  walk(parseFragment(source, { sourceCodeLocationInfo: true }));
}

// Work with source ranges instead of serializing an AST. This preserves old
// headings, native Markdown examples, reference-link labels, titles and HTML.
function rewrite(input, { destination, wiki, block }) {
  // Both Markdown parsers count positions from the first character after a BOM.
  const bom = input.startsWith('\uFEFF') ? '\uFEFF' : '';
  input = input.slice(bom.length);
  const edits = [];
  const inactive = [];
  const edit = (start, end, text) => edits.push({ start, end, text });
  const ast = fromMarkdown(input);
  const definitions = new Map();
  function collectDefinitions(node) {
    if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
    for (const child of node.children ?? []) collectDefinitions(child);
  }
  if (destination) collectDefinitions(ast);
  const events = postprocess(parse().document().write(preprocess()(input, undefined, true)));
  for (const [event, token] of events) {
    if (event !== 'enter' || !['resourceDestinationString', 'definitionDestinationString', 'autolinkProtocol'].includes(token.type)) continue;
    const start = token.start.offset, end = token.end.offset;
    const original = decodeString(input.slice(start, end));
    const value = destination(original);
    if (value !== undefined && value !== null && value !== original) {
      if (token.type === 'autolinkProtocol') edit(start - 1, end + 1, `[${labelText(original)}](${value})`);
      else edit(start, end, value);
    }
  }
  function visit(node) {
    const start = node.position.start.offset, end = node.position.end.offset;
    if (node.type === 'html') return htmlDestinations(node, input, destination, edit);
    if (['link', 'image', 'linkReference', 'imageReference', 'definition'].includes(node.type)) {
      const url = node.url ?? definitions.get(node.identifier);
      if (url !== undefined && destination?.(url) === null) inactive.push({ start, end,
        text: node.type === 'definition' ? '' : inactiveLabel(node.alt ?? plain(node)) });
      return;
    }
    if (node.type === 'code' || node.type === 'inlineCode') return;
    if (node.type === 'text') {
      const raw = input.slice(start, end);
      const replace = (pattern, build) => {
        for (const m of raw.matchAll(pattern)) {
          const escapes = /\\*$/.exec(raw.slice(0, m.index))[0].length;
          if (escapes % 2) continue;
          const replacement = build(m);
          if (replacement !== undefined) edit(start + m.index, start + m.index + m[0].length, replacement);
        }
      };
      if (wiki) replace(/\[\[([^|\]\r\n]+)(?:\|([^\]\r\n]+))?\]\]/g, m => wiki(m[1], m[2]));
      if (block) replace(/\(\((\d{14}-[a-z0-9]{7})(?:\s+['"]([^\n]*?)['"])?\)\)/g, m => block(m[1], m[2]));
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(ast);
  let at = 0;
  const parts = [];
  const changes = edits.filter(edit => !inactive.some(range => edit.start >= range.start && edit.end <= range.end));
  for (const { start, end, text } of [...changes, ...inactive].sort((a, b) => a.start - b.start)) {
    parts.push(input.slice(at, start), text);
    at = end;
  }
  return bom + parts.join('') + input.slice(at);
}

function appTarget(value, origin) {
  const native = /^(?:siyuan|kane):\/\/blocks\/(\d{14}-[a-z0-9]{7})(?:#([^\s]+))?$/.exec(value);
  if (native) return { type: 'document', key: native[1], fragment: native[2] || '' };
  const relativeAsset = value.startsWith('assets/');
  if (!relativeAsset && !value.startsWith('/') && !(origin && /^https?:\/\//i.test(value))) return;
  const base = origin || 'https://raw.invalid';
  const url = new URL(relativeAsset ? '/' + value : value, base);
  if (url.origin !== new URL(base).origin || url.username || url.password) return;
  // The former creation route opens the filtered list, even when a card has slug "new".
  if (url.pathname === '/cards/new') return { type: 'list', href: url.pathname + url.search + url.hash };
  const fragment = url.hash.slice(1);
  const id = /^\/cards\/([^/]+)$/.exec(url.pathname)?.[1];
  if (id || (url.pathname === '/' && url.searchParams.get('id'))) {
    return { type: 'document', key: id ? decodeURIComponent(id) : url.searchParams.get('id'), fragment };
  }
  if (url.pathname === '/wiki' && url.searchParams.get('source')) return { type: 'source', key: url.searchParams.get('source'), fragment };
  if (url.pathname.startsWith('/assets/')) return { type: 'asset', key: decodeURIComponent(url.pathname.slice(1)), fragment };
}

export function exportRawMarkdown(markdown, { cardPath, documentPath, assetPath, sourcePath, origin }) {
  const relative = (target, fragment) => {
    const path = typeof target === 'string' ? target : target.path;
    return urlPath(posix.relative(posix.dirname(cardPath), path)) + (fragment ? '#' + fragment : '');
  };
  const destination = value => {
    const target = appTarget(value, origin);
    if (!target) return;
    if (target.type === 'list') return target.href;
    const callback = { document: documentPath, asset: assetPath, source: sourcePath }[target.type];
    const local = callback?.(target.key, target.fragment);
    if (!local) fail(cardPath, `无法导出内部链接 ${value}`);
    return relative(local, target.fragment || local.fragment);
  };
  return rewrite(markdown, { destination, block: (id, label) =>
    `[${labelText(label || '相关内容')}](${destination('/?id=' + id)})` });
}

function metadataSections(card, markdown, sources) {
  const nodes = fromMarkdown(markdown).children;
  const { metadata } = card;
  const edits = [], added = [];
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const headingText = node => node.type === 'heading' ? plain(node).trim().replace(/^中文\s*[·・]\s*/, '') : '';
  const textOnly = node => node.type === 'text' ||
    (['paragraph', 'listItem', 'list'].includes(node.type) && node.children.every(textOnly));

  // A plain paragraph or list immediately below the heading is its editable
  // value. Keep subsequent prose, rich markup and child sections byte-for-byte.
  function project(heading, valuesOf, desiredOf, render) {
    const sections = [];
    for (const [index, node] of nodes.entries()) {
      if (headingText(node) !== heading) continue;
      let end = index + 1;
      while (end < nodes.length && nodes[end].type !== 'heading') end++;
      const body = nodes.slice(index + 1, end);
      const field = body[0] && textOnly(body[0]) ? body.shift() : null;
      const nested = nodes[end]?.depth > node.depth;
      sections.push({ node, field, body, nested });
    }
    const existing = unique(valuesOf(sections.flatMap(({ field, body }) => field ? [field, ...body] : body)));
    const desired = unique(desiredOf(existing));
    if (sections.length <= 1 && same(existing, desired)) return;
    if (!sections.length) {
      if (desired.length) added.push('## ' + heading + '\n\n' + render(desired));
      return;
    }
    const preserved = new Set(valuesOf(sections.flatMap(({ body }) => body)));
    const values = desired.filter(v => !preserved.has(v));
    for (const [index, { node, field, body, nested }] of sections.entries()) {
      const value = index === 0 && values.length ? render(values) : '';
      const keepHeading = Boolean(value || body.length || nested);
      const start = keepHeading ? node.position.end.offset : node.position.start.offset;
      const end = field?.position.end.offset ?? node.position.end.offset;
      edits.push([start, end, value ? '\n\n' + value : '']);
    }
  }

  const textValues = contents => contents.flatMap(n =>
    n.type === 'paragraph' ? plain(n).split(/[、\n]+/) : n.type === 'list' ? n.children.map(plain) : []
  ).map(t => t.replaceAll('\u200b', '').trim()).filter(Boolean);
  if (metadata.description) {
    const paragraphs = nodes.filter(n => n.type === 'paragraph');
    if (nodes.some(n => headingText(n) === '摘要') || !paragraphs.some(n => plain(n).trim() === metadata.description.trim())) {
      project('摘要', contents => contents.map(plain), () => [metadata.description.trim()], v => escapeText(v[0]));
    }
  }
  if (metadata.aliases) {
    project('别名', textValues, () => metadata.aliases.map(v => v.trim()), values => values.map(escapeText).join('、'));
  }
  const normalizeTag = value => value.trim().replace(/^学科\s*[:：]\s*/, '学科：').normalize('NFC');
  const subjects = [card.discipline, ...(metadata.also_in ?? [])].map(v => '学科：' + v.trim());
  const tagsOf = contents => tagsFromNodes([{ type: 'heading', depth: 2, children: [{ type: 'text', value: '标签' }] }, ...contents]).map(normalizeTag);
  project('标签', tagsOf, existing => {
    const previousSubjects = existing.filter(t => t.startsWith('学科：'));
    const previousTags = existing.filter(t => !t.startsWith('学科：'));
    const tags = metadata.tags ? metadata.tags.map(normalizeTag) : previousTags;
    if (same(previousSubjects, subjects) && same(previousTags, tags)) return existing;
    return [...subjects, ...tags];
  }, values => values.map(v => '- ' + escapeText(v)).join('\n'));
  const knownUrls = new Set();
  if (sources.length) rewrite(markdown, { destination: url => { knownUrls.add(url.split('#')[0]); } });
  const missing = sources.filter(s => !knownUrls.has(s.url));
  if (missing.length) added.push('## 来源\n\n' + missing.map(s => `- [${labelText(s.title)}](${s.url})`).join('\n'));
  for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0])) markdown = markdown.slice(0, start) + text + markdown.slice(end);
  return [markdown, ...added].filter(Boolean).join('\n\n');
}

function managedAsset(tree, path) {
  const match = /^([^/]+\/[^/]+)\/assets\//.exec(path);
  return Boolean(match && tree.byPath.has(match[1] + '/article.md'));
}

function sourceTarget(tree, path) {
  const source = tree.byPath.get(path);
  if (source?.metadata.kind === 'source' && source.sources.length === 1) return source.sources[0];
  return path;
}

function compile(tree, article, urls, used, reference) {
  const { cardUrl, assetUrl, sourceUrl, readingUrl } = urls;
  const fileUrl = (path, base = article.path) => {
    used?.add(path);
    reference?.(base, path);
    const record = tree.byPath.get(path);
    if (record && record.metadata.kind !== 'source') return cardUrl(record.id);
    const source = sourceTarget(tree, path);
    if (source !== path) reference?.(base, source);
    if (tree.sourceFiles.has(source)) { used?.add(source); return sourceUrl(source); }
    if (record?.metadata.kind === 'source') fail(article.path, `材料索引不能作为内容目标 ${path}`);
    if (tree.readingPaths.has(path) && readingUrl) return readingUrl(path);
    if (!tree.assets.has(path)) fail(article.path, `引用必须指向卡片、来源或已归档 assets 中的材料 ${path}`);
    return assetUrl(path);
  };
  const resolveWiki = (base, value, label) => {
    const [id, ...rest] = value.split('#');
    const target = tree.byId.get(id);
    if (!target || target.metadata.kind === 'source') fail(base, `找不到卡片标识 ${id}`);
    reference?.(base, target.path);
    const url = cardUrl(id);
    return url === null ? inactiveLabel(label || target.name) : `[${labelText(label || target.name)}](${url}${rest.length ? '#' + rest.join('#') : ''})`;
  };
  const render = (base, markdown) => rewrite(markdown, {
    wiki: (id, label) => resolveWiki(base, id, label),
    destination: value => {
      if (!value || value.startsWith('#') || value.startsWith('//')) return;
      // Old bookmarked routes resolve through the same inventory as local paths.
      const sameSite = tree.contentOrigin && /^https?:\/\//i.test(value) && appTarget(value, tree.contentOrigin);
      if (value.startsWith('/') || /^(siyuan|kane):\/\//i.test(value) || sameSite) {
        const target = sameSite || appTarget(value);
        if (target?.type === 'list') return target.href;
        let url;
        if (target?.type === 'document') {
          const record = tree.byDocument.get(target.key);
          if (record) {
            url = fileUrl(record.path, base);
            // The old graph citation hash includes the literal target ID.
            // Keep an explicitly authored bookmark (including a block ID);
            // local file paths and Wiki links continue to use the canonical ID.
            if (url !== null && record.bookmark) url = record.bookmark;
          }
        } else if (target?.type === 'source') {
          const path = tree.bySnapshot.get(target.key);
          if (path) url = fileUrl(path, base);
          else if (tree.historicalSnapshots?.has(target.key)) url = '/wiki?source=' + encodeURIComponent(target.key);
        } else if (target?.type === 'asset') {
          url = fileUrl(localPath(tree.files, base, target.key), base);
        }
        if (url === null) return null;
        if (!url) fail(base, `无法解析内部链接 ${value}`);
        return url + (target.fragment ? '#' + target.fragment : '');
      }
      if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
        if (/^file:/i.test(value)) fail(base, `不支持本机绝对路径 ${value}`);
        return;
      }
      const [pathname, suffix] = /^([^?#]*)([?#].*)?$/.exec(value).slice(1);
      if (!pathname) fail(base, `无法解析内部链接 ${value}`);
      let decoded;
      try { decoded = decodeURIComponent(pathname); } catch { fail(base, `路径编码无效 ${value}`); }
      const url = fileUrl(localPath(tree.files, base, decoded), base);
      return url === null ? null : url + (suffix ?? '');
    },
    block: (id, label) => {
      const target = tree.byDocument.get(id);
      if (!target) fail(base, `找不到块链接 ${id}`);
      const url = fileUrl(target.path, base);
      const link = target.bookmark ?? url;
      return url === null ? inactiveLabel(label || target.name) : `[${labelText(label || target.name)}](${link})`;
    },
  });
  const markdown = render(article.path, article.markdown);
  const sources = article.sources.map(path => {
    const target = sourceTarget(tree, path);
    const sidecar = tree.sourceMetadata.get(target) ?? tree.frozenSourceMetadata?.get(target);
    return { title: sidecar?.title || tree.byPath.get(path)?.name || posix.basename(target), url: fileUrl(path) };
  });
  const readings = article.readings.map(reading => {
    reference?.(article.path, reading.path);
    return { ...reading, markdown:render(reading.path, reading.markdown) };
  });
  return {
    title: article.name,
    markdown: article.metadata.kind === 'source' ? markdown : metadataSections(article, markdown, sources),
    readings,
  };
}

export function compileRawCard(tree, card, urls) {
  return compile(tree, card, urls);
}

/** Replace the body of one verified card while preserving its raw-only metadata. */
export function writeRawCardBody(path,original,{rawId,id,title,markdown,archivedAt,aliases,tags,description,disciplines,previousId}) {
  const packagePath=/^[^/\\\x00-\x1f]+\/([a-z0-9]+(?:-[a-z0-9]+)*)\/article\.md$/.exec(path ?? '');
  if (!packagePath || path.startsWith('./') || path.startsWith('../') ||
      !slug.test(rawId ?? '') || !blockId.test(id ?? '') ||
      typeof title!=='string' || !title.trim() || title.length>1000 || /[\r\n\0]/u.test(title) ||
      typeof markdown!=='string' || (archivedAt!=null && !Number.isFinite(Date.parse(archivedAt))))
    fail(path,'需要稳定的卡片原稿身份和已核实的正文。');
  validateCore(path,markdown);
  const source=original==null ? '' : original.toString('utf8');
  const previous=frontMatter.exec(source);
  if (original!=null && !previous) fail(path,'现有原稿缺少 YAML 元数据边界。');
  const document=parseYamlDocument(previous ? previous[1] : '{}');
  if (document.errors.length) throw document.errors[0];
  if (previous && (document.get('kind')==='source' || (document.get('id')??packagePath[1])!==rawId ||
      (document.has('siyuan_id') && document.get('siyuan_id')!==id && document.get('siyuan_id')!==previousId)))
    exportConflict(path,'目标原稿与已绑定的生产卡片不符。');
  if (disciplines!==undefined) {
    const extra=document.get('also_in',true)?.toJSON() ?? [];
    if (!Array.isArray(extra)) exportConflict(path,'原稿的其他学科字段需要核对。');
    const expected=[path.split('/')[0],...extra];
    if (!Array.isArray(disciplines) || disciplines.length!==expected.length ||
        disciplines.some((value,index)=>value!==expected[index]))
      exportConflict(path,'学科与已绑定原稿目录不符，需要单独核对归属。');
  }
  if (!previous) document.set('id',rawId);
  document.set('name',title);
  document.set('siyuan_id',id);
  if (description===null) document.delete('description');
  else if (description!==undefined) document.set('description',description);
  for (const [key,values] of [['aliases',aliases],['tags',tags]]) {
    if (values === undefined) continue;
    if (!Array.isArray(values)) fail(path,'卡片标签或别名格式无效。');
    if (values.length) document.set(key,values);
    else document.delete(key);
  }
  if (archivedAt) {
    document.set('status','archived');
    document.set('archived_at',archivedAt);
  } else if (archivedAt===null && document.get('status')==='archived') {
    document.delete('status');
    document.delete('archived_at');
  }
  const eol=previous?.[0].includes('\r\n') ? '\r\n' : '\n';
  const bom=source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const yaml=document.toString({lineWidth:0}).replaceAll('\n',eol);
  const body=trimBlankLines(markdown).replace(/\r?\n/g,eol);
  return Buffer.from(`${bom}---${eol}${yaml}---${eol}${eol}${body}${eol}`);
}

export function setRawArchive(bytes, archivedAt, documentId) {
  const source = bytes.toString('utf8'), match = frontMatter.exec(source);
  if (!match) throw new Error('原稿缺少 YAML 元数据边界。');
  const document = parseYamlDocument(match[1]);
  if (document.errors.length) throw document.errors[0];
  if (documentId!==undefined) {
    if (!blockId.test(documentId)) throw new Error('需要可核实的原生文档标识。');
    document.set('siyuan_id',documentId);
  }
  if (archivedAt) {
    document.set('status', 'archived');
    document.set('archived_at', archivedAt);
  } else if (document.get('status') === 'archived') {
    document.delete('status');
    document.delete('archived_at');
  } else if (documentId===undefined) return bytes;
  const eol = match[0].includes('\r\n') ? '\r\n' : '\n';
  const yaml = document.toString({lineWidth:0}).replaceAll('\n', eol);
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  return Buffer.from(`${bom}---${eol}${yaml}---${eol}${source.slice(match[0].length)}`);
}

/** Rewrites only inventoried Markdown destinations for the supplied asset moves. */
export function rewriteRawAssetPaths(tree, base, moves) {
  const source = textFile(tree.files, base);
  const header = tree.byPath.has(base) ? frontMatter.exec(source)[0] : '';
  return Buffer.from(header + rewrite(source.slice(header.length), { destination:value => {
    if (!value || value.startsWith('#') || value.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(value)) return;
    const [pathname, suffix] = /^([^?#]*)([?#].*)?$/.exec(value).slice(1);
    if (!pathname) return;
    let original;
    if (value.startsWith('/')) {
      const target = appTarget(value);
      if (target?.type !== 'asset') return;
      original = target.key;
    } else original = decodeURIComponent(pathname);
    const from = posix.join(posix.dirname(base), original).normalize('NFC');
    const to = moves.get(from);
    if (to) return urlPath(posix.relative(posix.dirname(base), to)) + (suffix ?? '');
  } }));
}

export function loadRawTree(rawRoot, options) {
  return loadRawFiles(readFiles(resolve(rawRoot)), options);
}

/** Validate a projected raw file set with the same parser as an actual checkout. */
export function loadRawFiles(files,{references=false, registerReferences}={}) {
  const tree = { files, cards: [], sources: [], assets: new Set(), sourceFiles: new Set(),
    byPath: new Map(), byId: new Map(), byDocument: new Map(), bySnapshot: new Map(), sourceMetadata: new Map(), readingPaths: new Set() };
  for (const path of files.keys()) {
    if (!/^[^/]+\/[^/]+\/article\.md$/.test(path)) {
      if (posix.basename(path) === 'article.md' && !path.includes('/assets/')) fail(path, 'article.md 必须位于学科/英文标识目录');
      continue;
    }
    const entry = article(files, path);
    if (tree.byId.has(entry.id)) fail(path, `重复标识 ${entry.id}`);
    tree.byId.set(entry.id, entry);
    tree.byPath.set(path, entry);
    if (entry.metadata.kind === 'source') tree.sources.push(entry);
    else {
      tree.cards.push(entry);
      for (const ref of [entry.id, entry.metadata.siyuan_id].filter(Boolean)) {
        if (tree.byDocument.has(ref) && tree.byDocument.get(ref) !== entry) fail(path, `重复文档标识 ${ref}`);
        tree.byDocument.set(ref, entry);
      }
    }
    for (const r of entry.readings) {
      if (tree.readingPaths.has(r.path)) fail(path, `补充阅读需要唯一父卡与路径 ${r.path}`);
      tree.readingPaths.add(r.path);
    }
  }
  for (const entry of tree.byPath.values()) {
    if (entry.metadata.kind === 'source' && !entry.sources.length && !entry.metadata.attachments_only) tree.sourceFiles.add(entry.path);
    for (const path of entry.sources) {
      const file = sourceTarget(tree, path);
      if (tree.byPath.has(file) && tree.byPath.get(file).metadata.kind !== 'source') fail(entry.path, `sources 指向知识卡 ${file}`);
      tree.sourceFiles.add(file);
    }
  }
  for (const path of tree.readingPaths) {
    if (!managedAsset(tree, path)) fail(path, '补充阅读需要在已归档目录的 assets 中');
  }
  const sidecars = new Set();
  for (const file of tree.sourceFiles) {
    if (!tree.byPath.has(file) && !managedAsset(tree, file)) fail(file, '来源需要原稿或已归档目录的 assets 文件');
    textFile(files, file);
    const sidecar = file.slice(0, file.length - posix.extname(file).length) + '.json';
    if (files.has(sidecar) && file !== sidecar) {
      let record;
      try { record = JSON.parse(textFile(files, sidecar)); } catch { fail(sidecar, '来源 JSON 无效'); }
      if (typeof record?.id === 'string' && typeof record?.sourceId === 'string' && typeof record?.title === 'string') {
        if (tree.bySnapshot.has(record.id)) fail(sidecar, `重复来源快照 ${record.id}`);
        sidecars.add(sidecar);
        tree.sourceMetadata.set(file, record);
        tree.bySnapshot.set(record.id, file);
      }
    }
  }
  for (const path of files.keys()) {
    if (managedAsset(tree, path) && !tree.sourceFiles.has(path) && !tree.readingPaths.has(path) && !sidecars.has(path)) tree.assets.add(path);
  }
  const preview = { cardUrl: id => '/cards/' + id, sourceUrl: path => '/wiki?source=' + encodeURIComponent(path),
    assetUrl: path => '/assets/' + urlPath(path), readingUrl: path => '/cards/' + urlPath(path) };
  registerReferences?.(tree);
  // Parse the complete set and reject broken references before a caller can write.
  if (references) tree.inbound = new Map();
  const reference = references ? (base, path) => {
    let previous = tree.inbound.get(path);
    if (!previous) tree.inbound.set(path, previous = new Set());
    previous.add(base);
  } : undefined;
  for (const entry of tree.byPath.values()) {
    const used = new Set([entry.path, ...entry.readings.map(r => r.path)]);
    compile(tree, entry, preview, used, reference);
    entry.hash = digest(JSON.stringify([...used].sort().map(path => [path, digest(files.get(path))])));
  }
  return tree;
}
