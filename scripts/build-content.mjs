import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { compileContentCards, loadContentTree, nativeProjectionDigest } from '../lib/content-cards.mjs';
import { compileContentMaterials } from '../lib/content-materials.mjs';
import { buildContentViews } from '../lib/content-views.mjs';
import { inventoryDigest, openContentStore } from '../lib/content-store.mjs';
import { writeContentDatabase } from '../lib/content-database-writer.mjs';
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

const digest = value => sha256(JSON.stringify(canonical(value)));

function verifyNativeBase(store, record, main, url) {
  const native = store.nativeEvidence(record.id);
  // Older packages predate the full private-input digest. They still contain
  // the exact two public projections and the verified native block locators.
  const origin = nativeProjectionDigest(record);
  const locators = (record.blocks ?? []).map(({id,markdown})=>({id,markdown}));
  const trusted = native && (native.sha256 ? native.sha256 === origin : digest(locators) === digest(native.blocks));
  const expected = [record.frozenDocument?.data,record.frozenGet?.data];
  if (!trusted || digest(expected) !== digest([store.document(record.id,url),main ? store.card(record.id,url) : undefined]))
    throw new Error('与上版核实的原生投影不符：' + record.id);
  return origin;
}

// The store contains only active rows. A sealed, content-free receipt lets a
// previously verified archived document return, including an unchanged child
// whose parent was hidden for several releases.
function checkRawEdits(metadata, prior, store) {
  const documents = new Map(Object.entries(prior?.authoredDocuments ?? {}));
  const originalShapes = new Map();
  let checkedReady = false;
  let reseal = false;
  function prove(record, main) {
    if (!checkedReady) {
      store.assertCommandReady();
      checkedReady = true;
    }
    return verifyNativeBase(store,record,main,metadata.origin ?? 'https://local.invalid');
  }
  const records = [[metadata.cards,true],[metadata.readings,false]];
  for (const [group, main] of records) {
    for (const record of Object.values(group ?? {})) {
      const id = record?.id, edit = record?.rawEdit, last = documents.get(id);
      const native = store && typeof id === 'string' ? store.nativeEvidence(id) : null;
      if (native?.sha256 && native.sha256 !== nativeProjectionDigest(record))
        throw new Error('与上版核实的原生投影不符：' + id);
      if (native && (!native.sha256 || !native.shape)) {
        if (edit !== undefined || !metadata.previousManifest)
          throw new Error('上版缺少原稿语义摘要；请固定 previousManifest，用未改原稿及原冻结输入先重封基线：' + id);
        prove(record,main);
        reseal = true;
      }
      const originalShape = last?.originalShape ?? (metadata.previousManifest && native?.sha256 ? native.shape : undefined);
      if (originalShape) originalShapes.set(id,originalShape);
      if (edit === undefined) {
        if (last?.change) throw new Error('已发布的原稿投影缺少 rawEdit：' + id);
        if (last && nativeProjectionDigest(record) !== last.origin)
          throw new Error('归档前核实的原始冻结投影发生变化：' + id);
        continue;
      }
      if (!store || !metadata.previousManifest) throw new Error('rawEdit 需要 --previous 和已固定的 previousManifest');
      const document = record.frozenDocument?.data, get = record.frozenGet?.data;
      if (!document || main !== Boolean(get) || !edit) throw new Error('rawEdit 缺少原始冻结投影：' + id);
      const origin = last ? nativeProjectionDigest(record) : prove(record,main);
      if (last && origin !== last.origin) throw new Error('rawEdit 原始冻结投影发生变化：' + id);
      const {rawSha256,updated,...declaration} = edit;
      if (Array.isArray(declaration.retiredBlockIds ?? []))
        declaration.retiredBlockIds = [...(declaration.retiredBlockIds ?? [])].sort();
      if (Array.isArray(declaration.fixedFields?.sections)) {
        declaration.fixedFields = {...declaration.fixedFields,sections:[...declaration.fixedFields.sections]
          .sort((a,b)=>String(a?.id).localeCompare(String(b?.id),'en'))};
      }
      documents.set(id,{origin,change:digest(declaration),updated,originalShape});
    }
  }
  const proofs = Object.fromEntries(documents);
  return {
    proofs,originalShapes,reseal,
    archive(tree) {
      if (!store) return;
      const paths = new Set(tree.cards.filter(card=>card.metadata.status === 'archived')
        .flatMap(card=>[card.path,...card.readings.map(child=>child.path)]));
      if (!paths.size) return;
      for (const [group,main] of records) {
        for (const record of Object.values(group ?? {})) {
          if (!record.frozenDocument || Object.hasOwn(proofs,record.id) ||
              !paths.has(tree.byDocument.get(record.id)?.path)) continue;
          // An older already-archived package can lack both an active row and
          // this receipt. Its identity remains reserved without inventing proof.
          if (store.nativeEvidence(record.id)) {
            proofs[record.id] = {origin:prove(record,main),updated:record.frozenDocument.data.updated,
              originalShape:store.nativeEvidence(record.id).shape};
          }
        }
      }
    },
  };
}

