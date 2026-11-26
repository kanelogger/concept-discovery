import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildContent } from '../../scripts/build-content.mjs';
import { handoffContentAuth } from '../../lib/content-auth-handoff.mjs';
import { initializeAuthStore, openAuthStore } from '../../server/auth-store.mjs';
import { openContentReader } from '../../server/content-reader.mjs';
import { openContentShareMaterials } from '../../server/content-share-materials.mjs';

export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const libraryId = 'container-drill';
const updated = '20261126090000';
export const benchmarkCardCount = 280;
export const shared = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF/0AAAAASUVORK5CYII=', 'base64');
function json(file, value) {
  const text = JSON.stringify(value);
  writeFileSync(file + '.next', text, { mode: 0o600 });
  renameSync(file + '.next', file);
  return sha(text);
}

export async function contentFixture(root, origin, {createLedger,releaseLabel=''} = {}) {
  const rawRoot = join(root,'raw'), directory = join(root,'release'), previous = join(root,'previous');
  const settings = join(root,'settings'), controlDirectory = join(root,'control'), auth = join(root,'auth');
  const databasePath = join(auth,'auth.sqlite'), cold = join(root,'cold.sqlite');
  const metadataFile = join(root,'meta.json'), baselineFile = join(root,'baseline.json');
  const credentials = {username:'container-owner',password:randomBytes(32).toString('hex')};
  const agentToken = randomBytes(32).toString('hex');
  for (const folder of [settings,controlDirectory,auth]) mkdirSync(folder,{mode:0o700});
  writeFileSync(join(settings,'agent-token'),agentToken,{mode:0o600});
  const cards = {};
  function article(id,archived=false) {
    const folder = join(rawRoot,'示例',id);
    mkdirSync(join(folder,'assets'),{recursive:true});
    writeFileSync(join(folder,'assets','shared.png'),shared);
    writeFileSync(join(folder,'article.md'),`---\nname: 合成 ${id}\n${archived?'status: archived\n':''}---\n\n## 核心理解\n\n测试 ${id}。\n\n![共享图片](assets/shared.png)\n`);
    cards[id] = {id,updated};
  }
  function compile(output,prior) {
    json(metadataFile,{version:1,libraryId,cards,readings:{},history:{sources:{},proposals:{},events:{}}});
    return buildContent({rawRoot,metadataFile,baselineFile,output,previous:prior});
  }
  for (const id of ['card-a','card-b','card-c']) article(id);
  json(baselineFile,{version:1,libraryId,sources:[],proposals:[],events:[]});
  compile(previous);
  const ledger = createLedger?.({libraryId,publicId:'card-b',publishedRelease:previous,rawRoot});
  article('card-a',true);
  rmSync(join(rawRoot,'示例','card-b'),{recursive:true});
  delete cards['card-b'];
  // One deterministic ring gives the precomputed graph real edges at corpus scale.
  const benchId = i => 'bench-' + String(i).padStart(3,'0');
  for (let i=0;i<benchmarkCardCount;i++) {
    const id=benchId(i), next=benchId((i+1)%benchmarkCardCount), folder=join(rawRoot,'示例',id);
    mkdirSync(folder);
    const releaseNote=i===0 && releaseLabel ? '\n\n合成发布版本 '+releaseLabel+'。' : '';
    writeFileSync(join(folder,'article.md'),`---\nname: 性能样本 ${i}\n---\n\n## 核心理解\n\n中文检索样本。参考[相邻卡](../${next}/article.md)。${releaseNote}\n\n## 标签\n\n学科：测试\n`);
    cards[id]={id,updated};
  }
  const buildStart=performance.now();
  const manifest = compile(directory,previous);
  const buildMetrics={compileMs:Number((performance.now()-buildStart).toFixed(2)),
    databaseBytes:statSync(join(directory,'knowledge.sqlite')).size,
    assetBytes:manifest.files.filter(f=>f.path.startsWith('assets/')).reduce((sum,f)=>sum+statSync(join(directory,f.path)).size,0)};
  const asset = '/' + manifest.files.find(file=>file.path.startsWith('assets/')).path;
  const manifestSha256 = sha(readFileSync(join(directory,'manifest.json')));
  const reader = openContentReader({directory,libraryId,origin});
  let materialDigest;
  try { materialDigest = openContentShareMaterials(join(directory,'share-materials'),reader).digest; }
  finally { reader.close(); }
  await initializeAuthStore({databasePath},credentials);
  const store = openAuthStore({databasePath});
  let session;
  const links = {};
  try {
    session = await store.login(credentials);
    for (const id of ['card-a','card-b','card-c']) {
      const content = {title:id,html:`<p>旧分享 ${id}</p>`};
      const preview = {title:id,description:'合成旧分享',cover:{type:'image/png',bytes:shared}};
      if (id==='card-c') {
        const priorToken=store.shares.createWithPreview(id,0,content,preview);
        links.revoked={token:priorToken,previewId:store.shares.previewFor(priorToken).id};
        if (!store.shares.revoke(id,priorToken)) throw new Error('合成保留卡的第一条分享未能撤销');
      }
      const token = store.shares.createWithPreview(id,store.shares.state(id).generation,content,preview);
      links[id] = {token,previewId:store.shares.previewFor(token).id};
    }
  } finally { store.close(); }
  const opts = {libraryId,directory,databasePath,controlDirectory,manifestSha256,offline:true,sourceSha256:sha(readFileSync(databasePath))};
  let generation = 0;
  function control(state,authIdentity) {
    generation++;
    const review=ledger?.read();
    const deletions=review?.deletions ?? {version:1,libraryId,deletedIds:['card-b']};
    if (deletions.libraryId!==libraryId || JSON.stringify(deletions.deletedIds)!=='["card-b"]') throw new Error('合成账本与已核实的删除目标不符');
    const approvedSha256 = json(join(controlDirectory,'approved.json'),{version:1,libraryId,generation,state,authIdentity,
      readerContract:1,manifestSha256,materialDigest,activeIds:Object.keys(cards).filter(id=>id!=='card-a'),archivedIds:['card-a']});
    const deletionsSha256 = json(join(controlDirectory,'deletions.json'),deletions);
    if (review && review.deletionsSha256!==deletionsSha256) throw new Error('签名账本与落盘的删除清单摘要不符');
    const checkpointSha256 = json(join(controlDirectory,'checkpoint.json'),{version:1,libraryId,generation,approvedSha256,deletionsSha256});
    return {...opts,checkpointSha256,deletionsSha256,ledgerHead:review?.ledgerHead};
  }
  let identity = handoffContentAuth('bind',control('closed',null));
  copyFileSync(databasePath,cold);
  const closed = control('closed',identity);
  handoffContentAuth('reconcile',closed);
  function configure(pin,contentDigest=manifestSha256) {
    json(join(settings,'service.json'),{backend:'content',publicUrl:origin,host:'0.0.0.0',port:3000,libraryId,
      manifestSha256:contentDigest,checkpointSha256:pin,contentRelease:'/content',controlDirectory:'/control',authDirectory:'/auth',
      agentTokenFile:'agent-token',auth:{mode:'required',databaseFile:'auth.sqlite'}});
  }
  configure(closed.checkpointSha256);
  return {directory,previous,auth,settings,controlDirectory,asset,agentToken,buildMetrics,credentials,links,cookie:`__Host-cd-session=${session.token}`,
    close() { const decision=control('closed',identity); configure(decision.checkpointSha256); return decision; },
    open(selectedDirectory=directory) {
      const decision=control('open',identity);
      configure(decision.checkpointSha256,sha(readFileSync(join(selectedDirectory,'manifest.json'))));
      return decision;
    },
    mountCold() { copyFileSync(cold,databasePath); },
    restore() {
      // Caller has stopped all auth writers. Only this run's cold file is used.
      const review = control('closed',identity);
      copyFileSync(cold,databasePath);
      const rotated = handoffContentAuth('restore',review);
      if (rotated.volumeId!==identity.volumeId || rotated.generation===identity.generation) throw new Error('认证恢复代次没有更新');
      identity = rotated;
    }};
}
