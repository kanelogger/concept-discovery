import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { hash } from '../../lib/siyuan.mjs';
import { openContentReader } from '../../server/content-reader.mjs';
import { block, childBlock, fixture, old, reading, readingPath, shadow } from './content-command-fixture.mjs';

const oldPath = '学科/old/article.md';
const editedAt = '20261121153000', archivedAt = '20261122153000', restoredAt = '20261123153000';

function publish(t) {
  const f = fixture(t);
  f.main.aliases = ['previous-name'];
  function release(name,previous) {
    const output = join(f.root,name);
    if (previous) f.metadata.previousManifest = hash(readFileSync(join(previous,'manifest.json')));
    f.build({output,previous});
    return output;
  }
  function open(directory) {
    const reader = openContentReader({directory,libraryId:'fixture',origin:shadow});
    t.after(()=>reader.close());
    return reader;
  }
  function edit(path,record,text,updated,retiredBlockIds = []) {
    writeFileSync(join(f.raw,path),text);
    record.rawEdit = {version:1,updated,rawSha256:hash(text),retiredBlockIds};
    if (record.legacyFixedFields && text !== f.article) {
      record.rawEdit.fixedFields = {content:{...record.content},sections:[]};
    }
  }
  return {...f,release,open,edit};
}

test('a reviewed raw edit updates get, search and HTML at the existing share and bookmark identity', t=>{
  const f = publish(t);
  const original = f.release('v1'), first = f.open(original);
  const oldGet = first.dispatch('get',{id:old});
  const oldDoc = first.dispatch('get-document',{id:old});
  // Add both an ordinary card and new prose to an originally fixed-field card.
  mkdirSync(join(f.raw,'学科/third'));
  writeFileSync(join(f.raw,'学科/third/article.md'),'---\nname: 第三张卡\n---\n\n## 核心理解\n\n保留旧引用。');
  f.metadata.cards.third = {id:'third',updated:editedAt};
  delete f.main.aliases;
  const body = f.article.replace('旧解释。','旧解释。\n\n新增段落。');
  f.edit(oldPath,f.main,body,editedAt);
  const current = f.open(f.release('v2',original));
  for (const id of ['old',old,'previous-name','meta:old','concept:old']) {
    assert.equal(current.activeMain(id).id,old);
    const detail = current.dispatch('get',{id});
    assert.equal(detail.schema,1);
    assert.equal(detail.hashSource,'raw-markdown');
    assert.deepEqual(detail.relations,oldGet.relations);
    assert.equal(detail.legacyId,'concept:old');
    assert.match(detail.markdown,/新增段落/);
    assert.equal(detail.hash,hash(detail.markdown));
    assert.notEqual(detail.hash,oldGet.hash);
    assert.deepEqual(detail.content,oldGet.content);
    assert.ok(detail.sections.some(s=>s.id===block && s.key==='description' && s.hash===hash('旧解释。')));
    assert.ok(detail.sections.some(s=>s.id===childBlock && s.key==='reading'));
  }
  assert.equal(current.dispatch('get',{id:'third'}).id,'third');
  assert.deepEqual(current.dispatch('search',{query:'新增段落'}).map(row=>row.id),[old]);
  assert.deepEqual(current.dispatch('search',{query:'仅原生索引字段'}),[]);
  assert.deepEqual(current.dispatch('source-get',{id:f.source.id}),f.source);
  const doc = current.dispatch('get-document',{id:block});
  assert.equal(doc.id,old);
  assert.equal(doc.anchor,block);
  assert.ok(doc.html.includes('id="'+block+'"'));
  assert.notEqual(doc.revision,oldDoc.revision);
  assert.deepEqual(current.dispatch('get-document',{id:reading}),first.dispatch('get-document',{id:reading}));
  assert.deepEqual(first.dispatch('get',{id:old}),oldGet);
  assert.deepEqual(f.open(original).dispatch('get-document',{id:old}),oldDoc);
});