export function buildContent({rawRoot,metadataFile,baselineFile,output,previous,resealManifest}) {
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
  const previousRoot=previous ? realpathSync(previous) : null;
  const priorInput=previousRoot ? readInput(join(previousRoot,'manifest.json')) : null;
  if (resealManifest !== undefined) {
    if (!priorInput || priorInput.sha256!==resealManifest) throw new Error('重封所指定的上版清单摘要不符');
    const inputs = priorInput.value.inputs;
    if (metadataInput.sha256!==inputs?.metadata || baselineInput.sha256!==inputs?.baseline)
      throw new Error('重封需要与上版清单完全一致的冻结元数据和历史文件');
    // The old metadata may itself pin an even earlier release. Its bytes
    // stay sealed. This operation uses the independently specified parent.
    metadata.previousManifest = resealManifest;
  } else if (metadata.previousManifest !== undefined && metadata.previousManifest!==priorInput?.sha256)
    throw new Error('上一版清单缺失或与版本化元数据指定的摘要不符');
  const prior=priorInput?.value;
  if (previous && (prior?.version!==1 || prior.libraryId!==baseline.libraryId || !Array.isArray(prior.reservedIdentities)))
    throw new Error('上一版清单格式或知识库身份不符');
  const previousIdentities=new Map(), reserved=new Map();
  for (const entry of prior?.reservedIdentities ?? []) {
    if (!Array.isArray(entry) || entry.length!==4 || entry.some(v=>typeof v!=='string') ||
        !entry[0] || !entry[1] || previousIdentities.has(entry[0])) throw new Error('上一版保留身份表无效');
    previousIdentities.set(entry[0],entry[1]);
    reserved.set(entry[0],entry);
  }
  let authoredDocuments,rawDigest;
  function prepare(store) {
    const edits = checkRawEdits(metadata,prior,store);
    if (edits.reseal && !resealManifest) throw new Error('上版缺少语义摘要；请用未改原稿及原冻结输入加 --reseal 重封基线');
    const tree = loadContentTree(raw,metadata,baseline,{previousIdentities,previousTargets:reserved,
      authoredDocuments:edits.proofs,previousAuthored:prior?.authoredDocuments,originalShapes:edits.originalShapes});
    const rawFiles=[...tree.files.keys()].sort().map(path=>[path,sha256(tree.files.get(path))]);
    rawDigest = sha256(JSON.stringify(rawFiles));
    if (resealManifest && rawDigest !== prior.inputs?.raw) throw new Error('重封基线需要与上版清单完全一致的未改原稿');
    edits.archive(tree);
    if (Object.keys(edits.proofs).length) authoredDocuments = edits.proofs;
    return tree;
  }
  let tree;
  if (prior) {
    const expected=prior.files?.find(file=>file.path==='knowledge.sqlite')?.sha256;
    const previousDatabase=join(previousRoot,'knowledge.sqlite');
    if (!expected || !lstatSync(previousDatabase).isFile() ||
        ['-wal','-shm','-journal'].some(suffix=>lstatSync(previousDatabase+suffix,{throwIfNoEntry:false})) ||
        sha256(readFileSync(previousDatabase))!==expected) throw new Error('上一版内容库未封存或与清单摘要不符');
    const store=openContentStore(previousDatabase);
    try {
      if (store.inventoryDigest!==inventoryDigest(prior)) throw new Error('上一版历史或身份库存与内容库不符');
      tree = prepare(store);
    } finally { store.close(); }
  } else tree = prepare();
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
  const counts={cards:compiled.cards.length,readings:compiled.readings.length,sources:materials.sources.length,
    proposals:materials.proposals.length,events:materials.events.length,assetPaths:materials.assets.length,
    graphEdges:views.graph.edges.length};
  mkdirSync(dirname(destination),{recursive:true});
  const staged=mkdtempSync(join(dirname(destination),'.content-build-'));
  try {
    const dbPath=join(staged,'knowledge.sqlite');
    writeContentDatabase(dbPath,{...compiled,materials,views,inventoryDigest:inventoryDigest({libraryId:baseline.libraryId,history,reservedIdentities,authoredDocuments})});
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
    const manifest={version:1,libraryId:baseline.libraryId,inputs:{raw:rawDigest,metadata:metadataInput.sha256,baseline:baselineInput.sha256,...(priorInput && {previousManifest:priorInput.sha256})},counts,history,reservedIdentities,...(authoredDocuments && {authoredDocuments}),files};
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
    const {values}=parseArgs({options:{'raw-root':{type:'string'},metadata:{type:'string'},baseline:{type:'string'},out:{type:'string'},previous:{type:'string'},reseal:{type:'string'},help:{type:'boolean'}}});
    if (values.help) console.log('npm run build:content -- --raw-root <原稿目录> --metadata <版本化元数据.json> --baseline <历史基线.json> --out <新目录> [--previous <上次发布目录>] [--reseal <已核准的旧版清单 SHA-256>]');
    else {
      for (const key of ['raw-root','metadata','baseline','out']) if (!values[key]) throw new Error('缺少参数 --'+key);
      const {counts}=buildContent({rawRoot:values['raw-root'],metadataFile:values.metadata,baselineFile:values.baseline,output:values.out,previous:values.previous,resealManifest:values.reseal});
      console.log(JSON.stringify(counts,null,2));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode=1;
  }
}
