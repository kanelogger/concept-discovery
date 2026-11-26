import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { documentMarkdown, documentRevision } from '../../lib/documents.mjs';
import { readOnlyReason } from '../../lib/read-commands.mjs';
import { hash, normalize } from '../../lib/siyuan.mjs';
import { createWikiStore } from '../../lib/wiki-store.mjs';
import { openContentStore } from '../../lib/content-store.mjs';
import { renderCardReferences } from '../../server/card-references.mjs';
import { buildContent } from '../../scripts/build-content.mjs';
import { freezeObservedContent } from '../../scripts/freeze-content-inputs.mjs';
import { exportInventory } from '../../scripts/raw-export.mjs';
import { sourceSnapshot } from '../service/source-fixture.mjs';

const libraryId = 'frozen-test-library';
const origin = 'http://127.0.0.1:11801';
const cardId = '20261126000001-cardaaa', readingId = '20261126000002-reading';
const blockId = '20261126000003-blockaa', readingBlock = '20261126000004-blockbb';
const updated = '20261126000005';
const json = path => JSON.parse(readFileSync(path, 'utf8'));

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'content-freeze-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const rawRoot = join(dir, 'raw'), frozen = join(dir, 'copy'), wikiRoot = join(frozen, 'wiki');
  const archive = createWikiStore(wikiRoot, libraryId);
  const source = archive.restoreSource(sourceSnapshot('fixture', { title: '原文', markdown: '可核对的版本。' }));
  function document(id, title, paragraph, block) {
    const raw = paragraph + '\n{: id="' + block + '" updated="' + updated + '"}';
    const row = { id, title, raw, attrs: { updated }, markdown: documentMarkdown(raw),
      blocks: [{ id: block, type: 'p', markdown: paragraph, content: '索引-' + title }],
      readings: [], tags: [], legacyFixedFields: false };
    return { ...row, revision: documentRevision(row) };
  }
  const card = document(cardId, '示例卡', '主要原句。', blockId);
  const child = document(readingId, '补读标题', '补读原句。', readingBlock);
  child.parent = cardId;
  card.readings = [child];
  const relation = { id: 37, source_concept_id: 'old-a', target_concept_id: 'old-b', relation_type: 'related_to' };
  const inventory = { identity: libraryId, cards: [card], assets: [], relations: [relation], sources: [source] };
  await exportInventory({ inventory, outputDir: rawRoot, assetsDir: frozen, origin });
  const exported = json(join(rawRoot, '.sync.json'));
  const bindingsFile = join(frozen, 'bindings.json');
  const save = (value = exported) => writeFileSync(bindingsFile, JSON.stringify(value));
  save();
  function detail(row) {
    const { id, title, markdown, revision } = row;
    const blocks = row.blocks.map(({ id, markdown }) => ({ id, markdown }));
    const { html } = renderCardReferences(markdown, { origin, id, blocks });
    return { id, title, markdown, revision, blocks, html, updated, editable: false, deletable: false, readOnlyReason,
      question: '', tags: [], url: origin + '/?id=' + id,
      readings: row.readings.map(({ id, title }) => ({ id, title, url: origin + '/?id=' + id })) };
  }
  const main = detail(card), reading = detail(child);
  const publicGet = { id: cardId, documentId: cardId, title: card.title, schema: 2, markdown: card.markdown,
    summary: card.markdown, sources: '', hash: hash(card.raw), url: main.url,
    sections: [card, child].map(({ id, raw, blocks }) => ({ id: blocks[0].id, key: id === cardId ? 'body' : 'reading',
      markdown: raw, hash: hash(raw) })), readings: [{ id: readingId, title: child.title, markdown: normalize(child.raw) }] };
  const { markdown, ...sourceMeta } = source;
  const commands = {
    'get-document': ({ id }) => id === cardId ? main : reading,
    get: () => publicGet,
    list: ({ offset, limit }) => ({ offset, limit, total: 1, hasMore: false, items: [{ id: cardId, title: card.title, updated }] }),
    'source-get': () => source, 'sources-list': () => ({ items: [{ ...sourceMeta, characters: [...markdown].length }] }),
    'wiki-proposals': () => ({ items: [] }), 'wiki-events': () => ({ items: [] }),
  };
  const call = (command, input) => structuredClone(commands[command](input));
  const options = { rawRoot, bindingsFile, wikiRoot, libraryId, origin, output: join(dir, 'inputs'), call,
    readInventory: () => structuredClone(inventory) };
  return { dir, options, archive, card, main, publicGet, inventory, exported, commands, save,
    cardBinding: exported.cards['card-' + cardId], childPath: Object.keys(exported.readings)[0] };
}