test('archive, restore and explicitly retired block bookmarks retain their verified owner across releases', t=>{
  const f = publish(t);
  const first = f.release('v1');
  const changed = f.article.replace('旧解释。','另写的新解释。');
  f.edit(oldPath,f.main,changed,editedAt);
  assert.throws(()=>f.release('missing-confirmation',first),/retiredBlockIds.*ccccccc/);
  f.main.rawEdit.retiredBlockIds = [block];
  f.main.rawEdit.fixedFields.content.description = '';
  const next = f.release('v2',first);
  const archived = changed.replace('name: 旧卡','name: 旧卡\nstatus: archived');
  f.edit(oldPath,f.main,archived,archivedAt,[block]);
  f.main.rawEdit.fixedFields.content.description = '';
  const hidden = f.release('v3',next);
  assert.equal(f.open(hidden).activeMain(old),null);
  assert.throws(()=>f.open(hidden).dispatch('get-document',{id:block}),{code:'outside_scope'});
  f.edit(oldPath,f.main,changed,restoredAt,[block]);
  f.main.rawEdit.fixedFields.content.description = '';
  const reader = f.open(f.release('v4',hidden));
  const doc = reader.dispatch('get-document',{id:block});
  assert.equal(doc.id,old);
  assert.equal(doc.anchor,block);
  assert.ok(!doc.html.includes('id="'+block+'"'));
  assert.equal(reader.activeMain('previous-name').id,old);
  assert.ok(!reader.dispatch('get',{id:old}).sections.some(s=>s.id===block));
});

test('editing only the supplement requires the parent get to acknowledge the new projection', t=>{
  const f = publish(t);
  const initial = f.release('original');
  f.edit(readingPath,f.child,'补读换成新原文。',editedAt,[childBlock]);
  assert.throws(()=>f.release('stale-parent',initial),/父卡也需要 rawEdit/);
  f.edit(oldPath,f.main,f.article,editedAt);
  const reader = f.open(f.release('current',initial));
  const card = reader.dispatch('get',{id:old});
  const original = f.open(initial).dispatch('get',{id:old});
  assert.deepEqual(card,{...original,readings:[{...original.readings[0],markdown:'补读换成新原文。'}],
    sections:original.sections.filter(s=>s.id !== childBlock)});
  assert.equal(card.readings[0].markdown,'补读换成新原文。');
  assert.ok(!card.sections.some(s=>s.id===childBlock));
  assert.equal(reader.dispatch('get-document',{id:childBlock}).id,reading);
});

test('an archived native card and supplement may receive their first raw edit while being restored', t=>{
  const f = publish(t);
  const first = f.release('original');
  const archived = f.article.replace('name: 旧卡','name: 旧卡\nstatus: archived');
  writeFileSync(join(f.raw,oldPath),archived);
  const hidden = f.release('hidden',first);
  const stillHidden = f.release('still-hidden',hidden);
  f.edit(readingPath,f.child,'第一次修改补读。',restoredAt,[childBlock]);
  f.edit(oldPath,f.main,f.article,restoredAt);
  const reader = f.open(f.release('restored',stillHidden));
  assert.equal(reader.activeMain('previous-name').id,old);
  assert.equal(reader.dispatch('get',{id:old}).readings[0].markdown,'第一次修改补读。');
  assert.equal(reader.dispatch('get-document',{id:childBlock}).id,reading);
});

test('an authored projection rejects stale bytes, frozen proofs, history, time, alias collisions and missing previous input', t=>{
  const f = publish(t);
  const first = f.release('v1');
  f.edit(oldPath,f.main,f.article,editedAt);
  assert.throws(()=>f.release('unchanged',first),/未变/);
  const changed = f.article + '\n当前版本。';
  f.edit(oldPath,f.main,changed,editedAt);
  delete f.metadata.previousManifest;
  assert.throws(()=>f.release('no-previous'),/--previous/);
  assert.throws(()=>f.build({output:join(f.root,'no-pin'),previous:first}),/previousManifest/);
  f.main.rawEdit.rawSha256 = hash(f.article);
  assert.throws(()=>f.release('stale',first),/原稿摘要/);
  f.main.rawEdit.rawSha256 = hash(changed);
  const originalRaw = f.main.frozenDocument.rawSha256;
  f.main.frozenDocument.rawSha256 = hash('未经核实的原稿');
  assert.throws(()=>f.release('wrong-base',first),/原生投影/);
  f.main.frozenDocument.rawSha256 = originalRaw;
  f.main.frozenGet.data.summary += '伪造摘要';
  assert.throws(()=>f.release('wrong-origin',first),/原生投影/);
  f.main.frozenGet.data.summary = f.main.content.description;
  f.main.rawEdit.retiredBlockIds = [childBlock];
  assert.throws(()=>f.release('wrong-owner',first),/原文档/);
  f.main.rawEdit.retiredBlockIds = [];
  const next = f.release('v2',first);
  f.main.rawEdit.updated = '20261120153000';
  assert.throws(()=>f.release('old-time',next),/递增/);
  f.main.rawEdit.updated = editedAt;
  f.metadata.cards.new.aliases = ['previous-name'];
  assert.throws(()=>f.release('collision',next),/归属不符|身份冲突/);
  delete f.metadata.cards.new.aliases;
  f.baseline.sources = [];
  f.metadata.history.sources = {};
  assert.throws(()=>f.release('lost-history',next),/已发历史记录缺失/);
});

