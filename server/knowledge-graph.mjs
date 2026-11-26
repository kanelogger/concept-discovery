import { fromMarkdown } from 'mdast-util-from-markdown';
import { disciplinesFromTags, tagsFromNodes } from '../lib/card-list.mjs';
import { CardBodyReader } from '../lib/card-body-reader.mjs';
import { documentMarkdown } from '../lib/documents.mjs';
import { cardScope } from '../lib/library-scope.mjs';
import { cardExcerpt, catalogTitle, parseCatalog } from '../lib/scenario-atlas.mjs';
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

export function graphDocument({ markdown, id, title, legacyFixedFields, blocks }, available, origin, resolveDocumentId) {
  const body = fromMarkdown(markdown).children;
  const tags = tagsFromNodes(body, { proseOnly: true });
  const disciplines = disciplinesFromTags(tags);
  const catalog = title === catalogTitle ? parseCatalog(body, available, origin, resolveDocumentId) : undefined;
  const { references } = renderCardReferences(markdown, {
    origin, id, legacyFixedFields, blocks, membershipLines: catalog?.membershipLines, annotate: false,
  });
  return { categories: disciplines.length ? disciplines : tags, disciplines, summary: cardExcerpt(body), references, catalog };
}

export async function readKnowledgeGraph(api, { origin, signal, cardBodies = new CardBodyReader(api) }) {
  const options = { signal };
  signal?.throwIfAborted();
  await api.identity(options);
  const rows = await readInventory(api, options);
  const available = new Set(rows.map(row => row.id));
  const documents = await cardBodies.read(rows, { signal, allowMissing: true }, (row, raw) => {
    const parse = value => graphDocument({
      id: row.id, title: row.content, legacyFixedFields: row.schema === '1', markdown: documentMarkdown(value),
    }, available, origin);
    if (row.content === catalogTitle) return parse(raw);
    return cardBodies.derive('graph', JSON.stringify([row.id, row.schema, origin]), raw, parse);
  });
  signal?.throwIfAborted();
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
  const nodes = rows.map(({ id, content: title }) => ({ id, title }));
  function resolve(ref) {
    if (available.has(ref)) return { id: ref };
    if (validBlockID(ref)) return { id: owners.get(ref), anchor: ref };
    return { id: aliases.get(ref) };
  }
  return buildKnowledgeGraph(nodes, documents, resolve, ref => owners.get(ref));
}

export function buildKnowledgeGraph(cards, documents, resolve, blockOwner) {
  const nodes = cards.map(({ id, title }, index) => ({
    id, title, categories: documents[index]?.categories ?? [], summary: documents[index]?.summary ?? '',
  }));
  const scanned = documents.filter(Boolean).length;
  if (!scanned && nodes.length) fail('graph_read_failed', '未能读取知识卡正文，请稍后重试。');

  const available = new Set(nodes.map(node => node.id));
  const edges = [];
  for (const [index, doc] of documents.entries()) {
    const source = nodes[index].id;
    const outgoing = new Map();
    for (const { ref, fragment, anchor, excerpt } of doc?.references ?? []) {
      const identity = resolve(ref);
      const target = identity?.id;
      if (!available.has(target) || source === target) continue;
      if (validBlockID(fragment) && blockOwner(fragment) !== target) continue;
      if (!outgoing.has(target)) {
        const edge = { source, target, occurrences: [] };
        outgoing.set(target, edge);
        edges.push(edge);
      }
      const targetBlock = validBlockID(fragment) ? fragment : identity.anchor;
      outgoing.get(target).occurrences.push({ anchor, excerpt, ...(targetBlock && { targetBlock }), ...(fragment && { targetFragment: fragment }) });
    }
  }
  return { nodes, edges, complete: scanned === nodes.length, scanned, total: nodes.length };
}
