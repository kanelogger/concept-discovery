import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { compileContentMaterials } from '../../lib/content-materials.mjs';
import { documentTags } from '../../lib/card-list.mjs';
import { documentMarkdown, documentRevision } from '../../lib/documents.mjs';
import { compileRawCard, loadRawTree } from '../../lib/raw-format.mjs';
import { hash, canonical } from '../../lib/siyuan.mjs';
import { projectDeploymentRaw } from '../../scripts/project-deployment-raw.mjs';
import { exportInventory } from '../../scripts/raw-export.mjs';
import { sealRawBindings } from '../../scripts/raw-sync.mjs';
import { sourceSnapshot } from '../service/source-fixture.mjs';

const originalId = '20261126000001-author1', publicId = '20261126000002-public1';
const oldChild = '20261126000003-author2', publicChild = '20261126000004-public2';
const block = '20261126000005-anchor1', archived = '20261126000006-hidden1';
const libraryId = 'deployed-library', slug = 'stable-slug', updated = '20261126000001';
const cardPath = '案例/' + slug + '/article.md', assetFolder = '案例/' + slug + '/assets';
const reading = assetFolder + '/reading.md', asset = assetFolder + '/photo.png', sourcePath = assetFolder + '/source.md';
const sha = value => hash(canonical(value));
const save = (file, data) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
};
const saveJSON = (file, value) => save(file, JSON.stringify(value));

async function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'deployment-raw-projection-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const raw = join(root, 'raw'), exportRoot = join(root, 'native-export');
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9YkAAAAASUVORK5CYII=', 'base64'), remotePath = 'assets/raw-' + hash(bytes) + '.png';
  const source = sourceSnapshot('projection', { title: '原文', markdown: '独立原始资料。' });
  const { markdown, ...meta } = source;
  save(join(raw, cardPath), '---\nid: ' + slug + '\nname: 卡片\nsiyuan_id: ' + originalId +
    '\ntags: [测试]\nsources: [assets/source.md]\nreadings:\n  - title: 补读\n    path: assets/reading.md\n---\n\n' +
    '## 核心理解\n\n字面量 ' + originalId + '。\n\n![示例](assets/photo.png)\n');
  save(join(raw, reading), '子文档。');
  save(join(raw, sourcePath), markdown);
  saveJSON(join(raw, sourcePath.replace('.md', '.json')), meta);
  save(join(raw, asset), bytes);
  const githubOnly = ['cd0064-acceptance-keeper', 'cd0064-acceptance-target'];
  for (const id of githubOnly) save(join(raw, '验收/', id, 'article.md'), '---\nname: 测试\n---\n\n## 核心理解\n\n测试内容。\n');
  const relation = { id: 37, source_concept_id: 'alias', target_concept_id: 'example' };
  const author = loadRawTree(raw);
  const origin = sealRawBindings(author, { version: 1, identity: 'author-library',
    cards: { [slug]: { remoteId: originalId, path: cardPath } },
    readings: { [reading]: { remoteId: oldChild, parent: originalId } }, relations: [relation],
    assets: { [asset]: { remotePath: 'assets/author.png', sha256: hash(bytes) } }, sources: { [sourcePath]: meta } });
  saveJSON(join(raw, '.sync.json'), origin);
  const urls = { assetUrl: () => remotePath, readingUrl: () => '/cards/' + publicChild,
    cardUrl: () => '/cards/' + publicId, sourceUrl: () => '/wiki?source=' + source.id };
  const render = compileRawCard(author, author.byId.get(slug), urls);
  function doc(id, title, body, parent) {
    const attrs = parent ? { updated } : { updated, 'custom-cd-legacy-id': 'alias' };
    const row = { id, title, raw: body, parent, attrs, legacyId: attrs['custom-cd-legacy-id'],
      markdown: documentMarkdown(body), readings: [], blocks: [], tags: documentTags(body) };
    row.revision = documentRevision(row);
    return row;
  }
  const main = doc(publicId, render.title, render.markdown);
  const child = doc(publicChild, '补读', render.readings[0].markdown, publicId);
  main.blocks = [{ id: block, markdown: '段落', content: '段落' }];
  main.readings = [child];
  const inventory = { identity: libraryId, cards: [main], sources: [source], assets: [{ path: remotePath, sha256: hash(bytes) }], relations: [relation] };
  const settled = { version: 1, identity: libraryId, cards: {}, readings: {},
    assets: { [asset]: { remotePath, sha256: hash(bytes) } },
    sources: { [sourcePath]: { id: source.id, digest: sha(source), hash: source.hash, createdAt: source.createdAt } },
    relations: { 37: { id: '37', digest: sha(relation) } } };
  function bound(native, previous) {
    const { rawHash, portableHash } = previous;
    return { remoteId: native.id, rawHash, portableHash, updated, revision: native.revision,
      desiredHash: sha({ title: native.title, markdown: native.raw }), parent: native.parent, legacyId: native.legacyId };
  }
  settled.cards[slug] = bound(main, origin.cards[slug]);
  settled.readings[reading] = bound(child, origin.readings[reading]);
  settled.cards['old-hidden'] = { remoteId: archived, revision: sha('before') };
  const approval = { version: 1, libraryId, archives: [{ rawId: 'old-hidden', documentId: archived, operationId: 'old-archive',
    archiveOp: 'raw-archive-native', revision: sha('after'), signature: sha('signature') }] };
  save(join(root, 'assets', remotePath.slice(7)), bytes);
  await exportInventory({ inventory, assetsDir: join(root, 'assets'), outputDir: exportRoot, origin: 'http://127.0.0.1' });
  const opts = { repo: root, inventoryFile: join(root, 'native.json'), bindingsFile: join(root, 'state.json'),
    exportRoot, archiveApproval: join(root, 'approved.json'), approvalSha256: hash(JSON.stringify(approval)),
    libraryId, output: join(root, 'projected') };
  saveJSON(opts.archiveApproval, approval);
  saveJSON(opts.bindingsFile, settled);
  saveJSON(opts.inventoryFile, inventory);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q');
  git('add', 'raw');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid', '-c', 'commit.gpgSign=false', 'commit', '-qm', 'raw');
  opts.commit = git('rev-parse', 'HEAD').toString().trim();
  return { opts, raw, inventory, settled };
}