test('freeze native search text, integer relations, public projections and history; compile and read them back', async t => {
  const f = await fixture(t);
  let reads = 0;
  const coverage = await freezeObservedContent({ ...f.options, readInventory() { reads++; return structuredClone(f.inventory); } });
  assert.equal(reads, 2);
  assert.equal(coverage.cards, 1);
  assert.equal(coverage.readings, 1);
  assert.equal(coverage.sources, 1);
  const metadataFile = join(f.options.output, 'metadata.json'), baselineFile = join(f.options.output, 'history.json');
  for (const file of [metadataFile, baselineFile]) assert.equal(statSync(file).mode & 0o077, 0);
  const metadata = json(metadataFile);
  assert.equal(metadata.cards[cardId].frozenDocument.searchText, '示例卡\n索引-示例卡');
  assert.equal(metadata.readings[f.childPath].frozenDocument.searchText, '补读标题\n索引-补读标题');
  assert.deepEqual(json(baselineFile).sources, f.inventory.sources);
  const output = join(f.dir, 'release');
  buildContent({ rawRoot: f.options.rawRoot, output, metadataFile, baselineFile });
  const store = openContentStore(join(output, 'knowledge.sqlite'));
  try {
    assert.deepEqual(store.card(cardId, origin), f.publicGet);
    assert.deepEqual(store.document(cardId, origin), f.main);
    assert.equal(store.document(readingBlock, origin).id, readingId);
    assert.equal(store.document(readingBlock, origin).anchor, readingBlock);
  } finally { store.close(); }
  await assert.rejects(freezeObservedContent(f.options), /已存在/);
});

test('reject unsettled bindings, archived identities, wrong ownership and native index omissions', async t => {
  const f = await fixture(t);
  const changed = async (modify, pattern) => {
    const bindings = structuredClone(f.exported);
    modify(bindings);
    f.save(bindings);
    await assert.rejects(freezeObservedContent(f.options), pattern);
    assert.equal(existsSync(f.options.output), false);
  };
  await changed(b => { b.identity = 'other-copy'; }, /库身份/);
  for (const key of ['archived', 'needsSync', 'forceApply', 'archiveOp', 'reserved']) {
    await changed(b => { Object.values(b.cards)[0][key] = true; }, /归档|未结算/);
  }
  await changed(b => { Object.values(b.cards)[0].path = 'other.md'; }, /路径不符/);
  await changed(b => { Object.values(b.cards)[0].legacyMeta = { lifecycle_status: 'archived' }; }, /已归档/);
  await changed(b => { b.readings[f.childPath].parent = readingId; }, /父卡不符/);
  await changed(b => { b.readings[f.childPath].rawHash = hash('other'); }, /修订与冻结绑定/);
  await changed(b => { b.relations = { '37': { id: '37', digest: hash('changed') } }; }, /结构化关系/);
  f.save();
  const old = json(join(f.options.rawRoot, '.sync.json'));
  Object.values(old.cards)[0].archiveOp = 'archive-operation';
  writeFileSync(join(f.options.rawRoot, '.sync.json'), JSON.stringify(old));
  await assert.rejects(freezeObservedContent(f.options), /历史绑定归属或归档/);
  writeFileSync(join(f.options.rawRoot, '.sync.json'), JSON.stringify(f.exported));
  delete f.inventory.cards[0].blocks[0].content;
  await assert.rejects(freezeObservedContent(f.options), /缺少原生块搜索文本/);
  assert.equal(existsSync(f.options.output), false);
});

test('refuse changes to the selected copy, list, history, raw files or bindings during the freeze', async t => {
  const f = await fixture(t);
  for (const kind of ['native', 'list', 'raw', 'bindings', 'history']) {
    let reads = 0;
    const readInventory = () => {
      const rows = structuredClone(f.inventory);
      if (++reads === 2) {
        if (kind === 'native') rows.cards[0].blocks[0].content += 'changed';
        if (kind === 'raw') writeFileSync(join(f.options.rawRoot, 'README.md'), '并发修改');
        if (kind === 'bindings') f.save({ ...f.exported, lastPlan: 'changed' });
        if (kind === 'history') f.archive.restoreSource(sourceSnapshot('second', { title: '并发加入', markdown: '另一来源。' }));
      }
      return rows;
    };
    const call = (command, input) => {
      const result = f.options.call(command, input);
      if (kind === 'list' && reads === 2 && command === 'list') result.items[0].updated = '20261127000005';
      return result;
    };
    const reason = { native: /冻结前后原生库存/, list: /冻结前后公开活动卡库存/, raw: /原稿文件发生变化/,
      bindings: /冻结前后绑定/, history: /冻结前后磁盘历史库存/ };
    await assert.rejects(freezeObservedContent({ ...f.options, readInventory, call }), reason[kind]);
    assert.equal(reads, 2);
    assert.equal(existsSync(f.options.output), false);
    f.save();
  }
});

