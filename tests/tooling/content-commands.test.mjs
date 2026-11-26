import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { documentTags } from '../../lib/card-list.mjs';
import { createContentCommands } from '../../lib/content-commands.mjs';
import { openContentStore } from '../../lib/content-store.mjs';
import { documentMarkdown } from '../../lib/documents.mjs';
import { readOnlyReason } from '../../lib/read-commands.mjs';
import { canonical, hash, normalize } from '../../lib/siyuan.mjs';
import { headingQuestion } from '../../lib/wiki.mjs';
import { renderCardReferences } from '../../server/card-references.mjs';
import { buildContent, historyInventory } from '../../scripts/build-content.mjs';
import { sourceSnapshot } from '../service/source-fixture.mjs';

const old = '20261101000001-aaaaaaa', reading = '20261101000002-bbbbbbb';
const block = '20261101000003-ccccccc', childBlock = '20261101000004-ddddddd';
const updated = '20261120153000', origin = 'https://old.example', shadow = 'https://shadow.example';
const readingPath = '学科/old/assets/reading.md';
const bookmark = id => origin + '/?id=' + id;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'content-commands-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  const raw = join(root, 'raw');
  mkdirSync(join(raw, '学科/old/assets'), {recursive:true});
  mkdirSync(join(raw, '学科/new'), {recursive:true});
  const mainBody = '旧解释。\n\n## 自测\n\n记得吗？\n\n## 标签\n\n方法';
  const nativeLink = '[返回旧卡](/?id=' + old + ')';
  const childBody = '补读独有。\n\n' + nativeLink;
  const readingRaw = '补读独有。\n\n[返回旧卡](../article.md)';
  const article = '---\nname: 旧卡\nsiyuan_id: ' + old +
    '\nreadings: [{title: 附录, path: assets/reading.md}]\n---\n\n## 核心理解\n\n' + mainBody + '\n';
  writeFileSync(join(raw, '学科/old/article.md'), article);
  writeFileSync(join(raw, readingPath), readingRaw);
  writeFileSync(join(raw, '学科/new/article.md'), '---\nname: 新卡\n---\n\n## 核心理解\n\n另一份原稿。');
  const legacyId = 'concept:old';
  const relation = {id:'relation', source_concept_id:'meta:old', target_concept_id:'concept:other'};
  writeFileSync(join(raw, '.sync.json'), JSON.stringify({version:1, identity:'fixture',
    cards:{old:{remoteId:old, legacyId, legacyMeta:{id:'meta:old', version:3}}}, readings:{}, relations:[relation]}));

  const native = mainBody + '\n{: id="' + old + '" updated="' + updated + '"}';
  const section = {id:block,key:'description',markdown:'旧解释。'};
  section.hash = hash(section.markdown);
  const readingSection = {id:childBlock,key:'reading',markdown:nativeLink,hash:hash(nativeLink)};
  const content = {name:'卡片字段名称',description:'冻结的字段摘要',source_text:'冻结出处'};
  const oldGet = {id:old,documentId:old,legacyId,schema:1,title:content.name,summary:content.description,
    sources:content.source_text,hash:hash(native),markdown:normalize(native),content,
    sections:[section,readingSection],readings:[{id:reading,title:'附录',markdown:childBody}],
    version:3,relations:[relation],url:bookmark(old)};
  function record({id,title,md,rawText,blocks,readings = [],fixed = false}) {
    const markdown = documentMarkdown(md), revision = hash([title,md]);
    const data = {id,title,updated,markdown,blocks,revision,readings,url:bookmark(id),tags:documentTags(markdown),
      question:headingQuestion(markdown),editable:false,deletable:false,readOnlyReason,
      ...(fixed && {legacyFixedFields:true}),
      html:renderCardReferences(markdown,{origin,id,blocks,legacyFixedFields:fixed}).html};
    return {id,updated,revision,frozenDocument:{rawSha256:hash(rawText),data,blockIds:blocks.map(b=>b.id),
      searchText:[title,markdown,...(fixed ? ['仅原生索引字段'] : [])].join('\n')}};
  }
  const main = record({id:old,title:'旧卡',md:native,rawText:article,
    blocks:[{id:block,markdown:section.markdown}],fixed:true,readings:[{id:reading,title:'附录',url:bookmark(reading)}]});
  Object.assign(main, {content, legacyFixedFields:true,frozenGet:{nativeMarkdown:native,data:oldGet,
    sectionOwners:{[block]:old,[childBlock]:reading}}});
  const child = record({id:reading,title:'附录',md:childBody,rawText:readingRaw,blocks:[{id:childBlock,markdown:nativeLink}]});
  child.blocks = [{id:childBlock,markdown:nativeLink}];
  const source = sourceSnapshot('test', {title:'原文',markdown:'字😀'});
  const createdAt = source.createdAt;
  const proposal = {id:'prop_1111111111111111',kind:'proposal',createdAt,updatedAt:createdAt};
  const audit = {...proposal,id:'prop_2222222222222222',kind:'audit'};
  for (const row of [audit,proposal]) row.revision = hash(canonical(row));
  const event = {id:'evt_1111111111111111',kind:'review',createdAt};
  const baseline = {version:1,libraryId:'fixture',sources:[source],proposals:[proposal,audit],events:[event]};
  const metadata = {version:1,libraryId:'fixture',origin,cards:{[old]:main,new:{id:'new',updated:'20261121153000'}},
    readings:{[readingPath]:child},history:historyInventory(baseline)};
  function build() {
    const output = join(root, 'release');
    const metadataFile = join(root,'metadata.json'), baselineFile = join(root,'history.json');
    writeFileSync(metadataFile,JSON.stringify(metadata));
    writeFileSync(baselineFile,JSON.stringify(baseline));
    buildContent({rawRoot:raw,metadataFile,baselineFile,output});
    return join(output,'knowledge.sqlite');
  }
  return {main,child,oldGet,source,proposal,audit,event,build};
}

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
