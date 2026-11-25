import assert from 'node:assert/strict';
import { existsSync,mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openCardExportQueue } from '../../scripts/card-export-queue.mjs';

const initialTime = Date.parse('2026-11-25T01:00:00+08:00');
const boundary = Date.parse('2026-11-25T04:00:00+08:00');
const parent = '1'.repeat(40);
const candidate = '2'.repeat(40);
const rev = 'a'.repeat(64);
const synthetic = '20261125010000-synth01';
const library = 'test-library';
const make = (id,rawId,action='edit') => ({id,rawId,action,library,expectedRevision:rev});
const acknowledge = (queue,id,revision=rev) => queue.acknowledge(id,{documentId:synthetic,revision});

test('待永久删除立即成为持久待处理项，跨过四小时后才能认领，清理读回前不能完成',t=>{
  const dir=mkdtempSync(join(tmpdir(),'cd-db-first-export-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let time=initialTime;
  const file=join(dir,'queue.sqlite');
  let queue=openCardExportQueue(file,{now:()=>time});
  const input=make('purge-1','synthetic-deleted','purge');
  assert.equal(queue.prepare(input).dueAt,boundary);
  assert.equal(queue.pendingPurge(library,input.rawId).state,'prepared');
  queue.close();
  queue=openCardExportQueue(file,{now:()=>time});
  try {
    assert.equal(queue.pendingPurge(library,input.rawId).id,input.id);
    assert.equal(queue.prepare(input).dueAt,boundary);
    assert.throws(()=>queue.prepare(make('restoring',input.rawId,'restore')),{code:'operation_conflict'});
    assert.throws(()=>queue.prepare({...input,rawId:'other'}),{code:'operation_conflict'});
    assert.equal(acknowledge(queue,input.id).state,'pending');
    time=boundary-1;
    assert.equal(queue.claimDue(library,parent),null);
    time=boundary;
    const batch=queue.claimDue(library,parent);
    assert.deepEqual(batch.changes.map(change=>change.id),[input.id]);
    queue.recordCandidate(batch.id,candidate);
    assert.throws(()=>queue.complete(batch.id,parent),{code:'operation_conflict'});
    assert.throws(()=>queue.complete(batch.id,candidate),{code:'operation_pending'});
    queue.recordPurgeCleanup(input.id,candidate);
    assert.equal(queue.complete(batch.id,candidate).state,'complete');
    assert.equal(queue.pendingPurge(library,input.rawId),null);
  } finally {queue.close();}
});

test('未核实写入和后续修订阻止同卡被提前导出，旧批次完成后仍保留新修订',()=>{
  let time=initialTime;
  const queue=openCardExportQueue(':memory:',{now:()=>time});
  try {
    queue.prepare(make('edit-v1','synthetic-edited'));
    acknowledge(queue,'edit-v1');
    queue.prepare(make('edit-uncertain','synthetic-edited'));
    queue.reportWriteError('edit-uncertain','native_outcome_unknown');
    assert.deepEqual(queue.summary(library).issues,[{rawId:'synthetic-edited',code:'native_outcome_unknown'}]);
    time=boundary;
    assert.equal(queue.claimDue(library,parent),null);
    acknowledge(queue,'edit-uncertain','b'.repeat(64));
    assert.deepEqual(queue.summary(library).issues,[]);
    const frozen=queue.claimDue(library,parent);
    assert.deepEqual(frozen.changes.map(item=>item.id),['edit-v1','edit-uncertain']);
    queue.prepare(make('edit-v2','synthetic-edited'));
    acknowledge(queue,'edit-v2','c'.repeat(64));
    assert.equal(queue.claimDue(library,parent).id,frozen.id);
    queue.recordCandidate(frozen.id,candidate);
    queue.complete(frozen.id,candidate);
    assert.equal(queue.get('edit-v2').state,'pending');
    assert.equal(queue.claimDue(library,candidate),null);
    time+=4*60*60*1000;
    assert.deepEqual(queue.claimDue(library,candidate).changes.map(item=>item.id),['edit-v2']);
  } finally {queue.close();}
});

test('卡片级冲突独立显示，健康卡结算不清除其他卡的异常',()=>{
  let time=initialTime;
  const queue=openCardExportQueue(':memory:',{now:()=>time});
  try {
    for (const [id,rawId] of [['edit-conflict','synthetic-conflict'],['edit-clean','synthetic-clean']]) {
      queue.prepare(make(id,rawId));
      acknowledge(queue,id);
    }
    time=boundary;
    const batch=queue.claimDue(library,parent);
    const amended=queue.deferCard(batch.id,'synthetic-conflict','git_content_conflict');
    assert.deepEqual(amended.changes.map(change=>change.rawId),['synthetic-clean']);
    queue.recordCandidate(batch.id,candidate);
    queue.block(batch.id,'git_unavailable');
    assert.equal(queue.claimDue(library,parent).id,batch.id);
    assert.equal(queue.summary(library).issue.code,'git_unavailable');
    assert.equal(queue.resume(batch.id).candidate,candidate);
    queue.complete(batch.id,candidate);
    assert.deepEqual(queue.summary(library),{lastSuccessAt:boundary,nextBatchAt:boundary+14400000,
      pendingCount:1,issues:[{rawId:'synthetic-conflict',code:'git_content_conflict',retryable:true}]});
  } finally {queue.close();}
});

test('未证实的恢复不能被待删越过，只有证明没有写入才能取消',()=>{
  const queue=openCardExportQueue(':memory:',{now:()=>initialTime});
  try {
    const restore=make('old-restore','synthetic-target','restore');
    queue.prepare(restore);
    queue.reportWriteError(restore.id,'native_outcome_unknown');
    assert.throws(()=>queue.prepare(make('new-purge','synthetic-target','purge')),{code:'operation_pending'});
    assert.throws(()=>queue.abandonUnwritten(restore.id,{operationId:'db-card-old-restore',state:'pending'}),{code:'operation_conflict'});
    queue.abandonUnwritten(restore.id,{operationId:'db-card-old-restore',state:'sealed-unwritten'});
    queue.prepare(make('new-purge','synthetic-target','purge'));
    assert.throws(()=>queue.prepare(restore),{code:'operation_conflict'});
    assert.throws(()=>queue.abandonUnwritten('new-purge',{operationId:'db-card-new-purge',state:'sealed-unwritten'}),{code:'operation_conflict'});
  } finally {queue.close();}
});

test('发送已登记且结果未知时，不能为同卡确认删除或提前放弃候选',()=>{
  let time=initialTime;
  const queue=openCardExportQueue(':memory:',{now:()=>time});
  try {
    queue.prepare(make('edit-sending','synthetic-target'));
    acknowledge(queue,'edit-sending');
    time=boundary;
    const batch=queue.claimDue(library,parent);
    queue.recordCandidate(batch.id,candidate);
    queue.beginSend(batch.id,candidate);
    assert.throws(()=>queue.prepare(make('purge-while-sending','synthetic-target','purge')),{code:'previous_export_conflict'});
    assert.throws(()=>queue.supersede(batch.id,{state:'prepared',head:parent,commit:candidate}),{code:'operation_conflict'});
    const remoteAdvanced='3'.repeat(40);
    assert.equal(queue.supersede(batch.id,{state:'conflict',head:remoteAdvanced,commit:candidate}).state,'superseded');
    assert.equal(queue.prepare(make('purge-after-fast-forward','synthetic-target','purge')).state,'prepared');
  } finally {queue.close();}
});

test('私有库清除中间行标题及冻结附件路径的主库、空闲区和 WAL 字节',t=>{
  const root=mkdtempSync(join(tmpdir(),'cd-manual-title-erasure-')),file=join(root,'queue.sqlite');
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const legacy=new DatabaseSync(file);
  legacy.exec(`PRAGMA journal_mode=WAL;
    PRAGMA secure_delete=OFF;
    CREATE TABLE card_manual_originals (
      id TEXT PRIMARY KEY,title TEXT,evidence TEXT,verifiedHead TEXT,reason TEXT,observedRemoval INTEGER NOT NULL DEFAULT 0
    ) STRICT`);
  const insert=legacy.prepare('INSERT INTO card_manual_originals(id,title) VALUES (?,?)');
  const old='UNIQUE-SEED-IN-FREE-PAGE-75403',target='UNIQUE-LIVE-MIDDLE-ROW-58026';
  for (const [id,title] of [['keep-left','retain-left'],['legacy',old],['deleting',target],['keep-right','retain-right']])
    insert.run(id,title);
  legacy.prepare("DELETE FROM card_manual_originals WHERE id='legacy'").run();
  legacy.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  legacy.close();
  assert.ok(readFileSync(file).includes(old));
  let queue=openCardExportQueue(file);
  const contains=marker=>[file,file+'-wal',file+'-journal'].some(path=>existsSync(path) && readFileSync(path).includes(marker));
  assert.equal(contains(old),false);
  assert.ok(contains(target));
  queue.prepare(make('deleting','middle-card','purge'));
  acknowledge(queue,'deleting');
  const attachment='UNIQUE-EVIDENCE-ATTACHMENT-29918';
  queue.freezeManual('deleting',{paths:['raw/middle-card/assets/'+attachment+'.png']});
  assert.ok(contains(attachment));
  queue.reportManual('deleting',candidate);
  const reader=new DatabaseSync(file);
  try {
    reader.exec('BEGIN');
    assert.equal(reader.prepare("SELECT title FROM card_manual_originals WHERE id='deleting'").get().title,target);
    assert.throws(()=>queue.completeManual('deleting',candidate,[]),{code:'operation_pending'});
    assert.equal(queue.get('deleting').state,'pending');
    reader.exec('COMMIT');
    assert.throws(()=>queue.completeManual('deleting',candidate,[]),{code:'operation_pending'});
    assert.equal(queue.get('deleting').state,'pending');
    assert.ok(contains(attachment));
    reader.close();
    queue.completeManual('deleting',candidate,[]);
    assert.equal(contains(target),false);
    assert.equal(contains(attachment),false);
    assert.equal(queue.get('deleting').state,'complete');
    reader.open();
    assert.equal(reader.prepare('PRAGMA journal_mode').get().journal_mode,'wal');
    assert.deepEqual(reader.prepare('SELECT title FROM card_manual_originals ORDER BY id').all().map(row=>row.title),
      ['retain-left','retain-right']);
  } finally { if (reader.isOpen) reader.close();queue.close(); }
  // Simulate a process stopping between the rollback-journal commit and restoring WAL mode.
  const interrupted=new DatabaseSync(file);
  interrupted.exec("INSERT INTO card_export_migrations VALUES ('restore-wal-after-manual-cleanup'); PRAGMA journal_mode=DELETE");
  interrupted.close();
  queue=openCardExportQueue(file);
  queue.close();
  const recovered=new DatabaseSync(file);
  assert.equal(recovered.prepare('PRAGMA journal_mode').get().journal_mode,'wal');
  recovered.close();
  assert.equal(contains(target),false);
  assert.equal(contains(attachment),false);
});
