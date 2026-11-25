import test from 'node:test';
import assert from 'node:assert/strict';
import {documentTags,listOptions} from '../../lib/card-list.mjs';
import {readRoute,routeHref} from '../../web/routes.mjs';
import {Documents} from '../../lib/documents.mjs';
import {CardBodyReader} from '../../lib/card-body-reader.mjs';
import {DatabaseSync} from 'node:sqlite';

test('wiki source links survive direct navigation and refresh without carrying card search state',()=>{
 const href=routeHref('wiki','src_abcd',{query:'旧搜索'},'','ask');
 assert.equal(href,'/wiki?source=src_abcd');
 assert.equal(readRoute(href).kind,'wiki');
 assert.equal(new URL(href,'http://localhost').searchParams.get('source'),'src_abcd');
});

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
test('list and detail routes preserve filters and page, including older bookmarks', () => {
  const filters = { query: '队列', tag: '方法论', updatedFrom: '2026-11-01', updatedTo: '2026-11-05', page: 3 };
  for (const kind of ['list', 'detail']) {
    const href = routeHref(kind, 'doc', filters);
    assert.equal(readRoute(href).kind, kind);
    assert.deepEqual(readRoute(href).filters, filters);
  }
  assert.equal(readRoute('/?id=legacy#anchor').id, 'legacy');
  assert.equal(readRoute('/?id=legacy#anchor').hash, '#anchor');
  assert.equal(readRoute('/cards?page=-1').filters.page, 1);
});

test('legacy structured tags preserve punctuation and discard empty placeholders',()=>{
 assert.deepEqual(documentTags('## 中文 · 标签\n\n- 分析,设计\n- 边界；适用性'),['分析,设计','边界；适用性']);
 assert.deepEqual(documentTags('## 中文 · 标签\n\n\u200b'),[]);
});

test('legacy tag lists survive native block attributes and preserve technical terms',()=>{
 const raw = '## 中文 · 名称\n{: id="20261106000000-abcdefg"}\n\n示例\n\n## 中文 · 标签\n{: id="20261106000000-abcdefg"}\n\n{{{row\n\n- 认知偏差\n- API 设计\n  {: id="20261106000000-abcdefg"}\n\n}}}\n{: id="20261106000000-abcdefg" custom-cd-field="tags"}';
 assert.deepEqual(documentTags(raw),['认知偏差','API 设计']);
 assert.deepEqual(documentTags('## 标签\n\n分析,设计、边界；适用性'),['分析,设计','边界；适用性']);
 assert.deepEqual(documentTags('## tags\n\nAPI\n\n## English · 标签\n\n旧标签'),[]);
});

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

test('list items expose ordinary card metadata without a language-specific reading selector', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE blocks(id,root_id,box,path,type,content,updated);
    CREATE TABLE attributes(block_id,name,value);
    INSERT INTO blocks VALUES
      ('legacy','legacy','box','/root/legacy.sy','d','旧卡','20261106010000'),
      ('article','article','box','/root/legacy/article.sy','d','补充阅读','20261106010000'),
      ('plain','plain','box','/root/plain.sy','d','新卡','20261106010000');
    INSERT INTO attributes VALUES
      ('legacy','custom-cd-schema','1'),
      ('article','custom-cd-kind','article'),('article','custom-cd-parent','legacy');
  `);
  const docs = new Documents({
    c: { notebookId: 'box', libraryRootId: 'root' },
    sql: async sql => db.prepare(sql).all(),
    markdown: async () => '## 标签\n\n方法',
  }, {});
  const { items } = await docs.list({ includeTags: true });
  assert.equal(items.length, 2);
  for (const item of items) assert.deepEqual(Object.keys(item).sort(), ['id','summary','tags','title','updated']);
});

test('page tags read only the SQL page; filtering and full facets include matches beyond it', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE blocks(id,root_id,box,path,type,content,updated); CREATE TABLE attributes(block_id,name,value);');
  const insert = db.prepare('INSERT INTO blocks VALUES(?,?,?,?,?,?,?)');
  const bodies = new Map();
  for (let n = 0; n < 70; n++) {
    const id = 'card-' + String(n).padStart(2, '0');
    insert.run(id, id, 'box', '/root/' + id + '.sy', 'd', id, '20261123000000');
    bodies.set(id, '## 标签\n\n' + (n < 3 ? '末页标签' : '常见标签'));
  }
  const queries = [], batches = [];
  const api = {
    c: { notebookId: 'box', libraryRootId: 'root' },
    async sql(sql) { queries.push(sql); return db.prepare(sql).all(); },
    async markdowns(ids) {
      batches.push(ids);
      return Object.fromEntries(ids.toReversed().map(id => [id, bodies.get(id)]));
    },
  };
  const docs = new Documents(api, {});
  const options = { cardBodies: new CardBodyReader(api) };
  const list = (input = {}) => docs.list({ limit: 20, ...input }, options);
  for (const includeTags of [false, undefined]) {
    const plain = await list({ includeTags });
    assert.equal(plain.tags, undefined);
    assert.ok(plain.items.every(row => row.tags === undefined));
    assert.equal(batches.length, 0);
  }
  queries.length = 0;
  const page = await list({ includeTags: 'page', offset: 20 });
  assert.equal(queries.length, 2);
  assert.deepEqual(batches, [page.items.map(row => row.id)]);
  assert.equal(page.items[0].id, 'card-49');
  assert.equal(page.items.length, 20);
  assert.ok(page.items.every(row => row.tags[0] === '常见标签'));
  assert.deepEqual([page.total, page.hasMore, page.tags], [70, true, undefined]);

  // A second edit inside the same second cannot reuse old tags.
  bodies.set('card-49', '## 标签\n\n改后标签');
  const updated = await list({ includeTags: 'page', offset: 20 });
  assert.deepEqual(updated.items[0].tags, ['改后标签']);

  batches.length = 0;
  const facets = await list({ includeTags: true });
  assert.deepEqual(batches.map(ids => ids.length).sort((a,b) => b-a), [32, 32, 6]);
  assert.deepEqual(new Set(facets.tags), new Set(['常见标签', '改后标签', '末页标签']));
  for (const includeTags of [false, true, 'page']) {
    const filtered = await list({ includeTags, tag: '末页标签', limit: 2, offset: 1 });
    assert.deepEqual(filtered.items.map(row => row.id), ['card-01', 'card-00']);
    assert.equal(filtered.total, 3);
    assert.equal(filtered.hasMore, false);
    assert.deepEqual(filtered.tags, includeTags === 'page' ? undefined : facets.tags);
  }
  assert.throws(() => listOptions({ includeTags: 'yes' }), { code: 'invalid_input' });
});

test('list propagates a failed fallback even when that card had cached tags', async () => {
  const row = { id: 'one', content: '标题', updated: '20261123000000' };
  const error = Object.assign(new Error('block not found'), { code: 'siyuan_error' });
  let missing = false, singles = 0;
  const api = {
    c: { notebookId: 'box', libraryRootId: 'root' },
    sql: async () => [row],
    async markdowns() { if (missing) throw error; return { one: '## 标签\n\n缓存' }; },
    async markdown() { singles++; throw error; },
  };
  const docs = new Documents(api, {});
  const options = { cardBodies: new CardBodyReader(api) };
  assert.deepEqual((await docs.list({ includeTags: true }, options)).tags, ['缓存']);
  missing = true;
  await assert.rejects(docs.list({ includeTags: true }, options), error);
  assert.equal(singles, 1);
});
