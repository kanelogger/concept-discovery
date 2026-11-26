import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { compileContentCards, loadContentTree } from '../lib/content-cards.mjs';
import { compileContentMaterials } from '../lib/content-materials.mjs';
import { buildContentViews } from '../lib/content-views.mjs';
import { openContentStore, writeContentDatabase } from '../lib/content-store.mjs';
import { canonical } from '../lib/siyuan.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function readInput(path) {
  if (!lstatSync(path).isFile()) throw new Error('需要普通 JSON 输入文件');
  const bytes = readFileSync(path);
  return {value:JSON.parse(bytes.toString('utf8')),sha256:sha256(bytes)};
}
function inside(root, path) {
  const tail = relative(root,path);
  return !isAbsolute(tail) && tail !== '..' && !tail.startsWith('..'+sep);
}
function physicalDestination(path) {
  if (lstatSync(path,{throwIfNoEntry:false})) return realpathSync(path);
  return resolve(physicalDestination(dirname(path)),relative(dirname(path),path));
}

const historyKinds = ['sources','proposals','events'];
export function historyInventory(records) {
  return Object.fromEntries(historyKinds.map(kind => [kind,Object.fromEntries(
    records[kind].map(row => [row.id,sha256(JSON.stringify(canonical(row)))]).sort(([a],[b])=>a<b?-1:a>b?1:0)
  )]));
}

function checkHistory(required, available) {
  for (const kind of historyKinds) {
    const rows = required?.[kind];
    if (!rows || typeof rows!=='object' || Array.isArray(rows)) throw new Error('冻结清单缺少历史库存 '+kind);
    for (const [id,digest] of Object.entries(rows)) {
      if (!Object.hasOwn(available[kind],id) || available[kind][id]!==digest)
        throw new Error('已发历史记录缺失或内容变更：'+kind+'/'+id);
    }
  }
}

function inventoryDigest({libraryId,history,reservedIdentities}) {
  return sha256(JSON.stringify(canonical({libraryId,history,reservedIdentities})));
}

