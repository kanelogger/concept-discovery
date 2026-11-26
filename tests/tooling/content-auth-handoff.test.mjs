import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { buildContent } from '../../scripts/build-content.mjs';
import { contentAuthCommand } from '../../scripts/content-auth-admin.mjs';
import { handoffContentAuth, openAuthIdentityVerifier } from '../../lib/content-auth-handoff.mjs';
import { initializeAuthStore, openAuthStore } from '../../server/auth-store.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const libraryId = 'synthetic-auth-handoff';
const credentials = {username:'合成站主', password:'synthetic-offline-handoff-password'};
const shared = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF/0AAAAASUVORK5CYII=','base64');
const exclusive = 'synthetic-private-text-of-permanently-deleted-card';

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(),'cd-auth-handoff-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const databasePath = join(root,'auth','auth.sqlite'), directory = join(root,'release'), controlDirectory = join(root,'control');
  const rawRoot = join(root,'raw'), folder = join(rawRoot,'示例','keep');
  mkdirSync(join(folder,'assets'),{recursive:true});
  mkdirSync(join(rawRoot,'示例','archived'));
  mkdirSync(controlDirectory);
  writeFileSync(join(folder,'assets','shared.png'),shared);
  writeFileSync(join(folder,'article.md'),'---\nname: 保留卡\n---\n\n## 核心理解\n\n![共享](assets/shared.png)\n');
  writeFileSync(join(rawRoot,'示例','archived','article.md'),'---\nname: 归档卡\nstatus: archived\n---\n\n## 核心理解\n\n归档内容。\n');
  function json(path,data) {
    const bytes = JSON.stringify(data);
    writeFileSync(path,bytes);
    return sha(bytes);
  }
  const metadataFile = join(root,'meta.json'), baselineFile = join(root,'baseline.json');
  json(metadataFile,{version:1,libraryId,cards:{keep:{id:'keep',updated:'20261126080000'},
    archived:{id:'archived',updated:'20261126080000',aliases:['old-archive-alias']}},
    readings:{},history:{sources:{},proposals:{},events:{}}});
  json(baselineFile,{version:1,libraryId,sources:[],proposals:[],events:[]});
  const manifest = buildContent({rawRoot,metadataFile,baselineFile,output:directory});
  const asset = join(directory,manifest.files.find(f=>f.path.startsWith('assets/')).path);
  await initializeAuthStore({databasePath},credentials);
  const store = openAuthStore({databasePath});
  const session = await store.login(credentials);
  const cover = {type:'image/png',bytes:shared};
  const keep = store.shares.createWithPreview('keep',0,{html:'<p>keep</p>'},{title:'keep',description:'',cover});
  const keepPreview = store.shares.previewFor(keep).id;
  const drop = store.shares.createWithPreview('drop',0,{html:exclusive},
    {title:'drop',description:'',cover:{...cover,bytes:Buffer.from(exclusive+'-cover')}});
  const revoked = store.shares.create('revoked',0,{html:'revoked'});
  store.shares.revoke('revoked',revoked);
  store.close();
  const opts = {databasePath,directory,libraryId,controlDirectory,offline:true,
    manifestSha256:sha(readFileSync(join(directory,'manifest.json'))),sourceSha256:sha(readFileSync(databasePath))};
  function control(generation,authIdentity,deletedIds=[],state='closed') {
    const approvedSha256 = json(join(controlDirectory,'approved.json'),{version:1,libraryId,generation,state,authIdentity});
    const deletionsSha256 = json(join(controlDirectory,'deletions.json'),{version:1,libraryId,deletedIds});
    const checkpointSha256 = json(join(controlDirectory,'checkpoint.json'),{version:1,libraryId,generation,approvedSha256,deletionsSha256});
    return {...opts,checkpointSha256};
  }
  return {root,opts,control,asset,session,keep,keepPreview,drop,revoked};
}

function verify(options,expected,deletedIds) {
  const verifier = openAuthIdentityVerifier(options.databasePath,options.libraryId);
  try { return verifier.verify(expected,deletedIds); }
  finally { verifier.close(); }
}

