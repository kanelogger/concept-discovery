// Owner-side, one-time handoff between the authoring and deployed SiYuan libraries.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { parseDocument } from 'yaml';
import { documentTags } from '../lib/card-list.mjs';
import { documentMarkdown, documentRevision, markdownEquivalent } from '../lib/documents.mjs';
import { compileRawCard, loadRawFiles, loadRawTree } from '../lib/raw-format.mjs';
import { rawLegacyMeta } from '../lib/raw-write.mjs';
import { canonical, deletedAttr, hash } from '../lib/siyuan.mjs';
import { readArchiveApproval } from './frozen-archives.mjs';
import { sealRawBindings } from './raw-sync.mjs';

const excluded = ['cd0064-acceptance-keeper','cd0064-acceptance-target'];
const nativeId = /^\d{14}-[a-z0-9]{7}$/;
const encoded = value => JSON.stringify(value,null,2) + '\n';
const digest = value => hash(canonical(value));
const same = (a,b) => isDeepStrictEqual(canonical(a),canonical(b));
const fileSetHash = files => hash([...files.keys()].sort().map(path=>[path,hash(files.get(path))]));
const check = (ok, reason) => { if (!ok) throw new Error(reason); };
const keysEqual = (left,right) => same([...left].sort(),[...right].sort());
const urlPath = path => path.split('/').map(encodeURIComponent).join('/').replaceAll('(','%28').replaceAll(')','%29');

function repoRaw(repo, commit) {
  check(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit),'需指定核准提交的完整对象 ID');
  const git = (args, input) => execFileSync('git',['-C',repo,...args],{input,maxBuffer:256*1024*1024});
  check(git(['rev-parse','--show-toplevel']).toString().trim()===realpathSync(repo) &&
    git(['cat-file','-t',commit]).toString().trim()==='commit','需要仓库根和提交对象');
  const entries = git(['ls-tree','-rz',commit,'--','raw']).toString('utf8').split('\0').filter(Boolean).map(row=>{
    const m = /^100644 blob ([a-f0-9]+)\traw\/(.+)$/u.exec(row);
    check(m && !m[2].split('/').some(p=>!p || p==='..' || p==='.'),'原稿 Git 路径或对象类型不符');
    return {id:m[1],path:m[2].normalize('NFC')};
  });
  check(entries.length>0,'所选提交无受管原稿');
  const batch = git(['cat-file','--batch'],entries.map(e=>e.id).join('\n')+'\n');
  const files = new Map();
  let at=0;
  for (const {id,path} of entries) {
    const end = batch.indexOf(10,at);
    const header = end>=at && /^([a-f0-9]+) blob (\d+)$/.exec(batch.toString('ascii',at,end));
    check(header && header[1]===id && !files.has(path),'Git 原稿批次的对象或路径不符');
    at=end+1;
    const size=Number(header[2]);
    check(Number.isSafeInteger(size) && batch[at+size]===10,'不完整的原稿对象');
    files.set(path,batch.subarray(at,at+size));
    at+=size+1;
  }
  check(at===batch.length,'原稿批次尾部不符');
  return files;
}

// Replace just the scalar. The authored body, including literal occurrences of the old ID, stays byte-exact.
function projectedArticle(bytes, originalId, targetId) {
  const text=bytes.toString('utf8');
  const header=/^(\uFEFF?---[^\S\r\n]*\r?\n)([\s\S]*?)\r?\n---[^\S\r\n]*(?:\r?\n|$)/.exec(text);
  check(header && nativeId.test(originalId) && nativeId.test(targetId),'原稿缺少可核对的文档身份');
  const field=parseDocument(header[2]).get('siyuan_id',true);
  check(field?.value===originalId && field.range,'原稿原生 ID 与作者绑定不符');
  const from=header[1].length+field.range[0], to=header[1].length+field.range[1];
  return Buffer.from(text.slice(0,from)+targetId+text.slice(to));
}

