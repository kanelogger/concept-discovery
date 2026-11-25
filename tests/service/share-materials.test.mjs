import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, renameSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { getShareMaterial, readShareCover, shareMaterialReader } from '../../server/card-share-preview.mjs';
import { cardShareStore } from '../../server/card-share-store.mjs';

const root = new URL('../../server/share-materials/', import.meta.url);
const materials = JSON.parse(readFileSync(new URL('catalog.json', root), 'utf8'));

test('published presets have independent, square PNG covers', () => {
  const ids = Object.keys(materials);
  assert.ok(ids.length > 0);
  assert.deepEqual(readdirSync(new URL('covers/', root)).sort(), ids.map(id => id + '.png').sort());
  const covers = new Set();
  for (const [id, card] of Object.entries(materials)) {
    assert.equal(card.id, id);
    assert.ok(card.title && card.description && card.coverLine && card.discipline);
    const preset = getShareMaterial({ rawId: id, title: card.cardTitle });
    const { bytes } = readShareCover(preset.cover);
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [320, 320]);
    assert.ok(bytes.length < 512 * 1024, id);
    covers.add(createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(covers.size, ids.length);
});

test('a missing raw identity or renamed card gets the generic presentation', () => {
  const card = materials['confirmation-bias'];
  assert.ok(getShareMaterial({ rawId: card.id, title: card.cardTitle }).cover);
  const newer = { rawId: card.id, title: '当前不同的标题' };
  assert.deepEqual(getShareMaterial(newer), { title: newer.title, description: '' });
  assert.equal(getShareMaterial({ title: card.cardTitle }).cover, undefined);
});

test('a live material reader observes catalogue replacement and leaves another card untouched', t => {
  const directory = mkdtempSync(join(tmpdir(), 'cd-materials-'));
  t.after(() => rmSync(directory, {recursive:true, force:true}));
  const covers = join(directory, 'covers');
  mkdirSync(covers);
  const first = { id:'synthetic-one', cardTitle:'合成甲', title:'专属甲', description:'甲的摘要' };
  const second = { id:'synthetic-two', cardTitle:'合成乙', title:'专属乙', description:'乙的摘要' };
  const file = join(directory, 'catalog.json');
  const publish = value => {
    writeFileSync(`${file}.next`, JSON.stringify(value));
    renameSync(`${file}.next`, file);
  };
  writeFileSync(join(covers, `${first.id}.png`), Buffer.from('synthetic-a'));
  writeFileSync(join(covers, `${second.id}.png`), Buffer.from('synthetic-b'));
  publish({ [first.id]:first, [second.id]:second });
  const location = pathToFileURL(`${directory}/`);
  const read = shareMaterialReader(location);
  const firstInput = { rawId:first.id, title:first.cardTitle }, secondInput = { rawId:second.id, title:second.cardTitle };
  assert.equal(read(firstInput).description, first.description);
  assert.equal(readShareCover(read(firstInput).cover).bytes.toString(), 'synthetic-a');
  publish({ [second.id]:second });
  rmSync(join(covers, `${first.id}.png`));
  assert.equal(read(firstInput).description, '');
  assert.equal(shareMaterialReader(location)(firstInput).cover, undefined);
  assert.equal(read(secondInput).description, second.description);
  assert.equal(readShareCover(read(secondInput).cover).bytes.toString(), 'synthetic-b');
});

test('purging a share fences both late and fresh publication, including a row that never existed', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const shares = cardShareStore(db);
    const content = { body:'synthetic' }, preview = { title:'例', description:'摘要', cover:{type:'image/png', bytes:Buffer.from('example')} };
    const token = shares.createWithPreview('card-one', 0, content, preview);
    const unrelated = shares.createWithPreview('card-two', 0, content, preview);
    const previewId = shares.previewFor(token).id;
    shares.purge('card-one');
    shares.purge('never-published');
    const next = cardShareStore(db);
    assert.equal(next.contentFor(token), undefined);
    assert.equal(next.coverById(previewId), undefined);
    assert.equal(next.createWithPreview('card-one', 0, content, preview), undefined);
    assert.equal(next.createWithPreview('card-one', next.state('card-one').generation, content, preview), undefined);
    assert.equal(next.create('never-published', 0, content), undefined);
    assert.equal(next.savePreview('card-one', token, 1, preview), false);
    assert.equal(next.previewFor(unrelated).description, preview.description);
  } finally { db.close(); }
});