test('bind claims only the reviewed offline legacy file, never during startup, and preserves credentials on restarts',async t=>{
  const {opts,control,session,keep,revoked,root} = await fixture(t);
  assert.throws(()=>openAuthIdentityVerifier(opts.databasePath,libraryId),/尚未显式绑定/);
  const first = control(1,null);
  const mixedVolume = join(opts.controlDirectory,'wrong-auth.sqlite');
  copyFileSync(opts.databasePath,mixedVolume);
  assert.throws(()=>handoffContentAuth('bind',{...first,databasePath:mixedVolume}),/独立目录/);
  assert.throws(()=>handoffContentAuth('bind',{...first,offline:false}),/停止认证写入/);
  assert.throws(()=>handoffContentAuth('bind',{...first,manifestSha256:'1'.repeat(64)}),/清单摘要/);
  assert.throws(()=>handoffContentAuth('bind',{...first,sourceSha256:'1'.repeat(64)}),/来源摘要/);
  assert.throws(()=>handoffContentAuth('bind',{...first,libraryId:'other'}),/库身份/);
  assert.equal(sha(readFileSync(opts.databasePath)),first.sourceSha256);
  const args = ['bind','--database',opts.databasePath,'--library-id',libraryId,'--release',opts.directory,
    '--manifest-sha256',opts.manifestSha256,'--control',opts.controlDirectory,'--checkpoint-sha256',first.checkpointSha256,
    '--source-sha256',opts.sourceSha256,'--offline'];
  const {authIdentity} = JSON.parse(contentAuthCommand(args));
  assert.deepEqual(JSON.parse(contentAuthCommand(args)).authIdentity,authIdentity);
  assert.equal(verify(opts,authIdentity,[]),true);
  assert.throws(()=>verify(opts,{...authIdentity,volumeId:randomUUID()},[]),/认证卷或恢复代次不符/);
  assert.throws(()=>openAuthIdentityVerifier(opts.databasePath,'other-library'),/库身份/);
  const reopened = openAuthStore(opts);
  assert.equal(reopened.session(session.token).publicId,session.publicId);
  assert.equal(reopened.shares.cardFor(keep),'keep');
  assert.equal(reopened.shares.cardFor(revoked),undefined);
  reopened.close();

  const verifier = openAuthIdentityVerifier(opts.databasePath,libraryId);
  try {
    assert.equal(verifier.verify(authIdentity,[]),true);
    const writer = openAuthStore(opts);
    try {
      writer.shares.suspendForDeletion('queued');
      assert.throws(()=>verifier.verify(authIdentity,[]),/待删/);
      writer.shares.releasePendingDeletion('queued');
      assert.equal(verifier.verify(authIdentity,[]),true);
    } finally { writer.close(); }
    const moved = join(root,'previous.sqlite');
    renameSync(opts.databasePath,moved);
    copyFileSync(moved,opts.databasePath);
    assert.throws(()=>verifier.verify(authIdentity,[]),/文件已更换/);
  } finally { verifier.close(); }
  linkSync(opts.databasePath,join(root,'hardlink.sqlite'));
  assert.throws(()=>openAuthIdentityVerifier(opts.databasePath,libraryId),/独立/);
});