function checkedNative(bound, native, desired, rawHash, parent) {
  check(native && native.id===bound.remoteId && nativeId.test(native.id) && native.parent===parent &&
    bound.parent===parent && !bound.archived && !bound.archiveOp && !bound.forceApply && !bound.reserved &&
    !bound.needsSync && !native.attrs[deletedAttr],'目标原生文档、父卡或结算状态不符');
  check(native.revision===documentRevision(native) && native.revision===bound.revision &&
    (!bound.updated || native.attrs.updated===bound.updated),'目标原生修订与已结算绑定不符');
  // The settled raw-sync binding links the authored byte hash and the exact
  // target-specific render to this native revision, including kernel normalization.
  check(rawHash===bound.rawHash && digest({title:desired.title,markdown:desired.markdown})===bound.desiredHash &&
    desired.title===native.title && native.markdown===documentMarkdown(native.raw) &&
    markdownEquivalent(desired.markdown,native.markdown) && same(documentTags(desired.markdown),documentTags(native.markdown)),'原稿、目标正文摘要、标题或标签不符');
  const legacyMeta = native.attrs['custom-cd-meta'] && rawLegacyMeta(JSON.parse(native.attrs['custom-cd-meta']));
  check((bound.legacyId??'')===(native.legacyId??'') && (native.legacyId??'')===(native.attrs['custom-cd-legacy-id']??'') &&
    (!bound.legacyMeta || same(bound.legacyMeta,legacyMeta)) && legacyMeta?.lifecycle_status!=='archived','历史别名或元数据不符');
  const blocks = new Map(native.blocks.map(block=>[block.id,block]));
  check(blocks.size===native.blocks.length && [...blocks.keys()].every(id=>nativeId.test(id)) &&
    Object.entries(bound.anchors??{}).every(([id,v])=>blocks.has(id) && hash(blocks.get(id).markdown)===v.sha256),
  '原生块或标签锚点的归属、摘要不符');
}

function checkedMaterials(tree, origin, settled, inventory, exportedSources) {
  const nativeAssets = new Map(inventory.assets.map(a=>[a.path,a.sha256]));
  check(keysEqual(tree.assets,Object.keys(settled.assets)) && keysEqual(tree.assets,Object.keys(origin.assets)) &&
    nativeAssets.size===inventory.assets.length &&
    keysEqual(new Set(Object.values(settled.assets).map(a=>a.remotePath)),nativeAssets.keys()),'目标附件库存不符');
  for (const path of tree.assets) {
    const b=settled.assets[path], sha=hash(tree.files.get(path));
    check(b.sha256===sha && nativeAssets.get(b.remotePath)===sha && origin.assets[path].sha256===sha,'附件内容不符');
  }
  const sources=new Map(inventory.sources.map(s=>[s.id,s]));
  check(sources.size===inventory.sources.length && keysEqual(tree.sourceFiles,Object.keys(settled.sources)) &&
    keysEqual(tree.sourceFiles,Object.keys(origin.sources)), '来源归属不符');
  const sourcesByPath = Object.create(null);
  for (const path of tree.sourceFiles) {
    const binding=settled.sources[path], record=sources.get(binding.id);
    check(record && record.markdown===(tree.byPath.get(path)?.markdown??tree.files.get(path).toString('utf8')) &&
      binding.digest===digest(record) && record.hash===hash(record.markdown) && record.hash===binding.hash &&
      record.createdAt===binding.createdAt,'来源正文、快照或绑定摘要不符');
    const {markdown,...metadata}=record;
    check(same(metadata,origin.sources[path]) && (!tree.sourceMetadata.has(path)||same(metadata,tree.sourceMetadata.get(path))),
      '来源旁注与原始版本不符');
    // raw export records snapshot metadata; raw-sync's private digest authenticates the
    // complete record above and is not a field of the snapshot consumed by build:content.
    const exported = exportedSources.get(binding.id);
    check(same(metadata, exported), '原生导出与目标来源快照不符');
    sourcesByPath[path] = exported;
  }
  const relations=new Map(inventory.relations.map(r=>[String(r.id),r]));
  check(relations.size===inventory.relations.length && keysEqual(relations.keys(),Object.keys(settled.relations)) &&
    origin.relations.length===relations.size && new Set(origin.relations.map(r=>String(r.id))).size===relations.size &&
    origin.relations.every(r=>same(r,relations.get(String(r.id))) &&
      same(settled.relations[r.id],{id:String(r.id),digest:digest(r)})),'结构化关系不符');
  return sourcesByPath;
}

