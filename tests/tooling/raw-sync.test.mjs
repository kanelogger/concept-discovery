import test from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { selectRawSyncPlan, planRawSync, applyRawSync, archiveRawCard, listRawArchives, settleRawSync, rebaseRawCard, sealRawBindings, readPendingRawSync, restrictRawSyncPlan, inspectPurgeBindings } from "../../scripts/raw-sync.mjs";
import { loadRawTree } from "../../lib/raw-format.mjs";
import { canonical,hash } from "../../lib/siyuan.mjs";

test("绑定目录不可访问时保留错误，只有不存在的待办才返回空", t => {
  const root = mkdtempSync(join(tmpdir(),"cd-binding-permission-"));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  const identity = "synthetic-library", directory = join(root,hash(identity));
  assert.equal(readPendingRawSync(root,identity),null);
  writeFileSync(directory,"not a directory");
  assert.throws(() => readPendingRawSync(root,identity),{code:"ENOTDIR"});
  if (process.getuid?.() > 0) {
    rmSync(directory);
    mkdirSync(directory,{mode:0o700});
    writeFileSync(join(directory,"pending.json"),'{"id":"pending"}');
    fs.chmodSync(directory,0);
    try {
      assert.throws(() => readPendingRawSync(root,identity),{code:"EACCES"});
    } finally {
      fs.chmodSync(directory,0o700);
    }
    assert.equal(readPendingRawSync(root,identity).id,"pending");
  }
});

function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),"cd-raw-sync-")), rawRoot=join(dir,"raw"), stateDir=join(dir,"state");
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  function put(path,body) {
    const parts=path.split("/"), file=parts.pop(), folder=join(rawRoot,...parts);
    mkdirSync(folder,{recursive:true});writeFileSync(join(folder,file),body);
  }
  put("学科/a/article.md","---\nname: 甲\nsources: [assets/s.md]\nreadings: [{title: 阅读, path: assets/r.md}]\n---\n## 核心理解\n\n参考 [[b]] 与 ![图](assets/i.png)。");
  put("学科/b/article.md","---\nname: 乙\n---\n## 核心理解\n\n参考 [[a]]。");
  put("学科/a/assets/i.png",Buffer.from([0,255,13,10]));
  put("学科/a/assets/s.md","原文\n");
  put("学科/a/assets/r.md","补充 [[b|乙]]");
  const inventory={identity:"test|demo",cards:[],assets:[],sources:[],relations:[]};
  const actions=[], receipts=new Map();
  function probe(x) {
    if (x.kind==="relation") {
      const v=inventory.relations.find(a=>String(a.id)===String(x.relationId));return v ? {digest:hash(canonical(v))} : null;
    }
    if (x.kind==="asset") {const v=inventory.assets.find(a=>a.path===x.path);return v ? {sha256:v.sha256}:null;}
    if (x.kind==="source") {const v=inventory.sources.find(a=>a.id===x.id);return v ? {id:v.id,digest:hash(canonical(v))}:null;}
    const docs=[...inventory.cards,...inventory.cards.flatMap(c=>c.readings)];
    const v=docs.find(x1=>x1.id===x.id);return v ? {id:v.id,revision:v.revision}:null;
  }
  async function rpc(method,x={}) {
    if (method==="raw-target") return inventory.identity;
    if (method==="raw-outcome") {
      const result=receipts.get(x.request.op_id);return result ? {state:"applied",result} : {state:"unstarted"};
    }
    if (method==="raw-probe") return x.items.map(probe);
    if (receipts.has(x.op_id)) return receipts.get(x.op_id);
    let result;
    if (method==="raw-document") {
      const list=x.parent ? inventory.cards.find(c=>c.id===x.parent).readings : inventory.cards;
      let item=list.find(c=>c.id===x.id);
      assert.equal(item?.revision??null,x.expected_revision);
      if(!item){item={id:x.id,readings:[]};list.push(item);}
      Object.assign(item,{title:x.title, markdown:x.markdown,revision:hash(x.markdown+actions.length)});
      result=probe(x);
    } else if (method==="raw-order-readings") {
      const card=inventory.cards.find(c=>c.id===x.id);
      assert.equal(card.revision,x.expected_revision??receipts.get(x.expected_operation)?.revision);
      card.attrs={"custom-cd-reading-order":JSON.stringify(x.readings)};
      card.revision=hash(x.readings);result={id:x.id,revision:card.revision};
    } else if(method==="raw-relation") {inventory.relations.push(x.record);result=probe({kind:"relation",relationId:x.record.id});}
    else if(method==="raw-source") {inventory.sources.push(x.record);result=probe({kind:"source",id:x.record.id});}
    else if(method==="raw-asset") {inventory.assets.push(x);result=probe({kind:"asset",path:x.path});}
    else if(method==="raw-archive") {
      const index=inventory.cards.findIndex(c=>c.id===x.id); assert.notEqual(index,-1);
      assert.equal(inventory.cards[index].revision,x.expected_revision); inventory.cards.splice(index,1);
      result={id:x.id,revision:"deleted",deleted:true};
    } else throw Error(method);
    receipts.set(x.op_id,result);actions.push(method);return result;
  }
  return {rawRoot,stateDir,inventory,put,actions,rpc,plan:()=>planRawSync({rawRoot,stateDir,inventory})};
}