test('waiting for a deletion batch hides share data and prevents late first publication without clearing the copy',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    const shares=cardShareStore(db);
    const content={body:'合成正文'}, preview={title:'合成分享',description:'合成摘要',cover:{type:'image/png',bytes:Buffer.from('fake')}};
    const token=shares.createWithPreview('waiting',0,content,preview);
    const coverId=shares.previewFor(token).id;
    shares.suspendForDeletion('waiting');
    shares.suspendForDeletion('waiting');
    shares.suspendForDeletion('first-share-not-yet-published');
    shares.suspendForDeletion('first-share-not-yet-published');
    db.prepare('INSERT INTO card_share_pending_deletions VALUES (?)').run('legacy-pending-no-share-row');
    shares.suspendForDeletion('legacy-pending-no-share-row');
    assert.deepEqual(shares.state('waiting'),Object.assign(Object.create(null),{token:null,generation:1}));
    assert.equal(shares.state('first-share-not-yet-published').generation,1);
    assert.equal(shares.contentFor(token),undefined);
    assert.equal(shares.previewById(coverId),undefined);
    assert.equal(shares.coverById(coverId),undefined);
    assert.equal(shares.savePreview('waiting',token,1,preview),false);
    assert.equal(shares.createWithPreview('first-share-not-yet-published',0,content,preview),undefined);
    assert.equal(shares.revoke('waiting',token),false);
    assert.equal(shares.purged('waiting'),false);
    const afterRestart=cardShareStore(db);
    assert.equal(afterRestart.contentFor(token),undefined);
    assert.equal(afterRestart.state('first-share-not-yet-published').generation,1);
    assert.equal(afterRestart.state('legacy-pending-no-share-row').generation,1);
    assert.equal(db.prepare('SELECT content FROM card_shares WHERE card_id=?').get('waiting').content,JSON.stringify(content));
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM card_share_previews WHERE id=?').get(coverId).count,1);
    assert.equal(afterRestart.purge('waiting').unpublished,true);
    assert.equal(afterRestart.purged('waiting'),true);
    assert.equal(db.prepare('SELECT content FROM card_shares WHERE card_id=?').get('waiting').content,null);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM card_share_previews WHERE id=?').get(coverId).count,0);
  } finally {db.close();}
});

test('permanent cleanup removes legacy share bytes from an online database file',t=>{
  const directory=mkdtempSync(join(tmpdir(),'cd-share-legacy-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const file=join(directory,'auth.sqlite');
  const db=new DatabaseSync(file);
  try {
    const shares=cardShareStore(db);
    const body='LEGACY-SYNTHETIC-BODY-UNIQUE-'.repeat(450);
    const cover=Buffer.from('LEGACY-SYNTHETIC-COVER-UNIQUE-'.repeat(450));
    db.exec('PRAGMA secure_delete = OFF');
    shares.createWithPreview('waiting',0,{body},{title:'合成分享',description:'历史副本',
      cover:{type:'image/png',bytes:cover}});
    const retained=shares.create('retained',0,{body:'保留正文'});
    // Reproduce deletion by the old server before secure_delete was enabled.
    db.exec("UPDATE card_shares SET token=NULL,content=NULL,generation=generation+1 WHERE card_id='waiting'");
    assert.ok(readFileSync(file).includes(Buffer.from('LEGACY-SYNTHETIC-COVER-UNIQUE-')));
    const reopened=cardShareStore(db);
    assert.deepEqual(reopened.purge('waiting'),{checkpointed:true,unpublished:true});
    assert.ok(!readFileSync(file).includes(Buffer.from('LEGACY-SYNTHETIC-BODY-UNIQUE-')));
    assert.ok(!readFileSync(file).includes(Buffer.from('LEGACY-SYNTHETIC-COVER-UNIQUE-')));
    assert.match(reopened.contentFor(retained),/保留正文/);
  } finally {db.close();}
});