test('project the pinned author commit onto deployed bookmarks and preserve the exact authored body and child', async t => {
  const { opts, raw, inventory } = await fixture(t);
  const article = readFileSync(join(raw, cardPath), 'utf8');
  save(join(raw, cardPath), '并发的未提交修改。');
  const receipt = projectDeploymentRaw(opts);
  const tree = loadRawTree(join(opts.output, 'raw')), sync = JSON.parse(tree.files.get('.sync.json'));
  assert.deepEqual([receipt.cards, receipt.readings, receipt.sources, receipt.assets, receipt.hiddenArchives], [1, 1, 1, 1, 1]);
  assert.equal(tree.files.get(cardPath).toString(), article.replace('siyuan_id: ' + originalId, 'siyuan_id: ' + publicId));
  assert.deepEqual(Object.keys(sync.cards), [slug]);
  assert.equal(sync.cards[slug].remoteId, publicId);
  assert.equal(sync.cards[slug].legacyId, 'alias');
  assert.equal(sync.cards[slug].rawHash, tree.byId.get(slug).hash);
  assert.equal(sync.readings[reading].remoteId, publicChild);
  const { markdown, ...exportedSource } = inventory.sources[0];
  const baseline = { version: 1, sources: inventory.sources, sourceFiles: { [sourcePath]: exportedSource }, proposals: [], events: [] };
  const materials = compileContentMaterials(tree, baseline);
  assert.deepEqual(sync.sources[sourcePath], exportedSource);
  assert.deepEqual(materials.sources, inventory.sources);
  assert.equal(materials.assets.length, 1);
  assert.equal(readFileSync(join(raw, cardPath), 'utf8'), '并发的未提交修改。');
  assert.notEqual(receipt.authorRawSha256, receipt.projectedRawSha256);
  assert.equal(receipt.excluded.length, 2);
  assert(receipt.excluded.every(row => /^[a-f0-9]{64}$/.test(row.articleSha256)));
  assert.throws(() => projectDeploymentRaw(opts), /EEXIST/);
});

test('reject inconsistent raw, active identity, export, child, asset, snapshot and relation evidence before writing', async t => {
  const { opts, settled, inventory } = await fixture(t);
  for (const change of [
    s => { delete s.cards[slug]; },
    s => { s.cards[slug].remoteId = archived; },
    s => { s.cards[slug].rawHash = sha('drift'); },
    s => { s.cards[slug].desiredHash = sha('drift'); },
    s => { s.cards[slug].anchors = { [block]: { sha256: sha('wrong') } }; },
    s => { s.readings[reading].parent = archived; },
    s => { s.assets[asset].remotePath = 'assets/wrong.png'; },
    s => { s.sources[sourcePath].digest = sha('other snapshot'); },
    s => { s.relations['37'].digest = sha('other relation'); },
    s => { s.cards['unknown-hidden'] = { remoteId: archived }; },
    s => { s.cards[slug].legacyId = 'wrong-alias'; },
  ]) {
    const changed = structuredClone(settled);
    change(changed);
    saveJSON(opts.bindingsFile, changed);
    assert.throws(() => projectDeploymentRaw(opts));
    assert.equal(existsSync(opts.output), false);
  }
  saveJSON(opts.bindingsFile, settled);
  const changed = structuredClone(inventory);
  changed.cards[0].raw += '未核准修改。';
  saveJSON(opts.inventoryFile, changed);
  assert.throws(() => projectDeploymentRaw(opts));
  saveJSON(opts.inventoryFile, inventory);
  const exported = loadRawTree(opts.exportRoot);
  const file = join(opts.exportRoot, exported.cards[0].path);
  save(file, readFileSync(file, 'utf8') + '导出后被改写。\n');
  assert.throws(() => projectDeploymentRaw(opts), /原生导出/);
  assert.equal(existsSync(opts.output), false);
});
