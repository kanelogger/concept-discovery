import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from '../../lib/siyuan.mjs';
import { buildContent } from '../../scripts/build-content.mjs';
import { startContentShadow } from '../../scripts/start-content-shadow.mjs';
import { openContentReader } from '../../server/content-reader.mjs';

function sample(t) {
  const root=mkdtempSync(join(tmpdir(),'cd-shadow-reader-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const rawRoot=join(root,'raw'), folder=join(rawRoot,'测试','reader');
  mkdirSync(join(folder,'assets'),{recursive:true});
  const png=readFileSync(new URL('../../web/share-cover.png',import.meta.url));
  writeFileSync(join(folder,'assets','chart.png'),png);
  writeFileSync(join(folder,'article.md'),'---\nname: 阅读样本\n---\n\n## 核心理解\n\n![示意](assets/chart.png)\n');
  const libraryId='isolated-shadow', metadataFile=join(root,'metadata.json'), baselineFile=join(root,'history.json'), directory=join(root,'release');
  writeFileSync(metadataFile,JSON.stringify({version:1,libraryId,cards:{reader:{id:'reader',updated:'20261126080000'}},readings:{},
    history:{sources:{},proposals:{},events:{}}}));
  writeFileSync(baselineFile,JSON.stringify({version:1,libraryId,sources:[],proposals:[],events:[]}));
  buildContent({rawRoot,metadataFile,baselineFile,output:directory});
  const options={directory,libraryId,origin:'http://127.0.0.1',manifestSha256:hash(readFileSync(join(directory,'manifest.json')))};
  return {root,directory,png,options};
}

test('the shadow opens a verified release and never serves unlisted or changed asset bytes',async t=>{
  const {directory,png,options}=sample(t);
  const reader=openContentReader(options);
  t.after(()=>reader.close());
  const path='/assets/'+hash(png)+'.png';
  const view=reader.readView('graph');
  assert.equal(JSON.parse(view.body).data.nodes[0].id,'reader');
  assert.notEqual(view.etag,reader.readView('scenarios').etag);
  const response=await reader.readAsset(path);
  assert.equal(response.headers.get('etag'),'"'+hash(png)+'"');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
  writeFileSync(join(directory,'assets','unpublished.txt'),'unpublished');
  assert.equal((await reader.readAsset('/assets/unpublished.txt')).status,404);
  writeFileSync(join(directory,path.slice(1)),'changed after startup');
  await assert.rejects(reader.readAsset(path),{code:'content_unavailable'});
  assert.throws(()=>openContentReader(options),/文件与清单摘要/);
});

test('a different library, unsealed SQLite state or wrong manifest cannot start the candidate',async t=>{
  const {root,directory,options}=sample(t);
  assert.throws(()=>openContentReader({...options,manifestSha256:'wrong'}),/清单摘要/);
  assert.throws(()=>openContentReader({...options,libraryId:'wrong'}),/身份/);
  writeFileSync(join(directory,'knowledge.sqlite-wal'),'unsealed');
  assert.throws(()=>openContentReader(options),/未封存/);
  const file=join(root,'config.json');
  writeFileSync(file,JSON.stringify({backend:'content-shadow',publicUrl:'http://127.0.0.1',host:'0.0.0.0',port:0}));
  await assert.rejects(startContentShadow(file),/回环/);
  writeFileSync(file,JSON.stringify({backend:'content-shadow',publicUrl:'https://site.example',port:0}));
  await assert.rejects(startContentShadow(file),/回环/);
  writeFileSync(file,JSON.stringify({kernelConfig:'kernel.json'}));
  await assert.rejects(startContentShadow(file),/影子服务/);
});
