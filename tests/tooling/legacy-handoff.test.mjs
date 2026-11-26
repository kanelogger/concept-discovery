import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { documentRevision } from '../../lib/documents.mjs';
import { canonical, hash } from '../../lib/read-contract.mjs';
import { openCardLifecycleTasks } from '../../scripts/card-lifecycle-tasks.mjs';
import { openCardExportQueue } from '../../scripts/card-export-queue.mjs';
import { inspectLegacyHandoff } from '../../scripts/inspect-legacy-handoff.mjs';

const libraryId='synthetic-library';
const archiveIds=['20260101101010-aaaaaaa','20260101101010-bbbbbbb'];
const deleted='20260101101010-ccccccc';
const before={id:archiveIds[0],title:'Private fixture title',raw:'Private text',attrs:{},nodes:[]};
before.revision=documentRevision(before);
before.signature=hash(canonical({title:before.title,attrs:{},blocks:[]}));
const save=(path,data)=>writeFileSync(path,JSON.stringify(data));
function edit(db, sql, ...args) {
  const store=new DatabaseSync(db);
  try {store.prepare(sql).run(...args);}
  finally {store.close();}
}
function makeArchive({controlRoot,operationsRoot}, index) {
  const operationId='operation-'+index, documentId=archiveIds[index], rawId='private-'+index;
  const archiveOp=index ? 'previous-archive' : 'db-card-'+operationId;
  const revision=hash('archived-'+index);
  const expectedRevision=index ? revision : before.revision;
  const plan={action:'archive',library:libraryId,documentId,rawId,archiveOp:index ? archiveOp : null,
    revision:expectedRevision,signature:before.signature};
  const progress={stage:'database-readback',revision,documentId};
  const queue=openCardExportQueue(join(controlRoot,'card-exports.sqlite'));
  try {
    queue.prepare({id:operationId,library:libraryId,action:'archive',documentId,rawId,expectedRevision,requestHash:hash(plan)});
    queue.acknowledge(operationId,{documentId,revision});
  } finally {queue.close();}
  edit(join(controlRoot,'database-tasks.sqlite'),'INSERT INTO lifecycle_tasks VALUES (?,?,?,?,?,?)',
    operationId,'owner','complete',1,JSON.stringify(plan),JSON.stringify(progress));
  const input={op_id:archiveOp,id:documentId,expected_revision:before.revision,expected_signature:before.signature};
  const command='delete-document';
  const receipt={input,command,target:libraryId,requestHash:hash(canonical({command,input,target:libraryId})),state:'verified',
    deletionMarker:archiveOp,documentId,beforeDocument:{...before,id:documentId},afterRevision:revision,
    result:{id:documentId,op_id:archiveOp,deleted:true,revision}};
  save(join(operationsRoot,archiveOp+'.json'),receipt);
  return {rawId,documentId};
}
function fixture(t) {
  const workspace=mkdtempSync(join(tmpdir(),'handoff-test-'));
  t.after(()=>rmSync(workspace,{recursive:true,force:true}));
  const controlRoot=join(workspace,'control'), operationsRoot=join(workspace,'operations');
  const cwd=join(workspace,'git'), bare=join(workspace,'authority.git');
  for (const path of [controlRoot,operationsRoot,cwd]) mkdirSync(path);
  const opts={cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']};
  const git=(...args)=>execFileSync('git',args,opts).trim();
  git('init','--bare',bare); git('init','-b','ledger');
  git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  const key=join(workspace,'key');
  execFileSync('ssh-keygen',['-q','-t','ed25519','-N','','-f',key],opts);
  const allowedSignersFile=join(workspace,'trusted');writeFileSync(allowedSignersFile,'owner '+readFileSync(key+'.pub','utf8'));
  git('config','gpg.format','ssh');git('config','user.signingkey',key);git('remote','add','drill',bare);
  git('commit','--allow-empty','-S','-m','anchor');const anchor=git('rev-parse','HEAD');
  const plan={action:'purge',library:libraryId,rawId:'legacy-deleted',evidence:{id:deleted},
    deletion:{native:{id:deleted,documents:[{id:deleted}]}}};
  const decision={version:1,library:libraryId,rawId:plan.rawId,opId:'purge-one',mainCommit:anchor,
    documents:[deleted],previewDigest:hash(canonical(plan))};
  mkdirSync(join(cwd,'decisions'));
  for(const d of [decision,{...decision,opId:'reversed',outcome:'cancelled'}]) {
    save(join(cwd,'decisions',d.opId+'.json'),d);
    git('add','decisions');git('commit','-S','-m','record');
  }
  git('push','drill','ledger');
  const head=git('rev-parse','HEAD');
  writeFileSync(join(controlRoot,'database-first.active'),libraryId+'\n');
  openCardLifecycleTasks(join(controlRoot,'tasks.sqlite')).close();
  openCardLifecycleTasks(join(controlRoot,'database-tasks.sqlite'),{databaseFirst:true}).close();
  edit(join(controlRoot,'tasks.sqlite'),'INSERT INTO lifecycle_tasks VALUES (?,?,?,?,?,?)','purge-one','owner','complete',0,
    JSON.stringify(plan),JSON.stringify({stage:'readback',commit:anchor}));
  const journal=new DatabaseSync(join(controlRoot,'ledger.sqlite'));
  journal.exec('CREATE TABLE deletion_ledger_head(ref TEXT, sha TEXT); CREATE TABLE deletion_ledger_pending(op_id TEXT); CREATE TABLE lifecycle_git_readback(request_id TEXT)');
  journal.prepare('INSERT INTO deletion_ledger_head VALUES (?,?)').run('refs/heads/ledger',head);
  journal.close();
  const config={controlRoot,operationsRoot,libraryId,output:join(workspace,'output'),
    ledgerConfig:{cwd,remote:'drill',authority:{localBare:bare},allowedSignersFile,branch:'ledger',anchor,minimumHead:head,libraryId}};
  config.archives=archiveIds.map((_,i)=>makeArchive(config,i));
  return config;
}
const json=file=>JSON.parse(readFileSync(file));
test('one-time handoff preserves both pending rows and their native IDs, and verifies signed legacy deletes separately',t=>{
  const config=fixture(t);
  const queue=join(config.controlRoot,'card-exports.sqlite');
  // Exercise a consistent WAL image, including a frame not yet checkpointed.
  const db=new DatabaseSync(queue);
  t.after(()=>db.close());
  db.exec("PRAGMA journal_mode=WAL; UPDATE card_export_intents SET dueAt=1000");
  const files=root=>Object.fromEntries(readdirSync(root).map(name=>[name,hash(readFileSync(join(root,name)))]));
  const control=files(config.controlRoot), operations=files(config.operationsRoot);
  const result=inspectLegacyHandoff(config);
  assert.equal(result.oldExportState,'pending');
  assert.equal(result.cancelledCount,1);
  assert.deepEqual(json(join(config.output,'ledger-readback.json')).deletions.deletedIds,[deleted]);
  const archives=json(join(config.output,'archive-handoff.json')).archives;
  assert.deepEqual(archives.map(row=>row.documentId),archiveIds);
  assert.deepEqual(archives.map(row=>row.archiveOp),['db-card-operation-0','previous-archive']);
  assert.equal(archives.every(row=>row.signature===before.signature),true);
  assert.equal(hash(readFileSync(join(config.output,'ledger-evidence.json'))),result.evidenceSha256);
  assert.deepEqual(files(config.controlRoot),control);
  assert.deepEqual(files(config.operationsRoot),operations);
  for (const name of readdirSync(config.output)) {
    assert.equal(statSync(join(config.output,name)).mode & 0o077,0);
    assert.doesNotMatch(readFileSync(join(config.output,name),'utf8'),/Private fixture title|Private text/);
  }
  assert.throws(()=>inspectLegacyHandoff(config),/全新输出目录/);
});

test('extra queue rows, swapped native IDs, absent receipts and unproved revisions block the handoff before any output',t=>{
  const config=fixture(t);
  const queue=join(config.controlRoot,'card-exports.sqlite'), tasks=join(config.controlRoot,'database-tasks.sqlite');
  const rejects=pattern=>{
    assert.throws(()=>inspectLegacyHandoff(config),pattern);
    assert.equal(existsSync(config.output),false);
  };
  const first=config.archives[0];
  config.archives[0]={...first,documentId:config.archives[1].documentId};
  rejects(/两条不同/);
  config.archives[0]=first;
  config.archives.reverse();
  edit(queue,"INSERT INTO card_export_intents (id,library,rawId,action,state,dueAt) VALUES ('extra',?,'other','edit','pending',0)",libraryId);
  rejects(/归档集合/);
  edit(queue,"DELETE FROM card_export_intents WHERE id='extra'");
  edit(tasks,"UPDATE lifecycle_tasks SET state='running' WHERE id='operation-0'");
  rejects(/未结算维护任务/);
  edit(tasks,"UPDATE lifecycle_tasks SET state='complete' WHERE id='operation-0'");
  edit(queue,"UPDATE card_export_intents SET action='restore' WHERE id='operation-0'");
  rejects(/归档身份或状态/);
  edit(queue,"UPDATE card_export_intents SET action='archive' WHERE id='operation-0'");
  const name=join(config.operationsRoot,'db-card-operation-0.json'), receipt=json(name);
  rmSync(name);
  rejects(/普通文件/);
  save(name,{...receipt,afterRevision:'1'.repeat(64)});
  rejects(/原生归档回执/);
  save(name,{...receipt,beforeDocument:{...receipt.beforeDocument,nodes:[{id:'other',raw:'old',attrs:{},type:'p'}]}});
  rejects(/原生归档回执/);
  save(name,receipt);
  edit(tasks,"UPDATE lifecycle_tasks SET progress=json_set(progress,'$.revision',?) WHERE id='operation-0'",'5'.repeat(64));
  rejects(/写后读回/);
});

test('signed ledger and frozen control evidence must agree in both directions',t=>{
  const config=fixture(t),journal=join(config.controlRoot,'ledger.sqlite'),legacy=join(config.controlRoot,'tasks.sqlite');
  edit(journal,"INSERT INTO deletion_ledger_pending VALUES ('unsent')");
  assert.throws(()=>inspectLegacyHandoff(config),/待验签/);
  edit(journal,'DELETE FROM deletion_ledger_pending');
  edit(journal,'UPDATE deletion_ledger_head SET sha=?',config.ledgerConfig.anchor);
  assert.throws(()=>inspectLegacyHandoff(config),/权威签名头/);
  edit(journal,'UPDATE deletion_ledger_head SET sha=?',config.ledgerConfig.minimumHead);
  edit(legacy,"UPDATE lifecycle_tasks SET plan=json_set(plan,'$.rawId','unproven') WHERE id='purge-one'");
  assert.throws(()=>inspectLegacyHandoff(config),/永久决定与冻结/);
  assert.equal(existsSync(config.output),false);
});