test("空库用冻结资源与双向目标创建文档、补充阅读、原文及附件；失去回执后复用计划",async t=>{
  const f=fixture(t), plan=f.plan();
  assert.equal(plan.conflicts.length,0);
  f.put("学科/a/assets/s.md","随后修改的原文");
  let first=true;
  await assert.rejects(applyRawSync({...f,plan,rpc:async(m,x)=>{
    const result=await f.rpc(m,x); if (first && m==="raw-document") {first=false;throw Error("response lost");}return result;
  }}),/response lost/);
  const pending=readPendingRawSync(f.stateDir,f.inventory.identity);
  const out=await applyRawSync({...f,plan:pending});
  assert.equal(out.writes,5); assert.equal(f.actions.length,5);
  const [a,b]=f.inventory.cards;
  assert.ok(a.markdown.includes("/cards/"+b.id));assert.ok(b.markdown.includes("/cards/"+a.id));
  assert.equal(a.readings.length,1);assert.ok(a.readings[0].markdown.includes(b.id));
  assert.equal(f.inventory.sources[0].markdown,"原文\n");assert.equal(f.inventory.assets.length,1);
  f.put("学科/a/assets/s.md","原文\n");
  assert.equal(f.plan().actions.length,0);
  assert.equal((await applyRawSync({...f,plan})).writes,0);
  assert.equal(readPendingRawSync(f.stateDir,f.inventory.identity),null);
  a.revision="foreign";assert.ok(f.plan().conflicts.length);
});

test("原位绑定按原稿和目标版本跳过。冻结计划拒绝写错库和应用前的修改",async t=>{
  const f=fixture(t);
  const id="20260101010101-0000001",b="20260101010101-0000002";
  f.inventory.cards.push({id,title:"甲",revision:"rev",markdown:"老卡\n",readings:[]},{id:b,title:"乙",revision:"b",markdown:"乙",readings:[]});
  const binding=sealRawBindings(loadRawTree(f.rawRoot),{version:1,identity:f.inventory.identity,
    cards:{a:{remoteId:id,revision:"rev"},b:{remoteId:b,revision:"b"}},sources:{},assets:{},readings:{},relations:[]});
  f.put(".sync.json",JSON.stringify(binding));
  const plan=f.plan();
  assert.ok(!plan.actions.some(a=>a.kind==="cards"));assert.deepEqual(plan.conflicts,[]);
  await assert.rejects(applyRawSync({...f,plan,rpc:(m,x)=>m==="raw-target"?"other":f.rpc(m,x)}),/其他知识库/);
  f.inventory.cards[0].revision="outside";
  await assert.rejects(applyRawSync({...f,plan}),/目标已经变化/);assert.deepEqual(f.actions,[]);
});

test("显式继续只应用已预览的原稿，也不改写其他卡的基线",async t=>{
  const f=fixture(t);
  await applyRawSync({...f,plan:f.plan()});
  const oldA=f.inventory.cards.find(card=>card.title==="甲");
  const before=structuredClone(oldA);
  const a="学科/a/article.md", b="学科/b/article.md";
  f.put(a,readFileSync(join(f.rawRoot,a),"utf8")+"\n未经确认的独立原稿变更。");
  f.put(b,readFileSync(join(f.rawRoot,b),"utf8")+"\n已复核的入链变更。");
  const plan=f.plan();
  const scoped=restrictRawSyncPlan(plan,f.stateDir,(group,key)=>group==="cards" && key==="b");
  assert.deepEqual(scoped.actions.map(action=>action.key),["b"]);
  await applyRawSync({...f,plan:scoped});
  assert.deepEqual(oldA,before);
  assert.match(f.inventory.cards.find(card=>card.title==="乙").markdown,/已复核/);
  assert.deepEqual(f.plan().actions.map(action=>action.key),["a"]);
});