test('closed reconciliation purges only confirmed stable IDs and keeps shared assets, sessions and other links', async t=>{
  const {opts,control,asset,session,keep,keepPreview,drop} = await fixture(t);
  const first = handoffContentAuth('bind',control(1,null));
  assert.throws(()=>handoffContentAuth('reconcile',control(2,first,['keep'])),/仍可/);
  assert.throws(()=>handoffContentAuth('reconcile',control(2,first,['old-archive-alias'])),/主卡稳定公开/);
  assert.throws(()=>handoffContentAuth('reconcile',control(2,first,['drop'],'open')),/状态或代次/);
  const closed = control(3,first,['drop']);
  assert.throws(()=>verify(opts,first,['drop']),/清理尚未/);
  const before = openAuthStore(opts);
  before.shares.suspendForDeletion('undecided');
  assert.throws(()=>verify(opts,first,[]),/待删/);
  before.close();
  assert.throws(()=>handoffContentAuth('reconcile',closed),/待删/);
  const decided = openAuthStore(opts);
  assert.equal(decided.shares.cardFor(drop),'drop');
  decided.shares.releasePendingDeletion('undecided');
  decided.close();
  const db = new DatabaseSync(opts.databasePath);
  db.exec('PRAGMA journal_mode=WAL');
  db.close();
  assert.deepEqual(handoffContentAuth('reconcile',closed),first);
  assert.deepEqual(handoffContentAuth('reconcile',closed),first);
  assert.equal(verify(opts,first,['drop']),true);
  assert.throws(()=>verify(opts,first,[]),/漏列/);
  const after = openAuthStore(opts);
  assert.equal(after.shares.purged('drop'),true);
  assert.equal(after.shares.contentFor(drop),undefined);
  assert.equal(after.shares.cardFor(keep),'keep');
  assert.deepEqual(Buffer.from(after.shares.coverById(keepPreview).cover),shared);
  assert.equal(after.session(session.token).publicId,session.publicId);
  after.close();
  assert.deepEqual(readFileSync(asset),shared);
  for (const suffix of ['', '-wal']) if (existsSync(opts.databasePath+suffix))
    assert.equal(readFileSync(opts.databasePath+suffix).includes(Buffer.from(exclusive)),false);
});

test('cold restore refuses foreign and unbound backups, rotates the same volume, and resumes a partial purge',async t=>{
  const {opts,root,control,keep,session} = await fixture(t);
  mkdirSync(join(root,'cold'));
  const preBind = join(root,'cold','unbound.sqlite');
  copyFileSync(opts.databasePath,preBind);
  const old = handoffContentAuth('bind',control(1,null));
  const backup = join(root,'cold','cold.sqlite');
  copyFileSync(opts.databasePath,backup);
  const wrong = {...old,volumeId:randomUUID()};
  assert.throws(()=>handoffContentAuth('restore',control(2,wrong)),/卷身份不符/);
  const recovery = control(3,old,['drop']);
  assert.throws(()=>handoffContentAuth('restore',{...recovery,databasePath:preBind}),/必须已绑定/);
  const db = new DatabaseSync(opts.databasePath);
  db.exec("CREATE TRIGGER synthetic_interruption BEFORE INSERT ON card_share_deletions BEGIN SELECT RAISE(ABORT,'synthetic interruption'); END");
  db.close();
  assert.throws(()=>handoffContentAuth('restore',recovery),/synthetic interruption/);
  assert.throws(()=>openAuthIdentityVerifier(opts.databasePath,libraryId),/交接尚未完成/);
  const interrupted = openAuthStore(opts);
  assert.equal(interrupted.session(session.token),null);
  assert.equal(interrupted.shares.cardFor(keep),undefined);
  interrupted.close();
  const repaired = new DatabaseSync(opts.databasePath);
  repaired.exec('DROP TRIGGER synthetic_interruption');
  repaired.close();
  const current = handoffContentAuth('restore',recovery);
  assert.equal(current.volumeId,old.volumeId);
  assert.notEqual(current.generation,old.generation);
  assert.deepEqual(handoffContentAuth('restore',recovery),current);
  assert.equal(verify(opts,current,['drop']),true);
  assert.throws(()=>verify({...opts,databasePath:backup},current,['drop']),/代次不符/);

  const next = {...control(4,current,['drop']),databasePath:backup};
  assert.throws(()=>handoffContentAuth('reconcile',next),/当前核准/);
  const restored = handoffContentAuth('restore',next);
  assert.equal(restored.volumeId,current.volumeId);
  assert.notEqual(restored.generation,current.generation);
  const reopened = openAuthStore(next);
  assert.equal(reopened.session(session.token),null);
  assert.equal(reopened.shares.cardFor(keep),undefined);
  assert.ok((await reopened.login(credentials)).publicId);
  reopened.close();
  assert.equal(verify(next,restored,['drop']),true);
  chmodSync(backup,0o644);
  assert.throws(()=>verify(next,restored,['drop']),/私有/);
});
