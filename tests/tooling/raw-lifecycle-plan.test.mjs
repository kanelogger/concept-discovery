import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRawTree } from '../../lib/raw-format.mjs';
import { planCardRawChange } from '../../scripts/raw-lifecycle-plan.mjs';

function fixture(t) {
  const rawRoot = mkdtempSync(join(tmpdir(), 'cd-raw-lifecycle-'));
  t.after(() => rmSync(rawRoot, { recursive:true, force:true }));
  const write = (path, data) => {
    const file = join(rawRoot, path);
    mkdirSync(dirname(file), { recursive:true });
    writeFileSync(file, data);
  };
  function apply(plan) {
    assert.deepEqual(plan.blockers, []);
    for (const [path, value] of plan.edits) {
      if (value === null) rmSync(join(rawRoot, path));
      else write(path, value);
    }
  }
  return { rawRoot, write, apply };
}

const a = '学科/a/article.md', b = '学科/b/article.md';
const shared = '学科/b/assets/share.png', exclusive = '学科/b/assets/only.png';
const card = (name, body) => `---\nname: ${name}\n---\n\n## 核心理解\n\n${body}\n`;

test('归档甲、删除乙并恢复甲，原稿和 Git 基线一起迁移仍被引用的图片', t => {
  const f = fixture(t);
  f.write(a, card('甲', '![共用](../b/assets/share.png)'));
  f.write(b, card('乙', '删除卡专用正文。'));
  f.write(shared, 'shared image bytes');
  f.write(exclusive, 'only B');
  f.write('学科/README.md', '# 导读\n\n1. [甲](<a/article.md>)\n2. [乙](<b/article.md>)\n');
  f.write('README.md', '学科导读共收录 2 张知识卡。\n\n| [学科](<学科/README.md>) | 2 |\n');
  const binding = {remotePath:'assets/shared-live.png',sha256:'synthetic-hash'};
  f.write('.sync.json', JSON.stringify({ version:1, identity:'synthetic', cards:{ b:{path:b} }, assets:{ [shared]:binding, [exclusive]:{} },
    relations:[{ id:'for-b', source_concept_id:'b' }, { id:'unrelated', source_concept_id:'c' }] }));
  f.apply(planCardRawChange({...f, rawId:'a', action:'archive', archivedAt:'2026-11-24T00:00:00Z'}));
  const purge = planCardRawChange({...f, rawId:'b', action:'purge'});
  const moved = purge.moves.get(shared);
  assert.match(moved, /^学科\/a\/assets\/shared-/);
  assert.equal(purge.edits.get(exclusive), null);
  f.apply(purge);
  f.apply(planCardRawChange({...f, rawId:'a', action:'restore'}));
  const tree = loadRawTree(f.rawRoot, {references:true});
  assert.deepEqual(tree.cards.map(card => card.id), ['a']);
  assert.equal(tree.cards[0].metadata.status, undefined);
  assert.deepEqual([...tree.inbound.get(moved)], [a]);
  assert.equal(tree.files.get(moved).toString(), 'shared image bytes');
  const next = JSON.parse(tree.files.get('.sync.json').toString());
  assert.deepEqual(next.assets, {[moved]:binding});
  assert.deepEqual(next.relations.map(relation => relation.id), ['unrelated']);
  assert.match(readFileSync(join(f.rawRoot, 'README.md'), 'utf8'), /共收录 1 张知识卡/);
});

test('归档原稿直接引用和归属不明材料阻止彻删；缺少原稿时仅清理已有元数据', t => {
  const f = fixture(t);
  f.write(a, card('甲', '[[b]]'));
  f.write(b, card('乙', '目标。'));
  f.write('学科/b/foreign.txt', 'unknown provenance');
  f.apply(planCardRawChange({...f, rawId:'a', action:'archive', archivedAt:'2026-11-24T00:00:00Z'}));
  const blocked = planCardRawChange({...f, rawId:'b', action:'purge'});
  assert.deepEqual(new Set(blocked.blockers.map(item => item.reason)), new Set(['incoming_reference','asset_ownership_unverified']));
  f.write('.sync.json', JSON.stringify({version:1,identity:'synthetic',cards:{b:{path:'原学科/b/article.md'}}}));
  const moved = planCardRawChange({...f,rawId:'b',action:'purge',sourcePath:b});
  assert.deepEqual(moved.blockers,[{reason:'original_path_unverified'}]);
  const legacy = '学科/old/article.md';
  f.write('.sync.json', JSON.stringify({ version:1, identity:'synthetic', cards:{ old:{ path:legacy } } }));
  const absent = planCardRawChange({...f, rawId:'old', action:'purge'});
  assert.equal(absent.rawMissing, true);
  assert.deepEqual([...absent.edits.keys()], ['.sync.json']);
  f.apply(absent);
  assert.deepEqual(planCardRawChange({...f, rawId:'old', action:'purge'}).edits, new Map());
});
