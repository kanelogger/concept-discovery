import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, hash } from '../../lib/siyuan.mjs';
import { loadRawFiles, compileRawCard } from '../../lib/raw-format.mjs';
import { compileContentMaterials } from '../../lib/content-materials.mjs';
import { sourceSnapshot } from '../service/source-fixture.mjs';

const folder = '入门/one/';
const ownerPath = folder + 'article.md', sourcePath = folder + 'assets/source.md';
const pngPath = folder + 'assets/shared.png', readingPath = folder + 'assets/reading.md';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9X2i8AAAAASUVORK5CYII=', 'base64');
const card = (title, fields, body) => Buffer.from('---\nname: ' + title + '\n' + fields + '\n---\n## 核心理解\n\n' + body);
const snapshot = (version, markdown) => sourceSnapshot('one-source', {title:'原文', version, markdown});
const meta = ({markdown, ...record}) => record;
const json = data => Buffer.from(JSON.stringify(data));
const baseline = () => ({version:1, sources:[], proposals:[], events:[]});

function fixture() {
  const one = snapshot(1, '旧版本\r\n'), two = snapshot(2, '  二版 😀\r\n');
  const files = new Map([
    [ownerPath, card('一', 'sources: [assets/source.md]\nreadings: [{title: 补读, path: assets/reading.md}]',
      '![](assets/shared.png)\n\n[inactive]: assets/unused.png\n\n`![](assets/metadata.json)`')],
    [readingPath, Buffer.from('![补图][图]\n\n[图]: shared.png')],
    ['入门/two/article.md', card('二', '', '<img src="../one/assets/shared.png" alt="共享" />')],
    ['入门/old/article.md', card('归档', 'status: archived', '![](assets/exclusive.png)')],
    ['入门/old/assets/exclusive.png', Buffer.from('inactive')],
    [pngPath, png], [folder + 'assets/unused.png', Buffer.from('unused')],
    [folder + 'assets/metadata.json', Buffer.from('{"private":true}')],
    [sourcePath, Buffer.from(two.markdown)], [folder + 'assets/source.json', json(meta(two))],
    ['.sync.json', json({version:1,sources:{[sourcePath]:meta(one)},assets:{[pngPath]:{remotePath:'assets/old.png',sha256:hash(png)}}})]
  ]);
  const history = baseline(), rawProposal = {id:'prop_' + 'a'.repeat(32),kind:'proposal',state:'archived',
    createdAt:'2026-01-01',updatedAt:'2026-01-02',items:[]};
  history.sources.push(one);
  history.proposals.push({...rawProposal,revision:hash(canonical(rawProposal))});
  history.events.push({id:'evt_' + 'a'.repeat(32),kind:'applied',createdAt:'2026-01-03'});
  return {files, one, two, history};
}

test('material compilation keeps immutable source versions, verified archives and only reachable reader assets', () => {
  const {files, one, two, history} = fixture(), tree = loadRawFiles(files);
  const materials = compileContentMaterials(tree, history);
  assert.deepEqual(materials.sources, [two, one]);
  assert.equal(materials.sourceUrl(sourcePath), '/wiki?source=' + two.id);
  assert.deepEqual(materials.proposals, history.proposals);
  assert.deepEqual(materials.events, history.events);
  const filename = hash(png) + '.png';
  assert.deepEqual(materials.assets, [{path:pngPath,hash:hash(png),filename,mime:'image/png',
    bytes:png,owners:['one','two',readingPath],legacyPath:'assets/old.png'}]);
  const urls = {...materials, cardUrl:id => '/cards/' + id, readingUrl:() => '/cards/reading'};
  const {markdown, readings} = compileRawCard(tree, tree.byPath.get(ownerPath), urls);
  assert.ok(markdown.includes('/assets/' + filename));
  assert.ok(readings[0].markdown.includes('/assets/' + filename));
  assert.ok(!markdown.includes('unused.png'));
  assert.throws(() => materials.assetUrl('入门/old/assets/exclusive.png'), /活动附件/);
  assert.throws(() => materials.sourceUrl('missing.md'), /来源文件/);
  const again = compileContentMaterials(loadRawFiles(new Map([...files].reverse())), history);
  for (const key of ['sources', 'assets', 'proposals', 'events']) assert.deepEqual(again[key], materials[key]);
});

