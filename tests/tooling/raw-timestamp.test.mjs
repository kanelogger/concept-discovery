import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hash, canonical } from '../../lib/siyuan.mjs';
import { rawWrite } from '../../lib/raw-write.mjs';
import { exportInventory } from '../../scripts/raw-export.mjs';
import { planRawSync, applyRawSync, settleRawSync } from '../../scripts/raw-sync.mjs';

const first = '20261122010101', later = '20261123020202', afterSave = '20261123030303';
const docId = first + '-aaaaaaa', childId = first + '-bbbbbbb';

function revision({title,raw,attrs}) {
  return hash(canonical({title,raw,attrs}));
}
function doc(id, title, markdown, parent) {
  const raw = markdown + '\n{: id="' + id + '"}\n';
  const attrs = {updated:first,'custom-cd-kind':parent ? 'article' : 'concept',...(parent && {'custom-cd-parent':parent})};
  const value = {id,title,raw,markdown,attrs,tags:['学科：数学'],blocks:[],readings:[]};
  return {...value,revision:revision(value)};
}
function retime(doc, updated) {
  doc.attrs.updated = updated;
  doc.revision = revision(doc);
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(),'raw-timestamp-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const rawRoot = join(root,'raw'), assetsDir = join(root,'assets'), stateDir = join(root,'state');
  const card = {...doc(docId,'甲','## 理解\n\n一段理解。'),legacyId:'first'};
  const reading = doc(childId,'补充','阅读原文。',docId);
  card.readings.push(reading);
  const inventory = {identity:'timestamp-library',cards:[card],assets:[],sources:[],relations:[]};
  await mkdir(assetsDir);
  await exportInventory({inventory,assetsDir,outputDir:rawRoot});
  const manifest = join(rawRoot,'.sync.json');
  const bindings = JSON.parse(await readFile(manifest));
  const readingPath = Object.keys(bindings.readings)[0];
  const article = join(rawRoot,bindings.cards.first.path);
  const calls = [], receipts = new Map();
  const docs = () => inventory.cards.flatMap(c=>[c,...c.readings]);
  const api = {
    c:{libraryRootId:'root'}, identity:async()=>inventory.identity, requireActivePath:async()=>{},
    inScope(id) {
      const d = docs().find(doc=>doc.id===id), parent = d.attrs['custom-cd-parent'];
      return {id,type:'d',path:'/root/' + (parent ? parent+'/' : '') + id+'.sy'};
    },
    attrs:id=>docs().find(d=>d.id===id).attrs, markdown:id=>docs().find(d=>d.id===id).raw,
    sql(query) {
      const d = docs().find(d=>query.includes("'" + d.id + "'"));
      return d ? [{...this.inScope(d.id),content:d.title}] : [];
    },
  };
  async function rpc(method,input) {
    if (method==='raw-outcome') {
      const result = receipts.get(input.request.op_id);
      return result ? {state:'applied',result} : {state:'unstarted'};
    }
    if (method!=='raw-document') return rawWrite(api,method,input);
    if (receipts.has(input.op_id)) return receipts.get(input.op_id);
    let d = docs().find(d=>d.id===input.id);
    assert.equal(d?.revision ?? null,input.expected_revision);
    if (!d) {
      d = doc(input.id,input.title,input.markdown,input.parent);
      (input.parent ? inventory.cards.find(d=>d.id===input.parent).readings : inventory.cards).push(d);
    }
    Object.assign(d,{title:input.title,markdown:input.markdown,raw:input.markdown});
    retime(d,afterSave);
    const result = {id:d.id,revision:d.revision};
    receipts.set(input.op_id,result);
    calls.push(input);
    return result;
  }
  const args = {rawRoot,stateDir,inventory,rpc};
  const plan = overrides=>planRawSync({...args,...overrides});
  const apply = plan=>applyRawSync({...args,plan});
  const state = async()=>JSON.parse(await readFile(join(stateDir,hash(inventory.identity),'state.json')));
  return {card,reading,readingPath,article,bindings,manifest,inventory,calls,args,rpc,plan,apply,state};
}

test('导出卡片和阅读绑定其原生时间；旧绑定用对应 ID 的旧时间恢复后重复同步零写入',async t=>{
  const f=await fixture(t);
  assert.equal(f.bindings.cards.first.updated,first);
  assert.equal(f.bindings.readings[f.readingPath].updated,first);
  delete f.bindings.cards.first.updated;
  await writeFile(f.manifest,JSON.stringify(f.bindings));
  retime(f.card,later);
  retime(f.reading,later);
  for (const evidence of [undefined,{[childId]:first},{[docId]:afterSave}]) {
    assert.deepEqual(f.plan({previousUpdates:evidence}).conflicts.map(c=>c.key),['first']);
  }
  const accepted = f.plan({previousUpdates:{[docId]:first}});
  assert.deepEqual(accepted.conflicts,[]);
  assert.deepEqual(accepted.actions,[]);
  assert.equal((await f.apply(accepted)).writes,0);
  const state=await f.state();
  assert.deepEqual([state.cards.first.updated,state.cards.first.revision],[later,f.card.revision]);
  assert.deepEqual([state.readings[f.readingPath].updated,state.readings[f.readingPath].revision],[later,f.reading.revision]);
  retime(f.card,afterSave);
  const second=f.plan();
  assert.deepEqual(second.conflicts,[]);
  assert.equal((await f.apply(second)).writes,0);
  assert.deepEqual(f.calls,[]);
});

