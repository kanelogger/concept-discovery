import assert from 'node:assert/strict';
import test from 'node:test';
import { openCardExportQueue } from '../../scripts/card-export-queue.mjs';
import { applyDatabaseCardWrite } from '../../scripts/card-database-write.mjs';

const library='synthetic-library', rawId='synthetic-card', documentId='20261125010101-synth01';
const first='a'.repeat(64), second='b'.repeat(64), signature='c'.repeat(64);
const id='01234567-89ab-4def-8101-0123456789ab';
const fixedTime=Date.parse('2026-11-25T01:00:00+08:00');
const edit={id,library,rawId,documentId,action:'edit',revision:first,signature,title:'合成标题',markdown:'## 核心理解\n\n合成正文。'};

test('数据库先写入，同一操作在响应丢失后读回原生回执，未核实版本不能出站',async ()=>{
  const queue=openCardExportQueue(':memory:',{now:()=>fixedTime});
  const calls=[];
  let writes=0;
  const context={queue,resolveDocument:async()=>documentId,rpc:async(method,input)=>{
    calls.push(method);
    if (method==='raw-target') return library;
    if (method==='raw-active-card-evidence') return {id:documentId,revision:first,signature};
    assert.equal(method,'raw-document');
    assert.equal(input.op_id,'db-card-'+id);
    assert.equal(input.expected_signature,signature);
    if (writes===0) {
      writes++;
      throw Object.assign(new Error('应答丢失'),{code:'operation_pending'});
    }
    return {id:documentId,revision:second};
  }};
  try {
    await assert.rejects(applyDatabaseCardWrite(context,edit),{code:'operation_pending'});
    assert.equal(queue.get(id).state,'prepared');
    assert.deepEqual(queue.summary(library).issues,[{rawId,code:'operation_pending'}]);
    await assert.rejects(applyDatabaseCardWrite(context,{...edit,markdown:'不同内容'}),{code:'operation_conflict'});
    const confirmed=await applyDatabaseCardWrite(context,edit);
    assert.equal(writes,1);
    assert.equal(confirmed.state,'pending');
    assert.equal(confirmed.revision,second);
    assert.equal(calls.filter(method=>method==='raw-active-card-evidence').length,1);
    assert.deepEqual(queue.summary(library).issues,[]);
  } finally {queue.close();}
});

test('先记录待删并暂停分享，再用原生归档隐藏目标，此时没有永久删除或 Git 写入',async ()=>{
  const queue=openCardExportQueue(':memory:',{now:()=>fixedTime});
  let suspended=false;
  const context={queue,resolveDocument:async()=>documentId,
    shares:{suspendForDeletion(target){
      assert.equal(target,documentId);
      assert.equal(queue.pendingPurge(library,rawId).state,'prepared');
      suspended=true;
      return true;
    }},
    rpc:async (method,input)=>{
      if (method==='raw-target') return library;
      if (method==='raw-active-card-evidence') return {id:documentId,revision:first,signature};
      assert.equal(method,'raw-archive');
      assert.equal(input.expected_revision,first);
      assert.equal(suspended,true);
      return {id:documentId,revision:second,deleted:true};
    }};
  try {
    const intent=await applyDatabaseCardWrite(context,{id,library,rawId,documentId,action:'purge',revision:first,signature});
    assert.equal(intent.state,'pending');
    assert.equal(intent.dueAt,Date.parse('2026-11-25T04:00:00+08:00'));
    assert.equal(queue.claimDue(library,'1'.repeat(40)),null);
    await assert.rejects(applyDatabaseCardWrite(context,{...edit,id:'01234567-89ab-4def-8101-0123456789ac'}),{code:'operation_conflict'});
  } finally {queue.close();}
});