export function buildContent({rawRoot,metadataFile,baselineFile,output,previous}) {
  const raw = realpathSync(rawRoot), destination = resolve(output);
  if (lstatSync(destination,{throwIfNoEntry:false})) throw new Error('目标目录已存在，请使用新目录');
  if (inside(raw,physicalDestination(destination))) throw new Error('输出目录不能位于原稿目录中');
  const metadataInput=readInput(metadataFile), baselineInput=readInput(baselineFile);
  const metadata=metadataInput.value, baseline=baselineInput.value;
  if (metadata?.version!==1 || baseline?.version!==1 || typeof metadata.libraryId!=='string' ||
      !metadata.libraryId.trim() || metadata.libraryId!==baseline.libraryId) throw new Error('冻结输入的版本或知识库身份不符');
  if (metadata.origin !== undefined) {
    const origin = new URL(metadata.origin);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
      throw new Error('元数据 origin 必须是原站 HTTP(S) 源地址');
    metadata.origin = origin.origin;
  }
  if (Object.hasOwn(metadata,'previousIdentities')) throw new Error('旧身份必须从上一内容包读取');
  const priorInput=previous ? readInput(join(realpathSync(previous),'manifest.json')) : null;
  if (metadata.previousManifest !== undefined && metadata.previousManifest!==priorInput?.sha256)
    throw new Error('上一版清单缺失或与版本化元数据指定的摘要不符');
  const prior=priorInput?.value;
  if (previous && (prior?.version!==1 || prior.libraryId!==baseline.libraryId || !Array.isArray(prior.reservedIdentities)))
    throw new Error('上一版清单格式或知识库身份不符');
  if (prior) {
    const expected=prior.files?.find(file=>file.path==='knowledge.sqlite')?.sha256;
    const previousDatabase=join(previous,'knowledge.sqlite');
    if (!expected || sha256(readFileSync(previousDatabase))!==expected) throw new Error('上一版内容库与清单摘要不符');
    const store=openContentStore(previousDatabase);
    try {
      if (store.inventoryDigest!==inventoryDigest(prior)) throw new Error('上一版历史或身份库存与内容库不符');
    } finally { store.close(); }
  }
  const previousIdentities=new Map(), reserved=new Map();
  for (const entry of prior?.reservedIdentities ?? []) {
    if (!Array.isArray(entry) || entry.length!==4 || entry.some(v=>typeof v!=='string') ||
        !entry[0] || !entry[1] || previousIdentities.has(entry[0])) throw new Error('上一版保留身份表无效');
    previousIdentities.set(entry[0],entry[1]);
    reserved.set(entry[0],entry);
  }
  const tree=loadContentTree(raw,metadata,baseline,{previousIdentities});
  const sync=tree.files.get('.sync.json');
  if (sync && JSON.parse(sync.toString('utf8')).identity!==baseline.libraryId) throw new Error('冻结基线和原稿绑定的库身份不符');
  const materials=compileContentMaterials(tree,baseline);
  const history=historyInventory(materials);
  checkHistory(metadata.history,history);
  if (prior) checkHistory(prior.history,history);
  const compiled=compileContentCards(tree,metadata,materials);
  const views=buildContentViews({...compiled,origin:metadata.origin ?? 'https://local.invalid'});
  // A saved block must remain a block at the same anchor, including across an archive.
  // A reading likewise retains its parent, even when the document ID is unchanged.
  for (const {ref,id,anchor,parentId} of compiled.reservedIdentities) {
    const target=[ref,id,anchor ?? '',parentId ?? ''];
    const previousTarget=reserved.get(ref);
    if (previousTarget && previousTarget.some((v,i)=>v!==target[i])) throw new Error('历史身份的文档、块锚点或父卡发生变化：'+ref);
    reserved.set(ref,target);
  }
  const reservedIdentities=[...reserved.values()].sort(([a],[b])=>a<b?-1:a>b?1:0);
  const rawFiles=[...tree.files.keys()].sort().map(path=>[path,sha256(tree.files.get(path))]);
  const counts={cards:compiled.cards.length,readings:compiled.readings.length,sources:materials.sources.length,
    proposals:materials.proposals.length,events:materials.events.length,assetPaths:materials.assets.length,
    graphEdges:views.graph.edges.length};
  mkdirSync(dirname(destination),{recursive:true});
  const staged=mkdtempSync(join(dirname(destination),'.content-build-'));
  try {
    const dbPath=join(staged,'knowledge.sqlite');
    writeContentDatabase(dbPath,{...compiled,materials,views,inventoryDigest:inventoryDigest({libraryId:baseline.libraryId,history,reservedIdentities})});
    const files=[{path:'knowledge.sqlite',sha256:sha256(readFileSync(dbPath))}];
    mkdirSync(join(staged,'assets'));
    const written=new Map();
    for (const item of materials.assets) {
      if (!/^[a-zA-Z0-9._-]+$/.test(item.filename) || !item.filename.startsWith(item.hash) || sha256(item.bytes)!==item.hash) {
        throw new Error('附件内容与发布名称不符');
      }
      if (written.has(item.filename)) {
        if (written.get(item.filename)!==item.hash) throw new Error('附件发布路径重名');
        continue;
      }
      const path='assets/'+item.filename;
      writeFileSync(join(staged,path),item.bytes,{flag:'wx'});
      written.set(item.filename,item.hash);
      files.push({path,sha256:item.hash});
    }
    files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
    const manifest={version:1,libraryId:baseline.libraryId,inputs:{raw:sha256(JSON.stringify(rawFiles)),metadata:metadataInput.sha256,baseline:baselineInput.sha256,...(priorInput && {previousManifest:priorInput.sha256})},counts,history,reservedIdentities,files};
    writeFileSync(join(staged,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    // Reserve exactly this new name. POSIX rename alone replaces an unrelated empty directory.
    mkdirSync(destination,{mode:0o700});
    try { renameSync(staged,destination); }
    catch (error) {
      rmdirSync(destination);
      throw error;
    }
    return manifest;
  } finally {
    rmSync(staged,{recursive:true,force:true});
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try {
    const {values}=parseArgs({options:{'raw-root':{type:'string'},metadata:{type:'string'},baseline:{type:'string'},out:{type:'string'},previous:{type:'string'},help:{type:'boolean'}}});
    if (values.help) console.log('npm run build:content -- --raw-root <原稿目录> --metadata <版本化元数据.json> --baseline <历史基线.json> --out <新目录> [--previous <上次发布目录>]');
    else {
      for (const key of ['raw-root','metadata','baseline','out']) if (!values[key]) throw new Error('缺少参数 --'+key);
      const {counts}=buildContent({rawRoot:values['raw-root'],metadataFile:values.metadata,baselineFile:values.baseline,output:values.out,previous:values.previous});
      console.log(JSON.stringify(counts,null,2));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode=1;
  }
}
