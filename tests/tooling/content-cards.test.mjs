import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { compileContentCards, loadContentTree } from '../../lib/content-cards.mjs';
import { compileContentMaterials } from '../../lib/content-materials.mjs';
import { buildContentViews } from '../../lib/content-views.mjs';
import { exportRawMarkdown, loadRawTree } from '../../lib/raw-format.mjs';
import { hash } from '../../lib/siyuan.mjs';
import { renderCardReferences } from '../../server/card-references.mjs';
import { sourceSnapshot } from '../service/source-fixture.mjs';

const cardId = '20261101100000-aaaaaaa', readingId = '20261101100100-bbbbbbb';
const blockId = '20261101100200-ccccccc', readingBlock = '20261101100300-ddddddd';
const updated = '20261125130359', oldPath = '学科/old/article.md', readingPath = '学科/old/assets/reading.md';
const urls = { sourceUrl: path => '/wiki?source=' + encodeURIComponent(path), assetUrl: () => '/assets/figure.png' };
const article = (header, body) => '---\n' + header + '\n---\n\n## 核心理解\n\n' + body + '\n';
const baseline = { sources: [{ id: 'snapshot-old' }] };

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), 'content-cards-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  function write(path, value) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), value);
  }
  return { dir, write };
}

function fixture(t) {
  const { dir, write } = workspace(t);
  write(oldPath, article('name: 旧卡\nsiyuan_id: ' + cardId +
    '\ndescription: 验证摘要\naliases: [通用检索词]\ntags: [关键词]\nreadings: [{title: 补读, path: assets/reading.md}]',
    '一段旧原文。\n\n参见 [[new|新卡]]、[[retired|归档卡]]。\n\n## 自测\n\n如何验证？\n\n## 中文 · 空字段\n\n## 文本\n\n<script>alert(1)</script>'));
  write(readingPath, '补读原句。\n\n## 自测：读懂了吗？\n\n## 标签\n\n补读测试');
  write('学科/new/article.md', article('name: 新卡\naliases: [通用检索词]',
    `[旧概念](/?id=concept%3Aold) [补读](/cards/${readingId}) ((${readingBlock} "原句")) [块](../old/article.md#${blockId}) [历史版本](/wiki?source=snapshot-old)。`));
  write('学科/retired/article.md', article('name: 已归档\nstatus: archived', '已归档内容。'));
  const sync = { version: 1, cards: { old: { remoteId: cardId, path: oldPath, legacyId: 'concept:old',
    legacyMeta: { id: 'old-alias', version: 2 }, anchors: { [blockId]: { sha256: hash('一段旧原文。') } } } },
    readings: { [readingPath]: { parent: cardId, remoteId: readingId } },
    relations: [{ id: 1, source_concept_id: 'old-alias', target_concept_id: 'peer', relation_type: 'related_to' }] };
  const saveSync = () => write('.sync.json', JSON.stringify(sync));
  saveSync();
  const metadata = { version: 1, cards: {
    [cardId]: { id: cardId, updated, aliases: ['prev-slug'], blocks: [{ id: blockId, markdown: '一段旧原文。', key: 'description' }],
      revision: 'frozen-revision', legacyFixedFields: true, content: { description: '旧摘要' } },
    new: { id: 'new', updated }, retired: { id: 'retired', updated } },
    readings: { [readingPath]: { id: readingId, updated, blocks: [{ id: readingBlock, markdown: '补读原句。' }] } } };
  const build = previousIdentities => compileContentCards(loadContentTree(dir, metadata, baseline, {previousIdentities}), metadata, urls);
  return { build, write, dir, sync, saveSync, metadata };
}

