import assert from 'node:assert/strict';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { readScenarioAtlas } from '../../lib/scenario-atlas.mjs';
import { createApp } from '../../server/app.mjs';

const origin = 'http://127.0.0.1';
const catalogId = '20261122080000-ccccccc';
const first = '20261122080001-aaaaaaa';
const second = '20261122080002-bbbbbbb';
const noncurated = '20261122080003-ddddddd';
const external = '20261122080004-eeeeeee';
const deleted = '20261122080005-fffffff';
const deletedChild = '20261122080006-ggggggg';
const reading = '20261122080007-hhhhhhh';
const cardLink = id => `/cards/${id}`;

function mockLibrary(rows, markdown) {
  const reads = [];
  return {
    reads,
    api: {
      c: { notebookId: 'box', libraryRootId: 'root' },
      async identity({ signal }) { signal.throwIfAborted(); },
      async sql(_query, { signal }) { signal.throwIfAborted(); return rows; },
      async markdown(id, { signal }) { signal.throwIfAborted(); reads.push(id); return markdown.get(id); },
    },
  };
}

test('atlas normalizes saved Markdown, scopes document links and indexes explicitly marked uncurated cards', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE blocks(id,root_id,box,path,type,content); CREATE TABLE attributes(block_id,name,value);');
  const insert = db.prepare('INSERT INTO blocks VALUES(?,?,?,?,?,?)');
  const add = (id, title, path = `/root/${id}.sy`, box = 'box') => insert.run(id, id, box, path, 'd', title);
  add(catalogId, '场景图鉴');
  add(first, '当前标题一');
  add(second, '当前标题二');
  add(noncurated, '只在学科中出现');
  add(external, '外部', `/other/${external}.sy`);
  add(deleted, '已删');
  add(deletedChild, '已删下级', `/root/${deleted}/${deletedChild}.sy`);
  add(reading, '补充阅读', `/root/${first}/${reading}.sy`);
  db.prepare('INSERT INTO attributes VALUES(?,?,?)').run(deleted, 'custom-cd-deleted', 'fixture');
  db.prepare('INSERT INTO attributes VALUES(?,?,?)').run(reading, 'custom-cd-kind', 'article');
  const catalog = [
    '## 标签', '', '- 学科：图鉴维护', '',
    '## 先评审', `{: id="${catalogId}"}`, '', '### 【精选】做哪一步？', '', '先看**证据**是否充足。', '',
    `1. [旧标题二](${origin}/?id=${second}&q=资料) — **核对原文**`,
    `   {: id="${catalogId}"}`, `2. [旧标题一](${cardLink(first)}?q=卡片) — 分清结论`,
    `3. [重复一](${cardLink(first)}) — 第二次应忽略`,
    `4. [错误域](https://example.org${cardLink(first)})`,
    `5. [指向块](${cardLink(first)}#internal)`, `6. [外部](${cardLink(external)})`,
    `7. [已删下级](${cardLink(deletedChild)})`, `8. [补充阅读](${cardLink(reading)})`,
    '9. 未提供链接', '', '## 再复盘', '', '### 哪些已验证？', '', `- [卡片](${cardLink(first)})`,
  ].join('\n');
  const markdown = new Map([
    [catalogId, catalog],
    [first, '## 适用情境\n\n情境优先级较低。\n\n## 中文 · 核心理解\n\n先区分**事实**和结论。\n\n## 标签\n\n- 学科：决策科学\n- 学科: 决策科学\n- 个人标签'],
    [second, `## 适用情境\n\n${'𠮷'.repeat(180)}\n\n## 其他\n\n学科：此处不是标签`],
    [noncurated, '## 标签\n\n学科：决策科学、学科 : 研究方法、学科：\n\n```text\n学科：示例代码\n```'],
  ]);
  const { api, reads } = mockLibrary([], markdown);
  let queries = 0;
  api.sql = async query => { queries++; return db.prepare(query).all(); };
  const result = await readScenarioAtlas(api, { origin });
  assert.equal(queries, 1);
  assert.deepEqual(reads, [catalogId, first, second, noncurated]);
  assert.equal(result.catalog.status, 'ready');
  assert.deepEqual(result.catalog.ids, [catalogId]);
  assert.deepEqual(result.catalog.groups.map(group => group.title), ['先评审', '再复盘']);
  const entry = result.catalog.groups[0].entries[0];
  assert.equal(entry.title, '做哪一步？');
  assert.equal(entry.featured, true);
  assert.equal(entry.description, '先看证据是否充足。');
  assert.deepEqual(entry.items, [{ cardId: second, note: '核对原文' }, { cardId: first, note: '分清结论' }]);
  assert.equal(result.catalog.diagnostics.length, 6);
  assert.deepEqual(result.cards.find(card => card.id === first), { id: first, title: '当前标题一', excerpt: '先区分事实和结论。' });
  assert.equal(Array.from(result.cards.find(card => card.id === second).excerpt).length, 160);
  assert.deepEqual(result.disciplines.find(d => d.title === '决策科学').items.map(item => item.cardId).sort(), [first, noncurated]);
  assert.deepEqual(result.disciplines.find(d => d.title === '研究方法').items, [{ cardId: noncurated, note: '' }]);
  assert.deepEqual(result.disciplines.find(d => d.title === '图鉴维护').items, [{ cardId: catalogId, note: '' }]);
  assert.doesNotMatch(JSON.stringify(result), /此处不是标签|示例代码|重复一|旧标题一|第二次应忽略/);

  const key = entry.id;
  markdown.set(catalogId, catalog.replace('核对原文', '改用途').replace('【精选】', ''));
  assert.equal((await readScenarioAtlas(api, { origin })).catalog.groups[0].entries[0].id, key);
});