function checkNativeExport(root, inventory) {
  const tree=loadRawTree(root), sync=JSON.parse(tree.files.get('.sync.json'));
  const resealed=sealRawBindings(tree,structuredClone(sync));
  const cards=new Map(inventory.cards.map(card=>[card.id,card]));
  check(sync.version===1 && sync.identity===inventory.identity && same(resealed,sync) &&
    keysEqual(tree.cards.map(c=>c.id),Object.keys(sync.cards)) &&
    keysEqual(tree.cards.map(c=>c.metadata.siyuan_id),cards.keys()),'原生导出的身份、活动库存或原稿摘要不符');
  for (const c of tree.cards) {
    const b=sync.cards[c.id], n=cards.get(c.metadata.siyuan_id);
    check(b.remoteId===n.id && b.path===c.path && b.revision===n.revision && c.name===n.title &&
      same(c.readings.map(r=>sync.readings[r.path]?.remoteId),n.readings.map(r=>r.id)) &&
      c.readings.every((r,i)=>sync.readings[r.path].parent===n.id && sync.readings[r.path].revision===n.readings[i].revision),
    '原生导出与独立库存的文档、修订或补读不符');
  }
  check(keysEqual(tree.readingPaths,Object.keys(sync.readings)) && keysEqual(tree.assets,Object.keys(sync.assets)) &&
    keysEqual(tree.sourceFiles,Object.keys(sync.sources)) && same(sync.relations,inventory.relations),'原生导出清单不全');
  const nativeSources=new Map(inventory.sources.map(s=>[s.id,s]));
  check(keysEqual(Object.values(sync.sources).map(s=>s.id),nativeSources.keys()) && [...tree.sourceFiles].every(path=>{
    const meta=sync.sources[path], source=nativeSources.get(meta.id);
    return same({...meta,markdown:tree.files.get(path).toString('utf8')},source);
  }),'原生导出的原文或版本不符');
  const assets=new Map(inventory.assets.map(a=>[a.path,a.sha256]));
  check(keysEqual(Object.values(sync.assets).map(a=>a.remotePath),assets.keys()) && [...tree.assets].every(path=>{
    const asset=sync.assets[path];
    return hash(tree.files.get(path))===asset.sha256 && assets.get(asset.remotePath)===asset.sha256;
  }),'原生导出的附件不符');
  const sourceFields = ['id', 'sourceId', 'title', 'author', 'url', 'createdAt', 'version', 'hash'];
  const sources = new Map();
  for (const metadata of Object.values(sync.sources)) {
    check(keysEqual(Object.keys(metadata), sourceFields), '原生导出来源字段不符');
    sources.set(metadata.id, metadata);
  }
  return { nativeExportSha256: fileSetHash(tree.files), sources };
}