test("移动或移除原稿只报告，显式归档检查已绑定身份",async t=>{
  const f=fixture(t);
  await applyRawSync({...f,plan:f.plan()});
  // Remove the referencing article and its reciprocal link together.
  f.put("学科/b/article.md","---\nname: 乙\n---\n## 核心理解\n\n保留一张");
  rmSync(join(f.rawRoot,"学科/a"),{recursive:true});
  const next=f.plan();
  assert.ok(next.missing.some(x=>x.key==="a"));assert.equal(next.actions.filter(a=>a.kind==="cards").length,1);
  await applyRawSync({...f,plan:next});assert.equal(f.inventory.cards.length,2);
  const result=await archiveRawCard({...f,rawId:"a"});
  assert.equal(result.archived,true);assert.equal(f.inventory.cards.length,1);
  assert.ok(!f.plan().actions.length);
  const empty={identity:"rebuilt",cards:[],assets:[],sources:[],relations:[]};
  const rebuild=planRawSync({...f,inventory:empty});
  assert.deepEqual(rebuild.actions.filter(a=>a.kind==="cards").map(a=>a.key),["b"]);
  f.put("学科/a/article.md","---\nname: 已移除\nstatus: archived\n---\n## 核心理解\n\n已归档的内容。");
  const retained=planRawSync({...f,inventory:empty});
  assert.deepEqual(retained.actions.filter(a=>a.kind==="cards").map(a=>a.key),["b"]);
});

test("归档清单读取 Git，并按旧绑定、回执及原稿缺失区分状态", async t => {
  const f = fixture(t);
  await applyRawSync({...f, plan:f.plan()});
  const archive = await archiveRawCard({...f, rawId:"a"});
  const checkedAt = "2026-11-24T09:00:00.000Z";
  let verified = true;
  const rpc = async (method, input) => {
    if (method !== "raw-archive-evidence") return f.rpc(method, input);
    assert.deepEqual(input, { identity:f.inventory.identity, id:archive.id, op_id:archive.op_id });
    return verified ? { verified, id:archive.id, revision:archive.revision, title:"甲", archivedAt:checkedAt }
      : { verified, reason:"archive_document_mismatch" };
  };
  const marked = await listRawArchives({...f, rpc});
  assert.equal(marked[0].state, "needs-marker");
  f.put("学科/b/article.md", "---\nname: 乙\nstatus: archived\n---\n## 核心理解\n\n仅在 Git 标记。");
  const gitOnly = await listRawArchives({rawRoot:f.rawRoot});
  assert.deepEqual(gitOnly.map(({rawId,state}) => [rawId,state]), [["b", "from-raw"]]);
  rmSync(join(f.rawRoot, "学科/a"), {recursive:true});
  const [missing, uncertain] = await listRawArchives({...f, rpc});
  assert.equal(missing.state, "missing-raw");
  assert.equal(missing.title, "甲");
  assert.equal(missing.archivedAt, checkedAt);
  assert.equal(uncertain.state, "needs-review");
  verified = false;
  assert.equal((await listRawArchives({...f, rpc})).find(row => row.rawId === "a").reason, "archive_document_mismatch");
});

test("未创建的恢复保留 ID 只在实例确认空缺时可以从原稿再次恢复", async t => {
  const f = fixture(t);
  await applyRawSync({...f, plan:f.plan()});
  f.put("学科/a/article.md", "---\nname: 甲\nstatus: archived\n---\n## 核心理解\n\n保留原稿。");
  const path = join(f.stateDir, hash(f.inventory.identity), "state.json");
  const state = JSON.parse(readFileSync(path, "utf8"));
  const card = f.inventory.cards.find(item => item.id === state.cards.a.remoteId);
  Object.assign(state.cards.a, { reserved:true, revision:null });
  delete state.cards.b;
  f.put("学科/b/article.md", "---\nname: 乙\nstatus: archived\n---\n## 核心理解\n\n保留另一张原稿。");
  writeFileSync(path, JSON.stringify(state));
  assert.equal((await listRawArchives(f))[0].state, "needs-review");
  const occupied = await listRawArchives({...f,rpc(method,input) {
    if (method === "raw-probe") throw Object.assign(new Error("被库外文档占用"),{code:"outside_scope"});
    return f.rpc(method,input);
  }});
  assert.deepEqual(occupied.map(({state})=>state),["needs-review","from-raw"]);
  f.inventory.cards.splice(f.inventory.cards.indexOf(card), 1);
  assert.equal((await listRawArchives(f))[0].state, "from-raw");
});