test('missing and duplicate catalog states preserve the discipline view', async () => {
  const ordinary = { id: first, content: '知识卡' };
  const markdown = new Map([[first, '## 标签\n\n- 学科：研究方法'], [catalogId, ''], [second, '']]);
  for (const [status, ids] of [['missing', []], ['duplicate', [catalogId, second]]]) {
    const rows = [ordinary, ...ids.map(id => ({ id, content: '场景图鉴' }))];
    const { api, reads } = mockLibrary(rows, markdown);
    const result = await readScenarioAtlas(api, { origin });
    assert.equal(result.catalog.status, status);
    assert.deepEqual(result.catalog.ids, ids);
    assert.deepEqual(result.catalog.groups, []);
    assert.equal(result.catalog.diagnostics.length, ids.length ? 1 : 0);
    assert.deepEqual(result.disciplines.map(d => d.title), ['研究方法']);
    assert.deepEqual(reads, [first, ...ids]);
  }
});

test('an authored discipline directory preserves its order and empty categories without becoming a scene', async () => {
  const scene = `## 问题类目\n\n### 在哪里开始？\n\n- [知识卡](${cardLink(first)})`;
  const declaration = '## 学科目录\n\n1. 心理学\u200b\n2. 工程学\n3. 元认知与思维方法论\n4. 心理学\n5. [外链](https://example.org)';
  const rows = [
    { id: catalogId, content: '场景图鉴' },
    { id: first, content: '场景中的卡片' },
    { id: second, content: '仅有学科的卡片' },
    { id: noncurated, content: '不在目录的卡片' },
  ];
  const markdown = new Map([
    [catalogId, `${declaration}\n\n${scene}`],
    [first, '## 标签\n\n- 学科：未列学科'],
    [second, '## 标签\n\n- 学科：心理学\n- 学科：元认知与思维方法论'],
    [noncurated, '## 标签\n\n- 学科：未列学科'],
  ]);
  const { api } = mockLibrary(rows, markdown);
  const result = await readScenarioAtlas(api, { origin });
  const sceneEntry = result.catalog.groups[0].entries[0];
  assert.deepEqual(result.catalog.groups.map(group => group.title), ['问题类目']);
  assert.deepEqual(sceneEntry.items, [{ cardId: first, note: '' }]);
  assert.deepEqual(result.disciplines.map(discipline => [
    discipline.title, discipline.items.map(item => item.cardId),
  ]), [['心理学', [second]], ['工程学', []], ['元认知与思维方法论', [second]]]);
  assert.deepEqual(result.cards.map(card => card.id).sort(), [first, second]);
  assert.equal(result.catalog.diagnostics.length, 1);

  markdown.set(catalogId, `## 学科目录\n\n请填写名称。\n\n${scene}`);
  const fallback = await readScenarioAtlas(api, { origin });
  assert.deepEqual(fallback.catalog.groups, result.catalog.groups);
  assert.equal(fallback.catalog.diagnostics.length, 1);
  const fallbackDiscipline = fallback.disciplines.find(discipline => discipline.title === '心理学');
  assert.equal(fallbackDiscipline.id, result.disciplines[0].id);
  assert.deepEqual(fallback.disciplines.find(discipline => discipline.title === '未列学科').items.map(item => item.cardId).sort(), [first, noncurated]);
});

