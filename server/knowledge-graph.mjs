import { fromMarkdown } from 'mdast-util-from-markdown';
import { tagsFromNodes } from '../lib/card-list.mjs';
import { CardBodyReader } from '../lib/card-body-reader.mjs';
import { documentMarkdown } from '../lib/documents.mjs';
import { cardScope } from '../lib/library-scope.mjs';
import { cardExcerpt, parseCatalog } from '../lib/scenario-atlas.mjs';
import { fail, quote } from '../lib/siyuan.mjs';
import { renderCardReferences } from './card-references.mjs';
import { validBlockID } from './render.mjs';

async function readInventory(api, options) {
  const rows = [];
  let after = '';
  for (;;) {
    options.signal?.throwIfAborted();
    const page = await api.sql(`SELECT b.id,b.content,
      (SELECT value FROM attributes WHERE block_id=b.id AND name='custom-cd-schema' LIMIT 1) AS schema,
      (SELECT value FROM attributes WHERE block_id=b.id AND name='custom-cd-legacy-id' LIMIT 1) AS alias
      FROM blocks b WHERE ${cardScope(api.c)} AND b.id > ${quote(after)}
      ORDER BY b.id LIMIT 128`, options);
    if (!page.length) return rows;
    if (page.at(-1).id <= after) fail('graph_read_failed', '知识卡列表未能完整读取。');
    rows.push(...page);
    after = page.at(-1).id;
  }
}

// Only query referenced blocks and only accept roots in the live card scope.
// Supplementary readings, deleted cards/ancestors and other notebooks stay out.
async function blockOwners(api, ids, options) {
  const owners = new Map();
  for (let offset = 0; offset < ids.length; offset += 64) {
    options.signal?.throwIfAborted();
    const part = ids.slice(offset, offset + 64);
    const found = await api.sql(`SELECT s.id,b.id AS owner FROM blocks s JOIN blocks b
      ON b.id=s.root_id AND b.box=s.box AND b.path=s.path
      WHERE s.id IN (${part.map(quote).join(',')}) AND ${cardScope(api.c)}`, options);
    for (const { id, owner } of found) owners.set(id, owner);
  }
  return owners;
}

function aliasMap(rows) {
  const aliases = new Map(), legacyAliases = new Set();
  for (const { id, alias, schema } of rows) {
    if (!alias) continue;
    // Knowledge.locate rejects alias lookups when schema-1 identities conflict.
    if (schema === '1' && legacyAliases.has(alias)) return new Map();
    if (schema === '1') legacyAliases.add(alias);
    aliases.set(alias, aliases.has(alias) ? null : id);
  }
  return aliases;
}

function graphDocument(raw, { id, schema, content }, available, origin) {
  const markdown = documentMarkdown(raw);
  const body = fromMarkdown(markdown).children;
  const tags = tagsFromNodes(body, { proseOnly: true });
  const disciplines = tags.flatMap(tag => {
    const name = /^学科\s*[:：]\s*(.+)$/.exec(tag)?.[1]?.trim();
    return name ? [name] : [];
  });
  const membershipLines = content === '场景图鉴'
    ? parseCatalog(body, available, origin).membershipLines : undefined;
  const { references } = renderCardReferences(markdown, { origin, id, legacyFixedFields: schema === '1', membershipLines, annotate: false });
  return { categories: [...new Set(disciplines.length ? disciplines : tags)], summary: cardExcerpt(body), references };
}

export async function readKnowledgeGraph(api, { origin, signal, cardBodies = new CardBodyReader(api) }) {
  const options = { signal };
  signal?.throwIfAborted();
  await api.identity(options);
  const rows = await readInventory(api, options);
  const available = new Set(rows.map(row => row.id));
  const documents = await cardBodies.read(rows, { signal, allowMissing: true }, (row, raw) => {
    const parse = value => graphDocument(value, row, available, origin);
    if (row.content === '场景图鉴') return parse(raw);
    return cardBodies.derive('graph', JSON.stringify([row.id, row.schema, origin]), raw, parse);
  });
  signal?.throwIfAborted();
  const nodes = rows.map(({ id, content: title }, index) => ({
    id, title, categories: documents[index]?.categories ?? [], summary: documents[index]?.summary ?? '',
  }));
  const scanned = documents.filter(Boolean).length;
  if (!scanned && nodes.length) fail('graph_read_failed', '未能读取知识卡正文，请稍后重试。');

  const aliases = aliasMap(rows);
  const blocks = new Set();
  for (const doc of documents) {
    for (const { ref, fragment } of doc?.references ?? []) {
      if (!available.has(ref) && validBlockID(ref)) blocks.add(ref);
      if (validBlockID(fragment)) blocks.add(fragment);
    }
  }
  const owners = await blockOwners(api, [...blocks], options);
  signal?.throwIfAborted();
  const edges = [];
  for (const [index, doc] of documents.entries()) {
    const source = rows[index].id;
    const outgoing = new Map();
    for (const { ref, fragment, anchor, excerpt } of doc?.references ?? []) {
      const target = available.has(ref) ? ref : validBlockID(ref) ? owners.get(ref) : aliases.get(ref);
      if (!available.has(target) || source === target) continue;
      if (validBlockID(fragment) && owners.get(fragment) !== target) continue;
      if (!outgoing.has(target)) {
        const edge = { source, target, occurrences: [] };
        outgoing.set(target, edge);
        edges.push(edge);
      }
      const targetBlock = validBlockID(fragment) ? fragment : ref !== target && validBlockID(ref) ? ref : undefined;
      outgoing.get(target).occurrences.push({ anchor, excerpt, ...(targetBlock && { targetBlock }), ...(fragment && { targetFragment: fragment }) });
    }
  }
  return { nodes, edges, complete: scanned === rows.length, scanned, total: rows.length };
}
