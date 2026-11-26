import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openContentStore } from '../../lib/content-store.mjs';
import { documentMarkdown } from '../../lib/documents.mjs';
import { buildContent } from '../../scripts/build-content.mjs';
import { createLegacyCard } from './legacy-fixture.mjs';
import { runtime, writeJSON } from './runtime.mjs';

const description = '用证据校准旧判断。';
const readingText = '补读中出现贝叶斯先验。';
const body = '保留正文的核查原句。';
const question = '怎样核查原句？';

async function readView(instance, name) {
  const res = await fetch(instance.url + '/api/' + name);
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.ok, true);
  return result.data;
}

async function verify(instance) {
  const legacy = await createLegacyCard(instance, {
    title: '合成旧模型', legacyId: 'concept:verified-model', description,
    tags: ['学科：验证', '历史概念'], reading: { title: '模型补读', markdown: readingText },
  });
  const rawRoot = join(instance.dir, 'raw');
  const exported = await instance.raw(rawRoot, 'export', rawRoot);
  assert.equal(exported.cards, 1);
  const bindings = JSON.parse(readFileSync(join(rawRoot, '.sync.json'), 'utf8'));
  const libraryId = bindings.identity;
  assert.equal(bindings.cards['verified-model'].remoteId, legacy.id);
  const readingPath = Object.keys(bindings.readings)[0];
  assert.equal(bindings.readings[readingPath].remoteId, legacy.readingId);

  const dir = join(rawRoot, '验证', 'evidence');
  mkdirSync(dir);
  const file = join(dir, 'article.md');
  const rawArticle = '---\nname: 合成核查\n---\n\n## 核心理解\n\n' + body +
    '\n\n可以参考[[verified-model|旧模型]]。\n\n## 自测\n\n' + question + '\n';
  writeFileSync(file, rawArticle);
  const sync = await instance.raw(rawRoot, 'sync');
  assert.equal(sync.writes, 1);
  const expectedList = await instance.call('list', { includeTags: true });
  assert.equal(expectedList.items.length, 2);
  const currentId = expectedList.items.find(item => item.title === '合成核查').id;
  // A newly synced raw card has a private binding but no siyuan_id in the original
  // author file. Freeze the verified public ID without touching the running service.
  writeFileSync(file, rawArticle.replace('name: 合成核查', 'name: 合成核查\nsiyuan_id: ' + currentId));

  const [old, ordinary, reading, native] = await Promise.all([
    instance.call('get-document', { id: 'concept:verified-model' }),
    instance.call('get-document', { id: currentId }),
    instance.call('get-document', { id: legacy.readingId }),
    instance.call('get', { id: legacy.id }),
  ]);
  assert.equal(old.legacyFixedFields, true);
  assert.equal(old.id, legacy.id);
  assert.equal(ordinary.question, question);
  assert.equal(old.readings[0].id, reading.id);
  const section = native.sections.find(s => s.key === 'description');
  assert.equal(documentMarkdown(section.markdown), description);
  const nativeBlock = await instance.call('get-document', { id: section.id });
  assert.equal(nativeBlock.anchor, section.id);

  const version = ({ id, updated, revision }) => ({ id, updated, revision });
  const metadataFile = join(instance.dir, 'metadata.json'), baselineFile = join(instance.dir, 'history.json');
  writeJSON(metadataFile, {
    version: 1, libraryId, origin: instance.url,
    history: { sources: {}, proposals: {}, events: {} },
    cards: {
      [old.id]: { ...version(old), legacyFixedFields: true, content: native.content,
        blocks: [{ id: section.id, key: section.key, markdown: documentMarkdown(section.markdown) }] },
      [ordinary.id]: { ...version(ordinary), blocks: ordinary.blocks },
    },
    readings: { [readingPath]: { ...version(reading), blocks: reading.blocks } },
  });
  writeJSON(baselineFile, { version: 1, libraryId, sources: [], proposals: [], events: [] });
  const output = join(instance.dir, 'release');
  const release = buildContent({ rawRoot, metadataFile, baselineFile, output });
  assert.equal(release.counts.cards, 2);
  assert.equal(release.counts.readings, 1);

  const store = openContentStore(join(output, 'knowledge.sqlite'));
  try {
    assert.deepEqual(store.list({ includeTags: true }), expectedList);
    const day = ordinary.updated.slice(0, 8).replace(/^(....)(..)(..)$/, '$1-$2-$3');
    for (const filter of [
      { limit: 1, offset: 1, includeTags: 'page' }, { tag: '历史概念' }, { updatedFrom: day, updatedTo: day },
    ]) {
      assert.deepEqual(store.list(filter), await instance.call('list', filter));
    }
    for (const [query, owner] of [['校准', old.id], ['先验', old.id], ['核查原句', ordinary.id]]) {
      const live = await instance.call('search', { query });
      assert.deepEqual(live.map(item => item.id), [owner]);
      assert.deepEqual(store.search({ query }).map(item => item.id), [owner]);
      assert.deepEqual(store.list({ query }), await instance.call('list', { query }));
    }
    const compiledOld = store.document('concept:verified-model', instance.url);
    assert.deepEqual(compiledOld.readings, old.readings);
    assert.equal(compiledOld.legacyFixedFields, true);
    for (const live of [old, ordinary, reading]) {
      const compiled = store.document(live.id, instance.url);
      for (const field of ['id', 'title', 'updated', 'revision', 'tags', 'question', 'editable', 'deletable', 'url']) {
        assert.deepEqual(compiled[field], live[field], live.title + ' ' + field);
      }
    }
    for (const html of [compiledOld.html, old.html]) assert.ok(html.includes(description));
    const compiledBlock = store.document(section.id, instance.url);
    assert.deepEqual([compiledBlock.id, compiledBlock.anchor], [nativeBlock.id, nativeBlock.anchor]);
    assert.ok(compiledBlock.html.includes('id="' + section.id + '"'));
    assert.equal(store.document(ordinary.id).html, ordinary.html);
    assert.equal(store.document(reading.id).html, reading.html);
    const graph = await readView(instance, 'graph');
    assert.equal(graph.edges.length, 1);
    const [{ source, target, occurrences }] = graph.edges;
    assert.deepEqual([source, target], [ordinary.id, old.id]);
    assert.equal(occurrences.length, 1);
    assert.ok(ordinary.html.includes('id="' + occurrences[0].anchor + '"'));
    assert.deepEqual(store.view('graph'), graph);
    assert.deepEqual(store.view('scenarios'), await readView(instance, 'scenarios'));
    instance.record('compiled-content-comparison', {
      liveSource: 'isolated SiYuan public HTTP', candidate: 'compiled read-only SQLite',
      cards: 2, legacySchema: native.schema, readings: 1, queries: 3,
      listAndFilterParity: true, publicDatesAndOrder: true, verifiedLegacyBlock: true,
      ordinaryAndReadingHtmlEqual: true, directedCitations: 1, graphAndAtlasEqual: true,
    });
  } finally {
    store.close();
  }
}

const instance = await runtime('content-compiler');
let passed = false;
try {
  await verify(instance);
  passed = true;
} finally {
  await instance.finish(passed);
}
