import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Documents } from '../../lib/documents.mjs';
import { deletedAttr, hash } from '../../lib/siyuan.mjs';
import { archiveReservations, observeFrozenArchives } from '../../scripts/frozen-archives.mjs';

test('archive evidence reconciles verified native receipts, disk documents, block index and every tombstone', async t=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'archive-native-')));
  const operations=join(root,'operations');
  mkdirSync(operations);
  const notebookId='20261101000000-noteboo', libraryRootId='20261101000001-library';
  const id='20261101000002-archive', child='20261101000003-reading', block='20261101000004-primary', childBlock='20261101000005-childbl';
  const libraryId='test-library', archiveOp='db-card-task1';
  const base=join(root,'workspace/data',notebookId,libraryRootId), prefix='/'+libraryRootId+'/'+id;
  mkdirSync(join(base,id),{recursive:true});
  const db=new DatabaseSync(':memory:');
  t.after(()=>{ db.close(); rmSync(root,{recursive:true,force:true}); });
  db.exec('CREATE TABLE blocks(id TEXT PRIMARY KEY,box,root_id,parent_id,path,type,content,updated,markdown);CREATE TABLE attributes(block_id,name,value)');
  const rows=db.prepare('INSERT INTO blocks(id,box,root_id,parent_id,path,type,content,updated) VALUES (?,?,?,?,?,?,?,?)');
  for (const [doc,para,path,body] of [[id,block,prefix+'.sy','private-main'],[child,childBlock,prefix+'/'+child+'.sy','private-reading']]) {
    rows.run(doc,notebookId,doc,null,path,'d',body,'20261101000002');
    rows.run(para,notebookId,doc,doc,path,'p',body,'20261101000002');
    writeFileSync(join(root,'workspace/data',notebookId,path),JSON.stringify({ID:doc,Type:'NodeDocument',Children:[
      {ID:para,Type:'NodeParagraph',Children:[{Type:'NodeText',Data:body}]},
    ]}));
  }
  const attribute=db.prepare('INSERT INTO attributes VALUES(?,?,?)');
  attribute.run(id,'custom-cd-legacy-id','old-test');
  attribute.run(child,'custom-cd-parent',id);
  attribute.run(child,'custom-cd-kind','article');
  const api={
    c:{notebookId,libraryRootId,dataDir:operations},
    identity:()=>libraryId,
    sql:q=>db.prepare(q).all(),
    attrs:ref=>Object.fromEntries(db.prepare('SELECT name,value FROM attributes WHERE block_id=?').all(ref).map(r=>[r.name,r.value])),
    inScope:ref=>db.prepare('SELECT * FROM blocks WHERE id=? AND box=?').get(ref,notebookId),
    api:(path,input)=>{ assert.equal(path,'/api/block/getChildBlocks');return db.prepare('SELECT id,type FROM blocks WHERE parent_id=?').all(input.id); },
    markdown:ref=>db.prepare('SELECT content FROM blocks WHERE id=?').get(ref).content,
    requireActivePath:()=>{},
    receipt:op=>({value:JSON.parse(readFileSync(join(operations,op+'.json'),'utf8'))}),
  };
  const docs=new Documents(api);
  const before=await docs.snapshot(id);
  attribute.run(id,deletedAttr,archiveOp);
  const after=await docs.snapshot(id,{includeDeleted:true});
  const receipt={target:libraryId,command:'delete-document',state:'verified',documentId:id,deletionMarker:archiveOp,
    result:{id,deleted:true,revision:after.revision},beforeDocument:before,afterRevision:after.revision};
  const receiptFile=join(operations,archiveOp+'.json');
  writeFileSync(receiptFile,JSON.stringify(receipt));
  const entry={rawId:'old-test',documentId:id,archiveOp,revision:after.revision,signature:after.signature,operationId:'task1'};
  const approval={version:1,libraryId,archives:[entry]};
  const observed=await observeFrozenArchives(api,approval);
  assert.equal(JSON.stringify(observed).includes('private-'),false);
  assert.deepEqual(archiveReservations(approval,observed),[
    [id,id,'',''],[child,child,'',id],[block,id,block,''],[childBlock,child,childBlock,id],['old-test',id,'',''],
  ]);
  await assert.rejects(observeFrozenArchives(api,{...approval,libraryId:'wrong'}), /同库/);
  await assert.rejects(observeFrozenArchives(api,{...approval,archives:[{...entry,signature:hash('wrong')}]}), /原生签名/);
  attribute.run(child,deletedAttr,'hidden-unapproved');
  await assert.rejects(observeFrozenArchives(api,approval),/归档标记/);
  db.prepare('DELETE FROM attributes WHERE block_id=? AND name=?').run(child,deletedAttr);
  db.prepare('DELETE FROM blocks WHERE id=?').run(childBlock);
  await assert.rejects(observeFrozenArchives(api,approval),/块索引和文件/);
  rows.run(childBlock,notebookId,child,child,prefix+'/'+child+'.sy','p','private-reading','20261101000002');
  writeFileSync(receiptFile,JSON.stringify({...receipt,state:'unknown'}));
  await assert.rejects(observeFrozenArchives(api,approval),/归档回执/);
});