test('compile frozen public identities, safe content, questions, old references, and ordered readings', t => {
  const f = fixture(t);
  const { cards, readings, identities, reservedIdentities } = f.build();
  const lookup = new Map(identities.map(row => [row.ref, [row.id, row.anchor]]));
  for (const alias of ['old', 'prev-slug', 'concept:old', 'old-alias', cardId]) assert.deepEqual(lookup.get(alias), [cardId, '']);
  assert.deepEqual(lookup.get(blockId), [cardId, blockId]);
  assert.deepEqual(lookup.get(readingBlock), [readingId, readingBlock]);
  assert.ok(!lookup.has('通用检索词') && !lookup.has('retired'));
  assert.ok(reservedIdentities.some(row => row.ref === 'retired'));
  assert.deepEqual(cards.map(c => c.slug).sort(), ['new','old']);
  const old = cards.find(c => c.id === cardId), fresh = cards.find(c => c.id === 'new');
  assert.equal(old.revision, 'frozen-revision');
  assert.equal(old.updated, updated);
  assert.equal(old.question, '如何验证？');
  assert.deepEqual(old.tags, ['学科：学科','关键词']);
  assert.deepEqual(old.aliases, ['通用检索词']);
  assert.equal(old.description, '验证摘要');
  assert.equal(old.legacyMeta.version, 2);
  assert.deepEqual(old.relations, f.sync.relations);
  assert.deepEqual(old.content, {description:'旧摘要'});
  assert.deepEqual(old.sections, [{ key:'description', id:blockId, markdown:'一段旧原文。', hash: hash('一段旧原文。') }]);
  assert.ok(old.html.includes('id="' + blockId + '"') && old.html.includes('href="/?id=new"'));
  assert.ok(old.html.includes('归档卡') && !old.html.includes('空字段') && !old.html.includes('<script>'));
  assert.ok(!old.html.includes('/cards/retired'));
  assert.equal(fresh.url, '/?id=new');
  assert.ok(fresh.markdown.includes('/cards/' + cardId + '#' + blockId));
  assert.ok(fresh.markdown.includes('/?id=' + readingBlock));
  // The exact alias in an old citation determines its cd-ref-* anchor.
  const original = renderCardReferences(fresh.markdown.replace('/?id=concept%3Aold', '/cards/concept%3Aold'), {
    origin:'https://local.invalid', id:'new',
  });
  assert.equal(fresh.references.find(r => r.ref === 'concept:old').anchor,
    original.references.find(r => r.ref === 'concept:old').anchor);
  assert.ok(fresh.markdown.includes('/wiki?source=snapshot-old'));
  assert.ok(fresh.references.every(r => fresh.html.includes('id="' + r.anchor + '"')));
  assert.deepEqual(readings.map(r => [r.id,r.parentId,r.position,r.updated]), [[readingId,cardId,0,updated]]);
  assert.ok(readings[0].html.includes('id="' + readingBlock + '"'));
  assert.equal(readings[0].question, '读懂了吗？');
  assert.deepEqual(readings[0].tags, ['补读测试']);
  assert.deepEqual(f.build(), { cards, readings, identities, reservedIdentities });
  assert.throws(() => loadRawTree(f.dir), /无法解析内部链接/);
});

test('reject stale time, ambiguous metadata, and collisions including hidden documents', t => {
  const f = fixture(t);
  const old = f.metadata.cards[cardId];
  for (const invalid of [undefined, 20261125130359, '20260431000000', '20261101246001', '20260229000000']) {
    old.updated = invalid;
    assert.throws(f.build, /old\/article.md.*updated/);
  }
  old.updated = '20240229000000';
  f.metadata.cards.old = old;
  assert.throws(f.build, /重复归属/);
  delete f.metadata.cards.old;
  for (const alias of [readingId, readingBlock, 'new', 'retired']) {
    old.aliases = [alias];
    assert.throws(f.build, /身份冲突/);
  }
  old.aliases = [];
  old.id = 'other';
  assert.throws(f.build, /siyuan_id/);
});

test('reject unverified historical block, owner, archive state, and absent snapshots', t => {
  const f = fixture(t);
  const old = f.metadata.cards[cardId];
  old.blocks = [];
  assert.throws(f.build, /历史块缺失/);
  old.blocks = [{ id:blockId, markdown:'已更改的证据。' }];
  assert.throws(f.build, /历史块缺失/);
  old.blocks = [{ id:blockId, markdown:'一段旧原文。' }];
  f.sync.readings[readingPath].parent = 'retired';
  f.saveSync();
  assert.throws(f.build, /补读归属/);
  f.sync.readings[readingPath].parent = cardId;
  f.sync.cards.old.archived = true;
  f.saveSync();
  assert.throws(f.build, /历史归档/);
  delete f.sync.cards.old.archived;
  f.saveSync();
  f.write('学科/new/article.md', article('name: 新卡', '[错](/wiki?source=unknown)'));
  assert.throws(f.build, /无法解析内部链接/);
  f.write('学科/new/article.md', article('name: 新卡', '[错](../old/article.md#' + readingBlock + ')'));
  assert.throws(f.build, /块引用归属不符/);
  f.write(readingPath, '替换掉原句。');
  assert.throws(f.build, /无法在当前正文中定位块/);
});

