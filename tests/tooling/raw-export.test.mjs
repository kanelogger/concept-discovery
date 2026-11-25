import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportDatabaseCard, exportInventory, normalizeRawCard } from '../../scripts/raw-export.mjs';
import { loadRawTree } from '../../lib/raw-format.mjs';
import { canonical, hash } from '../../lib/siyuan.mjs';

const first = '20260102000000-aaaaaaa', second = '20260102000000-bbbbbbb';
const child = '20260102000000-ccccccc', block = '20260102000000-ddddddd';
const sourceId = 'src_' + '1'.repeat(32);
const sharedImage = Buffer.from([0, 23, 44, 137]);
const archivedImage = Buffer.from([0, 23, 44, 133]);

test('定向导出只更新目标正文和状态，保留原稿元数据并解析已有内部链接',()=>{
  const path='合成学科/sample/article.md';
  const original=Buffer.from('---\nid: sample # 身份注释\nname: 合成旧标题\nsiyuan_id: '+first+'\ndescription: 原稿独有摘要\nreadings:\n  - title: 独立补读\n    path: assets/reading.md\n---\n\n## 核心理解\n\n旧正文。\n');
  const document={id:first,title:'合成新标题',disciplines:['合成学科'],markdown:'## 理解\n\n引用[保留卡](/cards/'+second+')。\n\n## 别名\n\n合成别名\n'};
  const links={documentPath:id=>id===second?'合成学科/retained/article.md':null};
  const output=exportDatabaseCard({path,original,rawId:'sample',document,links,archivedAt:'2026-11-25T04:00:00+08:00'}).toString();
  assert.match(output,/id: sample # 身份注释/);
  assert.match(output,/name: 合成新标题/);
  assert.match(output,/description: 原稿独有摘要/);
  assert.match(output,/path: assets\/reading\.md/);
  assert.match(output,/status: archived/);
  assert.match(output,/aliases:\n  - 合成别名/);
  assert.match(output,/\[保留卡\]\(\.\.\/retained\/article\.md\)/);
  assert.doesNotMatch(output,/旧正文/);
  assert.throws(()=>exportDatabaseCard({path,original,rawId:'sample',document:{...document,id:second},links}),/身份|不符/);
  assert.throws(()=>exportDatabaseCard({path,original,rawId:'sample',document,links:{}}),/无法导出内部链接/);
});

test('数据库已清空的别名和标签不会在重建时复活，复杂区块仍保留',()=>{
  const path='合成学科/sample/article.md';
  const original=Buffer.from('---\nname: 合成卡\naliases: [旧别名]\ntags: [旧标签]\n---\n\n## 核心理解\n\n旧正文。');
  const document={id:first,title:'合成卡',disciplines:['合成学科'],markdown:'## 理解\n\n新正文。\n\n## 标签\n'};
  const cleared=exportDatabaseCard({path,original,rawId:'sample',document}).toString();
  assert.doesNotMatch(cleared,/aliases:|tags:|旧标签|旧别名/);
  const retained=exportDatabaseCard({path,original,rawId:'sample',
    document:{...document,markdown:document.markdown+'\n需要保留 [引用](https://example.invalid)。\n'}}).toString();
  assert.match(retained,/tags: \[ 旧标签 \]/);
  assert.match(retained,/需要保留 \[引用\]\(https:\/\/example.invalid\)/);
});

test('标签按线上语义拆分，已绑定卡片的学科需要明确核对后才能变更',()=>{
  const path='合成学科/sample/article.md';
  const original=Buffer.from('---\nname: 合成卡\naliases: [甲, 乙]\ndescription: 旧摘要\n---\n\n## 核心理解\n\n旧正文。');
  const document={id:first,title:'合成卡',markdown:'## 理解\n\n新正文。\n\n## 摘要\n\n新摘要\n\n## 别名\n\n甲、乙\n\n## 标签\n\n标签甲、标签乙、学科：合成学科\n'};
  const output=exportDatabaseCard({path,original,rawId:'sample',document}).toString();
  assert.match(output,/description: 新摘要/);
  assert.doesNotMatch(output,/旧摘要/);
  assert.match(output,/aliases:\n  - 甲\n  - 乙/);
  assert.match(output,/tags:\n  - 标签甲\n  - 标签乙/);
  for (const change of [
    {...document,markdown:document.markdown.replace('学科：合成学科','学科：另一学科')},
    {...document,markdown:document.markdown.replace('、学科：合成学科','')},
    {...document,disciplines:[]},
    {...document,disciplines:['其他学科','合成学科']},
  ]) assert.throws(()=>exportDatabaseCard({path,original,rawId:'sample',document:change}),{code:'content_conflict'});
});
function card(id, title, markdown, extra = {}) {
  return { id, title, markdown, revision: hash(id + markdown), tags: ['学科：数学'], blocks: [], readings: [], ...extra };
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'raw-export-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const assetsDir = join(root, 'images'), outputDir = join(root, 'raw');
  await mkdir(assetsDir);
  await writeFile(join(assetsDir, 'shared.png'), sharedImage);
  await writeFile(join(assetsDir, 'loose.png'), archivedImage);
  const markdown = '原始段落。  \n\n结尾\r\n';
  const payload = { sourceId, title: '原始章节', markdown, author: '作者', url: '' };
  const snapshot = 'src_' + hash(canonical(payload)).slice(0, 32);
  const source = { ...payload, id: snapshot, version: 2, createdAt: '2026-01-02T00:00:00.000Z', hash: hash(markdown) };
  const cards = [
    card(first, '甲', '## 理解\n\n[见乙](/cards/' + second + '#' + block + ')\n\n![共享图](assets/shared.png)\n\n[原文](/wiki?source=' + snapshot + ')', {
      legacyId: 'first', readings: [card(child, '补充', '从[乙](/?id=' + second + ')继续。')],
    }),
    card(second, '乙', '## 理解\n\n乙的段落。\n\n![图](assets/shared.png)', {
      legacyId: 'second', blocks: [{ id: block, markdown: '乙的段落。' }],
    }),
  ];
  const catalog = { cards: [{ id: first, key: 'first' }], sources: [{ key: 'first', sourceId: snapshot, hash: source.hash }],
    models: [{ id: 'first', discipline: '历史', number: 1 }], disciplines: [{ title: '历史', description: '阅读目录。' }] };
  const inventory = { identity: 'test-library', cards, sources: [source], relations: [{ id: 'edge' }],
    assets: [{ path: 'assets/shared.png', sha256: hash(sharedImage) }, { path: 'assets/loose.png', sha256: hash(archivedImage) }] };
  return { inventory, assetsDir, outputDir, catalog };
}

test('export preserves original sources and reading identity, deduplicates assets and references real blocks', async t => {
  const options = await fixture(t);
  const summary = await exportInventory(options);
  assert.deepEqual(summary, { cards: 2, sources: 1, assets: 2, unreferencedAssets: 1, readings: 1,
    correctedAssetPaths: 0, referencedBlocks: 1 });
  const tree = loadRawTree(options.outputDir);
  const bindings = JSON.parse(await readFile(join(options.outputDir, '.sync.json')));
  const a = tree.byId.get('first'), b = tree.byId.get('second');
  assert.deepEqual(a.metadata.also_in, ['历史']);
  assert.ok(a.markdown.includes('../second/article.md#' + block));
  assert.ok(a.readings[0].markdown.includes('../../second/article.md'));
  assert.equal(a.sources.length, 1);
  assert.deepEqual(tree.files.get(a.sources[0]), Buffer.from(options.inventory.sources[0].markdown));
  assert.equal(tree.sourceMetadata.get(a.sources[0]).createdAt, options.inventory.sources[0].createdAt);
  assert.equal(tree.sourceFiles.size, 1);
  assert.equal(tree.assets.size, 2);
  assert.equal(tree.cards.length, 2);
  assert.equal(bindings.assets['数学/first/assets/shared.png'].remotePath, 'assets/shared.png');
  assert.deepEqual(tree.files.get('数学/first/assets/shared.png'), sharedImage);
  assert.deepEqual(tree.files.get('未归档/library-attachments/assets/loose.png'), archivedImage);
  assert.ok(b.markdown.includes('../first/assets/shared.png'));
  assert.equal(bindings.readings[a.readings[0].path].remoteId, child);
  assert.equal(bindings.readings[a.readings[0].path].parent, first);
  assert.equal(bindings.cards.second.anchors[block].sha256, hash('乙的段落。'));
  assert.equal(bindings.cards.first.rawHash, a.hash);
  assert.equal(bindings.cards.first.legacyId, 'first');
  assert.deepEqual(bindings.relations, [{ id: 'edge' }]);
  assert.match(await readFile(join(options.outputDir, '历史/README.md'), 'utf8'), /数学\/first\/article\.md/);
  await assert.rejects(exportInventory(options), { code: 'EEXIST' });
});

test('missing links, wrong block owners and changed frozen files never publish a partial tree', async t => {
  const options = await fixture(t);
  const doc = options.inventory.cards[0], original = doc.markdown;
  doc.markdown = '[无此卡](/cards/absent)';
  await assert.rejects(exportInventory(options), /无法导出/);
  doc.markdown = '[跨文档错锚](/cards/' + first + '#' + block + ')';
  await assert.rejects(exportInventory(options), /不属于目标文档/);
  doc.markdown = original;
  await writeFile(join(options.assetsDir, 'shared.png'), archivedImage);
  await assert.rejects(exportInventory(options), /冻结后发生变化/);
  await assert.rejects(readFile(join(options.outputDir, '.sync.json')), { code: 'ENOENT' });
});

test('only an explicit, hash-matched repair can bind a misspelled attachment', async t => {
  const options = await fixture(t);
  const card = options.inventory.cards[0];
  card.markdown = '## 理解\n\n图片可以作为原始记录。\n\n![插图](assets/shared.png9)';
  const repair = { documentId: first, from: 'assets/shared.png9', to: 'assets/shared.png', sha256: hash(sharedImage) };
  await assert.rejects(exportInventory(options), /无法导出/);
  await assert.rejects(exportInventory({ ...options, assetCorrections: [{ ...repair, sha256: hash(archivedImage) }] }), /修正清单/);
  const result = await exportInventory({ ...options, assetCorrections: [repair] });
  assert.equal(result.correctedAssetPaths, 1);
  const bindings = JSON.parse(await readFile(join(options.outputDir, '.sync.json')));
  assert.equal(bindings.cards.first.needsSync, true);
  assert.deepEqual(bindings.cards.first.repairs, [{ from: repair.from, to: repair.to }]);
  assert.equal(bindings.cards.second.needsSync, undefined);
});

test('normalize only recognized prose, move the real understanding intact and extract editable metadata', () => {
  const first = '## 别名\n\n- 一个名称\n- 另一个名称\n\n## 标签\n\n- 学科：工程学\n- 模型\n\n';
  const fenced = '## 例子\n\n```md\n## 理解\n示例中的标题\n```';
  const understanding = '已有的一句话。还有一句。\n\n使用[证据](a.md)说明。';
  const source = first + fenced + '\n\n## 中文 · 理解\n\n' + understanding +
    '\n\n## 别名\n\n- 原名来自[材料](b.md)';
  assert.deepEqual(normalizeRawCard(source), {
    aliases: ['一个名称', '另一个名称'], tags: ['模型'], description: '已有的一句话。',
    markdown: '## 核心理解\n\n' + understanding + '\n\n' + fenced + '\n\n## 别名\n\n- 原名来自[材料](b.md)',
  });
  const onlyDiscipline = '## 标签\n\n- 学科：心理学\n\n## 原理与用法\n\n原来的解释。';
  assert.deepEqual(normalizeRawCard(onlyDiscipline, { description: '已有摘要。' }),
    { markdown: '## 核心理解\n\n原来的解释。', description: '已有摘要。' });
});
