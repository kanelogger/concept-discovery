import test from 'node:test';
import assert from 'node:assert/strict';
import {documentTags,listOptions} from '../../lib/card-list.mjs';
import {readRoute,routeHref} from '../../web/routes.mjs';
import {Documents} from '../../lib/documents.mjs';
import {DatabaseSync} from 'node:sqlite';

test('tags are read from actual tag sections, without treating code examples or other sections as tags',()=>{
 assert.deepEqual(documentTags('## 标签\n\n方法论、验证\n\n## 用法\n\n不是标签\n\n```md\n## 标签\n伪标签\n```'),['方法论','验证']);
 assert.deepEqual(documentTags('## 中文 · 标签\n\n{{{row\n\n- 中文\n- 方法\n\n}}}\n{: custom-cd-field="tags"}'),['中文','方法']);
});
test('date and pagination boundaries reject invalid calendar days and reversed ranges',()=>{
 for(const input of[{updatedFrom:'2026-13-01'},{updatedTo:'2026-02-30'},{updatedFrom:'2026-11-06',updatedTo:'2026-11-05'},{offset:-1},{limit:0},{tag:7}])assert.throws(()=>listOptions(input),e=>e.code==='invalid_input');
 assert.equal(listOptions({updatedFrom:'2024-02-29'}).updatedFrom,'2024-02-29');
});
test('tag filters apply before pagination and return correct counts and facets',async()=>{
 const rows=Array.from({length:45},(_,i)=>({id:'note-'+i,content:'标题'+i,updated:'20261105000000'}));const api={c:{notebookId:'notebook',libraryRootId:'root'},sql:async()=>rows,markdown:async id=>'正文\n\n## 标签\n\n'+(Number(id.slice(5))%2?'其他':'方法论')};const docs=new Documents(api,{});
 const first=await docs.list({includeTags:true,tag:'方法论',limit:20});const last=await docs.list({includeTags:true,tag:'方法论',limit:20,offset:20});assert.equal(first.total,23);assert.equal(first.items.length,20);assert.equal(first.hasMore,true);assert.equal(last.items.length,3);assert.equal(last.hasMore,false);assert.ok(last.items.every(x=>x.tags.includes('方法论')));assert.deepEqual(first.tags,['方法论','其他']);
});
test('list/detail/new/edit URLs preserve filter and page context, and legacy links remain readable',()=>{
 const f={query:'队列',tag:'方法论',updatedFrom:'2026-11-01',updatedTo:'2026-11-05',page:3};for(const kind of['list','new','detail','edit']){const href=routeHref(kind,'doc',f);const route=readRoute(href);assert.equal(route.kind,kind);assert.deepEqual(route.filters,f);}assert.equal(readRoute('/?id=legacy#anchor').id,'legacy');assert.equal(readRoute('/?id=legacy#anchor').hash,'#anchor');assert.equal(readRoute('/cards?page=-1').filters.page,1);
});

test('legacy structured tags preserve punctuation and discard empty placeholders',async()=>{
 const{renderValue}=await import('../../lib/markdown.mjs');
 assert.deepEqual(documentTags('## 中文 · 标签\n\n'+renderValue(['分析,设计','边界；适用性'])),['分析,设计','边界；适用性']);
 assert.deepEqual(documentTags('## 中文 · 标签\n\n'+renderValue([])),[]);
});

test('legacy tag lists survive native block attributes and share the reader locale',()=>{
 const raw = '## 中文 · 名称\n{: id="20261106000000-abcdefg"}\n\n示例\n\n## 中文 · 标签\n{: id="20261106000000-abcdefg"}\n\n{{{row\n\n- 认知偏差\n- 风险决策\n  {: id="20261106000000-abcdefg"}\n\n}}}\n{: id="20261106000000-abcdefg" custom-cd-field="tags"}\n\n# Recall: Example\n\n## English · 名称\n\nExample\n\n## English · 标签\n\n- cognitive bias';
 assert.deepEqual(documentTags(raw,{legacyFixedFields:true}),['认知偏差','风险决策']);
 assert.deepEqual(documentTags(raw.slice(raw.indexOf('# Recall')),{legacyFixedFields:true}),['cognitive bias']);
});