test('atlas bounds the scan and stops sibling Markdown reads after a failure', async () => {
  const tooMany = mockLibrary(Array.from({ length: 10001 }, () => ({})), new Map());
  await assert.rejects(readScenarioAtlas(tooMany.api, { origin }), { code: 'scenario_limit' });
  assert.deepEqual(tooMany.reads, []);

  const rows = Array.from({ length: 16 }, (_, id) => ({ id, content: `卡 ${id}` }));
  const { api, reads } = mockLibrary(rows, new Map());
  const failure = new Error('fixture read failed');
  let interrupted = 0;
  api.markdown = (id, { signal }) => {
    reads.push(id);
    if (id === 0) return Promise.reject(failure);
    return new Promise((_, reject) => signal.addEventListener('abort', () => { interrupted++; reject(signal.reason); }, { once: true }));
  };
  await assert.rejects(readScenarioAtlas(api, { origin }), failure);
  assert.equal(reads.length, 8);
  assert.equal(interrupted, 7);
});

async function start(t, api, options = {}) {
  const server = createApp({ authMode: 'local', publicUrl: origin, agentToken: 'agent-fixture', api, ...options });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `${origin}:${server.address().port}`;
}

function get(url, headers) {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers }, async res => {
      const parts = [];
      for await (const part of res) parts.push(part);
      resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts).toString() });
    });
    req.once('error', reject);
    req.end();
  });
}

test('scenario shell allows navigation but the read API retains its same-origin and token guards', async t => {
  const { api, reads } = mockLibrary([{ id: first, content: '知识卡' }], new Map([[first, '## 标签\n\n学科：研究方法']]));
  const url = await start(t, api);
  const crossNavigation = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
  const page = await get(`${url}/scenarios`, crossNavigation);
  assert.equal(page.status, 200);
  assert.match(page.headers['content-security-policy'], /script-src 'self'/);
  assert.match(page.body, /id="root"/);
  const endpoint = `${url}/api/scenarios`;
  for (const [headers, status] of [
    [crossNavigation, 403], [{ 'sec-fetch-site': 'same-site' }, 403], [{ origin: 'https://wrong.example' }, 403],
    [{ host: 'wrong.example' }, 403], [{ authorization: 'Bearer invalid' }, 401],
  ]) assert.equal((await get(endpoint, headers)).status, status);
  assert.deepEqual(reads, []);
  const result = await get(endpoint, { 'sec-fetch-site': 'same-origin', origin });
  assert.equal(result.status, 200);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(JSON.parse(result.body).data.catalog.status, 'missing');
  assert.deepEqual(reads, [first]);
});

test('scenario request times out and disconnect cancels outstanding reads', { timeout: 4000 }, async t => {
  const { api } = mockLibrary([{ id: first, content: '知识卡' }], new Map());
  let started = Promise.withResolvers();
  let interrupted = Promise.withResolvers();
  api.markdown = (_id, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => { interrupted.resolve(signal.reason.name); reject(signal.reason); }, { once: true });
    started.resolve();
  });
  const timeoutURL = await start(t, api, { scenarioTimeoutMs: 50 });
  const timeout = await get(`${timeoutURL}/api/scenarios`);
  assert.equal(timeout.status, 504);
  assert.equal(JSON.parse(timeout.body).error.code, 'scenario_timeout');
  assert.equal(await interrupted.promise, 'TimeoutError');

  started = Promise.withResolvers();
  interrupted = Promise.withResolvers();
  const disconnectURL = await start(t, api);
  const client = request(`${disconnectURL}/api/scenarios`);
  client.on('error', () => {});
  client.end();
  await started.promise;
  client.destroy();
  assert.equal(await interrupted.promise, 'AbortError');
});