test('refuse public projection drift even when the native inventory and parent list timestamp are unchanged', async t => {
  const f = await fixture(t);
  for (const [command, id, field] of [
    ['get-document', readingId, 'updated'], ['get-document', cardId, 'html'], ['get', cardId, 'sections'],
  ]) {
    let matchingCalls = 0;
    function call(name, input) {
      const data = f.options.call(name, input);
      if (name === command && input.id === id && ++matchingCalls === 2) {
        if (field === 'updated') data.updated = '20261125000001';
        if (field === 'html') data.html += '<p>changed</p>';
        if (field === 'sections') data.sections[0].markdown += 'changed';
      }
      return data;
    }
    await assert.rejects(freezeObservedContent({ ...f.options, call }), /冻结前后公开投影/);
    assert.equal(matchingCalls, 2);
    assert.equal(existsSync(f.options.output), false);
  }
});

test('freshly exported active cards cannot override a pending operation or an archived binding in the private copy', async t => {
  const f = await fixture(t);
  const stateDir = join(f.dir, 'copy', 'raw-sync', hash(libraryId));
  mkdirSync(stateDir, {recursive:true});
  const pending = join(stateDir, 'pending.json');
  writeFileSync(pending, '{}');
  await assert.rejects(freezeObservedContent(f.options), /未结算的原稿同步/);
  rmSync(pending);
  const stateFile = join(stateDir, 'state.json');
  const state = { version:1, identity:libraryId, cards:{ retired:{remoteId:'old-card', archived:true} }, readings:{} };
  writeFileSync(stateFile, JSON.stringify(state));
  await assert.rejects(freezeObservedContent(f.options), /本地绑定仍有归档/);
  delete state.cards.retired;
  writeFileSync(stateFile, JSON.stringify(state));
  let reads = 0;
  await assert.rejects(freezeObservedContent({ ...f.options, readInventory() {
    if (++reads === 2) writeFileSync(stateFile, JSON.stringify({ ...state, lastPlan:'changed' }));
    return structuredClone(f.inventory);
  } }), /冻结前后副本本地绑定/);
  assert.equal(existsSync(f.options.output), false);
});