test('compact tag rendering preserves punctuation inside each tag',async()=>{const{renderCard}=await import('../../lib/compact.mjs');assert.deepEqual(documentTags(renderCard({title:'标签',tags:['分析,设计','边界；适用性']})),['分析,设计','边界；适用性']);});

test('list dates, ordering and detail use latest scoped content and reading timestamps',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE blocks(id,root_id,box,path,type,content,updated); CREATE TABLE attributes(block_id,name,value);
  INSERT INTO blocks VALUES
  ('first','first','box','/root/first.sy','d','首卡','20000101000000'),
  ('child','first','box','/root/first.sy','p','较新正文','20261106010000'),
  ('second','second','box','/root/second.sy','d','次卡','20261105000000'),
  ('reading','reading','box','/root/second/reading.sy','d','补充资料','20261107010000'),
  ('external','external','box','/elsewhere/external.sy','d','外部资料','20990101000000');
  INSERT INTO attributes VALUES ('reading','custom-cd-kind','article'),('reading','custom-cd-parent','second'),('external','custom-cd-parent','first');`);
  const api={c:{notebookId:'box',libraryRootId:'root'},sql:async stmt=>db.prepare(stmt).all()};const docs=new Documents(api,{});
  const all=await docs.list({limit:20});assert.deepEqual(all.items.map(x=>[x.id,x.updated]),[['second','20261107010000'],['first','20261106010000']]);
  const dated=await docs.list({updatedFrom:'2026-11-06',updatedTo:'2026-11-06'});assert.equal(dated.total,1);assert.equal(dated.items[0].id,'first');
  docs.snapshot=async()=>({id:'first',title:'首卡',markdown:'较新正文',attrs:{updated:'20000101000000'},units:[],editable:true});
  assert.equal((await docs.get('first')).updated,dated.items[0].updated);
 }finally{db.close();}
});

test('list only links legacy cards to Chinese articles in their reading scope', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE blocks(id,root_id,box,path,type,content,updated);
    CREATE TABLE attributes(block_id,name,value);
    INSERT INTO blocks VALUES
      ('legacy','legacy','box','/root/legacy.sy','d','旧卡','20261106010000'),
      ('english','english','box','/root/legacy/english.sy','d','English article','20261106010000'),
      ('zh','zh','box','/root/legacy/zh.sy','d','中文长文','20261106010000'),
      ('elsewhere','elsewhere','box','/elsewhere/elsewhere.sy','d','错位中文长文','20261106010000'),
      ('plain','plain','box','/root/plain.sy','d','新卡','20261106010000'),
      ('supplement','supplement','box','/root/plain/supplement.sy','d','中文资料','20261106010000');
    INSERT INTO attributes VALUES
      ('legacy','custom-cd-schema','1'),
      ('english','custom-cd-kind','article'),('english','custom-cd-parent','legacy'),('english','custom-cd-locale','en'),
      ('zh','custom-cd-kind','article'),('zh','custom-cd-parent','legacy'),('zh','custom-cd-locale','cn'),
      ('elsewhere','custom-cd-kind','article'),('elsewhere','custom-cd-parent','legacy'),('elsewhere','custom-cd-locale','cn'),
      ('supplement','custom-cd-kind','article'),('supplement','custom-cd-parent','plain'),('supplement','custom-cd-locale','cn');
  `);
  const docs = new Documents({
    c: { notebookId: 'box', libraryRootId: 'root' },
    sql: async sql => db.prepare(sql).all(),
    markdown: async () => '',
  }, {});
  const { items } = await docs.list({ includeTags: true });
  assert.equal(items.find(item => item.id === 'legacy').chineseArticleId, 'zh');
  assert.equal(items.find(item => item.id === 'plain').chineseArticleId, undefined);
  db.exec("DELETE FROM blocks WHERE id='zh'");
  const fallback = await docs.list({ includeTags: true });
  assert.equal(fallback.items.find(item => item.id === 'legacy').chineseArticleId, undefined);
});
