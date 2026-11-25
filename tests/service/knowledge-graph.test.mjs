import assert from 'node:assert/strict';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { parseFragment } from 'parse5';
import { documentMarkdown, Documents } from '../../lib/documents.mjs';
import { CardBodyReader } from '../../lib/card-body-reader.mjs';
import { createApp } from '../../server/app.mjs';
import { renderCardReferences } from '../../server/card-references.mjs';
import { readKnowledgeGraph } from '../../server/knowledge-graph.mjs';

const origin = 'http://127.0.0.1';
const id = number => '20261122000000-' + number.toString(36).padStart(7, '0');
const cardLink = number => '/cards/' + id(number);

function library(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE blocks(id PRIMARY KEY,root_id,box,path,type,content); CREATE TABLE attributes(block_id,name,value);');
  const markdown = new Map();
  const queries = [];
  const insert = db.prepare('INSERT INTO blocks VALUES(?,?,?,?,?,?)');
  function add(number, title, body, { root = number, box = 'book', path = '/root/' + id(root) + '.sy', type = 'd', attrs = {} } = {}) {
    insert.run(id(number), id(root), box, path, type, title);
    for (const [key, value] of Object.entries(attrs)) db.prepare('INSERT INTO attributes VALUES(?,?,?)').run(id(number), key, value);
    markdown.set(id(number), body);
  }
  const api = {
    c: { notebookId: 'book', libraryRootId: 'root' },
    async identity({ signal }) { signal?.throwIfAborted(); },
    async sql(query, { signal }) { signal?.throwIfAborted(); queries.push(query); return db.prepare(query).all(); },
    async markdown(ref, { signal }) { signal?.throwIfAborted(); return markdown.get(ref); },
  };
  return { api, add, markdown, queries, db };
}

function anchors(html) {
  const found = new Map();
  function visit(node) {
    const attrs = Object.fromEntries((node.attrs ?? []).map(({ name, value }) => [name, value]));
    if (attrs.id) found.set(attrs.id, attrs.href);
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parseFragment(html));
  return found;
}

test('the complete card inventory includes old and isolated cards; only visible scoped body links produce directed evidence', async t => {
  const { api, add, markdown } = library(t);
  const texts = [
    '## 中文 · 理解', '{{{row', '本句无关。参考[方法][ref]也见[方法][ref]。后面另有说明。', '}}}',
    '[ref]: ' + cardLink(2), '同一方法的[旧标识](/?id=old-method)。',
    '原生块引用 ((' + id(250) + ' "例子"))。', '文内[原段](' + cardLink(2) + '#' + id(250) + ')。',
    '<a href="kane://blocks/' + id(250) + '">旧格式链接</a>',
    '源卡[自引](' + cardLink(1) + ')与[同卡章节](#cd-section-1)。',
    '外部[同路径](https://external.example' + cardLink(2) + ')、[失效](' + cardLink(999) + ')、[附件](/assets/test.pdf)。',
    '忽略[删除](' + cardLink(201) + ')、[下级](' + cardLink(202) + ')、[阅读](' + cardLink(203) + ')、[库外块](' + cardLink(251) + ')。',
    '碎片[他卡块](' + cardLink(2) + '#' + id(251) + ')与[未存在块](' + cardLink(2) + '#' + id(997) + ')。',
    '`[代码示例](' + cardLink(4) + ')`', '```md\n[不会生成连线](' + cardLink(4) + ')\n```',
  ];
  add(1, '旧卡片', texts.join('\n\n'), { attrs: { 'custom-cd-schema': '1' } });
  add(2, '另一张卡', '[回到定义](' + origin + '/?id=' + id(1) + ')。', { attrs: { 'custom-cd-legacy-id': 'old-method' } });
  add(3, '场景图鉴', ['## 分类', '### 问题', '- [收录](' + cardLink(2) + ') — 此问题专用',
    '- 补充论证见[作者的说明](' + cardLink(4) + ')。', '参看[方法](' + cardLink(2) + ')以了解例外。',
    '### 问题', '- [重复场景收录](' + cardLink(5) + ') — 重复条目',
    '## 分类', '### 其他问题', '- [重复类目收录](' + cardLink(6) + ')'].join('\n\n'));
  for (let i = 4; i <= 132; i++) add(i, '重名卡', i === 132 ? '最后一页的[前文](' + cardLink(2) + ')。' : '## 标签\n\n学科：研究方法');
  add(201, '删除', '', { attrs: { 'custom-cd-deleted': 'yes' } });
  add(202, '删除的下级', '', { path: '/root/' + id(201) + '/' + id(202) + '.sy' });
  add(203, '阅读资料', '', { attrs: { 'custom-cd-kind': 'article' } });
  add(250, '卡内块', '', { root: 2, type: 'p' });
  add(251, '另一本笔记', '', { root: 2, type: 'p', box: 'other' });

  const result = await readKnowledgeGraph(api, { origin });
  assert.equal(result.complete, true);
  assert.equal(result.total, 132);
  assert.equal(result.scanned, 132);
  assert.deepEqual(result.nodes.map(n => n.id), Array.from({ length: 132 }, (_, i) => id(i + 1)));
  assert.deepEqual(result.edges.map(edge => [edge.source, edge.target]), [[1, 2], [2, 1], [3, 4], [3, 2], [132, 2]].map(pair => pair.map(id)));
  const occurrences = result.edges[0].occurrences;
  assert.equal(occurrences.length, 6);
  assert.equal(occurrences[0].excerpt, '参考方法也见方法。');
  assert.equal(occurrences[1].excerpt, occurrences[0].excerpt);
  assert.equal(new Set(occurrences.map(item => item.anchor)).size, 6);
  assert.deepEqual(occurrences.slice(3).map(item => item.targetBlock), [id(250), id(250), id(250)]);
  assert.equal(occurrences[4].targetFragment, id(250));
  const reader = renderCardReferences(documentMarkdown(markdown.get(id(1))), { origin, id: id(1), legacyFixedFields: true });
  const positions = anchors(reader.html);
  assert.ok(occurrences.every(item => positions.has(item.anchor)));
  assert.equal(result.edges.find(e => e.source === id(3) && e.target === id(2)).occurrences.length, 1);
  assert.doesNotMatch(JSON.stringify(result.edges), /此问题专用|不会生成连线|后面另有说明/);
});