test('freeze CLI keeps malformed private configuration, command arguments and secret file paths out of diagnostics', t => {
  const dir = mkdtempSync(join(tmpdir(), 'freeze-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cmd = fileURLToPath(new URL('../../scripts/freeze-content-inputs.mjs', import.meta.url));
  const secret = 'synthetic-private-value';
  const root = join(dir, 'copy'), raw = join(dir, 'raw'), bindings = join(dir, 'bindings.json');
  mkdirSync(root); mkdirSync(raw); writeFileSync(bindings, '{}');
  const args = ['--frozen-root', root, '--raw-root', raw, '--bindings', bindings, '--library-id', 'fixture', '--out', join(dir, 'new')];
  writeFileSync(join(root, 'client.json'), secret);
  for (const input of [args, ['--token=' + secret], ['--raw-root', join(dir, secret)]]) {
    const { status, stderr, stdout } = spawnSync(process.execPath, [cmd, ...input], { encoding: 'utf8' });
    assert.equal(status, 1);
    assert.equal(stdout, '');
    assert.doesNotMatch(stderr, new RegExp(secret));
    assert.ok(!stderr.includes(dir) && !existsSync(join(dir, 'new')));
  }
});

// Emulate only Docker's inspected metadata and the reader's line protocol.
// No daemon, application listener or kernel is needed for these CLI boundary tests.
const mockDocker = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const { FREEZE_DOCKER_FIXTURE, FREEZE_DOCKER_LOG } = process.env;
const fixture = JSON.parse(fs.readFileSync(FREEZE_DOCKER_FIXTURE, 'utf8'));
const args = process.argv.slice(2);
const record = event => fs.appendFileSync(FREEZE_DOCKER_LOG, JSON.stringify(event) + '\n');
record({args});
if (args[0] === 'context' && args[1] === 'show') console.log('synthetic');
else if (args[0] === 'context' && args[1] === 'inspect') console.log(fixture.endpoint);
else if (args[0] === 'compose') console.log(args.at(-1) === 'app' ? 'a'.repeat(12) : 'b'.repeat(12));
else if (args[0] === 'inspect') console.log(JSON.stringify(fixture.containers));
else if (args[0] === 'network' && args[1] === 'inspect' && args.at(-1) === fixture.networkId) {
  console.log(JSON.stringify(fixture.peers));
} else if (args[0] === 'run') {
  if (fixture.workerFailure) {
    console.error(fixture.workerFailure);
    process.exit(1);
  }
  readline.createInterface({input:process.stdin}).on('line', line => {
    const {method, input} = JSON.parse(line);
    record({method, input});
    const key = JSON.stringify([method, input]);
    if (!Object.hasOwn(fixture.replies, key)) process.exit(2);
    console.log(JSON.stringify({ok:true, data:fixture.replies[key]}));
  });
} else process.exit(2);
`;

async function dockerFixture(t) {
  const f = await fixture(t);
  const root = realpathSync(join(f.dir, 'copy')), bin = join(f.dir, 'bin');
  mkdirSync(bin);
  mkdirSync(join(root, 'workspace', 'data', 'assets'), { recursive: true });
  mkdirSync(join(root, 'operations'));
  const canary = 'synthetic-private-credential';
  for (const name of ['agent-token', 'kernel-token']) writeFileSync(join(root, name), canary + '-' + name);
  writeFileSync(join(root, 'kernel.json'), JSON.stringify({url:'http://kernel:6806', internal:true, tokenFile:'kernel-token'}));
  writeFileSync(join(root, 'client.json'), JSON.stringify({url:origin, tokenFile:'agent-token'}));
  writeFileSync(join(root, 'service.json'), JSON.stringify({publicUrl:origin, port:3000, kernelConfig:'kernel.json', agentTokenFile:'agent-token'}));
  writeFileSync(join(root, 'compose.env'), 'CONCEPT_PORT=11801\nCOMPOSE_PROJECT_NAME=synth\n');
  writeFileSync(join(bin, 'docker'), mockDocker, {mode:0o700});
  const cmd = fileURLToPath(new URL('../../scripts/freeze-content-inputs.mjs', import.meta.url));
  const args = ['--frozen-root', root, '--raw-root', f.options.rawRoot, '--bindings', f.options.bindingsFile,
    '--library-id', libraryId, '--out', f.options.output];
  const appId = 'a'.repeat(64), kernelId = 'b'.repeat(64), networkId = 'c'.repeat(64);
  const kernelIP = '172.25.0.3';
  const containers = ['app', 'kernel'].map(service => {
    const isApp = service === 'app';
    return {
      Id:isApp ? appId : kernelId, Image:'synthetic-image',
      Config:{ Labels:{'com.docker.compose.project':'synth', 'com.docker.compose.service':service},
        Env:isApp ? ['CONCEPT_SERVICE_CONFIG=/state/service.json'] : [] },
      State:{Running:true},
      Mounts:[{Type:'bind', Destination:isApp ? '/state' : '/siyuan/workspace', Source:isApp ? root : join(root, 'workspace')}],
      NetworkSettings:{Networks:{synth:{Aliases:[service], NetworkID:networkId, IPAddress:isApp ? '172.25.0.2' : kernelIP}},
        Ports:isApp ? {'3000/tcp':[{HostIp:'127.0.0.1', HostPort:'11801'}]} : {}},
    };
  });
  const replies = { [JSON.stringify(['inventory', {withBlocks:true}])]:f.inventory };
  for (const [command, input] of [
    ['list', {offset:0, limit:100}], ['sources-list', {}], ['wiki-proposals', {}], ['wiki-events', {}],
    ['source-get', {id:f.inventory.sources[0].id}], ['get-document', {id:cardId}], ['get', {id:cardId}],
    ['get-document', {id:readingId}],
  ]) {
    replies[JSON.stringify(['public-read', {command, input}])] = f.options.call(command, input);
  }
  const config = { endpoint:'unix:///synthetic/docker.sock', containers, networkId,
    peers:{[appId]:{IPv4Address:'172.25.0.2/16'}, [kernelId]:{IPv4Address:kernelIP + '/16'}}, replies };
  const log = join(f.dir, 'calls.jsonl'), configFile = join(f.dir, 'docker.json');
  function run(configure = () => {}) {
    const next = structuredClone(config);
    configure(next, ...next.containers);
    writeFileSync(configFile, JSON.stringify(next));
    writeFileSync(log, '');
    const env = {...process.env, PATH:bin + ':' + process.env.PATH, DOCKER_CONTEXT:'synthetic',
      FREEZE_DOCKER_FIXTURE:configFile, FREEZE_DOCKER_LOG:log};
    const result = spawnSync(process.execPath, [cmd, ...args], {env, encoding:'utf8', timeout:20000});
    assert.ifError(result.error);
    const events = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.ok(!JSON.stringify(events).includes(canary), 'credentials must stay out of Docker arguments and RPC');
    return {...result, events};
  }
  return { ...f, run, canary, root, appId, kernelId, kernelIP };
}

test('freeze CLI selects the verified container namespace, read-only state and literal kernel endpoint', async t => {
  const f = await dockerFixture(t);
  const {status, stdout, stderr, events} = f.run();
  assert.equal(status, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), {cards:1, readings:1, sources:1, proposals:0, events:0});
  const args = events.find(e => e.args?.[0] === 'run').args;
  assert.equal(args[args.indexOf('--network') + 1], 'container:' + f.appId);
  assert.ok(args.includes('type=bind,src=' + f.root + ',dst=/state,readonly'));
  assert.deepEqual(args.slice(-3), ['/app/scripts/frozen-reader.mjs', f.kernelIP, origin]);
  assert.equal(events.filter(e => e.method === 'inventory').length, 2);
  for (const [command, id] of [['get', cardId], ['get-document', cardId], ['get-document', readingId]]) {
    assert.equal(events.filter(e => e.method === 'public-read' && e.input.command === command && e.input.input.id === id).length, 2);
  }
  assert.equal(json(join(f.options.output, 'metadata.json')).cards[cardId].frozenGet.data.title, f.card.title);
});

test('freeze CLI rejects mismatched mounts, published endpoint and Docker network before starting the reader', async t => {
  const f = await dockerFixture(t);
  const cases = [
    ['remote daemon', config => { config.endpoint = 'tcp://192.0.2.1:2375'; }],
    ['wrong loopback port', (_, app) => { app.NetworkSettings.Ports['3000/tcp'][0].HostPort = '11802'; }],
    ['public binding', (_, app) => { app.NetworkSettings.Ports['3000/tcp'][0].HostIp = '0.0.0.0'; }],
    ['wrong workspace', (_, app, kernel) => { kernel.Mounts[0].Source = f.dir; }],
    ['overlaid wiki', (_, app) => { app.Mounts.push({Type:'volume', Destination:'/state/wiki'}); }],
    ['overlaid assets', (_, app, kernel) => { kernel.Mounts.push({Type:'volume', Destination:'/siyuan/workspace/data/assets'}); }],
    ['unverified container ID', (_, app) => { app.Id = 'd'.repeat(64); }],
    ['undeclared app config', (_, app) => { app.Config.Env = []; }],
    ['second app network', (_, app) => { app.NetworkSettings.Networks.other = {}; }],
    ['kernel host override', (_, app) => { app.HostConfig = {ExtraHosts:['kernel:192.0.2.5']}; }],
    ['network ID mismatch', (_, app) => { app.NetworkSettings.Networks.synth.NetworkID = 'e'.repeat(64); }],
    ['additional network peer', config => { config.peers['d'.repeat(64)] = {IPv4Address:'172.25.0.5/16'}; }],
    ['different kernel address', config => { config.peers[f.kernelId].IPv4Address = '172.25.0.4/16'; }],
  ];
  function assertRefused(label, configure, startsWorker = false) {
    const {status, stderr, stdout, events} = f.run(configure);
    assert.equal(status, 1, label);
    assert.equal(stdout, '', label);
    assert.match(stderr, /冻结失败/, label);
    assert.ok(!stderr.includes(f.canary) && !stderr.includes(f.root), label);
    assert.equal(events.some(e => e.args?.[0] === 'run'), startsWorker, label);
    assert.equal(existsSync(f.options.output), false, label);
  }
  for (const [label, configure] of cases) assertRefused(label, configure);
  const link = join(f.root, 'workspace', 'data', 'outside');
  symlinkSync(f.options.rawRoot, link);
  assertRefused('workspace contains a link outside its physical copy');
  rmSync(link);
  assertRefused('worker fails with private diagnostic', config => { config.workerFailure = f.canary + ' ' + f.root; }, true);
});
