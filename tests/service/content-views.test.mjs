import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { buildContentViews } from '../../lib/content-views.mjs';
import { readScenarioAtlas } from '../../lib/scenario-atlas.mjs';
import { renderCardReferences } from '../../server/card-references.mjs';
import { readKnowledgeGraph } from '../../server/knowledge-graph.mjs';

const origin = 'https://cards.example';
const native = '20261123000000-aaaaaaa';
const block = '20261123000001-bbbbbbb';

function fixture(id, title, markdown) {
  const { html } = renderCardReferences(markdown, { origin, id });
  return { id, slug: id, title, markdown, html };
}

function build(cards, extra = []) {
  const identities = [...cards.map(({ id }) => ({ ref: id, id, anchor: '' })), ...extra];
  return buildContentViews({ cards, identities, origin });
}

test('compiled atlas resolves slug and legacy members while the graph retains only active main-card citations', () => {
  const catalog = fixture('catalog', '场景图鉴', [
    '## 学科目录', '- 数学\n- 空学科', '## 类目', '### 【精选】先看什么？', '核对证据。',
    '- [新卡](/?id=new) — 专属用途\n- [重复](https://cards.example/?id=new)\n- [旧卡](/cards/prior-slug)\n- [保留的旧入口](/cards/new)\n- [补读](/cards/reading)\n- [正文块](/?id=' + block + ')',
    '论证见[普通例子](/cards/a1-b2)。',
  ].join('\n\n'));
  const source = fixture('new', '新卡', [
    '## 理解', '从原文开始。', '## 标签', '- 学科：数学\n- 普通',
    '见[旧名](/?id=prior-slug)。再看[原段](/cards/' + native + '#' + block + ')。',
    '复核 ((' + block + ' "段落"))。', '旁注[补读](/cards/reading)。',
    '排除[错卡的块](/cards/a1-b2#' + block + ')和[本卡](/?id=new)。',
  ].join('\n\n'));
  const target = fixture(native, '原卡', '[反向引用](/?id=new)。');
  const other = fixture('a1-b2', '例子', '## 标签\n\n- 未列入的普通标签');
  const cards = [target, source, other, catalog, fixture('lonely', '孤立卡', '')];
  const extra = [
    { ref: block, id: native, anchor: block }, { ref: 'prior-slug', id: native, anchor: '' },
    { ref: 'reading', id: 'reading', anchor: '' },
  ];
  const { graph, scenarios } = build(cards, extra);
  assert.deepEqual(build([...cards].reverse(), extra), { graph, scenarios });
  assert.deepEqual(graph.nodes.map(node => node.id), [native, 'a1-b2', 'catalog', 'lonely', 'new']);
  assert.deepEqual(graph.nodes.at(-1).categories, ['数学']);
  assert.equal(graph.nodes.at(-1).summary, '从原文开始。');
  assert.deepEqual(graph.nodes[1].categories, ['未列入的普通标签']);
  assert.deepEqual(graph.edges.map(({ source, target }) => [source, target]),
    [[native, 'new'], ['catalog', 'a1-b2'], ['new', native]]);
  const occurrences = graph.edges[2].occurrences;
  assert.equal(occurrences.length, 3);
  assert.equal(occurrences[0].excerpt, '见旧名。');
  assert.deepEqual(occurrences.map(o => o.targetBlock), [undefined, block, block]);
  assert.equal(occurrences[1].targetFragment, block);
  for (const { anchor } of occurrences) assert.ok(source.html.includes('id="' + anchor + '"'));
  assert.deepEqual(scenarios.disciplines.map(({ title, items }) => [title, items.map(i => i.cardId)]),
    [['数学', ['new']], ['空学科', []]]);
  const entry = scenarios.catalog.groups[0].entries[0];
  assert.deepEqual([entry.title, entry.featured, entry.description], ['先看什么？', true, '核对证据。']);
  assert.deepEqual(entry.items, [{ cardId: 'new', note: '专属用途' }, { cardId: native, note: '' }]);
  assert.equal(scenarios.catalog.diagnostics.length, 3);
});

test('missing and duplicate compiled directories retain the discipline index and isolate duplicate directory memberships', () => {
  const target = fixture('member', '成员', '## 标签\n\n学科：心理学');
  const content = '## 类目\n\n### 场景\n\n- [成员](/cards/member)';
  for (const ids of [[], ['first', 'second']]) {
    const cards = [target, ...ids.map(id => fixture(id, '场景图鉴', content))];
    const { graph, scenarios } = build(cards);
    assert.deepEqual(graph.edges, []);
    assert.equal(scenarios.catalog.status, ids.length ? 'duplicate' : 'missing');
    assert.deepEqual(scenarios.catalog.ids, ids);
    assert.deepEqual(scenarios.catalog.groups, []);
    assert.deepEqual(scenarios.disciplines[0].items, [{ cardId: 'member', note: '' }]);
  }
});

test('both compiled views match the live graph and atlas response for a native-ID library', async t => {
  const second = '20261123000002-ccccccc';
  const directory = '20261123000003-ddddddd';
  const cards = [
    fixture(native, '甲', '## 中文 · 适用情境\n\n场景细节。\n\n参见[乙](/cards/' + second + ')。'),
    fixture(second, '乙', '## 标签\n\n- 学科：心理学\n\n详见[原段](/?id=' + block + ')。'),
    fixture(directory, '场景图鉴', '## 问题\n\n### 为什么？\n\n- [甲](/cards/' + native + ')'),
  ];
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE blocks(id,root_id,box,path,type,content); CREATE TABLE attributes(block_id,name,value);');
  const insert = db.prepare('INSERT INTO blocks VALUES(?,?,?,?,?,?)');
  for (const { id, title } of cards) insert.run(id, id, 'book', '/root/' + id + '.sy', 'd', title);
  insert.run(block, native, 'book', '/root/' + native + '.sy', 'p', '原段');
  const api = {
    c: { libraryRootId: 'root', notebookId: 'book' },
    identity: async () => {},
    sql: async query => db.prepare(query).all(),
    markdown: async ref => cards.find(({ id }) => id === ref).markdown,
  };
  assert.deepEqual(build(cards, [{ ref: block, id: native, anchor: block }]), {
    graph: await readKnowledgeGraph(api, { origin }),
    scenarios: await readScenarioAtlas(api, { origin }),
  });
});