test('document anchors persist across unrelated edits, expose repeated linked text and keep native IDs', () => {
  const source = '[方法][source]。\n\n[source]: ' + cardLink(2) + '\n\n<a href="' + cardLink(2) + '">另一个位置</a>';
  const options = { origin, id: id(1) };
  const before = renderCardReferences(source, options);
  assert.deepEqual(renderCardReferences(source, { ...options, annotate: false }).references, before.references);
  const after = renderCardReferences('新写的一段。\n\n' + source, { ...options, blocks: [{ id: id(22), markdown: source.slice(source.indexOf('<a ')) }] });
  assert.deepEqual(before.references, after.references);
  const positions = anchors(after.html);
  assert.ok(positions.has(id(22)));
  for (const ref of before.references) {
    assert.match(ref.anchor, /^cd-ref-/);
    assert.ok(positions.has(ref.anchor));
  }
  const changed = renderCardReferences(source.replace('方法', '新的论证'), options);
  assert.ok(!anchors(changed.html).has(before.references[0].anchor));
  const rawHtml = '<div>\n一段。请看 <a href="' + cardLink(2) + '">原文</a> 再下判断。\n</div>';
  assert.equal(renderCardReferences(rawHtml, options).references[0].excerpt, '请看 原文 再下判断。');

  const htmlBlock = '<a href="' + cardLink(2) + '">\n另一处\n</a>';
  const block = renderCardReferences(htmlBlock, { ...options, blocks: [{ id: id(23), markdown: htmlBlock }] });
  const citationId = block.references[0].anchor;
  assert.match(block.html, new RegExp('<span id="' + id(23) + '"></span><a [^>]*id="' + citationId + '"'));
  assert.equal(citationId, renderCardReferences(htmlBlock, options).references[0].anchor);
});

test('an empty library, a partial body read and complete failure are distinct and retryable', async t => {
  const { api, add, markdown } = library(t);
  assert.deepEqual(await readKnowledgeGraph(api, { origin }), { nodes: [], edges: [], complete: true, scanned: 0, total: 0 });
  add(1, '已读', '参考[另一张卡](' + cardLink(2) + ')。');
  add(2, '未读', undefined);
  const partial = await readKnowledgeGraph(api, { origin });
  assert.deepEqual([partial.complete, partial.total, partial.scanned, partial.nodes.length, partial.edges.length], [false, 2, 1, 2, 1]);
  markdown.set(id(2), '');
  assert.equal((await readKnowledgeGraph(api, { origin })).complete, true);
  api.markdown = () => { throw new Error('unavailable'); };
  await assert.rejects(readKnowledgeGraph(api, { origin }), { code: 'graph_read_failed' });
});