test('slug renames require a previous public identity and cannot reuse another owner’s bookmark', t => {
  const f = fixture(t);
  const fresh = f.metadata.cards.new;
  fresh.id = 'former-slug';
  fresh.aliases = ['former-slug'];
  assert.throws(f.build, /改名需要旧发布/);
  f.metadata.previousIdentities = {'former-slug':'former-slug'};
  assert.throws(f.build, /已校验的发布目录/);
  delete f.metadata.previousIdentities;
  const prior = new Map([['former-slug', 'former-slug']]);
  assert.equal(f.build(prior).cards.find(c => c.slug === 'new').id, 'former-slug');
  prior.set('lost-alias', 'former-slug');
  assert.throws(() => f.build(prior), /缺少旧发布的身份或块/);
  fresh.aliases.push('lost-alias');
  assert.ok(f.build(prior).identities.some(row => row.ref === 'lost-alias'));
  prior.set('new', cardId);
  assert.throws(() => f.build(prior), /旧发布归属/);
  prior.delete('new');
  fresh.status = 'archived';
  assert.throws(() => f.build(prior), /原稿状态冲突/);
  fresh.status = 'active';
  f.sync.cards.old.legacyMeta.lifecycle_status = 'archived';
  f.saveSync();
  assert.throws(() => f.build(prior), /历史概念归档/);
});

test('the old /cards/new list bookmark survives raw export, validation, content and atlas compilation', t => {
  const origin = 'https://cards.example', path = '学科/catalog/article.md';
  const bookmarks = [
    '[列表](/cards/new)', '[筛选列表](/cards/new?q=test&page=2#saved)', '[绝对地址](' + origin + '/cards/new?q=old#keep)',
  ];
  const expected = [bookmarks[0], bookmarks[1], '[绝对地址](/cards/new?q=old#keep)'];
  assert.equal(exportRawMarkdown(bookmarks.join('\n'), { cardPath:path, origin }), expected.join('\n'));
  assert.equal(exportRawMarkdown('[卡片](/?id=new)', { cardPath:path, origin,
    documentPath: id => id === 'new' && '学科/new/article.md',
  }), '[卡片](../new/article.md)');
  for (const withNew of [false, true]) {
    const { dir, write } = workspace(t);
    const metadata = { version:1, origin, cards:{ catalog:{id:'catalog',updated} }, readings:{} };
    const links = [...bookmarks];
    if (withNew) {
      write('学科/new/article.md', article('name: 合法新卡', '正文。'));
      metadata.cards.new = {id:'new',updated};
      links.push('[[new|Wiki 卡片]]', '[原稿卡片](../new/article.md)', '[查询卡片](/?id=new)');
    }
    write(path, article('name: 场景图鉴', '用于分类。\n\n## 分类\n\n### 场景\n\n' + links.map(link => '- ' + link).join('\n')));
    assert.doesNotThrow(() => loadRawTree(dir));
    const compiled = compileContentCards(loadContentTree(dir, metadata, {sources:[]}), metadata, urls);
    const card = compiled.cards.find(c => c.id === 'catalog');
    for (const link of expected) assert.ok(card.markdown.includes(link));
    const view = buildContentViews({...compiled, origin});
    const scene = view.scenarios.catalog.groups.flatMap(group => group.entries).find(entry => entry.title === '场景');
    assert.deepEqual(scene.items.map(({ cardId }) => cardId), withNew ? ['new'] : []);
    assert.deepEqual(card.references.map(r => r.ref), withNew ? ['new','new','new'] : []);
    assert.deepEqual(view.graph.edges, []);
    assert.equal(view.scenarios.catalog.diagnostics.length, bookmarks.length);
  }
});

test('explicit source file metadata resolves its raw snapshot link and verifies its content before publication', t => {
  const { dir, write } = workspace(t);
  const path = '学科/main/assets/source.md';
  const {markdown, ...record} = sourceSnapshot('direct-link', { title:'归属原文', version:1, markdown:'第一版原文。\n' });
  const baseline = { version:1, sources:[], proposals:[], events:[], sourceFiles:{ [path]:record } };
  const metadata = { version:1, cards:{ main:{id:'main',updated} }, readings:{} };
  write(path, markdown);
  write('学科/main/article.md', article('name: 卡片\nsources: [assets/source.md]', '[原文快照](/wiki?source=' + record.id + ')'));
  const compile = () => {
    const tree = loadContentTree(dir, metadata, baseline);
    const materials = compileContentMaterials(tree, baseline);
    return compileContentCards(tree, metadata, materials);
  };
  assert.ok(compile().cards[0].html.includes('href="/wiki?source=' + record.id + '"'));
  write(path, '与快照摘要不符。');
  assert.throws(compile, /校验/);
  baseline.sourceFiles = { '其他路径/source.md':record };
  assert.throws(compile, /无法解析内部链接/);
});
