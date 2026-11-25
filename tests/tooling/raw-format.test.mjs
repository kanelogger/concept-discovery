import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { documentTags } from '../../lib/card-list.mjs';
import { loadRawTree, compileRawCard, exportRawMarkdown } from '../../lib/raw-format.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'raw-format-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), value);
  };
  return { root, write };
}
const article = (meta, body) => '---\n' + meta + '\n---\n\n' + (meta.includes('kind: source') || body.includes('## 核心理解') ? '' : '## 核心理解\n\n示例。\n\n') + body + '\n';
const urls = { cardUrl: id => '/cards/' + id, assetUrl: p => '/assets/' + p.split('/').at(-1),
  sourceUrl: () => '/wiki?source=snapshot-42', readingUrl: () => '/cards/reading' };
const source = '知识/first/article.md', target = '历史/second/article.md';
const nativeId = '20261101010203-ab123cd', anchor = '20261101010203-a123456';

test('inbound inventory includes archived cards, readings and actual Markdown references', t => {
  const { root, write } = fixture(t);
  const image = '历史/second/assets/shared.png', reading = '知识/first/assets/notes.md';
  write(image, 'shared payload');
  write(target, article('name: 删除候选', '目标卡。'));
  write(source, article('name: 保留卡\nstatus: archived\nreadings: [{title: 问答, path: assets/notes.md}]',
    '[[second|目标]]，![图](../../历史/second/assets/shared.png)。<img src="../../历史/second/assets/shared.png">'));
  write(reading, '另见[图][img]，以及示例代码 `[[second]]`。\n\n[img]: ../../../历史/second/assets/shared.png');
  const tree = loadRawTree(root, { references:true });
  assert.deepEqual([...tree.inbound.get(target)], [source]);
  assert.deepEqual([...tree.inbound.get(image)].sort(), [source, reading].sort());
  assert.deepEqual([...tree.inbound.get(reading)], [source]);
});

test('complete YAML, mutual references, material links and frozen UTF-8 inputs', t => {
  const { root, write } = fixture(t);
  write(source, article([
    'name: "第一张: 卡片"', 'id: one', 'description: 关于判断的短句', 'aliases: [别称, 另一称呼]', 'tags: [判断, 新标签]',
    'also_in:', '  - 历史', 'sources: [../../未归档/notes/article.md]', 'readings:', '  - title: 补充解释', '    path: assets/more.md',
  ].join('\n'), [
    '## 核心理解', '', '参见 [[second]] 或 [[second|判断问题]]，以及[段落](../../历史/second/article.md#' + anchor + ')。',
    '', '`[[missing]]` \\[[literal]] [外链](https://external.test/cards/unknown)。',
    '', '~~~md', '[[missing]] [忽略](../missing/article.md)', '~~~',
    '', '<img src="assets/figure.png" width="200" alt="图">', '', '[材料](../../未归档/notes/article.md)。',
    '', '## 标签', '', '判断、学科：知识', '', '## 别名', '', '别称',
  ].join('\n')));
  write('知识/first/assets/figure.png', Buffer.from([1, 2, 3]));
  write('知识/first/assets/more.md', '\uFEFF延伸到 [[second]]，见[图][f]。\n\n[f]: figure.png "证据"');
  write(target, article('name: 第二张\nsiyuan_id: ' + nativeId, '反向 [例子](../../知识/first/article.md)。'));
  write('未归档/notes/article.md', article('name: 原文\nkind: source\nsources: [assets/original.md]', '见[原文](assets/original.md)。'));
  write('未归档/notes/assets/original.md', '\uFEFF# 原始证据\r\n逐字材料。\r\n');
  write('未归档/notes/assets/original.json', JSON.stringify({ id: 'snapshot-42', sourceId: 'original-family', title: '现场记录' }));
  const tree = loadRawTree(root);
  const first = tree.byId.get('one');
  write('知识/first/assets/more.md', '后来修改');
  const card = compileRawCard(tree, first, urls);
  assert.equal(card.title, '第一张: 卡片');
  assert.match(card.markdown, /\[第二张\]\(\/cards\/second\).*\[判断问题\]\(\/cards\/second\)/);
  assert.ok(card.markdown.includes('/cards/second#' + anchor));
  assert.ok(card.markdown.includes('`[[missing]]` \\[[literal]] [外链](https://external.test/cards/unknown)'));
  assert.ok(card.markdown.includes('[[missing]] [忽略](../missing/article.md)'));
  assert.ok(card.markdown.includes('<img src="/assets/figure.png" width="200" alt="图">'));
  assert.ok(card.markdown.includes('## 摘要\n\n关于判断的短句'));
  assert.equal(card.markdown.match(/别称/g).length, 1);
  assert.equal(card.markdown.match(/\/wiki\?source=snapshot-42/g).length, 1);
  assert.deepEqual(documentTags(card.markdown), ['学科：知识', '学科：历史', '判断', '新标签']);
  assert.equal(card.readings[0].markdown, '\uFEFF延伸到 [第二张](/cards/second)，见[图][f]。\n\n[f]: /assets/figure.png "证据"');
  assert.equal(compileRawCard(tree, tree.byId.get('second'), urls).markdown.includes('[例子](/cards/one)'), true);
  assert.deepEqual([...tree.sourceFiles], ['未归档/notes/assets/original.md']);
  assert.deepEqual([...tree.assets], ['知识/first/assets/figure.png']);
  assert.equal(tree.files.get([...tree.sourceFiles][0]).toString(), '\uFEFF# 原始证据\r\n逐字材料。\r\n');
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.notEqual(loadRawTree(root).byId.get('one').hash, first.hash);
});