test('graph nodes carry their own disciplines and reading summaries without creating category links', async t => {
  const { api, add } = library(t);
  add(1, '有多个学科', '## 标签\n\n- 专题\n- 学科：心理学\n- 学科: 统计学\n- 学科: 心理学\n\n## 核心理解\n\n先检查证据，再报告结论。');
  add(2, '普通标签', '## 标签\n\n- 专题\n\n## 适用情境\n\n比较两个样本。');
  add(3, '无分类', '标签只是正文中的一个词。');
  add(4, '空学科标签', '## 标签\n\n- 学科：\n- 备选专题');
  const data = await readKnowledgeGraph(api, { origin });
  assert.deepEqual(data.nodes.map(({ categories, summary }) => [categories, summary]), [
    [['心理学', '统计学'], '先检查证据，再报告结论。'], [['专题'], '比较两个样本。'], [[], ''],
    [['学科：', '备选专题'], ''],
  ]);
  assert.deepEqual(data.edges, []);
});

async function start(t, api, extra) {
  const server = createApp({ authMode: 'local', publicUrl: origin, agentToken: 'test-token', api, ...extra });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return origin + ':' + server.address().port;
}

test('graph and evidence routes keep the existing HTTP origin, token and script guards', async t => {
  const { api, add, markdown } = library(t);
  add(1, '来源', '[引用](' + cardLink(2) + ')。');
  add(2, '目标', '');
  const base = await start(t, api, { executeCommand: async () => ({ id: id(1), markdown: markdown.get(id(1)), editable: true, blocks: [] }) });
  const nav = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
  // fetch overrides Sec-Fetch-Mode; send actual document-navigation headers.
  const page = await new Promise((resolve, reject) => {
    const req = request(base + '/graph', { headers: nav }, res => { res.resume(); resolve(res); });
    req.once('error', reject);
    req.end();
  });
  assert.equal(page.statusCode, 200);
  assert.match(page.headers['content-security-policy'], /script-src 'self'/);
  for (const [headers, status] of [[nav, 403], [{ origin: 'https://other.example' }, 403],
    [{ 'sec-fetch-site': 'same-site' }, 403], [{ authorization: 'Bearer bad' }, 401]]) {
    assert.equal((await fetch(base + '/api/graph', { headers })).status, status);
  }
  const graph = await (await fetch(base + '/api/graph')).json();
  const detail = await (await fetch(base + '/api/v1/commands/get-document', { method: 'POST', headers: { origin }, body: '{}' })).json();
  assert.equal(anchors(detail.data.html).get(graph.data.edges[0].occurrences[0].anchor), cardLink(2));
});

test('timeout and client disconnect cancel pending graph reads', { timeout: 5000 }, async t => {
  const { api, add } = library(t);
  add(1, '等待正文', '');
  let started = Promise.withResolvers(), aborted = Promise.withResolvers();
  api.markdown = (_id, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => { aborted.resolve(signal.reason.name); reject(signal.reason); }, { once: true });
    started.resolve();
  });
  const base = await start(t, api, { graphTimeoutMs: 100 });
  const response = await fetch(base + '/api/graph');
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error.code, 'graph_timeout');
  assert.equal(await aborted.promise, 'TimeoutError');
  started = Promise.withResolvers();
  aborted = Promise.withResolvers();
  const url = await start(t, api);
  const req = request(url + '/api/graph');
  req.on('error', () => {});
  req.end();
  await started.promise;
  req.destroy();
  assert.equal(await aborted.promise, 'AbortError');
});