test('标题、原生块或其他属性变化以及不完整或自相矛盾的 inventory 仍冲突',async t=>{
  const f=await fixture(t);
  const edits=[
    d=>{ d.title+='改'; },
    d=>{ d.raw=d.raw.replace(docId,childId); },
    d=>{ d.attrs['custom-user-flag']='独立编辑'; },
    d=>{ delete d.raw; },
    d=>{ d.raw+='\n新段落'; },
    d=>{ delete d.attrs.updated; },
  ];
  for(const edit of edits) {
    const inventory=structuredClone(f.inventory), d=inventory.cards[0];
    retime(d,later);
    edit(d);
    d.revision=revision(d);
    assert.deepEqual(f.plan({inventory}).conflicts.map(c=>c.key),['first']);
  }
  const inventory=structuredClone(f.inventory);
  retime(inventory.cards[0],later);
  inventory.cards[0].revision=hash('错误的当前版本');
  assert.deepEqual(f.plan({inventory}).conflicts.map(c=>c.key),['first']);
});

test('冻结后的时间变化仍阻止写入，重新计划按当前精确版本保存并记录写后时间',async t=>{
  const f=await fixture(t);
  retime(f.card,later);
  await writeFile(f.article,(await readFile(f.article,'utf8')).replace('一段理解','新理解'));
  const frozen=f.plan();
  assert.deepEqual(frozen.conflicts,[]);
  assert.equal(frozen.actions[0].input.expected_revision,f.card.revision);
  retime(f.card,'20261123020203');
  await assert.rejects(f.apply(frozen),{code:'content_conflict'});
  assert.deepEqual(f.calls,[]);
  const retry=f.plan();
  assert.equal(retry.actions[0].input.expected_revision,f.card.revision);
  assert.equal((await f.apply(retry)).writes,1);
  const state=await f.state();
  assert.deepEqual([state.cards.first.updated,state.cards.first.revision],[afterSave,f.card.revision]);
  retime(f.card,'20261123040000');
  assert.deepEqual(f.plan().conflicts,[]);
  assert.equal((await f.apply(f.plan())).writes,0);
});

test('空库首次新建和已有冻结计划结算均保存与回执对应的原生时间',async t=>{
  const f=await fixture(t);
  f.inventory.identity='new-library';
  f.inventory.cards=[];
  const create=f.plan();
  assert.equal((await f.apply(create)).writes,2);
  let state=await f.state();
  assert.equal(state.cards.first.updated,afterSave);
  assert.equal(state.readings[f.readingPath].updated,afterSave);

  // A pending pre-upgrade plan contains only the original exact revisions.
  await writeFile(f.article,(await readFile(f.article,'utf8')).replace('一段理解','更新理解'));
  const frozen=f.plan();
  for(const bindings of [frozen.next,frozen.previous]) for(const group of ['cards','readings']) {
    for(const b of Object.values(bindings[group] ?? {})) delete b.updated;
  }
  delete frozen.id;
  frozen.id=hash(canonical(frozen));
  await assert.rejects(applyRawSync({...f.args,plan:frozen,rpc:async(method,input)=>{
    const result=await f.rpc(method,input);
    if(method==='raw-document') throw Error('response lost');
    return result;
  }}),/response lost/);
  const settled=await settleRawSync(f.args);
  assert.equal(settled.pending,false);
  state=await f.state();
  assert.deepEqual([state.cards.first.updated,state.cards.first.revision],[afterSave,f.inventory.cards[0].revision]);
  retime(f.inventory.cards[0],'20261123040000');
  assert.deepEqual(f.plan().conflicts,[]);
  assert.equal((await f.apply(f.plan())).writes,0);
});

test('最终读回发现独立编辑时，结算不会把后来的时间记到原操作回执上',async t=>{
  const f=await fixture(t);
  await writeFile(f.article,(await readFile(f.article,'utf8')).replace('一段理解','新理解'));
  const frozen=f.plan();
  await assert.rejects(applyRawSync({...f.args,plan:frozen,rpc:async(method,input)=>{
    const result=await f.rpc(method,input);
    if(method==='raw-document') {
      f.card.attrs['custom-personal-note']='独立编辑';
      retime(f.card,'20261123040000');
    }
    return result;
  }}),{code:'content_conflict'});
  assert.equal((await settleRawSync(f.args)).pending,false);
  const state=await f.state();
  assert.notEqual(f.card.revision,state.cards.first.revision);
  assert.equal(state.cards.first.updated,undefined);
  assert.deepEqual(f.plan().conflicts.map(c=>c.key),['first']);
});