test('missing, corrupt and colliding source versions stop the build', () => {
  const {files, one, two, history} = fixture();
  const compile = () => compileContentMaterials(loadRawFiles(files), history);
  history.sources = [];
  assert.throws(compile, /已发布的原文版本/);
  files.delete('.sync.json');
  assert.throws(compile, /缺少历史版本 1/);
  history.sources = [one, snapshot(1, '不同的一版')];
  assert.throws(compile, /同一来源版本/);
  history.sources = [one, {...two, createdAt:'2025-01-01'}];
  assert.throws(compile, /相同 ID/);
  history.sources = [one];
  files.set(sourcePath, Buffer.from('换过的原文'));
  assert.throws(compile, /标识、版本或内容校验/);
  files.set(sourcePath, Buffer.from(two.markdown));
  files.set(folder + 'assets/source.json', json({title:'坏旁注'}));
  assert.throws(compile, /旁注/);
});

test('a standalone new source uses explicit repeatable metadata, never the build clock', () => {
  const path = '未归档/note/article.md', files = new Map([[path, Buffer.from('---\nname: 新来源\nkind: source\n---\n\n新原文\n')]]);
  const history = baseline(), tree = loadRawFiles(files);
  assert.throws(() => compileContentMaterials(tree, history), /缺少版本化元数据/);
  const record = snapshot(1, '新原文');
  history.sourceFiles = {[path]:meta(record)};
  assert.deepEqual(compileContentMaterials(tree, history).sources, [record]);
  history.sourceFiles['没了.md'] = meta(record);
  assert.throws(() => compileContentMaterials(tree, history), /文件缺失/);
});

test('active malformed assets, unsafe old paths, digest mismatches and textual sidecars stop compilation', () => {
  const {files, history} = fixture();
  const compile = () => compileContentMaterials(loadRawFiles(files), history);
  files.set(pngPath, png.subarray(0, 27));
  assert.throws(compile, /文件不完整/);
  files.set(pngPath, png);
  const sync = JSON.parse(files.get('.sync.json'));
  sync.assets[pngPath].sha256 = '0'.repeat(64);
  files.set('.sync.json', json(sync));
  assert.throws(compile, /哈希/);
  sync.assets[pngPath].sha256 = hash(png);
  sync.assets[pngPath].remotePath = 'assets/../private.png';
  files.set('.sync.json', json(sync));
  assert.throws(compile, /路径无效/);
  files.delete('.sync.json');
  files.set(ownerPath, card('一', 'sources: [assets/source.md]', '[元数据](assets/metadata.json)'));
  assert.throws(compile, /不是可分发/);
});

test('historical revisions and id uniqueness are verified before export', () => {
  const {files, history} = fixture(), tree = loadRawFiles(files);
  history.events.push({...history.events[0], kind:'other'});
  assert.throws(() => compileContentMaterials(tree, history), /相同 ID/);
  history.events.pop();
  history.proposals[0].items.push({reason:'changed'});
  assert.throws(() => compileContentMaterials(tree, history), /提案修订/);
  delete history.events;
  assert.throws(() => compileContentMaterials(tree, history), /历史资料基线/);
});

test('ordinary downloads and SVGs retain their types while unused material stays private', () => {
  const files = new Map([
    [ownerPath, card('可下载', '', '[文本](assets/file.txt) [表格](assets/file.csv) ![图](assets/diagram.svg)')],
    [folder + 'assets/file.txt', Buffer.from('纯文字')],
    [folder + 'assets/file.csv', Buffer.from('a,b\n1,2')],
    [folder + 'assets/diagram.svg', Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><circle/></svg>')],
    [folder + 'assets/private.txt', Buffer.from('未引用的文本')],
  ]);
  const history = baseline(), compile = () => compileContentMaterials(loadRawFiles(files), history);
  const {assets} = compile();
  assert.deepEqual(assets.map(({path, mime}) => [path, mime]), [
    [folder + 'assets/diagram.svg', 'image/svg+xml'],
    [folder + 'assets/file.csv', 'application/octet-stream'],
    [folder + 'assets/file.txt', 'application/octet-stream'],
  ]);
  history.assets = Object.fromEntries(assets.map(asset => [asset.path, {remotePath:'assets/collision',sha256:asset.hash}]));
  assert.throws(compile, /附件 URL 映射冲突/);
});

test('an image inside a suppressed link to an archived card is never published', () => {
  const files = new Map([
    [ownerPath, card('一', '', '本段仍可见。\n\n[![私图](assets/nested.png)](../old/article.md)')],
    ['入门/old/article.md', card('旧', 'status: archived', '旧文')],
    [folder + 'assets/nested.png', png],
  ]);
  const {assets} = compileContentMaterials(loadRawFiles(files), baseline());
  assert.deepEqual(assets, []);
});

test('a referenced historical snapshot must accompany its proposal', () => {
  const {files, history} = fixture();
  const {revision, ...proposal} = history.proposals[0];
  proposal.sourceId = 'src_' + 'c'.repeat(32);
  history.proposals = [{...proposal,revision:hash(canonical(proposal))}];
  assert.throws(() => compileContentMaterials(loadRawFiles(files), history), /提案引用的原文快照缺失/);
});
