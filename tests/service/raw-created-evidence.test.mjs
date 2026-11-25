import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Documents } from '../../lib/documents.mjs';
import { rawWrite } from '../../lib/raw-write.mjs';
import { Siyuan } from '../../lib/siyuan.mjs';

const id = '20261124000000-a123456';
const input = {identity:'synthetic-library',id,op_id:'synthetic-recovery',rawId:'example-card'};

test('恢复创建回执必须证明文档仍是原操作所写的版本', async t=>{
  let snapshot = {id,revision:'verified-revision',signature:'native-signature',attrs:{'custom-cd-request':'proof'}};
  t.mock.method(Documents.prototype,'snapshot',async()=>snapshot);
  const receipt = {target:input.identity,command:'raw-create-document',documentId:id,requestHash:'proof',
    input:{id,kind:'card',legacyId:input.rawId},state:'verified',result:{id,revision:'verified-revision'},
    createdSignature:'native-signature'};
  const api = {identity:async()=>input.identity,receipt:async()=>({value:receipt})};
  const select = () => rawWrite(api,'raw-created-card-evidence',input);
  assert.deepEqual(await select(),{state:'applied',id,revision:'verified-revision',signature:'native-signature'});
  snapshot = {...snapshot,signature:'independent-block-change'};
  await assert.rejects(select(),{code:'content_conflict'});
  receipt.state = 'unknown';
  await assert.rejects(select(),{code:'operation_pending'});
  receipt.target = 'another-library';
  await assert.rejects(select(),{code:'content_conflict'});
});

test('没有创建回执时须核对文档标识没有被独立占用', async ()=>{
  let exists = false;
  const api = {c:{notebookId:'synthetic-notebook'},identity:async()=>input.identity,
    receipt:async()=>({value:undefined}),sql:async()=>exists?[{id}]:[]};
  const select = () => rawWrite(api,'raw-created-card-evidence',input);
  assert.deepEqual(await select(),{state:'unstarted'});
  exists = true;
  await assert.rejects(select(),{code:'content_conflict'});
});

test('只采用原创建批次已核实的补读顺序写后签名', async t=>{
  const request = {...input,orderOp:'synthetic-order'};
  t.mock.method(Documents.prototype,'snapshot',async()=>({
    id,revision:'ordered-revision',signature:'ordered-signature',attrs:{'custom-cd-request':'proof'},
  }));
  const create = {target:input.identity,command:'raw-create-document',documentId:id,requestHash:'proof',
    input:{id,kind:'card',legacyId:input.rawId},state:'verified',createdSignature:'created-signature',
    result:{id,revision:'original-revision'}};
  const order = {target:input.identity,command:'raw-order-readings',state:'verified',
    input:{id,expected_operation:input.op_id},beforeRevision:'original-revision',afterOrderSignature:'ordered-signature',
    result:{id,revision:'ordered-revision'}};
  const api = {identity:async()=>input.identity,receipt:async op=>({value:op===request.orderOp?order:create})};
  const select = () => rawWrite(api,'raw-created-card-evidence',request);
  assert.equal((await select()).signature,'ordered-signature');
  order.input.expected_operation='another-operation';
  await assert.rejects(select(),{code:'content_conflict'});
});

test('原生回执在同一把锁下封住未写操作，迟到恢复无法执行',async t=>{
  const dataDir=mkdtempSync(join(tmpdir(),'cd-sealed-unwritten-'));
  t.after(()=>rmSync(dataDir,{recursive:true,force:true}));
  const api=new Siyuan({url:'http://127.0.0.1:6806',token:'synthetic-token',dataDir});
  api.identity=async()=>input.identity;
  const op_id='db-card-01234567-89ab-4def-8101-0123456789ab';
  const pending={identity:input.identity,op_id};
  const sealed=await rawWrite(api,'raw-seal-unstarted',pending);
  assert.deepEqual(sealed,{operationId:op_id,state:'sealed-unwritten'});
  await assert.rejects(api.operate('recover-deleted-document',{op_id},()=>assert.fail('不能执行已封存的恢复')),
    {code:'operation_conflict'});
  assert.deepEqual(await rawWrite(api,'raw-seal-unstarted',pending),sealed);
});