test('repeated text and text moved into a code example cannot silently redirect a block bookmark', t=>{
  const f = publish(t);
  const first = f.release('v1');
  for (const [name,body] of [['repeated','旧解释。\n\n旧解释。'],['code','~~~\n旧解释。\n~~~'],['extended','旧解释。\n继续写在原段中。']]) {
    f.edit(oldPath,f.main,f.article.replace('旧解释。',body),editedAt);
    assert.throws(()=>f.release(name,first),/retiredBlockIds/);
  }
});

test('a pre-semantic v2 package requires the original raw tree to reseal before removing or renaming a supplement', t=>{
  const f = publish(t);
  const prior = f.release('old-format');
  const dbPath = join(prior,'knowledge.sqlite'), manifestPath = join(prior,'manifest.json');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("UPDATE documents SET payload=json_remove(payload,'$.nativeFreezeSha256','$.inputShape')");
    const evidence = db.prepare("SELECT json_type(payload,'$.nativeFreezeSha256') AS proof, " +
      "json_type(payload,'$.inputShape') AS shape FROM documents WHERE id=?").get(old);
    assert.deepEqual({...evidence},{proof:null,shape:null});
  } finally { db.close(); }
  const manifest = JSON.parse(readFileSync(manifestPath));
  manifest.files.find(file=>file.path==='knowledge.sqlite').sha256 = hash(readFileSync(dbPath));
  writeFileSync(manifestPath,JSON.stringify(manifest));
  const original = f.open(prior).dispatch('get',{id:old});
  const noReading = f.article.replace(/^readings:.*\n/m,'');
  f.edit(oldPath,f.main,noReading,editedAt);
  assert.throws(()=>f.release('ambiguous-fields',prior),/未改原稿.*重封/);
  delete f.main.rawEdit.fixedFields;
  assert.throws(()=>f.release('ambiguous-removal',prior),/未改原稿.*重封/);
  delete f.main.rawEdit;
  delete f.metadata.previousManifest;
  const pin = hash(readFileSync(manifestPath));
  function reseal(name) {
    const output=join(f.root,name);
    f.build({output,previous:prior,resealManifest:pin});
    return output;
  }
  writeFileSync(join(f.raw,oldPath),f.article);
  const unrelated = join(f.raw,'学科/new/article.md');
  const previousText = readFileSync(unrelated);
  writeFileSync(unrelated,Buffer.concat([previousText,Buffer.from('\n另一项变更。')]));
  assert.throws(()=>reseal('different-raw'),/重封基线.*完全一致/);
  writeFileSync(unrelated,previousText);
  const originalSearch = f.main.frozenDocument.searchText;
  f.main.frozenDocument.searchText += '\n仅伪造的索引能命中';
  assert.throws(()=>reseal('altered-search'),/完全一致的冻结元数据和历史文件/);
  f.main.frozenDocument.searchText = originalSearch;
  f.baseline.note='旧文件没有此项';
  assert.throws(()=>reseal('altered-history'),/完全一致的冻结元数据和历史文件/);
  delete f.baseline.note;
  const sealed = reseal('sealed');
  assert.deepEqual(f.open(sealed).dispatch('get',{id:old}),original);
  f.edit(oldPath,f.main,noReading,editedAt);
  delete f.main.rawEdit.fixedFields;
  const removed = f.open(f.release('removed',sealed)).dispatch('get',{id:old});
  assert.deepEqual(removed,{...original,readings:[],sections:original.sections.filter(s=>s.key!=='reading')});
  f.edit(oldPath,f.main,f.article.replace('title: 附录','title: 附录修订名'),editedAt);
  delete f.main.rawEdit.fixedFields;
  f.edit(readingPath,f.child,f.readingRaw,editedAt);
  const renamed = f.open(f.release('renamed',sealed)).dispatch('get',{id:old});
  assert.deepEqual(renamed,{...original,readings:[{...original.readings[0],title:'附录修订名'}]});
  writeFileSync(join(prior,'knowledge.sqlite-wal'),'');
  assert.throws(()=>f.release('unsealed',prior),/未封存/);
});

