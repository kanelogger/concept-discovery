import { fromMarkdown } from 'mdast-util-from-markdown';
import { tagsFromNodes, mapConcurrent } from './card-list.mjs';
import { readableMarkdown } from './compact.mjs';
import { cardScope } from './library-scope.mjs';
import { fail, hash, normalize } from './siyuan.mjs';

const catalogTitle = '场景图鉴';
const cardIdPattern = /^\d{14}-[a-z0-9]{7}$/;
const cardLimit = 10000;
const idFor = (kind, ...parts) => `${kind}-${hash(parts).slice(0, 24)}`;
const nodesOf = markdown => fromMarkdown(readableMarkdown(normalize(markdown))).children;

function inlineText(node) {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if (node.type === 'break') return ' ';
  return (node.children ?? []).map(inlineText).join('');
}

function textOf(node) {
  return inlineText(node).replaceAll('\u200b', '').replace(/\s+/g, ' ').trim().normalize('NFC');
}

function cardIdFromLink(href, origin) {
  if (!/^(?:\/(?!\/)|https?:\/\/)/i.test(href) || /[\\#\u0000-\u001f\u007f]/.test(href)) return null;
  let url;
  try { url = new URL(href, origin); }
  catch { return null; }
  if (url.origin !== origin || url.username || url.password) return null;
  const id = url.pathname === '/' && url.searchParams.getAll('id').length === 1
    ? url.searchParams.get('id') : /^\/cards\/([^/]+)$/.exec(url.pathname)?.[1];
  return cardIdPattern.test(id ?? '') ? id : null;
}

function parseLink(item, origin) {
  const [paragraph] = item.children;
  if (paragraph?.type !== 'paragraph' || item.children.length !== 1) return null;
  const [link, ...rest] = paragraph.children;
  if (link?.type !== 'link' || rest.some(node => ['html', 'image', 'link', 'linkReference'].includes(node.type))) return null;
  const cardId = cardIdFromLink(link.url, origin);
  const suffix = textOf({ children: rest });
  if (!cardId || (suffix && !suffix.startsWith('—'))) return null;
  return { cardId, note: suffix.replace(/^—\s*/, '') };
}

function disciplineNames(list) {
  if (list?.type !== 'list') return { order: [], invalid: true };
  const names = new Set();
  let invalid = false;
  for (const item of list.children) {
    const [paragraph] = item.children;
    if (item.children.length !== 1 || paragraph?.type !== 'paragraph' ||
        !paragraph.children.every(node => node.type === 'text' && !/[\r\n]/.test(node.value))) {
      invalid = true;
      continue;
    }
    const title = inlineText(paragraph).replaceAll('\u200b', '').trim().normalize('NFC');
    if (title) names.add(title);
    else invalid = true;
  }
  return { order: [...names], invalid };
}

export function parseCatalog(nodes, available, origin) {
  const groups = [];
  const diagnostics = [];
  const membershipLines = new Set();
  const groupIds = new Set();
  let disciplineOrder = [];
  let group = null;
  let entry = null;
  let hasCategoryHeading = false;
  let hasSceneHeading = false;
  let cardIds;
  for (const [index, node] of nodes.entries()) {
    if (node.type === 'heading') {
      const heading = textOf(node);
      const featured = node.depth === 3 && heading.startsWith('【精选】');
      const title = featured ? heading.slice('【精选】'.length).trim() : heading;
      entry = null;
      if (node.depth <= 2) hasCategoryHeading = false;
      hasSceneHeading = node.depth === 3 && hasCategoryHeading && Boolean(title);
      if (node.depth === 1) group = null;
      if (node.depth === 2) {
        group = null;
        if (title === '学科目录') {
          if (disciplineOrder.length) diagnostics.push('「学科目录」重复，已保留首个有效列表。');
          else {
            const { order, invalid } = disciplineNames(nodes[index + 1]);
            disciplineOrder = order;
            if (invalid) diagnostics.push('「学科目录」需要直接跟一组纯文字学科名称，请检查格式。');
          }
          continue;
        }
        if (/^(?:中文\s*[·・]\s*)?标签$/.test(title)) continue;
        hasCategoryHeading = Boolean(title);
        const id = idFor('group', title);
        if (!title || groupIds.has(id)) {
          diagnostics.push(title ? `类目「${title}」重复，已保留首个。` : '有一个类目缺少标题。');
          continue;
        }
        group = { id, title, entries: [] };
        groupIds.add(id);
        groups.push(group);
      }
      if (node.depth === 3 && group) {
        const id = idFor('scene', group.title, title);
        if (!title || group.entries.some(item => item.id === id)) {
          diagnostics.push(title ? `类目「${group.title}」中的场景「${title}」重复，已保留首个。` : `类目「${group.title}」中有一个场景缺少标题。`);
          continue;
        }
        entry = { id, title, description: '', items: [], ...(featured && { featured: true }) };
        cardIds = new Set();
        group.entries.push(entry);
      }
      continue;
    }
    if (entry && node.type === 'paragraph' && !entry.description) entry.description = textOf(node);
    if (!hasSceneHeading || node.type !== 'list') continue;
    for (const item of node.children) {
      const link = parseLink(item, origin);
      // A repeated scene is omitted from the atlas, but its membership list
      // still describes curation rather than citations by the catalogue author.
      if (link) membershipLines.add(item.position.start.line - 1);
      if (!entry) continue;
      if (!link || !available.has(link.cardId)) {
        const line = item.position.start.line;
        diagnostics.push(`场景「${entry.title}」第 ${line} 行的链接格式无效，或目标不在当前知识库中。`);
        continue;
      }
      if (cardIds.has(link.cardId)) continue;
      cardIds.add(link.cardId);
      entry.items.push(link);
    }
  }
  return { groups, diagnostics, disciplineOrder, membershipLines };
}

export function cardExcerpt(nodes) {
  const excerpts = new Map();
  let section = '';
  let depth = 0;
  for (const node of nodes) {
    if (node.type === 'heading') {
      const heading = textOf(node).replace(/^中文\s*[·・]\s*/, '');
      if (section && node.depth <= depth) section = '';
      if (/^(理解|核心理解|适用情境)$/.test(heading)) {
        section = heading === '适用情境' ? 'situation' : 'understanding';
        depth = node.depth;
      }
    } else if (section && node.type === 'paragraph' && !excerpts.has(section)) {
      const text = textOf(node);
      if (text) excerpts.set(section, text);
    }
  }
  const chars = Array.from(excerpts.get('understanding') ?? excerpts.get('situation') ?? '');
  return chars.length > 160 ? `${chars.slice(0, 159).join('')}…` : chars.join('');
}

export async function readScenarioAtlas(api, { origin, signal }) {
  const stop = new AbortController();
  const options = { signal: signal ? AbortSignal.any([signal, stop.signal]) : stop.signal };
  const check = () => options.signal.throwIfAborted();
  check();
  await api.identity(options);
  check();
  const rows = await api.sql(`SELECT b.id,b.content FROM blocks b WHERE ${cardScope(api.c)} ORDER BY b.id LIMIT ${cardLimit + 1}`, options);
  check();
  if (rows.length > cardLimit) fail('scenario_limit', '图鉴最多读取 10000 张知识卡。');
  const catalogIds = rows.filter(row => row.content === catalogTitle).map(row => row.id);
  const available = new Set(rows.map(row => row.id));
  const catalog = { status: 'missing', ids: catalogIds, diagnostics: [], groups: [] };
  let catalogMarkdown;
  let disciplineOrder = [];
  if (catalogIds.length > 1) {
    catalog.status = 'duplicate';
    catalog.diagnostics.push('有多张「场景图鉴」目录卡，请只保留一张使用该标题。');
  } else if (catalogIds.length === 1) {
    catalogMarkdown = await api.markdown(catalogIds[0], options);
    check();
    const parsed = parseCatalog(nodesOf(catalogMarkdown), available, origin);
    disciplineOrder = parsed.disciplineOrder;
    Object.assign(catalog, { status: 'ready', groups: parsed.groups, diagnostics: parsed.diagnostics });
  }

  const newDiscipline = title => ({ id: idFor('discipline', title), title, items: [] });
  const disciplines = new Map(disciplineOrder.map(title => [title, newDiscipline(title)]));
  const referenced = new Set(catalog.groups.flatMap(group => group.entries.flatMap(entry => entry.items.map(item => item.cardId))));
  const index = await mapConcurrent(rows, async (row) => {
    try {
      check();
      const markdown = row.id === catalogIds[0] && catalogMarkdown !== undefined
        ? catalogMarkdown : await api.markdown(row.id, options);
      check();
      const nodes = nodesOf(markdown);
      const labels = tagsFromNodes(nodes, { proseOnly: true }).flatMap(tag => {
        const label = /^学科\s*[:：]\s*(.*)$/.exec(tag)?.[1]?.trim();
        return label && (!disciplineOrder.length || disciplines.has(label)) ? [label] : [];
      });
      if (!labels.length && !referenced.has(row.id)) return null;
      return { card: { id: row.id, title: row.content, excerpt: cardExcerpt(nodes) }, disciplines: new Set(labels) };
    } catch (error) {
      stop.abort(error);
      throw error;
    }
  });
  const collator = new Intl.Collator('zh-CN');
  const included = index.filter(Boolean).sort((a, b) => collator.compare(a.card.title, b.card.title) || a.card.id.localeCompare(b.card.id));
  for (const { card, disciplines: labels } of included) {
    for (const title of labels) {
      if (!disciplines.has(title)) disciplines.set(title, newDiscipline(title));
      disciplines.get(title).items.push({ cardId: card.id, note: '' });
    }
  }
  const orderedDisciplines = [...disciplines.values()];
  if (!disciplineOrder.length) orderedDisciplines.sort((a, b) => collator.compare(a.title, b.title));
  return {
    catalog,
    disciplines: orderedDisciplines,
    cards: included.map(value => value.card),
  };
}