test('warm graph parses only changed bodies and keeps source context, aliases, block owners and scope live', async t => {
  const { api, add, markdown, db } = library(t);
  const shared = '[本卡章节](#topic)、[旧书签](/?id=target)、[段落](/?id=' + id(50) + ')。';
  add(1, '来源甲', shared);
  add(2, '来源乙', shared);
  add(3, '原目标', '', { attrs: { 'custom-cd-legacy-id': 'target' } });
  add(4, '新目标', '');
  add(5, '普通卡', '## 类目\n\n### 问题\n\n- [成员](' + cardLink(4) + ')');
  add(50, '目标段落', '', { root: 3, type: 'p' });
  const batches = [];
  api.markdowns = async ids => {
    batches.push(ids);
    return Object.fromEntries(ids.toReversed().map(ref => [ref, markdown.get(ref)]));
  };
  let parses = 0;
  const cardBodies = new CardBodyReader(api);
  const derive = cardBodies.derive.bind(cardBodies);
  cardBodies.derive = (kind, key, raw, parse) => derive(kind, key, raw, value => { parses++; return parse(value); });
  const read = () => readKnowledgeGraph(api, { origin, cardBodies });
  const edges = result => result.edges.map(({ source, target, occurrences }) => [source, target, occurrences.length]);
  const initial = await read();
  assert.deepEqual(edges(initial), [[id(1), id(3), 2], [id(2), id(3), 2], [id(5), id(4), 1]]);
  assert.equal(parses, 5);
  assert.deepEqual(await read(), initial);
  assert.equal(parses, 5);
  assert.deepEqual(batches[1], batches[0]);

  db.prepare('UPDATE blocks SET root_id=?,path=? WHERE id=?').run(id(4), '/root/' + id(4) + '.sy', id(50));
  db.prepare('UPDATE attributes SET block_id=? WHERE block_id=?').run(id(4), id(3));
  db.prepare('INSERT INTO attributes VALUES(?,?,?)').run(id(3), 'custom-cd-deleted', 'yes');
  db.prepare('UPDATE blocks SET content=? WHERE id=?').run('场景图鉴', id(5));
  markdown.set(id(2), '[新引用](' + cardLink(1) + ')。');
  const changed = await read();
  assert.deepEqual(edges(changed), [[id(1), id(4), 2], [id(2), id(1), 1]]);
  assert.equal(changed.total, 4);
  assert.ok(!batches.at(-1).includes(id(3)));
  assert.equal(parses, 6);

  // Schema-1 and origin affect rendering even when the raw body stays identical.
  db.prepare('INSERT INTO attributes VALUES(?,?,?)').run(id(1), 'custom-cd-schema', '1');
  await read();
  assert.equal(parses, 7);
  await readKnowledgeGraph(api, { origin: 'http://localhost', cardBodies });
  assert.equal(parses, 10);
});

test('mixed batch failures isolate missing cards, preserve other batches, and recover on the next read', async t => {
  const { api, add, markdown } = library(t);
  for (let n = 1; n <= 68; n++) add(n, '卡' + n, '正文' + n);
  const missing = new Set(), batches = [], singles = [];
  api.markdowns = async ids => {
    batches.push(ids);
    if (ids.some(ref => missing.has(ref))) throw Object.assign(new Error('block not found'), { code: 'siyuan_error' });
    return Object.fromEntries(ids.map(ref => [ref, markdown.get(ref)]));
  };
  api.markdown = async ref => {
    singles.push(ref);
    if (missing.has(ref)) throw new Error('block not found');
    return markdown.get(ref);
  };
  const cardBodies = new CardBodyReader(api);
  const read = () => readKnowledgeGraph(api, { origin, cardBodies });
  assert.equal((await read()).scanned, 68);
  assert.equal(singles.length, 0);
  missing.add(id(4));
  batches.length = 0;
  const partial = await read();
  assert.deepEqual([partial.scanned, partial.total, partial.complete], [67, 68, false]);
  assert.deepEqual(batches.map(ids => ids.length).sort((a,b) => b-a), [32,32,4]);
  assert.deepEqual(singles, batches.find(ids => ids.includes(id(4))));
  missing.clear();
  assert.equal((await read()).complete, true);
  for (const ref of markdown.keys()) missing.add(ref);
  await assert.rejects(read(), { code: 'graph_read_failed' });
});

test('a shared reader retains distinct tag semantics for list items and graph nodes', async t => {
  const { api, add, db } = library(t);
  add(1, '标签示例', '## 标签\n\n```text\n代码示例\n```\n\n普通标签');
  db.exec("ALTER TABLE blocks ADD COLUMN updated DEFAULT '20261123000000'");
  const cardBodies = new CardBodyReader(api);
  const docs = new Documents(api, {});
  for (let n = 0; n < 2; n++) {
    const list = await docs.list({ includeTags: 'page' }, { cardBodies });
    const graph = await readKnowledgeGraph(api, { origin, cardBodies });
    assert.deepEqual(list.items[0].tags, ['代码示例', '普通标签']);
    assert.deepEqual(graph.nodes[0].categories, ['普通标签']);
  }
});

