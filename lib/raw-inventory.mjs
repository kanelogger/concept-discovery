import { lstat, readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cardScope, readingIds } from './library-scope.mjs';
import { documentMarkdown, documentRevision } from './documents.mjs';
import { documentTags, mapConcurrent } from './card-list.mjs';
import { hash, quote } from './siyuan.mjs';
import { createWikiStore } from './wiki-store.mjs';
import { orderedReadings, readingOrderAttr } from './raw-reading-order.mjs';

async function pageById(api, selection) {
  const rows = [];
  let after = '';
  for (;;) {
    const page = await api.sql(selection(quote(after)));
    if (!page.length) return rows;
    if (page[0].id <= after || page.at(-1).id <= after) throw new Error('读取知识库时游标没有前进');
    rows.push(...page);
    after = page.at(-1).id;
  }
}

async function assetInventory(directory) {
  const assets = [];
  async function walk(relative) {
    const folder = join(directory, relative);
    if (!(await lstat(folder)).isDirectory()) throw new Error('附件目录无效');
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) assets.push({ path: 'assets/' + path, sha256: hash(await readFile(join(directory, path))) });
      else throw new Error('附件目录含非普通文件：' + path);
    }
  }
  await walk('');
  return assets.sort((a, b) => a.path.localeCompare(b.path));
}

export async function rawInventory(api, { withBlocks = true } = {}) {
  const identity = await api.identity();
  const root = dirname(api.c.dataDir);
  const primaries = await pageById(api, after => `SELECT b.id,b.content title FROM blocks b WHERE ${cardScope(api.c)}
    AND b.id > ${after} ORDER BY b.id LIMIT 128`);
  const readings = await pageById(api, after => `SELECT d.id,d.content title,b.id parent FROM blocks b JOIN blocks d
    ON d.id IN (${readingIds('b')}) WHERE ${cardScope(api.c)} AND d.id > ${after} ORDER BY d.id LIMIT 128`);
  const all = await mapConcurrent([...primaries, ...readings], async row => {
    const [raw, attrs] = await Promise.all([api.markdown(row.id), api.attrs(row.id)]);
    const markdown = documentMarkdown(raw);
    return { ...row, raw, attrs, markdown, revision: documentRevision({ title: row.title, raw, attrs }),
      legacyFixedFields: attrs['custom-cd-schema'] === '1', legacyId: attrs['custom-cd-legacy-id'],
      tags: documentTags(markdown), blocks: [], readings: [] };
  });
  const byId = new Map(all.map(doc => [doc.id, doc]));
  if (withBlocks) {
    for (let start = 0; start < all.length; start += 64) {
      const ids = all.slice(start, start + 64).map(doc => quote(doc.id)).join(',');
      const blocks = await pageById(api, after => `SELECT id,root_id,parent_id,type,markdown,content FROM blocks WHERE root_id IN (${ids})
        AND box=${quote(api.c.notebookId)} AND type <> 'd' AND id > ${after} ORDER BY id LIMIT 256`);
      for (const b of blocks) byId.get(b.root_id).blocks.push({ id: b.id, parent: b.parent_id, type: b.type, markdown: b.markdown, content: b.content });
    }
  }
  for (const row of readings) byId.get(row.parent).readings.push(byId.get(row.id));
  for (const card of all) card.readings = orderedReadings(card.readings, card.attrs[readingOrderAttr]);
  const relations = await pageById(api, after => `SELECT b.id,a.value FROM blocks b JOIN attributes a ON a.block_id=b.id
    AND a.name='custom-cd-relation' WHERE b.box=${quote(api.c.notebookId)}
    AND b.path LIKE ${quote('/'+api.c.relationsRootId+'/%')} AND b.id > ${after} ORDER BY b.id LIMIT 128`);
  return { identity, cards: primaries.map(row => byId.get(row.id)),
    sources: createWikiStore(join(root,'wiki'), identity, {readOnly:true}).listSources(),
    assets: await assetInventory(join(root, 'workspace/data/assets')), relations: relations.map(row=>JSON.parse(row.value)) };
}