export function projectDeploymentRaw({repo,commit,bindingsFile,inventoryFile,exportRoot,libraryId,archiveApproval,approvalSha256,output}) {
  const git=repoRaw(repo,commit), author=loadRawFiles(git);
  const origin=JSON.parse(git.get('.sync.json'));
  const bindingBytes=readFileSync(bindingsFile), inventoryBytes=readFileSync(inventoryFile);
  const settled=JSON.parse(bindingBytes), native=JSON.parse(inventoryBytes);
  check(libraryId && origin.version===1 && origin.identity && origin.identity!==libraryId &&
    settled.version===1 && settled.identity===libraryId && native.identity===libraryId,'作者或目标库身份不符');
  const { nativeExportSha256, sources: exportedSources } = checkNativeExport(exportRoot,native);
  const approval=readArchiveApproval(archiveApproval,approvalSha256,libraryId);
  const archives=new Map(approval.archives.map(a=>[a.rawId,a]));
  const cards=new Map(native.cards.map(card=>[card.id,card]));
  const archivedIds=new Set(approval.archives.map(a=>a.documentId));
  check(cards.size===native.cards.length && [...archives].every(([slug,a])=>!author.byId.has(slug) && !cards.has(a.documentId) &&
    (!Object.hasOwn(settled.cards,slug) || settled.cards[slug].remoteId===a.documentId)),'归档与活动身份冲突');
  const removed=author.cards.filter(c=>!Object.hasOwn(settled.cards,c.id));
  check(keysEqual(removed.map(c=>c.id),excluded) && removed.every(c=>!origin.cards[c.id] && !c.metadata.siyuan_id),
    '未绑定原稿超出本次核准的两张合成卡');
  const active=author.cards.filter(c=>Object.hasOwn(settled.cards,c.id));
  check(keysEqual(active.map(c=>c.id),Object.keys(origin.cards)) &&
    keysEqual(active.map(c=>c.id),Object.keys(settled.cards).filter(id=>!archives.has(id))) &&
    keysEqual(active.map(c=>settled.cards[c.id].remoteId),cards.keys()),'活动原稿、目标绑定和原生库存未逐一覆盖');
  const skip=removed.map(c=>dirname(c.path)+'/');
  const files=new Map([...git].filter(([path])=>path!=='.sync.json' && !skip.some(dir=>path.startsWith(dir))));
  const target={version:1,identity:libraryId,cards:Object.create(null),readings:Object.create(null),
    assets:settled.assets,sources:{},relations:origin.relations};
  const urls={cardUrl:id=>'/cards/'+settled.cards[id].remoteId, readingUrl:p=>'/cards/'+settled.readings[p].remoteId,
    sourceUrl:p=>'/wiki?source='+settled.sources[p].id, assetUrl:p=>urlPath(settled.assets[p].remotePath)};
  for (const c of active) {
    const a=origin.cards[c.id], b=settled.cards[c.id], n=cards.get(b.remoteId);
    check(c.metadata.status!=='archived' && a.remoteId===c.metadata.siyuan_id && a.path===c.path && (!b.path || b.path===c.path) &&
      c.hash===a.rawHash && a.portableHash===b.portableHash && same(a.anchors??{},b.anchors??{}),'原作者身份、原稿路径或便携摘要冲突');
    const render=compileRawCard(author,c,urls);
    checkedNative(b,n,render,c.hash);
    check(same(c.readings.map(r=>settled.readings[r.path]?.remoteId),n.readings.map(r=>r.id)),'原生补读顺序或覆盖不符');
    target.cards[c.id]={...b,path:c.path};
    for (const [i,r] of render.readings.entries()) {
      const bound=settled.readings[r.path], old=origin.readings[r.path], sha=hash(git.get(r.path));
      check(old && old.parent===a.remoteId && old.rawHash===sha && old.portableHash===bound.portableHash &&
        same(old.anchors??{},bound.anchors??{}),'补读作者或原始摘要不符');
      checkedNative(bound,n.readings[i],r,sha,n.id);
      target.readings[r.path]={...bound};
    }
    files.set(c.path,projectedArticle(git.get(c.path),a.remoteId,n.id));
  }
  check(keysEqual(Object.keys(target.readings),Object.keys(origin.readings)) && keysEqual(Object.keys(target.readings),
    Object.entries(settled.readings).filter(([,b])=>!archivedIds.has(b.parent)).map(([p])=>p)),'补读库存不完整');
  const projected=loadRawFiles(files);
  target.sources=checkedMaterials(projected,origin,settled,native,exportedSources);
  sealRawBindings(projected,target);
  for (const c of projected.cards) {
    const after=compileRawCard(projected,c,urls), b=target.cards[c.id];
    check(b.portableHash===settled.cards[c.id].portableHash && digest({title:after.title,markdown:after.markdown})===b.desiredHash &&
      after.readings.every(r=>target.readings[r.path].portableHash===settled.readings[r.path].portableHash &&
        digest({title:r.title,markdown:r.markdown})===settled.readings[r.path].desiredHash),'投影改变了目标正文或补读');
  }
  files.set('.sync.json',Buffer.from(encoded(target)));
  const receipt={version:1,commit,libraryId,authorLibraryId:origin.identity,authorRawSha256:fileSetHash(git),projectedRawSha256:fileSetHash(files),
    nativeExportSha256,settledBindingsSha256:hash(bindingBytes),nativeInventorySha256:hash(inventoryBytes),archiveApprovalSha256:approvalSha256,
    cards:active.length,readings:projected.readingPaths.size,sources:projected.sourceFiles.size,assets:projected.assets.size,
    hiddenArchives:archives.size,excluded:removed.map(c=>({slug:c.id,articleSha256:hash(git.get(c.path)),rawHash:c.hash}))};
  const parent=realpathSync(dirname(resolve(output))), dest=join(parent,resolve(output).split('/').pop());
  const root=realpathSync(repo);
  check(!['raw','.git'].some(name=>dest===join(root,name) || dest.startsWith(join(root,name)+'/')),'输出不能写入 Git 原稿或对象库');
  const stage=mkdtempSync(join(parent,'.project-deployment-'));
  try {
    for (const [path,bytes] of files) {
      const file=join(stage,'raw',path);
      mkdirSync(dirname(file),{recursive:true,mode:0o700});
      writeFileSync(file,bytes,{flag:'wx',mode:0o600});
    }
    writeFileSync(join(stage,'projection.json'),encoded(receipt),{mode:0o600});
    mkdirSync(dest,{mode:0o700});
    try {renameSync(stage,dest);} catch(error) {rmdirSync(dest);throw error;}
  } finally {rmSync(stage,{recursive:true,force:true});}
  return receipt;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const keys=['repo','commit','bindings','inventory','export-root','library-id','archive-approval','approval-sha256','out'];
  try {
    const {values:v}=parseArgs({options:{...Object.fromEntries(keys.map(k=>[k,{type:'string'}])),help:{type:'boolean'}}});
    if (v.help) console.log('node scripts/project-deployment-raw.mjs '+keys.map(k=>'--'+k+' VALUE').join(' '));
    else {
      check(keys.every(k=>v[k]),'缺少显式投影参数');
      const result=projectDeploymentRaw({repo:v.repo,commit:v.commit,bindingsFile:v.bindings,inventoryFile:v.inventory,exportRoot:v['export-root'],
        libraryId:v['library-id'],archiveApproval:v['archive-approval'],approvalSha256:v['approval-sha256'],output:v.out});
      console.log(JSON.stringify({cards:result.cards,readings:result.readings,assets:result.assets,projectedRawSha256:result.projectedRawSha256}));
    }
  } catch {console.error('发布原稿投影未完成，请核对冻结输入、身份与目标绑定。');process.exitCode=1;}
}
