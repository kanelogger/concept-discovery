import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { buildContent, historyInventory } from '../../scripts/build-content.mjs';
import { openContentStore } from '../../lib/content-store.mjs';
import { sourceSnapshotId } from '../../lib/wiki-store.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (path, value) => writeFileSync(path,JSON.stringify(value));
const oldId = '20261120123000-abcdef1';
const txt = '分类/a/assets/original.md';
function snapshot(markdown,version) {
  const source={sourceId:'src_0123456789abcdef',title:'出处',url:'',author:'',markdown,version,hash:sha(markdown),createdAt:'2026-11-20T00:00:00Z'};
  return {...source,id:sourceSnapshotId(source)};
}

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'cd-content-build-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const raw=join(root,'raw');
  mkdirSync(join(raw,'分类/a/assets'),{recursive:true});
  mkdirSync(join(raw,'分类/b'),{recursive:true});
  const rawText=(path,text)=>writeFileSync(join(raw,path),text);
  const shared=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF/0AAAAASUVORK5CYII=','base64');
  rawText('分类/a/assets/shared.png',shared);
  rawText('分类/a/article.md','---\nname: 奥卡姆剃刀\nid: a\nsiyuan_id: '+oldId+'\ntags: [方法]\nsources: [assets/original.md]\nreadings: [{title: 附录, path: assets/reading.md}]\n---\n\n## 核心理解\n\n字面 100%_X，[[b]]。\n\n![图](assets/shared.png)\n');
  rawText('分类/b/article.md','---\nname: 参照卡\nid: b\n---\n\n## 核心理解\n\n另一张卡共用图片 ![图](../a/assets/shared.png)\n');
  rawText('分类/a/assets/reading.md','只有这里提到边际机会成本。');
  const v1=snapshot('初版',1),v2=snapshot('第二版',2);
  rawText(txt,v2.markdown);
  const {markdown,...sidecar}=v2;
  save(join(raw,'分类/a/assets/original.json'),sidecar);
  const metadata={version:1,libraryId:'test-library',cards:{
    a:{id:oldId,updated:'20261120000100',aliases:['legacy-a']},
    b:{id:'b',updated:'20261121000000'},
  },readings:{'分类/a/assets/reading.md':{id:'supplement',updated:'20261119130000'}}};
  const baseline={version:1,libraryId:'test-library',sources:[v1],proposals:[],events:[]};
  const args={rawRoot:raw,metadataFile:join(root,'metadata.json'),baselineFile:join(root,'baseline.json'),output:join(root,'one')};
  metadata.history=historyInventory(baseline);
  save(args.metadataFile,metadata);save(args.baselineFile,baseline);
  return {root,raw,shared,v1,v2,args,metadata,baseline};
}

test('host compiler publishes and reopens a deterministic, searchable offline release',t=>{
  const {root,shared,v1,v2,args}=fixture(t);
  const manifest=buildContent(args);
  const second=buildContent({...args,output:join(root,'two')});
  assert.deepEqual(second,manifest);
  assert.equal(manifest.counts.cards,2);
  assert.equal(manifest.counts.readings,1);
  assert.equal(manifest.counts.sources,2);
  assert.equal(manifest.counts.graphEdges,1);
  const names=readdirSync(join(args.output,'assets'));
  assert.equal(names.length,1);
  assert.equal(names[0],sha(shared)+'.png');
  assert.deepEqual(readFileSync(join(args.output,'assets',names[0])),shared);
  for (const file of manifest.files) assert.equal(sha(readFileSync(join(args.output,file.path))),file.sha256);
  const store=openContentStore(join(args.output,'knowledge.sqlite'));
  t.after(()=>store.close());
  assert.equal(store.asset('/assets/'+names[0]).mime,'image/png');
  assert.equal(store.asset('/assets/missing.png'),null);
  assert.deepEqual(store.list({limit:1}).items.map(i=>i.id),['b']);
  assert.equal(store.list({limit:1}).hasMore,true);
  for (const query of ['刀','剃刀','姆剃刀','100%_x','边际机会成本','不会命中 剃刀']) {
    assert.deepEqual(store.search({query}).map(i=>i.id),[oldId],query);
    assert.deepEqual(store.list({query}).items.map(i=>i.id),[oldId],query);
  }
  assert.equal(store.list({query:'%_absent'}).total,0);
  assert.deepEqual(store.search({query:' '}),[]);
  assert.throws(()=>store.search({limit:0}),{code:'invalid_input'});
  const tags=store.list({includeTags:true,tag:'方法',updatedFrom:'2026-11-20',updatedTo:'2026-11-20'});
  assert.equal(tags.total,1);
  assert.ok(tags.tags.includes('学科：分类'));
  assert.equal(store.document('legacy-a').id,oldId);
  assert.equal(store.document('a').editable,false);
  assert.equal(store.document('a').readings[0].id,'supplement');
  assert.match(store.document('supplement').html,/边际机会成本/);
  assert.match(store.document('b').html,new RegExp(names[0]));
  assert.deepEqual(store.record('sources',v1.id),v1);
  assert.deepEqual(store.record('sources',v2.id),v2);
  assert.equal(store.view('graph').nodes.length,2);
  assert.equal(store.view('scenarios').catalog.status,'missing');
  assert.throws(()=>store.document('missing'),{code:'not_found'});
});