test('export keeps block locations, native references, asset names, external links and code in context', t => {
  const { root, write } = fixture(t);
  const material = '知识/first/assets/原文.md';
  const rawAsset = '知识/first/assets/a (b).png';
  const data = [
    `[段落](/cards/${nativeId}#${anchor}) [旧入口](/?id=${nativeId}) ((${anchor} "原句"))`,
    `[原生](kane://blocks/${anchor}) [同站](http://localhost:9000/cards/${nativeId})`,
    '[外站](https://example.org/cards/other) [来源](/wiki?source=snapshot-42)',
    '', '<img src="assets/a%20(b).png" alt="图" width="234">', '',
    '`[代码](/cards/unknown)`', '', '~~~md', '![图](assets/missing.png)', '~~~',
  ].join('\n');
  const raw = exportRawMarkdown(data, { cardPath: source, origin: 'http://localhost:9000',
    documentPath: id => id === nativeId ? target : id === anchor ? { path: target, fragment: anchor } : undefined,
    assetPath: p => p === 'assets/a (b).png' ? rawAsset : undefined,
    sourcePath: id => id === 'snapshot-42' ? material : undefined });
  assert.equal((raw.match(new RegExp('#' + anchor, 'g')) || []).length, 3);
  assert.ok(raw.includes('[原句](../../%E5%8E%86%E5%8F%B2/second/article.md#' + anchor + ')'));
  assert.ok(raw.includes('<img src="assets/a%20%28b%29.png" alt="图" width="234">'));
  assert.ok(raw.includes('`[代码](/cards/unknown)`'));
  write(source, article('name: 返回\nsources: [assets/原文.md]', raw));
  write(target, article('name: 对象', '正文'));
  write(rawAsset, '图片');
  write(material, '# 原文');
  const tree = loadRawTree(root);
  const compiled = compileRawCard(tree, tree.byId.get('first'), { ...urls, assetUrl: () => '/assets/safe.png' });
  assert.ok(compiled.markdown.includes('[原句](/cards/second#' + anchor + ')'));
  assert.ok(compiled.markdown.includes('[外站](https://example.org/cards/other)'));
  assert.ok(compiled.markdown.includes('[来源](/wiki?source=snapshot-42)'));
  assert.throws(() => exportRawMarkdown('[错](/cards/bad)', { cardPath: source, documentPath: () => undefined }), /无法导出/);
});

test('unattached files are indexed without inventing a card or original source', t => {
  const { root, write } = fixture(t);
  write('未归档/library-attachments/article.md', article('name: 附件\nkind: source\nattachments_only: true', '[文档](assets/file.pdf)'));
  write('未归档/library-attachments/assets/file.pdf', 'bytes');
  const tree = loadRawTree(root);
  assert.equal(tree.cards.length, 0);
  assert.equal(tree.sourceFiles.size, 0);
  assert.deepEqual([...tree.assets], ['未归档/library-attachments/assets/file.pdf']);
});

test('preflight rejects broken references, escaping paths, symlinks, duplicate IDs and malformed fields', t => {
  const { root, write } = fixture(t);
  write(target, article('name: 已有卡', '内容'));
  for (const [meta, body, error] of [
    ['name: 卡', '[错](../../../secrets)', /越过/],
    ['name: 卡', '[[bad]]', /找不到卡片标识/],
    ['name: 卡', '[错](assets/missing.md)', /找不到本地文件/],
    ['name: 卡', '![错](file:///private/x)', /本机绝对路径/],
    ['name: 卡\nid: second', '', /重复标识/],
    ['name: 卡\ntags: 不是列表', '', /需要文字列表/],
    ['name: 卡\nname: 同名', '', /unique/i],
  ]) {
    write(source, article(meta, body));
    assert.throws(() => loadRawTree(root), error);
  }
  write(source, article('name: 卡', '正文'));
  symlinkSync(join(root, source), join(root, 'link'));
  assert.throws(() => loadRawTree(root), /符号链接/);
});

