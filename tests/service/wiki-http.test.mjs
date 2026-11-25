import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../../server/app.mjs';
import {createWikiStore} from '../../lib/wiki-store.mjs';
import {commands} from '../../lib/client.mjs';
import {sourceSnapshot} from './source-fixture.mjs';

const origin = 'http://127.0.0.1';
const auth = {authorization:'Bearer fixture-agent'};
async function fixture(t, services = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cd-wiki-http-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const wikiRoot = join(root, 'wiki');
  const app = createApp({authMode:'local',publicUrl:origin, agentToken:'fixture-agent', wikiRoot,
    api:{c:{dataDir:join(root, 'operations')}, identity:async () => 'fixture-library'}, ...services});
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.close(resolve)));
  const url = origin + ':' + app.address().port;
  const post = (name, input, headers = {}) => fetch(url + '/api/v1/commands/' + name,
    {method:'POST', headers:{'content-type':'application/json', ...headers}, body:JSON.stringify(input)});
  return {wikiRoot, url, post};
}

test('sources and historical commands read without initializing any private storage', async t => {
  const {wikiRoot, url, post} = await fixture(t);
  assert.deepEqual(commands, ['list','search','get','get-document','sources-list','source-get','wiki-card','wiki-proposals','wiki-proposal','wiki-events']);
  assert.equal((await post('sources-list', {})).status, 403);
  assert.equal((await post('sources-list', {}, {origin:'https://wrong.invalid'})).status, 403);
  assert.equal((await post('sources-list', {}, {authorization:'Bearer invalid', origin})).status, 401);
  for (const command of ['sources-list','wiki-events','wiki-proposals']) {
    assert.deepEqual(await (await post(command, {}, {origin})).json(), {ok:true,data:{items:[]}});
  }
  assert.equal((await post('source-get', {id:'src_' + 'a'.repeat(32)}, auth)).status, 404);
  assert.equal(existsSync(wikiRoot), false);
  const source = sourceSnapshot('source-http', {
    title:'来源测试', markdown:'保留原文。\n\n<script>bad()</script>', url:'https://example.org/source', version: 2,
  });
  createWikiStore(wikiRoot, 'fixture-library').restoreSource(source);
  assert.equal((await fetch(url + '/wiki?source=' + source.id)).status, 200);
  assert.equal((await fetch(url + '/wiki/sources/' + source.id, {headers:auth})).status, 404);
  for (const headers of [{origin}, auth]) {
    const listed = await (await post('sources-list', {}, headers)).json();
    assert.equal(listed.data.items[0].id, source.id);
    assert.deepEqual((await (await post('source-get', {id:source.id}, headers)).json()).data, source);
    assert.equal((await post('source-get', {id:'../../service.json'}, headers)).status, 400);
  }
});

test('retired writes, operation reconciliation, model, preview and upload are denied before parsing or dispatch', async t => {
  const effects = [];
  const touched = area => () => { effects.push(area); throw new Error(area); };
  const {url, wikiRoot} = await fixture(t, {
    api:{c:{}, identity:touched('wiki identity')}, executeCommand:touched('kernel'),
  });
  const retired = ['create','save-document','delete-document','update-block','append','recover','operation-status',
    'source-import','wiki-draft','wiki-propose','wiki-apply','wiki-understanding','wiki-recover','ask','polish-description','init','raw-probe','raw-convert-document','future-write'];
  for (const headers of [{origin}, auth]) {
    for (const command of retired) {
      const response = await fetch(url + '/api/v1/commands/' + command, {method:'POST', headers, body:'{'});
      assert.equal(response.status, 404, command);
      assert.equal((await response.json()).error.code, 'invalid_command', command);
    }
    for (const [path, method] of [['/api/model-settings','GET'], ['/api/model-settings','PUT'], ['/api/assets','POST'], ['/api/preview','POST']]) {
      const response = await fetch(url + path, {method, headers, body:method === 'GET' ? undefined : '{'});
      assert.equal(response.status, 404, path);
    }
  }
  assert.deepEqual(effects, []);
  assert.equal(existsSync(wikiRoot), false);
});