test('failed and repeated builds preserve the previous release and source files',t=>{
  const {root,raw,args,metadata,baseline}=fixture(t);
  const cli=['scripts/build-content.mjs','--raw-root',raw,'--metadata',args.metadataFile,'--baseline',args.baselineFile,'--out',args.output];
  assert.equal(JSON.parse(execFileSync(process.execPath,cli,{encoding:'utf8'})).cards,2);
  const file=join(args.output,'knowledge.sqlite'),prior=sha(readFileSync(file));
  assert.throws(()=>buildContent(args),/已存在/);
  assert.throws(()=>buildContent({...args,output:join(raw,'nested','release')}),/原稿目录/);
  const changed={...args,output:join(root,'bad')};
  save(args.baselineFile,{...baseline,libraryId:'another-library'});
  assert.throws(()=>buildContent(changed),/身份/);
  save(args.baselineFile,{...baseline,sources:[]});
  assert.throws(()=>buildContent(changed),/版本/);
  save(args.baselineFile,baseline);
  delete metadata.cards.a.updated;
  save(args.metadataFile,metadata);
  assert.throws(()=>buildContent(changed),/updated/);
  assert.equal(existsSync(changed.output),false);
  assert.equal(sha(readFileSync(file)),prior);
  const db=new DatabaseSync(file,{readOnly:true});
  try { assert.throws(()=>db.exec('DELETE FROM documents'),/readonly/); }
  finally { db.close(); }
});

test('frozen and previous-release inventories prevent silent loss of a whole historical record',t=>{
  const {root,args,baseline,metadata}=fixture(t);
  const historical={...snapshot('历史独立原文',1),sourceId:'src_1111111122222222'};
  historical.id=sourceSnapshotId(historical);
  baseline.sources.push(historical);
  metadata.history=historyInventory(baseline);
  save(args.baselineFile,baseline); save(args.metadataFile,metadata);
  buildContent(args);
  const before=sha(readFileSync(join(args.output,'knowledge.sqlite')));
  const output=join(root,'next');
  baseline.sources.pop();
  save(args.baselineFile,baseline);
  assert.throws(()=>buildContent({...args,output}),/已发历史记录缺失/);
  metadata.history=historyInventory(baseline);
  metadata.previousManifest=sha(readFileSync(join(args.output,'manifest.json')));
  save(args.metadataFile,metadata);
  assert.throws(()=>buildContent({...args,output}),/上一版清单/);
  assert.throws(()=>buildContent({...args,output,previous:args.output}),/已发历史记录缺失/);
  assert.equal(existsSync(output),false);
  assert.equal(sha(readFileSync(join(args.output,'knowledge.sqlite'))),before);
  baseline.sources.push(historical);
  save(args.baselineFile,baseline);
  assert.equal(buildContent({...args,output,previous:args.output}).counts.sources,3);
  delete metadata.previousManifest;
  save(args.metadataFile,metadata);
  const priorPath=join(args.output,'manifest.json');
  const tampered=JSON.parse(readFileSync(priorPath,'utf8'));
  delete tampered.history.sources[historical.id];
  save(priorPath,tampered);
  assert.throws(()=>buildContent({...args,output:join(root,'other'),previous:args.output}),/库存与内容库不符/);
});


test('a published block cannot be reclassified as an alias of the same document',t=>{
  const {root,args,metadata}=fixture(t);
  const block='20261120001000-abcdef2';
  metadata.cards.a.blocks=[{id:block,markdown:'## 核心理解'}];
  save(args.metadataFile,metadata);
  buildContent(args);
  const before=openContentStore(join(args.output,'knowledge.sqlite'));
  try { assert.equal(before.document(block).anchor,block); } finally { before.close(); }
  metadata.cards.a.blocks=[];
  metadata.cards.a.aliases.push(block);
  save(args.metadataFile,metadata);
  const output=join(root,'next');
  assert.throws(()=>buildContent({...args,output,previous:args.output}),/锚点/);
  assert.equal(existsSync(output),false);
});


test('source sidecars and frozen sourceFiles generate the same visible source title and URL',t=>{
  const {root,raw,args,baseline}=fixture(t);
  const sidecar=join(raw,'分类/a/assets/original.json');
  const meta=JSON.parse(readFileSync(sidecar,'utf8'));
  buildContent(args);
  const first=openContentStore(join(args.output,'knowledge.sqlite'));
  let expected;
  try { expected=first.document('a').html; } finally { first.close(); }
  assert.ok(expected.includes('>'+meta.title+'</a>'));
  rmSync(sidecar);
  baseline.sourceFiles={[txt]:meta};
  save(args.baselineFile,baseline);
  const output=join(root,'from-baseline');
  buildContent({...args,output});
  const second=openContentStore(join(output,'knowledge.sqlite'));
  try { assert.equal(second.document('a').html,expected); } finally { second.close(); }
});


test('a later supplementary reading update moves its owner in date-filtered lists',t=>{
  const {args,metadata}=fixture(t);
  metadata.readings['分类/a/assets/reading.md'].updated='20261122003000';
  save(args.metadataFile,metadata);
  buildContent(args);
  const store=openContentStore(join(args.output,'knowledge.sqlite'));
  try {
    assert.deepEqual(store.list({updatedFrom:'2026-11-22',updatedTo:'2026-11-22'}).items.map(row=>row.id),[oldId]);
    assert.equal(store.list().items[0].id,oldId);
    assert.equal(store.document(oldId).updated,'20261122003000');
  } finally { store.close(); }
});