test('removing a formerly published supplement checks its previous owner and preserves the parent native fields', t=>{
  const f = publish(t);
  const syncPath = join(f.raw,'.sync.json');
  const binding = JSON.parse(readFileSync(syncPath));
  binding.readings[readingPath] = {remoteId:reading,parent:old};
  writeFileSync(syncPath,JSON.stringify(binding));
  const prior = f.release('original');
  const before = f.open(prior).dispatch('get',{id:old});
  const article = f.article.replace(/^readings:.*\n/m,'');
  f.edit(oldPath,f.main,article,editedAt);
  delete f.main.rawEdit.fixedFields;
  // The original migration binding stays intact. The authored metadata no longer
  // lists this reading. Its old document and blocks remain reserved in the manifest.
  delete f.metadata.readings[readingPath];
  const directory = f.release('removed',prior), reader = f.open(directory);
  const after = reader.dispatch('get',{id:old});
  assert.deepEqual(after,{...before,readings:[],sections:before.sections.filter(s=>s.key !== 'reading')});
  assert.deepEqual(reader.dispatch('get-document',{id:old}).readings,[]);
  assert.throws(()=>reader.dispatch('get-document',{id:childBlock}),{code:'outside_scope'});
  const manifest = JSON.parse(readFileSync(join(directory,'manifest.json')));
  assert.deepEqual(manifest.reservedIdentities.find(r=>r[0]===childBlock),[childBlock,reading,childBlock,old]);
  f.metadata.cards.new.aliases = [childBlock];
  assert.throws(()=>f.release('stolen',directory),/归属不符/);
});

test('a supplement title can change while its text, parent fixed fields, relations and native body hash are preserved', t=>{
  const f = publish(t);
  const prior = f.release('v1'), before = f.open(prior);
  const oldCard = before.dispatch('get',{id:old}), oldChild = before.dispatch('get-document',{id:reading});
  f.edit(oldPath,f.main,f.article.replace('title: 附录','title: 新的补读标题'),editedAt);
  delete f.main.rawEdit.fixedFields;
  f.edit(readingPath,f.child,f.readingRaw,editedAt);
  const after = f.open(f.release('v2',prior));
  const card = after.dispatch('get',{id:old});
  assert.deepEqual(card,{...oldCard,readings:[{...oldCard.readings[0],title:'新的补读标题'}]});
  const child = after.dispatch('get-document',{id:reading});
  assert.equal(child.title,'新的补读标题');
  assert.equal(child.updated,editedAt);
  assert.equal(child.markdown,oldChild.markdown);
  assert.equal(child.html,oldChild.html);
  assert.notEqual(child.revision,oldChild.revision);
});

test('a changed fixed field requires a complete typed projection and verifiable original section IDs', t=>{
  const f = publish(t);
  const prior = f.release('v1');
  const text = '逐段核对后的解释。';
  f.edit(oldPath,f.main,f.article.replace('旧解释。',text),editedAt);
  delete f.main.rawEdit.fixedFields;
  assert.throws(()=>f.release('missing-fields',prior),/完整 fixedFields/);
  const projection = {content:{...f.main.content,description:text},sections:[]};
  f.main.rawEdit.fixedFields = projection;
  assert.throws(()=>f.release('missing-section',prior),/完整当前章节/);
  projection.sections.push({id:block,key:'description',markdown:text});
  projection.content.description = '另一段话';
  assert.throws(()=>f.release('wrong-value',prior),/字段值与当前章节不符/);
  projection.content.description = text;
  const reader = f.open(f.release('v2',prior)), card = reader.dispatch('get',{id:old});
  assert.equal(card.schema,1);
  assert.equal(card.hashSource,'raw-markdown');
  assert.equal(card.hash,hash(card.markdown));
  assert.equal(card.summary,text);
  assert.deepEqual(card.content,projection.content);
  assert.deepEqual(card.relations,f.oldGet.relations);
  assert.deepEqual(card.sections.find(s=>s.id===block),{id:block,key:'description',markdown:text,hash:hash(text)});
  assert.match(reader.dispatch('get-document',{id:block}).html,new RegExp('id="'+block+'"'));
});