test("线上归档未随 Git 移动目录时拒绝清理旧目录的附件", async t => {
  const f = fixture(t);
  await applyRawSync({...f, plan:f.plan()});
  const reading = f.inventory.cards.find(card=>card.title==="甲").readings[0].id;
  const archived = await archiveRawCard({...f,rawId:"a"});
  const args={stateDir:f.stateDir,identity:f.inventory.identity,rawId:"a",ids:[archived.id,reading],
    patch:{edits:new Map(),moves:new Map()}};
  assert.throws(()=>inspectPurgeBindings({...args,sourcePath:"新学科/a/article.md"}),
    {code:"content_conflict"});
  const checked = inspectPurgeBindings({...args,sourcePath:"学科/a/article.md"});
  assert.equal(checked.assets[0].path,"学科/a/assets/i.png");
});

test("归档卡和独立阅读的引用在新库显示文字，原稿恢复后重编译链接", async t => {
  const f = fixture(t);
  f.put("学科/a/article.md", "---\nname: 甲\nstatus: archived\nreadings: [{title: 阅读, path: assets/r.md}]\n---\n## 核心理解\n\n保留原稿。");
  f.put("学科/b/article.md", "---\nname: 乙\n---\n## 核心理解\n\n[[a|甲]]、[直链](../a/article.md)、[引用][a]、[阅读](../a/assets/r.md)。\n\n[a]: ../a/article.md\n");
  const planned = f.plan();
  const document = planned.actions.find(action => action.kind === "cards");
  assert.match(document.input.markdown, /甲、直链、引用、阅读/);
  assert.doesNotMatch(document.input.markdown, /\/cards\//);
  assert.deepEqual(planned.actions.filter(action => action.kind === "readings"), []);
  await applyRawSync({...f, plan:planned});
  const path = join(f.rawRoot, "学科/a/article.md");
  writeFileSync(path, readFileSync(path, "utf8").replace("status: archived\n", ""));
  const restored = f.plan();
  const update = restored.actions.find(action => action.kind === "cards" && action.key === "b");
  assert.match(update.input.markdown, /\[甲\]\(\/cards\//);
  assert.match(update.input.markdown, /\[阅读\]\(\/cards\//);
});

const originalImage = "学科/a/assets/i.png";
const refiledImage = "学科/b/assets/refiled.png";

function refileImage(f) {
  const bytes = readFileSync(join(f.rawRoot,originalImage));
  f.put(refiledImage,bytes);
  rmSync(join(f.rawRoot,originalImage));
  const article = "学科/a/article.md";
  f.put(article,readFileSync(join(f.rawRoot,article),"utf8").replace("assets/i.png","../b/assets/refiled.png"));
}

function exportedImage(f) {
  const sha256 = hash(readFileSync(join(f.rawRoot,originalImage)));
  const binding = {remotePath:"assets/original-image.png",sha256};
  return {version:1,identity:"original-library",assets:{[originalImage]:binding}};
}

for (const target of ["原库已有本机状态","重建库已有本机状态","冷备原库首次绑定"]) {
  test(`附件重新归档后保留该实例原地址与正文，重复同步零写入（${target}）`,async t=>{
    const f = fixture(t), manifest = exportedImage(f);
    const originalTarget = target !== "重建库已有本机状态";
    const exported = manifest.assets[originalImage];
    if (originalTarget) {
      f.inventory.identity = manifest.identity;
      f.inventory.assets.push({path:exported.remotePath,sha256:exported.sha256});
    }
    f.put(".sync.json",JSON.stringify(manifest));
    await applyRawSync({...f,plan:f.plan()});
    const before = JSON.stringify(f.inventory);
    const stateFile = join(f.stateDir,hash(f.inventory.identity),"state.json");
    const prior = JSON.parse(readFileSync(stateFile,"utf8"));
    if (originalTarget) Object.assign(manifest,prior,{relations:[]});
    manifest.assets = {[refiledImage]:exported};
    f.put(".sync.json",JSON.stringify(manifest));
    refileImage(f);
    if (target === "冷备原库首次绑定") rmSync(stateFile);

    const plan = f.plan();
    assert.deepEqual(plan.conflicts,[]);
    assert.deepEqual(plan.missing,[]);
    assert.deepEqual(plan.actions,[]);
    assert.equal(plan.next.assets[originalImage],undefined);
    assert.deepEqual(plan.next.assets[refiledImage],prior.assets[originalImage]);
    assert.equal((await applyRawSync({...f,plan})).writes,0);
    assert.equal(JSON.stringify(f.inventory),before);
    const second = f.plan();
    assert.deepEqual(second.missing,[]);
    assert.deepEqual(second.conflicts,[]);
    assert.equal((await applyRawSync({...f,plan:second})).writes,0);
  });
}

test("附件搬移只认唯一相同内容，保留不同内容、复制及重复哈希的原有行为",async t=>{
  const f = fixture(t), manifest = exportedImage(f), exported = manifest.assets[originalImage];
  f.inventory.identity = manifest.identity;
  f.inventory.assets.push({path:exported.remotePath,sha256:exported.sha256});
  f.put(".sync.json",JSON.stringify(manifest));
  await applyRawSync({...f,plan:f.plan()});
  const bytes = readFileSync(join(f.rawRoot,originalImage));
  f.put(refiledImage,bytes); // Both paths still exist.
  const copy = f.plan();
  assert.deepEqual(copy.missing,[]);
  assert.notEqual(copy.next.assets[refiledImage].remotePath,exported.remotePath);

  refileImage(f);
  f.put(refiledImage,"不同内容");
  assert.deepEqual(f.plan().missing,[{kind:"assets",key:originalImage}]);
  f.put(refiledImage,bytes);
  const duplicate = "学科/b/assets/duplicate.png";
  f.put(duplicate,bytes);
  const ambiguous = f.plan();
  assert.deepEqual(ambiguous.missing,[{kind:"assets",key:originalImage}]);
  assert.notEqual(ambiguous.next.assets[refiledImage].remotePath,exported.remotePath);
  rmSync(join(f.rawRoot,duplicate));

  const plan = f.plan();
  f.inventory.assets[0].sha256 = hash("库内独立修改");
  await assert.rejects(applyRawSync({...f,plan}),/目标已经变化/);
  for (const inventoryAssets of [f.inventory.assets,[]]) {
    f.inventory.assets = inventoryAssets;
    const blocked = f.plan();
    assert.deepEqual(blocked.conflicts.map(c=>[c.kind,c.key]),[["assets",refiledImage]]);
    assert.deepEqual(blocked.assetMoves ?? [],[]);
    assert.deepEqual(blocked.actions,[]);
    assert.deepEqual(blocked.missing,[]);
    assert.deepEqual(blocked.next.assets[originalImage],exported);
    assert.equal(blocked.next.assets[refiledImage],undefined);
  }
});

test("同哈希的两条旧绑定均保留，空库无已有绑定时重建一份附件",async t=>{
  const f = fixture(t), manifest = exportedImage(f), exported = manifest.assets[originalImage];
  const duplicate = "学科/a/assets/duplicate.png";
  manifest.assets[duplicate] = {...exported,remotePath:"assets/duplicate.png"};
  f.inventory.identity = manifest.identity;
  for (const b of Object.values(manifest.assets)) f.inventory.assets.push({path:b.remotePath,sha256:b.sha256});
  f.put(".sync.json",JSON.stringify(manifest));
  refileImage(f);
  const ambiguous = f.plan();
  assert.deepEqual(ambiguous.missing.map(x=>x.key).sort(),[duplicate,originalImage].sort());
  assert.equal(ambiguous.actions.filter(a=>a.method==="raw-asset").length,1);

  manifest.assets = {[refiledImage]:exported};
  f.put(".sync.json",JSON.stringify(manifest));
  f.inventory.identity = "empty-library";
  f.inventory.assets = [];
  const fresh = f.plan();
  assert.deepEqual(fresh.conflicts,[]);
  assert.deepEqual(fresh.missing,[]);
  await applyRawSync({...f,plan:fresh});
  assert.equal(f.inventory.assets.length,1);
  assert.equal(f.inventory.assets[0].sha256,exported.sha256);
  assert.notEqual(f.inventory.assets[0].path,exported.remotePath);
  assert.ok(f.inventory.cards.find(c=>c.title==="甲").markdown.includes(f.inventory.assets[0].path));
  assert.equal(f.plan().actions.length,0);
});

for (const interrupt of [false,true]) {
  test("附件搬移冻结后目标变动，结算仅撤回未通过复验的绑定" + (interrupt ? "（清理前中断重试）" : ""),async t=>{
    const f = fixture(t), manifest = exportedImage(f), exported = manifest.assets[originalImage];
    f.inventory.identity = manifest.identity;
    f.inventory.assets.push({path:exported.remotePath,sha256:exported.sha256});
    const spare = "学科/a/assets/spare.png", newSpare = "学科/b/assets/spare.png";
    f.put(spare,"另一张图片");
    f.put(".sync.json",JSON.stringify(manifest));
    await applyRawSync({...f,plan:f.plan()});
    refileImage(f);
    f.put(newSpare,readFileSync(join(f.rawRoot,spare)));
    rmSync(join(f.rawRoot,spare));
    const plan = f.plan();
    assert.deepEqual(plan.actions,[]);
    let probes = 0;
    await assert.rejects(applyRawSync({...f,plan,rpc:(method,input)=>{
      if (method==="raw-probe" && ++probes===2) f.inventory.assets[0].sha256 = hash("外部写入");
      return f.rpc(method,input);
    }}),/目标已经变化/);
    assert.ok(readPendingRawSync(f.stateDir,f.inventory.identity));
    const folder = join(f.stateDir,hash(f.inventory.identity));
    if (interrupt) {
      const unlink = fs.unlinkSync;
      const stop = t.mock.method(fs,"unlinkSync",path=>{
        if (path === join(folder,"pending.json")) throw Error("已写入状态，中断清理");
        return unlink(path);
      });
      syncBuiltinESMExports();
      try { await assert.rejects(settleRawSync(f),/已写入状态，中断清理/); }
      finally { stop.mock.restore(); syncBuiltinESMExports(); }
      assert.equal(JSON.parse(readFileSync(join(folder,"state.json"))).lastSettlement,plan.id);
      assert.equal(readPendingRawSync(f.stateDir,f.inventory.identity).id,plan.id);
    }
    const settled = await settleRawSync(f);
    assert.equal(settled.pending,false);
    assert.equal(readPendingRawSync(f.stateDir,f.inventory.identity),null);
    const state = JSON.parse(readFileSync(join(folder,"state.json")));
    assert.deepEqual(state.assets[originalImage],exported);
    assert.equal(state.assets[refiledImage],undefined);
    assert.equal(state.assets[spare],undefined);
    assert.equal(state.assets[newSpare].sha256,hash("另一张图片"));
    assert.deepEqual((settled.conflicts ?? []).map(c=>c.key),[refiledImage]);
    assert.ok(f.plan().conflicts.some(c=>c.kind==="assets" && c.key===refiledImage));
  });
}

test("同一目标互斥同步和归档；第二份零动作计划验证后不改本机基线",async t=>{
  const f=fixture(t), plan=f.plan();
  let arrived,release;
  const waiting=new Promise(r=>{arrived=r;}), gate=new Promise(r=>{release=r;});
  let first=true;
  const save=applyRawSync({...f,plan,rpc:async(m,x)=>{
    if(m==="raw-probe" && first){first=false;arrived();await gate;}
    return f.rpc(m,x);
  }});
  await waiting;
  try {
    await assert.rejects(applyRawSync({...f,plan}),/另一个本机同步/);
    await assert.rejects(archiveRawCard({...f,rawId:"a"}),/另一个本机同步/);
  } finally {release();}
  await save;
  const state=join(f.stateDir,hash(f.inventory.identity),"state.json");
  const before=statSync(state,{bigint:true});
  const next=f.plan();assert.equal(next.actions.length,0);
  await applyRawSync({...f,plan:next});
  const after=statSync(state,{bigint:true});
  assert.equal(after.ino,before.ino);assert.equal(after.mtimeNs,before.mtimeNs);
});

test("数字归档关系标识在空库及第二次同步保持原类型与身份",async t=>{
  const f=fixture(t);
  const relation={id:1,source_concept_id:"a",target_concept_id:"b",note:"引用"};
  f.put(".sync.json",JSON.stringify({version:1,identity:"previous",cards:{},relations:[relation]}));
  const plan=f.plan();
  assert.equal(plan.missing.length,0);assert.equal(plan.actions.filter(a=>a.kind==="relations").length,1);
  await applyRawSync({...f,plan});assert.deepEqual(f.inventory.relations,[relation]);
  const second=f.plan();assert.deepEqual(second.missing,[]);assert.equal(second.actions.length,0);
});

test("已绑定旧卡只改 YAML 注释或独立阅读，保留原父卡正文和旧字段",async t=>{
  const f=fixture(t), id="20260101010101-0000001";
  f.inventory.cards.push({id,title:"甲",revision:"old",markdown:"原库特有的固定布局。",readings:[],legacyFixedFields:true});
  const origin=sealRawBindings(loadRawTree(f.rawRoot),{version:1,identity:f.inventory.identity,cards:{a:{remoteId:id,revision:"old"}}});
  f.put(".sync.json",JSON.stringify(origin));
  await applyRawSync({...f,plan:f.plan()});
  const file="学科/a/article.md", before=readFileSync(join(f.rawRoot,file),"utf8");
  f.put(file,before.replace("name: 甲","# 作者注释\nname: 甲"));
  assert.ok(!f.plan().actions.length);
  f.put("学科/a/assets/r.md","独立阅读已修改");
  const next=f.plan();assert.deepEqual(next.actions.map(a=>a.kind),["readings"]);
  await applyRawSync({...f,plan:next});
  assert.equal(f.inventory.cards[0].markdown,"原库特有的固定布局。");assert.equal(f.inventory.cards[0].revision,"old");
});

test("结算保留成功写入并释放 pending；相邻卡并发变更后按审阅的 revision 继续",async t=>{
  const f=fixture(t);
  await applyRawSync({...f,plan:f.plan()});
  const a=f.inventory.cards.find(x=>x.title==="甲"), b=f.inventory.cards.find(x=>x.title==="乙");
  f.put("学科/a/assets/r.md","计划修改独立阅读。");
  f.put("学科/b/article.md","---\nname: 乙\n---\n## 核心理解\n\n新写入。");
  const plan=f.plan();
  const external=hash("reviewed external content");
  await assert.rejects(applyRawSync({...f,plan,rpc:async(m,x)=>{
    if(m==="raw-document" && x.id===b.id){
      const result=await f.rpc(m,x);
      a.markdown="库外更新";a.revision=external;
      throw Error("disconnect");
    }
    return f.rpc(m,x);
  }}),/disconnect/);
  const settled=await settleRawSync(f);
  assert.equal(settled.pending,false); assert.deepEqual(settled.applied.map(x=>x.key),["b"]);
  assert.ok(settled.unstarted.some(x=>x.kind==="readings"));
  const report=f.plan();assert.deepEqual(report.conflicts.map(x=>x.actualRevision),[external]);
  await assert.rejects(rebaseRawCard({...f,rawId:"a",revision:hash("older")}),/不符/);
  await rebaseRawCard({...f,rawId:"a",revision:external});
  const retry=f.plan();assert.equal(retry.conflicts.length,0);
  assert.deepEqual(retry.actions.map(x=>x.key),["a","学科/a/assets/r.md"]);
  await applyRawSync({...f,plan:retry});
  assert.equal(b.markdown.includes("新写入"),true);assert.ok(!f.plan().actions.length);
});

test("结算遇到尚未执行的更新已冲突，保留旧 revision 和后续显式 rebase 路径",async t=>{
  const f=fixture(t); await applyRawSync({...f,plan:f.plan()});
  f.put("学科/a/assets/r.md","后执行的阅读修改");
  f.put("学科/b/article.md","---\nname: 乙\n---\n## 核心理解\n\n先执行。");
  const r=f.inventory.cards[0].readings[0];
  const plan=f.plan();
  await assert.rejects(applyRawSync({...f,plan,rpc:async(m,x)=>{
    if(m==="raw-document" && x.id===r.id){r.markdown="其他修改";r.revision=hash(r.markdown);throw Error("revision conflict");}
    return f.rpc(m,x);
  }}),/revision conflict/);
  assert.equal((await settleRawSync(f)).pending,false);
  assert.equal(f.plan().conflicts[0].key,"学科/a/assets/r.md");
  await rebaseRawCard({...f,rawId:"学科/a/assets/r.md",revision:r.revision});
  await applyRawSync({...f,plan:f.plan()});
  assert.equal(r.markdown,"后执行的阅读修改");
});

test("原始 sidecar 的来源 A→B→C→B 复用 B 的已验证快照",async t=>{
  const f=fixture(t), file="学科/a/assets/s.md";
  const data={sourceId:"src_"+"f".repeat(32),title:"原始快照",markdown:"A",url:"",author:""};
  const record={...data,id:"src_"+hash(canonical(data)).slice(0,32),version:1,createdAt:"2025-01-01T00:00:00.000Z",hash:hash("A")};
  f.put("学科/a/assets/s.json",JSON.stringify(record));
  for (const text of ["A","B","C"]) {f.put(file,text);await applyRawSync({...f,plan:f.plan()});}
  f.put(file,"B");
  const p=f.plan();assert.deepEqual(p.conflicts,[]);assert.ok(!p.actions.some(a=>a.kind==="sources"));
  await applyRawSync({...f,plan:p});assert.equal(f.inventory.sources.length,3);
});

test("补充阅读换序只改顺序，绑定记录新的父卡 revision",async t=>{
  const f=fixture(t), path="学科/a/article.md";
  const text=readFileSync(join(f.rawRoot,path),"utf8");
  const r1="{title: 阅读, path: assets/r.md}",r2="{title: 后记, path: assets/end.md}";
  f.put("学科/a/assets/end.md","后记。"); f.put(path,text.replace(r1,r1+", "+r2));
  await applyRawSync({...f,plan:f.plan()});
  const parent=f.inventory.cards[0];const before=parent.markdown;
  f.put(path,text.replace(r1,r2+", "+r1));
  const plan=f.plan();assert.deepEqual(plan.actions.map(x=>x.method),["raw-order-readings"]);
  await applyRawSync({...f,plan});
  assert.equal(parent.markdown,before);
  assert.equal(JSON.parse(parent.attrs["custom-cd-reading-order"])[0],parent.readings.find(r=>r.title==="后记").id);
  assert.equal(f.plan().actions.length,0);
});

test("prepared 或 unknown 的写前回执沿用原请求；曾启动写入且缺少备份的回执不会重试",async t=>{
  const {Siyuan,save}=await import("../../lib/siyuan.mjs");
  const {Documents}=await import("../../lib/documents.mjs");
  const {rawWrite}=await import("../../lib/raw-write.mjs");
  const f=fixture(t), identity=f.inventory.identity, id="20260101010101-0000001";
  const api=new Siyuan({url:"http://localhost",token:"synthetic",dataDir:join(f.stateDir,"receipts")});
  api.identity=async()=>identity;api.flush=async()=>{};
  let title, writes=0;
  api.api=async(route,params)=>{assert.equal(route,"/api/filetree/renameDocByID");writes++;title=params.title;};
  t.mock.method(Documents.prototype,"snapshot",async()=>({id,title,editable:true,units:[],markdown:"",raw:"",
    revision:hash(title),signature:hash(title)}));
  for (const state of ["prepared","unknown","started"]) {
    title="旧标题";
    const op_id="raw-interruption-"+state;
    const input={id,title:"修改后的标题",markdown:"",expected_revision:hash(title),op_id};
    const full={...input,kind:"card",identity};
    const rec={command:"save-document",input,target:identity,
      requestHash:hash(canonical({command:"save-document",input,target:identity})),
      state:state==="started"?"unknown":state, ...(state==="started" && {writeStarted:true})};
    save((await api.receipt(op_id)).p,rec);
    if (state==="started") {
      await assert.rejects(rawWrite(api,"raw-document",full),{code:"operation_pending"});
      assert.equal(title,"旧标题");continue;
    }
    assert.equal((await rawWrite(api,"raw-outcome",{identity,method:"raw-document",request:full})).state,"unstarted");
    const result=await rawWrite(api,"raw-document",full);
    assert.equal(result.revision,hash("修改后的标题"));
    assert.deepEqual(await rawWrite(api,"raw-document",full),result);
    assert.equal((await api.receipt(op_id)).value.retryHistory[0].state,state);
  }
  assert.equal(writes,2);
});

test("frozen sync and single-card archive do not require an inventory", async t => {
  const f = fixture(t);
  const rpc = (method, input) => {
    assert.notEqual(method, "inventory", "unrelated inventory is unreadable");
    return f.rpc(method, input);
  };
  const { plan, pending } = await selectRawSyncPlan({...f, rpc: (method, input) =>
    method === "inventory" ? f.inventory : rpc(method, input)});
  assert.equal(pending, false);
  await assert.rejects(applyRawSync({...f, plan, rpc: async (method, input) => {
    if (method === "raw-document") throw Error("interrupted");
    return rpc(method, input);
  }}), /interrupted/);
  const frozen = await selectRawSyncPlan({...f, rpc});
  assert.equal(frozen.pending, true);
  assert.equal(frozen.plan.id, plan.id);
  await assert.rejects(archiveRawCard({...f, rawId: "a", rpc}), {code:"operation_pending"});
  await applyRawSync({...f, plan: frozen.plan, rpc});
  assert.equal((await archiveRawCard({stateDir:f.stateDir, rawId:"a", rpc})).archived, true);
});