test('opening all facets in a thousand-card library keeps both graph and list parses hot', async t => {
  const { api, add, db, markdown } = library(t);
  for (let n = 1; n <= 1000; n++) add(n, '卡片' + n, '## 标签\n\n专题' + n);
  db.exec("ALTER TABLE blocks ADD COLUMN updated DEFAULT '20261123000000'; CREATE INDEX roots ON blocks(root_id)");
  let reads = 0;
  api.markdowns = async ids => {
    reads += ids.length;
    return Object.fromEntries(ids.map(ref => [ref, markdown.get(ref)]));
  };
  const docs = new Documents(api, {});
  const cardBodies = new CardBodyReader(api);
  const parses = { graph: 0, tags: 0 };
  const derive = cardBodies.derive.bind(cardBodies);
  cardBodies.derive = (kind, key, raw, parse) => derive(kind, key, raw, value => {
    parses[kind]++;
    return parse(value);
  });
  for (let visit = 1; visit <= 2; visit++) {
    const graph = await readKnowledgeGraph(api, { origin, cardBodies });
    assert.equal(graph.scanned, 1000);
    const facets = await docs.list({ includeTags: true }, { cardBodies });
    assert.equal(facets.tags.length, 1000);
    assert.equal(reads, 2000 * visit);
    assert.deepEqual(parses, { graph: 1000, tags: 1000 });
  }
});

test('batch service failures do not fan out; graph reports usable batches and list returns the kernel error', async t => {
  const { api, add } = library(t);
  for (let n = 1; n <= 65; n++) add(n, '标题' + n, '正文');
  let failure, loseAll = false, singles = 0;
  api.markdown = async () => { singles++; throw new Error('unexpected single read'); };
  api.markdowns = async ids => {
    if (loseAll || ids.includes(id(1))) throw failure;
    return Object.fromEntries(ids.map(ref => [ref, '正文']));
  };
  const cardBodies = new CardBodyReader(api);
  const read = () => readKnowledgeGraph(api, { origin, cardBodies });
  for (const code of ['transport_unknown', 'http_401', 'http_403', 'http_503', 'siyuan_error']) {
    failure = Object.assign(new Error('kernel unavailable'), { code });
    const graph = await read();
    assert.deepEqual([graph.scanned, graph.total, graph.complete], [33, 65, false]);
  }
  loseAll = true;
  await assert.rejects(read(), { code: 'graph_read_failed' });
  const docs = new Documents({ ...api, sql: async () => [{ id: id(1), content: '卡' }] }, {});
  for (const code of ['transport_unknown', 'http_403', 'http_500']) {
    failure = Object.assign(new Error('kernel unavailable'), { code });
    await assert.rejects(docs.list({ includeTags: true }, { cardBodies }), error => error === failure);
  }
  assert.equal(singles, 0);
});

test('disconnecting list POST cancels identity, count, page SQL and batch reads before fallback', { timeout: 5000 }, async t => {
  for (const stopAt of ['identity', 'count', 'page', 'bodies']) {
    const began = Promise.withResolvers(), stopped = Promise.withResolvers();
    const calls = [];
    const stage = (name, { signal }, value) => {
      calls.push(name);
      assert.ok(signal instanceof AbortSignal);
      if (name !== stopAt) return value;
      began.resolve();
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => { stopped.resolve(); reject(signal.reason); }, { once: true });
      });
    };
    const api = {
      c: { notebookId: 'book', libraryRootId: 'root' },
      identity: options => stage('identity', options),
      sql: (sql, options) => sql.includes('count(*) AS total')
        ? stage('count', options, [{ total: 1 }])
        : stage('page', options, [{ id: id(1), content: '卡' }]),
      markdowns: (_ids, options) => stage('bodies', options),
      markdown: () => { calls.push('single'); },
    };
    const base = await start(t, api);
    const req = request(base + '/api/v1/commands/list', { method: 'POST', headers: { origin } });
    req.on('error', () => {});
    req.end(JSON.stringify({ includeTags: 'page', limit: 20 }));
    await began.promise;
    req.destroy();
    await stopped.promise;
    await new Promise(resolve => setImmediate(resolve));
    const stages = ['identity', 'count', 'page', 'bodies'];
    assert.deepEqual(calls, stages.slice(0, stages.indexOf(stopAt) + 1));
  }
});