test('quoted or reordered YAML leaves the frozen and authored dates, list order and public output unchanged', t=>{
  const f = publish(t);
  const prior = f.release('v1'), before = f.open(prior);
  const format = text => text.replace('name: 旧卡\nsiyuan_id: '+old,'siyuan_id: "'+old+'"\nname: "旧卡"');
  writeFileSync(join(f.raw,oldPath),format(f.article));
  const formatted = f.release('v2',prior), same = f.open(formatted);
  for (const command of ['get','get-document','list']) {
    const input = command==='list' ? {} : {id:old};
    assert.deepEqual(same.dispatch(command,input),before.dispatch(command,input));
  }
  f.main.rawEdit = {version:1,rawSha256:hash(format(f.article)),updated:f.main.updated};
  const declared = f.open(f.release('explicit-format',prior));
  assert.deepEqual(declared.dispatch('get',{id:old}),before.dispatch('get',{id:old}));
  assert.deepEqual(declared.dispatch('list',{}),before.dispatch('list',{}));
  f.main.rawEdit.updated = editedAt;
  assert.throws(()=>f.release('format-bumped-original',prior),/未变时须保留原日期/);
  delete f.main.rawEdit;
  const changed = f.article+'\n经过核对的新说明。';
  f.edit(oldPath,f.main,changed,editedAt);
  const authored = f.release('v3',formatted), edited = f.open(authored);
  writeFileSync(join(f.raw,oldPath),format(changed));
  const reformatted = f.open(f.release('v4',authored));
  for (const command of ['get','get-document','list']) {
    const input = command==='list' ? {} : {id:old};
    assert.deepEqual(reformatted.dispatch(command,input),edited.dispatch(command,input));
  }
  const oldDigest = f.main.rawEdit.rawSha256;
  f.main.rawEdit.rawSha256 = hash(format(changed));
  f.main.rawEdit.updated = archivedAt;
  assert.throws(()=>f.release('format-bumped-authored',authored),/未变时须保留原日期/);
  f.main.rawEdit.rawSha256 = oldDigest;
  f.main.rawEdit.updated = editedAt;
  const altered = format(changed).replace('经过核对','再次修改');
  writeFileSync(join(f.raw,oldPath),altered);
  assert.throws(()=>f.release('stale-bytes',authored),/原稿摘要/);
  f.main.rawEdit.rawSha256 = hash(altered);
  assert.throws(()=>f.release('stale-date',authored),/递增/);
});

test('a release without rawEdit must retain the previous native evidence for cards and supplements', t=>{
  const f = publish(t);
  const prior = f.release('v1');
  const quoted = f.article.replace('name: 旧卡','name: "旧卡"');
  writeFileSync(join(f.raw,oldPath),quoted);
  const previousCard = structuredClone(f.main);
  f.main.frozenDocument.rawSha256 = hash(quoted);
  f.main.frozenDocument.data.updated = f.main.updated = editedAt;
  assert.throws(()=>f.release('changed-card-freeze',prior),/原生投影/);

  Object.assign(f.main,previousCard);
  delete f.child.frozenDocument;
  assert.throws(()=>f.release('missing-supplement-freeze',prior),/原生投影/);
});

test('the actual edited supplement advances its parent date across otherwise equivalent YAML', t=>{
  const f = publish(t);
  const original = f.release('v1');
  const quoted = f.article.replace('name: 旧卡','name: "旧卡"');
  f.edit(oldPath,f.main,quoted,f.main.updated);
  delete f.main.rawEdit.fixedFields;
  f.edit(readingPath,f.child,'第一次实质更新。',editedAt,[childBlock]);
  const first = f.release('v2',original);
  assert.equal(f.open(first).dispatch('get-document',{id:old}).updated,editedAt);
  f.edit(readingPath,f.child,'第二次实质更新。',archivedAt,[childBlock]);
  f.main.rawEdit.updated = restoredAt;
  assert.throws(()=>f.release('invented-date',first),/最新改动补读的日期/);
  f.main.rawEdit.updated = archivedAt;
  const reader = f.open(f.release('v3',first));
  assert.equal(reader.dispatch('get-document',{id:old}).updated,archivedAt);
  assert.deepEqual(reader.dispatch('list',{updatedFrom:'2026-11-22'}).items.map(r=>r.id),[old]);
});
