import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createContentCommands } from '../../lib/content-commands.mjs';
import { openContentStore } from '../../lib/content-store.mjs';
import { hash } from '../../lib/siyuan.mjs';
import { fixture, old, reading, block, childBlock, updated, shadow } from './content-command-fixture.mjs';

test('ten public commands preserve native hashes, document and block ownership, history and failure codes', t => {
  const {main,child,oldGet,source,proposal,audit,event,build} = fixture(t);
  const store = openContentStore(build());
  t.after(()=>store.close());
  const run = createContentCommands(store,{origin:shadow});
  assert.deepEqual(run('get',{id:'concept:old'}),{...oldGet,url:shadow+'/?id='+old});
  assert.notEqual(oldGet.hash,hash(oldGet.markdown));
  const mainDoc = main.frozenDocument.data;
  assert.deepEqual(run('get-document',{id:block}),{...mainDoc,anchor:block,url:shadow+'/?id='+old,
    readings:[{id:reading,title:'附录',url:shadow+'/?id='+reading}]});
  assert.deepEqual(run('get-document',{id:childBlock}),{...child.frozenDocument.data,anchor:childBlock,url:shadow+'/?id='+reading});
  assert.deepEqual(run('wiki-card',{id:'old'}),{id:old,revision:mainDoc.revision,question:'记得吗？'});
  for (const query of ['补读独有','仅原生索引','不在库内 索引字段']) {
    assert.deepEqual(run('search',{query}),[{id:old,legacyId:'meta:old',name:oldGet.content.name,
      summary:oldGet.summary,sources:oldGet.sources,url:shadow+'/?id='+old}]);
    assert.deepEqual(run('list',{query,includeTags:'page'}).items.map(item=>item.id),[old]);
  }
  const page = run('list',{limit:1,offset:1,includeTags:true});
  assert.equal(page.total,2);
  assert.equal(page.hasMore,false);
  assert.deepEqual(page.items,[{id:old,title:'旧卡',tags:['方法'],summary:'',updated}]);
  assert.deepEqual(run('search',{query:'找不到的字段'}),[]);
  const fresh = run('get',{id:'new'});
  assert.equal(fresh.schema,2);
  assert.equal(fresh.hash,hash(fresh.markdown));
  assert.ok(fresh.markdown.includes('另一份原稿。'));
  const {markdown,...summary} = source;
  assert.deepEqual(run('sources-list'),{items:[{...summary,characters:2}]});
  assert.deepEqual(run('source-get',{id:source.id}),source);
  assert.deepEqual(run('wiki-proposals'),{items:[proposal]});
  assert.deepEqual(run('wiki-proposal',{id:proposal.id}),proposal);
  assert.deepEqual(run('wiki-events'),{items:[event]});
  for (const [command,input,code] of [
    ['get',{id:reading},'identity_conflict'],['get',{id:block},'identity_conflict'],
    ['get-document',{id:'20261101122222-zzzzzzz'},'outside_scope'],['get-document',{id:'missing'},'identity_conflict'],
    ['list',{limit:0},'invalid_input'],['search',{locale:'zh'},'invalid_input'],['get',{option:{language:'zh'}},'invalid_input'],
    ['wiki-events',[],'invalid_input'],['source-get',{id:'../source'},'invalid_input'],
    ['source-get',{id:'src_ffffffffffffffff'},'not_found'],['wiki-proposal',{id:audit.id},'outside_scope'],
    ['save-document',{},'invalid_command'],
  ]) assert.throws(()=>run(command,input),{code},command);
});

test('rejects mismatched frozen versions, inventories, section owners, HTML and public fields', t => {
  const {main,child,build} = fixture(t);
  const doc = main.frozenDocument, snapshot = main.frozenGet;
  const wrong = (obj,key,value,expected) => {
    const prior = obj[key];
    obj[key] = value;
    try { assert.throws(build,expected); }
    finally { if (prior === undefined) delete obj[key]; else obj[key] = prior; }
  };
  wrong(doc,'rawSha256',hash('later'),/原稿摘要/);
  wrong(doc,'searchText',undefined,/原生搜索文本/);
  wrong(doc.data,'html','<p>其他版本</p>',/安全渲染/);
  wrong(doc.data,'shareable',true,/无写入权限/);
  wrong(doc.data,'internal',{},/不支持的公开字段/);
  wrong(doc,'blockIds',[],/与原生库存不符/);
  wrong(snapshot.sectionOwners,childBlock,old,/冻结章节归属不符/);
  wrong(snapshot.data,'hash',hash('another'),/原生正文哈希/);
  wrong(snapshot.data,'markdown','不同版本',/同一原生快照/);
  wrong(snapshot.data.sections[0],'hash',hash('another'),/章节字段或哈希/);
  wrong(snapshot.data,'relations',[],/关系不符/);
  wrong(snapshot.data,'version',4,/历史元数据不符/);
  wrong(snapshot.data,'internal',{},/不支持的公开字段/);
  wrong(child.frozenDocument.data,'revision',hash('future'),/身份或版本/);
  wrong(snapshot.data.readings[0],'markdown','未来补读',/补读顺序、内容/);
});

test('partial native freezes and pre-projection databases stay available only for offline reads', t => {
  const {main,build} = fixture(t);
  delete main.frozenGet;
  const file = build();
  let store = openContentStore(file);
  try {
    assert.equal(store.document(old).id,old);
    assert.throws(()=>createContentCommands(store),{code:'configuration'});
  } finally { store.close(); }
  const database = new DatabaseSync(file);
  try { database.exec('PRAGMA user_version=1'); } finally { database.close(); }
  store = openContentStore(file);
  try {
    assert.equal(store.list({}).total,2);
    assert.throws(()=>createContentCommands(store),/版本 2/);
  } finally { store.close(); }
});
