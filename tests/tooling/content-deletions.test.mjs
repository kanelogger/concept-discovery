import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { hash } from '../../lib/read-contract.mjs';
import { buildContent } from '../../scripts/build-content.mjs';
import { contentDeletionsCommand } from '../../scripts/content-deletions.mjs';

test('owner-side deletions import the existing list and append only hidden primary IDs atomically', t => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'cd-owner-deletions-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  const libraryId = 'offline-deletions';
  const directory = join(root, 'release');
  const rawRoot = join(root, 'raw');
  for (const [id, state] of [['active', ''], ['hidden', 'status: archived\n'], ['second-hidden', 'status: archived\n']]) {
    const folder = join(rawRoot, '测试', id);
    mkdirSync(folder, {recursive:true});
    writeFileSync(join(folder, 'article.md'), '---\nname: '+id+'\n'+state+'---\n\n## 核心理解\n\n测试。\n');
  }
  const metadataFile = join(root, 'metadata.json'), baselineFile = join(root, 'history.json');
  const updated = '20261126080000';
  writeFileSync(metadataFile, JSON.stringify({version:1,libraryId,cards:{active:{id:'active',updated},
    hidden:{id:'hidden',updated,aliases:['old-hidden-alias']},'second-hidden':{id:'second-hidden',updated}},
    readings:{},history:{sources:{},proposals:{},events:{}}}));
  writeFileSync(baselineFile, JSON.stringify({version:1,libraryId,sources:[],proposals:[],events:[]}));
  buildContent({rawRoot, metadataFile, baselineFile, output:directory});
  const seed = join(root, 'seed.json');
  const seedBytes = JSON.stringify({version:1, libraryId, deletedIds:['older']});
  writeFileSync(seed, seedBytes);

  const cli = (action, ...args) => JSON.parse(contentDeletionsCommand([action, '--database', join(root, 'owner.sqlite'),
    '--library-id', libraryId, ...args]));
  const init = pin => cli('init', '--seed', seed, '--seed-sha256', pin);
  const manifest = hash(readFileSync(join(directory, 'manifest.json')));
  let current = hash(seedBytes+'\n');
  const add = (pin, ...ids) => cli('add', '--current-sha256', current, '--release', directory, '--manifest-sha256', pin, ...ids);
  const exported = () => cli('export', '--current-sha256', current);
  assert.throws(() => init('0'.repeat(64)), /摘要不符/);
  assert.deepEqual(init(hash(seedBytes)).deletedIds, ['older']);
  const stale = join(root, 'stale.sqlite');
  copyFileSync(join(root, 'owner.sqlite'), stale);
  assert.throws(() => init(hash(seedBytes)), /EEXIST/);
  assert.throws(() => add('0'.repeat(64), 'hidden'), /清单摘要不符/);
  assert.throws(() => add(manifest, 'hidden', 'active'), /不可读取的主卡/);
  assert.throws(() => add(manifest, 'old-hidden-alias'), /主卡/);
  assert.throws(() => add(manifest, 'missing'), /主卡/);
  assert.deepEqual(exported().deletedIds, ['older']);
  const expected = {version:1, libraryId, deletedIds:['hidden','older','second-hidden']};
  const planned = cli('plan', '--current-sha256', current, '--release', directory, '--manifest-sha256', manifest, 'second-hidden', 'hidden');
  assert.deepEqual(planned, expected);
  assert.deepEqual(exported().deletedIds, ['older']);
  // Discard the append result to simulate an interruption after COMMIT.
  add(manifest, 'hidden', 'second-hidden');
  assert.throws(() => exported(), /当前摘要不符/);
  assert.throws(() => add(manifest, 'hidden'), /当前摘要不符/);
  current = hash(JSON.stringify(planned)+'\n');
  assert.throws(() => contentDeletionsCommand(['export', '--database', stale, '--library-id', libraryId,
    '--current-sha256', current]), /当前摘要不符/);
  assert.deepEqual(add(manifest, 'hidden'), expected);
  assert.deepEqual(exported(), expected);
});