test('metadata edits replace simple values in place and preserve other user sections', t => {
  const { root, write } = fixture(t);
  const body = '## 摘要\n\n旧说明\n\n## 别名\n\n旧名\n\n## 中文 · 标签\n\n- 学科：旧归属\n- 旧标签\n\n## 我的理解\n\n我写下的文字和 `旧名`。';
  write(source, article('name: 新卡\naliases: [新名]\ndescription: 新说明\ntags: [新标签]\nalso_in: [逻辑]', body));
  const tree = loadRawTree(root);
  const result = compileRawCard(tree, tree.byId.get('first'), urls).markdown;
  assert.deepEqual(documentTags(result), ['学科：知识', '学科：逻辑', '新标签']);
  assert.ok(result.includes('## 摘要\n\n新说明\n\n## 别名\n\n新名'));
  assert.ok(result.endsWith('## 我的理解\n\n我写下的文字和 `旧名`。'));
  assert.doesNotMatch(result, /旧归属|旧标签|旧说明/);
});

test('upload all package assets, including unlinked files, and distinguish sidecars from regular JSON', t => {
  const { root, write } = fixture(t);
  write(source, article('name: 卡\nsources: [../../历史/second/assets/source.md, assets/survey.md]', '当前没有附件链接。'));
  write(target, article('name: 另一张', '另一个包。'));
  write('历史/second/assets/source.md', '原文');
  write('历史/second/assets/source.json', JSON.stringify({ id: 'snapshot-42', sourceId: 'original-family', title: '记录' }));
  write('知识/first/assets/read-me-later.pdf', 'pdf');
  write('知识/first/assets/data.json', '{"series":[1]}');
  write('知识/first/assets/survey.md', '访谈稿');
  write('知识/first/assets/survey.json', '{"id":"survey-local","responses":[1,2]}');
  write('历史/second/assets/other.md', '普通 Markdown 附件');
  write('未纳入/unowned/assets/image.png', '不在卡片包中');
  const tree = loadRawTree(root);
  assert.deepEqual([...tree.assets].sort(), ['历史/second/assets/other.md', '知识/first/assets/data.json', '知识/first/assets/survey.json', '知识/first/assets/read-me-later.pdf'].sort());
  write(source, article('name: 卡', '![图](../../未纳入/unowned/assets/image.png)'));
  assert.throws(() => loadRawTree(root), /已归档 assets/);
  write(source, article('name: 卡\nsources: [../../未纳入/unowned/assets/image.png]', '正文'));
  assert.throws(() => loadRawTree(root), /已归档目录的 assets/);
});

test('repeated metadata headings update once and leave adjacent prose and nested sections in place', t => {
  const { root, write } = fixture(t);
  const raw = [
    '## 别名', '', '甲、乙', '', '这是要保留的普通段落。', '',
    '## 摘要', '', '已过时的摘要。', '', '## 核心理解', '', '新的摘要。', '',
    '## 别名', '', '- 乙', '- 丙', '', '### 历史背景', '', '这段文字含有 **格式** 和行内 `代码`。', '',
    '## 标签', '', '旧标签一', '', '## 标签', '', '旧标签二', '',
    '## 摘要', '', '新的摘要。', '', '## 我的理解', '', '结尾正文。',
  ].join('\n');
  write(source, article('name: 多节卡\naliases: [丁]\ntags: [新标签]\ndescription: 新的摘要。', raw));
  const tree = loadRawTree(root);
  const compiled = compileRawCard(tree, tree.byId.get('first'), urls).markdown;
  assert.deepEqual(documentTags(compiled), ['学科：知识', '新标签']);
  assert.equal(compiled.match(/^## 标签$/gm)?.length, 1);
  assert.equal(compiled.match(/^## 摘要$/gm)?.length, 1);
  assert.match(compiled, /## 别名\n\n丁\n\n这是要保留的普通段落。/);
  assert.match(compiled, /## 别名\n\n### 历史背景\n\n这段文字含有 \*\*格式\*\* 和行内 `代码`。/);
  assert.doesNotMatch(compiled, /甲、乙|- 丙|已过时的摘要|旧标签/);
  assert.ok(compiled.endsWith('## 我的理解\n\n结尾正文。'));
});

test('every card needs exactly one substantive core section; source records keep their own form', t => {
  const { root, write } = fixture(t);
  const put = body => write(source, '---\nname: 测试\n---\n\n' + body);
  for (const body of ['正文', '## 核心理解\n\n## 别名\n\n材料', '## 核心理解\n\n<!-- 模板说明 -->\n\n### 只有标题', '## 核心理解\n\n这是核心。\n\n## 核心理解\n\n第二段']) {
    put(body);
    assert.throws(() => loadRawTree(root), /核心理解/);
  }
  for (const body of ['![图](https://example.test/a.png)', '[例子](https://example.test)', '$$\nf(x)=x+1\n$$', '<img src="https://example.test/a.png">']) {
    put('## 核心理解\n\n' + body);
    assert.equal(loadRawTree(root).cards.length, 1);
  }
  write(source, article('kind: source\nname: 原始记录', '逐字存档，不含固定章节。'));
  assert.equal(loadRawTree(root).sourceFiles.size, 1);
});
