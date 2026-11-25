import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync, linkSync, readdirSync } from "node:fs";
import { join, resolve, posix } from "node:path";
import { randomUUID } from "node:crypto";
import { hash, canonical, id as blockId, fail } from "../lib/siyuan.mjs";
import { documentRevision, markdownEquivalent, markdownChunks } from "../lib/documents.mjs";
import { loadRawTree, compileRawCard } from "../lib/raw-format.mjs";
import { sourceSnapshotId, sourceSnapshotCharLimit, sourceSnapshotByteLimit } from "../lib/wiki-store.mjs";
import { orderedReadings, readingOrderAttr } from "../lib/raw-reading-order.mjs";

const digest = value => hash(canonical(value));
const groups = ["cards","readings","assets","sources","relations"];
const safeMap = () => Object.create(null);
const statePath = (dir, identity) => resolve(dir, hash(identity));
function read(path) {
  try {
    return JSON.parse(readFileSync(path,"utf8"));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
const blank = identity => ({version:1, identity, cards:{}, readings:{}, assets:{}, sources:{}, relations:{}});
const renderHash = ({title,markdown}) => digest({title,markdown});
const safeUrl = path => path.split("/").map(encodeURIComponent).join("/").replaceAll("(", "%28").replaceAll(")", "%29");
const dataOf = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "id"));
// Each local invocation owns a unique marker. A dead process cannot leave a
// permanent lock, and reclaiming its marker never removes a successor's lock.
async function withLocalWriter(dir,identity,run) {
  const folder=statePath(dir,identity);
  mkdirSync(folder,{recursive:true,mode:0o700});
  const own = `writer-${process.pid}-${randomUUID()}.lock`;
  writeFileSync(join(folder,own),"",{flag:"wx",mode:0o600});
  try {
    for (const name of readdirSync(folder)) {
      const match = /^writer-(\d+)-[a-f0-9-]+\.lock$/.exec(name);
      if (!match || name === own) continue;
      try { process.kill(Number(match[1]),0); }
      catch (e) {
        if (e.code === "ESRCH") {
          try { unlinkSync(join(folder,name)); } catch (gone) { if (gone.code!=="ENOENT") throw gone; }
          continue;
        }
        if (e.code !== "EPERM") throw e;
      }
      fail("write_locked","另一个本机同步或归档进程正在运行。");
    }
    return await run();
  } finally { unlinkSync(join(folder,own)); }
}
function publish(path, value, exclusive = false) {
  const tmp = path + ".tmp-" + randomUUID();
  writeFileSync(tmp, JSON.stringify(value) + "\n", {mode:0o600, flag:"wx"});
  try { if (exclusive) linkSync(tmp,path); else renameSync(tmp,path); }
  finally { if (existsSync(tmp)) unlinkSync(tmp); }
}
export function baseline(raw) {
  if (!raw) return null;
  if (raw.version !== 1 || typeof raw.identity !== "string" || !raw.identity) fail("invalid_input","不支持的原稿绑定格式。");
  return raw;
}
function stored(stateDir,identity) {
  const state = read(join(statePath(stateDir,identity),"state.json"));
  if (state && (state.identity !== identity || state.version !== 1)) fail("content_conflict","本机状态与目标库不符。");
  return state;
}
export const readPendingRawSync = (stateDir,identity) => read(join(statePath(stateDir,identity),"pending.json"));
function bindingMap(bindings, group, key) {
  const map = bindings?.[group];
  return map && Object.hasOwn(map,key) ? map[key] : undefined;
}
const portable = {cardUrl:id=>"/cards/"+id, readingUrl:path=>"/readings/"+safeUrl(path),
  sourceUrl:path=>"/wiki?source="+encodeURIComponent(path), assetUrl:path=>"/assets/"+safeUrl(path)};
export function sealRawBindings(tree, bindings) {
  baseline(bindings);
  for (const card of tree.cards) {
    const bound = bindingMap(bindings,"cards",card.id);
    if (!bound) continue;
    bound.rawHash = card.hash;
    const compiled = compileRawCard(tree,card,portable);
    bound.portableHash = renderHash(compiled);
    for (const reading of compiled.readings) {
      const child = bindingMap(bindings,"readings",reading.path);
      if (child) { child.rawHash = hash(tree.files.get(reading.path)); child.portableHash = renderHash(reading); }
    }
  }
  return bindings;
}

function sourceRecord(tree, path, stamp, old, origin) {
  const entry = tree.byPath.get(path);
  const markdown = entry?.metadata.kind === "source" ? entry.markdown : tree.files.get(path).toString("utf8");
  if (!markdown.trim() || markdown.includes("\0") || Buffer.byteLength(markdown) > sourceSnapshotByteLimit || [...markdown].length > sourceSnapshotCharLimit)
    fail("invalid_input","原始资料为空、含无效字符或超过资料快照容量：" + path);
  const meta = tree.sourceMetadata.get(path) ?? origin ?? {};
  const title = meta.title || entry?.name || posix.basename(path);
  const author = meta.author ?? "", url = meta.url ?? "";
  const hashed = hash(markdown);
  const unchanged = meta.hash === hashed && meta.id && meta.sourceId;
  const payload = {title,markdown,url,author};
  const sourceId = unchanged ? meta.sourceId : "src_" + digest({path, ...payload}).slice(0,32);
  const id = sourceSnapshotId({sourceId,...payload});
  if (unchanged && meta.id !== id) fail("content_conflict","来源快照的身份与内容不匹配：" + path);
  return {id,sourceId,...payload,version:unchanged ? meta.version : 1,hash:hashed,
    createdAt:unchanged ? meta.createdAt : old?.id === id ? old.createdAt : stamp};
}

function remoteIndex(inventory) {
  const cards = new Map(), readings = new Map();
  for (const card of inventory.cards) {
    cards.set(card.id,card);
    for (const r of card.readings ?? []) readings.set(r.id,{...r,parent:card.id});
  }
  return {cards,readings,assets:new Map(inventory.assets.map(a=>[a.path,a])),
    sources:new Map(inventory.sources.map(s=>[s.id,s])),
    relations:new Map((inventory.relations??[]).map(r=>[String(r.id),r]))};
}
function selectors(group, b) {
  if (group === "sources") return {kind:"source",id:b.id};
  if (group === "assets") return {kind:"asset",path:b.remotePath};
  if (group === "relations") return {kind:"relation",relationId:b.id};
  return {kind:group === "cards" ? "card" : "reading",id:b.remoteId,...(group === "readings" && {parent:b.parent})};
}
function checkPlan(plan) {
  if (plan.version !== 1 || plan.id !== digest(dataOf(plan))) fail("invalid_input","冻结的同步计划已变化。");
}
function sameContent(current, intended) {
  return current?.title === intended.title && markdownEquivalent(current.markdown,intended.markdown);
}

const isKernelTimestamp = value => typeof value === "string" && /^\d{14}$/.test(value);

function nativeRevisionAt(doc, updated) {
  return documentRevision({...doc, attrs:{...doc.attrs, updated}});
}

export function verifiedUpdated(doc) {
  if (typeof doc?.title !== "string" || typeof doc.raw !== "string" || !isKernelTimestamp(doc.attrs?.updated)) return;
  if (nativeRevisionAt(doc,doc.attrs.updated) === doc.revision) return doc.attrs.updated;
}

function rememberUpdated(binding, updated) {
  if (isKernelTimestamp(updated)) binding.updated = updated;
  else delete binding.updated;
}

function uniquePathsByHash(entries) {
  const paths = new Map();
  for (const [path,sha256] of entries) paths.set(sha256,paths.has(sha256) ? null : path);
  return paths;
}

/** The only inventory this function uses belongs to the selected live target. */
export function planRawSync({rawRoot,stateDir,inventory,bindings,previousUpdates,restoreRawId}) {
  const tree = loadRawTree(rawRoot);
  const origin = baseline(bindings ?? (tree.files.has(".sync.json") ? JSON.parse(tree.files.get(".sync.json")) : null));
  const identity = inventory.identity;
  if (!identity) fail("invalid_input","需要已核实的知识库身份。");
  const prior = stored(stateDir,identity);
  const base = prior ?? (origin?.identity === identity ? origin : blank(identity));
  const next = blank(identity);
  // Keep records for omitted raw entries. They retain their original identity if restored.
  for (const group of groups) next[group] = Object.assign(safeMap(),Array.isArray(base[group]) ? {} : structuredClone(base[group]));
  const live = remoteIndex(inventory);
  const plan = {version:1, identity, stateHash:digest(prior),actions:[],checks:[],missing:[],conflicts:[],unchanged:0,next};
  // Retain only the previous bindings of changed items. This lets settlement
  // preserve their last approved revisions even on the very first migration.
  plan.previous = {};
  const stamp = new Date().toISOString();
  const seen = Object.fromEntries(groups.map(g=>[g,new Set()]));
  const get = (group,key) => bindingMap(base,group,key);
  const current = (group,key,binding) => { seen[group].add(key); next[group][key] = binding; };
  const check = (group,key,b,expected,action=false) => plan.checks.push({group,key,item:selectors(group,b),expected,action});
  const action = (method,group,key,input) => {
    const before=get(group,key);
    if (before) (plan.previous[group] ??= {})[key] = before;
    const op_id = "raw-" + digest({method,identity,group,key,input});
    plan.actions.push({method,kind:group,key,input:{...input,identity,op_id}});
  };
  const conflict = (kind,key,reason) => plan.conflicts.push({kind,key,reason});
  const assetHashes = Array.from(tree.assets,path=>[path,hash(tree.files.get(path))]);
  const rawByHash = uniquePathsByHash(assetHashes);
  const boundByHash = uniquePathsByHash(Object.entries(next.assets).map(([path,b])=>[path,b.sha256]));
  const assetPaths = new Map();
  for (const [path,sha256] of assetHashes) {
    const bytes = tree.files.get(path);
    const bound = get("assets",path);
    const previousPath = boundByHash.get(sha256);
    const moved = !bound && previousPath && !tree.files.has(previousPath) && rawByHash.get(sha256) === path;
    const old = moved ? get("assets",previousPath) : bound;
    const ext = posix.extname(path).toLowerCase();
    const remotePath = old?.sha256 === sha256 ? old.remotePath : "assets/raw-" + sha256 + (/^\.[a-z0-9]{1,12}$/.test(ext) ? ext : "");
    assetPaths.set(path,remotePath);
    if (old && live.assets.get(old.remotePath)?.sha256 !== old.sha256) {
      conflict("assets",path,"绑定附件缺失或被改写。");
      if (moved) {
        seen.assets.add(previousPath);
        continue;
      }
    }
    if (moved) {
      delete next.assets[previousPath];
      (plan.assetMoves ??= []).push({from:previousPath,to:path});
    }
    const b = {remotePath,sha256};
    current("assets",path,b);
    const other = live.assets.get(remotePath);
    if (other && other.sha256 !== sha256) conflict("assets",path,"目标附件内容不同。");
    if (other?.sha256 === sha256) { plan.unchanged++; check("assets",path,b,{sha256}); }
    else { action("raw-asset","assets",path,{path:remotePath,sha256,bytes:bytes.toString("base64")}); check("assets",path,b,null,true); }
  }
  for (const path of tree.sourceFiles) {
    const old = get("sources",path);
    if (old && !live.sources.has(old.id)) conflict("sources",path,"绑定的原文快照不存在。");
    const record = sourceRecord(tree,path,stamp,old,bindingMap(origin,"sources",path));
    // An existing identical independent snapshot supplies its original timestamp.
    const existing = live.sources.get(record.id);
    const original = tree.sourceMetadata.get(path) ?? bindingMap(origin,"sources",path);
    if (existing && record.id !== original?.id) record.createdAt = existing.createdAt;
    const b = {id:record.id,hash:record.hash,createdAt:record.createdAt,digest:digest(record)};
    current("sources",path,b);
    if (old?.digest && old.digest !== digest(live.sources.get(old.id)??null)) conflict("sources",path,"来源基线与当前快照不符。");
    if (existing && digest(existing) !== b.digest) conflict("sources",path,"目标快照元信息不同。");
    if (existing) { plan.unchanged++; check("sources",path,b,{id:b.id,digest:b.digest}); }
    else { action("raw-source","sources",path,{record}); check("sources",path,b,null,true); }
  }
  const cardIds = new Map(), readingIds = new Map(), archivedCards = new Set(), archivedReadings = new Set();
  for (const card of tree.cards) {
    const bound = get("cards",card.id);
    if (bound?.archived || (card.metadata.status === "archived" && card.id!==restoreRawId)) {
      seen.cards.add(card.id);
      archivedCards.add(card.id);
      for (const reading of card.readings) {
        seen.readings.add(reading.path);
        archivedReadings.add(reading.path);
      }
      continue;
    }
    if (!bound && inventory.cards.some(c=>c.title===card.name || c.legacyId===card.id || c.id===card.metadata.siyuan_id))
      conflict("cards",card.id,"目标已有同名或同标识卡，缺少可核实的绑定。");
    const remoteId = bound?.remoteId ?? blockId();
    if ([...cardIds.values()].includes(remoteId)) fail("identity_conflict","多份原稿绑定同一目标文档。");
    cardIds.set(card.id,remoteId);
    for (const r of card.readings) {
      if (readingIds.has(r.path)) fail("invalid_input","同一补充阅读路径属于多个父卡：" + r.path);
      readingIds.set(r.path,get("readings",r.path)?.remoteId ?? blockId());
    }
  }
  const urls = {cardUrl:id => archivedCards.has(id) ? null : "/cards/"+cardIds.get(id),
  readingUrl:path=>archivedReadings.has(path) ? null : "/cards/"+readingIds.get(path),sourceUrl:path=>"/wiki?source="+next.sources[path].id,
  assetUrl:path=>safeUrl(assetPaths.get(path))};
  const fingerprints = { ...portable, cardUrl:id => archivedCards.has(id) ? null : portable.cardUrl(id),
    readingUrl:path => archivedReadings.has(path) ? null : portable.readingUrl(path) };
  const readingTasks = [];
  function document(group,key,id,desired,rawHash,portableHash,parent,legacyId,anchors,legacyMeta) {
    const old = get(group,key), actual = live[group].get(id);
    const b = {remoteId:id,rawHash,portableHash,desiredHash:renderHash(desired),revision:old?.revision??null,
      ...(group === "cards" && {path:tree.byId.get(key).path}),
      ...(old?.previousArchiveOp && {previousArchiveOp:old.previousArchiveOp}),
      ...(parent && {parent}), ...(legacyId && {legacyId}), ...(anchors && {anchors}), ...(legacyMeta && {legacyMeta})};
    current(group,key,b);
    const updated = verifiedUpdated(actual);
    // A legacy binding may use its own archived timestamp as evidence. Both
    // exact hashes must match before adopting a kernel-only timestamp change.
    const previousUpdated = old?.updated ?? previousUpdates?.[id];
    const sameNative = old && old.revision !== actual?.revision && updated && isKernelTimestamp(previousUpdated) &&
      nativeRevisionAt(actual,previousUpdated) === old.revision;
    if (old && !old.reserved && (!actual || (old.revision !== actual.revision && !sameNative) || (parent && actual.parent !== parent))) {
      plan.conflicts.push({kind:group,key,remoteId:id,expectedRevision:old.revision,actualRevision:actual?.revision??null,
        reason:"绑定文档缺失、版本变化或父卡不符。"}); return;
    }
    if (old?.reserved && actual) {
      conflict(group,key,"预留文档标识已被占用，未验证的文档不能绑定。"); return;
    }
    if (old && actual) {
      b.revision = actual.revision;
      rememberUpdated(b,updated ?? old.updated);
    }
    const rawMatches = old && old.rawHash === rawHash && old.portableHash === portableHash;
    const sameRaw = old && !old.reserved && !old.needsSync && !old.forceApply &&
      (old.desiredHash ? old.desiredHash === b.desiredHash : rawMatches);
    if (actual && rawMatches && old.needsSync && old.repairs?.length) {
      let markdown = actual.markdown;
      for (const {from,to} of old.repairs) {
        if (!from || !to || !markdown.includes(from)) { conflict(group,key,"待修复的附件地址已变化。"); return; }
        markdown = markdown.replaceAll(from,to);
      }
      desired = {title:actual.title, markdown};
    }
    if (actual && (sameRaw || sameContent(actual,desired))) {
      b.revision=actual.revision; plan.unchanged++; check(group,key,b,{id,revision:actual.revision}); return;
    }
    markdownChunks(desired.markdown);
    if (!actual && anchors && Object.keys(anchors).length) conflict(group,key,"新库不能推断导出原文的块锚点。");
    if (actual?.legacyFixedFields && anchors && Object.keys(anchors).length) conflict(group,key,"旧卡被其他块引用，需先按块处理。");
    check(group,key,b,actual ? {id,revision:actual.revision} : null,true);
    action("raw-document",group,key,{...selectors(group,b),...desired, expected_revision:actual?.revision??null,
      ...(actual?.legacyFixedFields && {legacy:true}), ...(legacyId && {legacyId}), ...(!actual && legacyMeta && {legacyMeta})});
  }
  for (const card of tree.cards) {
    if (!cardIds.has(card.id)) continue;
    const rendered = compileRawCard(tree,card,urls), fingerprint = compileRawCard(tree,card,fingerprints);
    const exported = bindingMap(origin,"cards",card.id);
    const old = get("cards",card.id) ?? exported;
    document("cards",card.id,cardIds.get(card.id),{title:rendered.title,markdown:rendered.markdown},
      card.hash,renderHash(fingerprint),null,old?.legacyId??card.id,old?.anchors,old?.legacyMeta??exported?.legacyMeta);
    for (const [index,r] of rendered.readings.entries()) {
      readingTasks.push(["readings",r.path,readingIds.get(r.path),{title:r.title,markdown:r.markdown},
        hash(tree.files.get(r.path)),renderHash(fingerprint.readings[index]),cardIds.get(card.id),null,
        bindingMap(origin,"readings",r.path)?.anchors]);
    }
  }
  for (const task of readingTasks) document(...task);
  for (const card of tree.cards) {
    const parent=cardIds.get(card.id);
    if (!parent || !card.readings.length) continue;
    const actual=live.cards.get(parent), selected=card.readings.map(r=>readingIds.get(r.path));
    const all=[...new Set([...(actual?.readings??[]).map(r=>r.id),...selected])];
    const projected=orderedReadings(all.map(id=>({id})),actual?.attrs?.[readingOrderAttr]).map(r=>r.id);
    const desired=[...selected,...projected.filter(id=>!selected.includes(id))];
    if (JSON.stringify(projected)===JSON.stringify(desired)) continue;
    const parentSave=plan.actions.find(a=>a.kind==="cards" && a.key===card.id);
    const check=plan.checks.find(c=>c.group==="cards" && c.key===card.id);
    if (!check) continue; // a conflict already accounts for this parent
    if (!check.action) {check.action=true;plan.unchanged--;}
    action("raw-order-readings","cards",card.id,{id:parent,readings:selected,...(parentSave ?
      {expected_operation:parentSave.input.op_id} : {expected_revision:actual.revision})});
  }
  for (const relation of origin?.relations ?? []) {
    const key = String(relation.id), b = {id:key,digest:digest(relation)};
    const actual = live.relations.get(key);
    if (actual && digest(actual)!==b.digest) conflict("relations",key,"已归档关系的元信息与原稿不同。");
    if (!actual && (base===origin || get("relations",key))) conflict("relations",key,"绑定的关系已从目标库消失。");
    current("relations",key,b);
    if (actual) { plan.unchanged++; check("relations",key,b,{digest:b.digest}); }
    else {
      action("raw-relation","relations",key,{record:relation,documentId:blockId()});
      check("relations",key,b,null,true);
    }
  }
  for (const group of groups) for (const key of Object.keys(next[group])) {
    if (!seen[group].has(key) && !next[group][key].archived) plan.missing.push({kind:group,key});
  }
  plan.id = digest(plan);
  return plan;
}

async function verifyChecks(rpc, identity, checks, writtenBindings) {
  for (let at = 0; at < checks.length; at += 32) {
    const batch = checks.slice(at, at+32);
    const items = batch.map(c=>writtenBindings && c.action && (c.group==="cards" || c.group==="readings") ?
      {...c.item,includeUpdated:true} : c.item);
    const results = await rpc("raw-probe",{identity,items});
    for (const [index,c] of batch.entries()) {
      let actual = results[index];
      if (items[index].includeUpdated && actual) {
        const {updated,...exact} = actual;
        rememberUpdated(writtenBindings[c.group][c.key],updated);
        actual = exact;
      }
      if (digest(actual) !== digest(c.expected))
        fail("content_conflict", `目标已经变化：${c.group}/${c.key}。请核对冻结版本。`);
    }
  }
}

/** Save the exact plan before the first mutation; completing it publishes one new baseline. */
export async function applyRawSync(args) {
  const {plan,stateDir,rpc} = args;
  checkPlan(plan);
  if (plan.conflicts.length) fail("content_conflict","同步计划包含未解决的冲突。");
  if (await rpc("raw-target",{}) !== plan.identity) fail("outside_scope","冻结计划属于其他知识库。");
  return withLocalWriter(stateDir,plan.identity,()=>applyFrozen(args));
}
async function applyFrozen({plan,stateDir,rpc}) {
  const base = statePath(stateDir,plan.identity), pendingPath = join(base,"pending.json");
  mkdirSync(base,{recursive:true,mode:0o700});
  const state = stored(stateDir,plan.identity);
  const pending = read(pendingPath);
  if (pending && pending.id !== plan.id) fail("operation_pending","已有其他冻结计划待完成，请先 resume。");
  const result = writes => ({identity:plan.identity,planId:plan.id,writes,unchanged:plan.unchanged,missing:plan.missing});
  if (state?.lastPlan === plan.id) {
    const checks = plan.checks.map(c=> {
      if (!c.action) return c;
      const b = state[c.group][c.key];
      return {...c,expected:readback(c.group,b)};
    });
    await verifyChecks(rpc,plan.identity,checks);
    if (pending) unlinkSync(pendingPath);
    return result(0);
  }
  if (digest(state) !== plan.stateHash) fail("content_conflict","本机基线已更新，请重新生成计划。");
  await verifyChecks(rpc,plan.identity,plan.checks.filter(c=> !pending || !c.action));
  if (!pending && !plan.actions.length && state) {
    const {lastPlan,...known} = state;
    if (digest(known) === digest(plan.next)) return result(0);
  }
  if (!pending) {
    try { publish(pendingPath,plan,true); }
    catch (e) {
      if(e.code !== "EEXIST") throw e;
      fail("write_locked","另一进程已开始同步，请等待或恢复该计划。");
    }
    // A concurrent plan could have finished during preflight, changing the generation.
    if (digest(stored(stateDir,plan.identity)) !== plan.stateHash) {
      unlinkSync(pendingPath); fail("content_conflict","本机基线已更新，请重新生成计划。");
    }
  }
  const next = structuredClone(plan.next);
  for (const a of plan.actions) {
    const b = next[a.kind][a.key];
    const actual = await rpc(a.method,a.input);
    if (a.kind==="cards" || a.kind==="readings") {
      if (actual?.id !== b.remoteId || typeof actual.revision !== "string") fail("readback_conflict","文档回执与冻结请求不符。");
      b.revision = actual.revision;
    }
    if (digest(actual) !== digest(readback(a.kind,b))) fail("readback_conflict","写后回执与冻结请求不符：" + a.key);
  }
  await verifyChecks(rpc,plan.identity,plan.checks.map(c=>({...c,expected:readback(c.group,next[c.group][c.key])})),next);
  next.lastPlan = plan.id;
  publish(join(base,"state.json"),next);
  if (read(pendingPath)?.id === plan.id) unlinkSync(pendingPath);
  return result(plan.actions.length);
}
function readback(group,b) {
  if (group === "cards" || group === "readings") return {id:b.remoteId,revision:b.revision};
  if (group === "sources") return {id:b.id,digest:b.digest};
  if (group === "relations") return {digest:b.digest};
  return {sha256:b.sha256};
}

export async function archiveRawCard({rawId, stateDir, rpc, expected}) {
  const identity = await rpc("raw-target");
  return withLocalWriter(stateDir, identity, () => archiveBound({rawId, stateDir, identity, rpc, expected}));
}

export function findBoundRawCard(stateDir, identity, documentId) {
  return Object.entries(stored(stateDir,identity)?.cards ?? {}).find(([, binding]) => binding.remoteId === documentId)?.[0];
}

export function listBoundRawCards(stateDir,identity) {
  return Object.entries(stored(stateDir,identity)?.cards ?? {})
    .filter(([,binding])=>!binding.reserved)
    .map(([rawId,binding])=>({rawId,documentId:binding.remoteId,path:binding.path ?? null,
      archived:binding.archived===true,archiveOp:binding.archiveOp ?? null,rawHash:binding.rawHash ?? null,revision:binding.revision ?? null}));
}

export function readRawExportLinks(stateDir,identity) {
  const state=stored(stateDir,identity);
  return {readings:Object.entries(state?.readings ?? {}).map(([path,binding])=>[binding.remoteId,path]),
    assets:Object.entries(state?.assets ?? {}).map(([path,binding])=>[binding.remotePath,path]),
    sources:Object.entries(state?.sources ?? {}).map(([path,binding])=>[binding.id,path])};
}

export function inspectPurgeBindings({stateDir, identity, rawId, ids, patch, sourcePath, databaseOnly=false}) {
  if (readPendingRawSync(stateDir,identity)) fail("operation_pending","先完成待处理的原稿同步。");
  const state = stored(stateDir,identity) ?? (databaseOnly ? blank(identity) : null);
  const card = bindingMap(state,"cards",rawId);
  if ((!databaseOnly && !card?.archived) || (card && card.remoteId !== ids[0]))
    fail("content_conflict","卡片归档绑定已变化。");
  if (databaseOnly && findBoundRawCard(stateDir,identity,ids[0]) &&
      findBoundRawCard(stateDir,identity,ids[0])!==rawId) fail('content_conflict','原生文档绑定了另一张卡。');
  const readings = Object.entries(state.readings ?? {}).filter(([, reading]) => reading.parent === ids[0]);
  const nativeIds = new Set(ids.slice(1));
  if (readings.length !== nativeIds.size || readings.some(([, reading]) => !nativeIds.has(reading.remoteId)))
    fail("outside_scope","补读文档与原稿绑定不一致。");
  const removed = new Set([...patch.edits].filter(([, bytes]) => bytes === null).map(([path]) => path));
  if (!sourcePath || (card?.path && card.path !== sourcePath))
    fail("content_conflict","实例归档绑定与 Git 原稿目录不一致，请先核对。");
  const owner = posix.dirname(sourcePath) + "/";
  for (const path of Object.keys(state.assets ?? {})) if (path.startsWith(owner)) removed.add(path);
  const assets = Object.entries(state.assets ?? {});
  return {
    card:card ?? null, readings,...(databaseOnly && {databaseOnly:true}),
    knownRemote:assets.map(([,asset])=>asset.remotePath),
    assets:assets.filter(([path]) => removed.has(path)).map(([path,binding]) => ({
      path, binding, nextPath:patch.moves.get(path) ?? null,
      shared:patch.moves.has(path) || assets.some(([other,asset]) => !removed.has(other) && asset.remotePath === binding.remotePath),
    })),
  };
}

export async function purgeRawBindings({stateDir, identity, rawId, frozen}) {
  return withLocalWriter(stateDir,identity,() => {
    if (readPendingRawSync(stateDir,identity)) fail("operation_pending","先完成待处理的原稿同步。");
    const state = stored(stateDir,identity);
    if (!state) {
      if (frozen.databaseOnly && !frozen.card && !frozen.readings.length && !frozen.assets.length) return;
      fail("outside_scope","缺少目标库的原稿绑定。");
    }
    const verifyBinding = (group,path,expected) => {
      const current = bindingMap(state,group,path);
      if (current && digest(current) !== digest(expected)) fail("content_conflict","线上原稿绑定在确认后已变化。");
    };
    verifyBinding("cards",rawId,frozen.card);
    for (const [path,reading] of frozen.readings) verifyBinding("readings",path,reading);
    for (const {path,binding,nextPath} of frozen.assets) {
      verifyBinding("assets",path,binding);
      if (nextPath) verifyBinding("assets",nextPath,binding);
    }
    delete state.cards[rawId];
    for (const [path] of frozen.readings) delete state.readings[path];
    for (const {path,binding,nextPath} of frozen.assets) {
      if (nextPath) state.assets[nextPath] = binding;
      delete state.assets[path];
    }
    delete state.lastPlan;
    publish(join(statePath(stateDir,identity),"state.json"),state);
  });
}

export function verifyPurgeBindings({stateDir,identity,rawId,frozen,checkMoved=false}) {
  const state = stored(stateDir,identity);
  if (!state) return frozen.databaseOnly===true && !frozen.card && !frozen.readings.length && !frozen.assets.length;
  if (bindingMap(state,"cards",rawId)) return false;
  return frozen.readings.every(([path])=>!bindingMap(state,"readings",path)) &&
    frozen.assets.every(({path,binding,nextPath})=>!bindingMap(state,"assets",path) &&
      (!checkMoved || !nextPath || digest(bindingMap(state,"assets",nextPath) ?? null) === digest(binding)));
}

/** Reconcile the Git catalogue and the selected instance without changing either. */
export async function listRawArchives({rawRoot, stateDir, rpc}) {
  const tree = loadRawTree(rawRoot);
  const entries = new Map(tree.cards.filter(card => card.metadata.status === "archived").map(card => [card.id, card]));
  const identity = rpc ? await rpc("raw-target") : null;
  const bindings = identity ? stored(stateDir, identity)?.cards ?? {} : {};
  const ids = new Set([...entries.keys(), ...Object.keys(bindings).filter(id => bindings[id].archived || bindings[id].archiveOp)]);
  const result = [];
  for (const rawId of ids) {
    const specified = entries.get(rawId), card = specified ?? tree.byId.get(rawId);
    const binding = Object.hasOwn(bindings, rawId) ? bindings[rawId] : null;
    const entry = { rawId, title: card?.name ?? rawId, discipline: card?.discipline ?? null,
      path: card?.path ?? null, archivedAt: specified?.metadata.archived_at ?? null };
    const hasReservation = specified && binding?.reserved === true && !binding.archived && !binding.archiveOp &&
      /^\d{14}-[a-z0-9]{7}$/.test(binding.remoteId ?? "");
    let unusedReservation = false;
    if (hasReservation) {
      try {
        const probe = await rpc("raw-probe", {identity,items:[{kind:"card",id:binding.remoteId}]});
        unusedReservation = Array.isArray(probe) && probe.length === 1 && probe[0] === null;
      } catch (error) {
        if (!["not_found","outside_scope"].includes(error.code)) throw error;
      }
    }
    if (specified && (!binding || unusedReservation)) {
      result.push({ ...entry, state: "from-raw" });
      continue;
    }
    const eligible = binding?.archived === true && /^\d{14}-[a-z0-9]{7}$/.test(binding.remoteId ?? "") &&
      /^[a-zA-Z0-9_-]{1,100}$/.test(binding.archiveOp ?? "");
    const evidence = eligible ? await rpc("raw-archive-evidence", { identity, id: binding.remoteId, op_id: binding.archiveOp }) : null;
    if (!evidence?.verified || evidence.revision !== binding.revision || (card && card.metadata.kind === "source")) {
      result.push({ ...entry, state: "needs-review", reason: evidence?.reason ?? "archive_binding_mismatch" });
      continue;
    }
    const state = specified ? "archived" : card ? "needs-marker" : "missing-raw";
    result.push({ ...entry, title: card?.name ?? evidence.title, archivedAt: evidence.archivedAt ?? entry.archivedAt,
      boundPath:binding.path ?? null,
      state, documentId: evidence.id, archiveOp: binding.archiveOp, revision: evidence.revision, signature:evidence.signature });
  }
  return result.sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? "") || a.rawId.localeCompare(b.rawId));
}

export async function selectRawSyncPlan({rawRoot, stateDir, rpc}) {
  const identity = await rpc("raw-target");
  const frozen = readPendingRawSync(stateDir, identity);
  if (frozen) {
    checkPlan(frozen);
    if (frozen.identity !== identity) fail("outside_scope", "冻结计划属于其他知识库。");
    return {plan: frozen, pending: true};
  }
  const inventory = await rpc("inventory", {withBlocks: false});
  if (inventory.identity !== identity) fail("outside_scope", "清单属于其他知识库。");
  return {plan: planRawSync({rawRoot, stateDir, inventory}), pending: false};
}

/** Retain unrelated bindings while applying an explicitly reviewed sub-plan. */
export function restrictRawSyncPlan(plan,stateDir,allows,{initialBindings}={}) {
  checkPlan(plan);
  const state = stored(stateDir,plan.identity);
  if ((!state && initialBindings===undefined) || digest(state) !== plan.stateHash ||
      (initialBindings && initialBindings.identity!==plan.identity))
    fail("content_conflict","复核所用的线上基线已变化。");
  const base=state ?? initialBindings ?? blank(plan.identity);
  const scoped = structuredClone(plan);
  for (const group of groups) {
    const previous = base[group] ?? {};
    const keys = new Set([...Object.keys(previous),...Object.keys(scoped.next[group])]);
    for (const key of keys) {
      if (allows(group,key)) continue;
      if (Object.hasOwn(previous,key)) scoped.next[group][key] = structuredClone(previous[key]);
      else delete scoped.next[group][key];
      if (scoped.previous[group]) delete scoped.previous[group][key];
    }
  }
  if ((scoped.assetMoves ?? []).some(({from,to}) => allows("assets",from) !== allows("assets",to)))
    fail("content_conflict","有附件跨越本次操作的维护范围。");
  if (scoped.assetMoves) scoped.assetMoves = scoped.assetMoves.filter(({to})=>allows("assets",to));
  scoped.actions = scoped.actions.filter(action=>allows(action.kind,action.key));
  scoped.checks = scoped.checks.filter(check=>allows(check.group,check.key));
  scoped.conflicts = scoped.conflicts.filter(conflict=>allows(conflict.kind,conflict.key));
  scoped.missing = scoped.missing.filter(item=>allows(item.kind,item.key));
  scoped.unchanged = scoped.checks.filter(check=>!check.action).length;
  delete scoped.id;
  scoped.id = digest(scoped);
  return scoped;
}

export async function recoverRawOperation({stateDir,identity,backupOp,revision,signature,rpc}) {
  if (!/^[0-9a-f]{64}$/.test(revision ?? '')) fail('invalid_input','需要明确指定原操作的完整写后修订或哈希。');
  return withLocalWriter(stateDir,identity,async () => {
    const pending = readPendingRawSync(stateDir,identity);
    if (pending) checkPlan(pending);
    const op_id = 'raw-recover-' + digest([identity,backupOp,revision,...(signature ? [signature] : [])]);
    let result;
    try {
      result = await rpc('raw-recover',{identity,op_id,backup_op_id:backupOp,expected_revision:revision,
        ...(signature && {expected_signature:signature}),
        ...(pending && {pendingOps:pending.actions.map(action=>action.input.op_id)})});
    } catch (error) {
      throw Object.assign(new Error(`${error.message}（恢复操作 ID ${op_id}）`),{code:error.code});
    }
    if (result.deleted === false) {
      // Recovering an archive also releases its local tombstone. On retry,
      // recheck the live revision before publishing a previously lost binding.
      const state = stored(stateDir,identity);
      const binding = Object.values(state?.cards ?? {}).find(card=>card.remoteId===result.id);
      if (binding && (binding.archived || binding.revision !== result.revision)) {
        if (binding.archived && binding.archiveOp !== backupOp) fail('content_conflict','归档绑定已发生变化。');
        const [live] = await rpc('raw-probe',{identity,items:[{kind:'card',id:result.id}]});
        if (live?.revision !== result.revision) fail('content_conflict','恢复后的文档已经变化，请核对当前修订。');
        if (binding.archiveOp) binding.previousArchiveOp = binding.archiveOp;
        delete binding.archived; delete binding.archiveOp; delete binding.updated;
        binding.revision = result.revision; delete state.lastPlan;
        publish(join(statePath(stateDir,identity),'state.json'),state);
      }
    }
    return result;
  });
}
async function archiveBound({rawId,stateDir,identity,rpc,expected}) {
  if (await rpc("raw-target",{}) !== identity) fail("outside_scope","归档目标与绑定库不符。");
  if (readPendingRawSync(stateDir,identity)) fail("operation_pending","先完成待处理的同步计划。");
  const state = stored(stateDir,identity);
  const b = bindingMap(state,"cards",rawId);
  if (!b) fail("outside_scope","归档需要已完成同步的卡片绑定。");
  if (expected && expected.id !== b.remoteId) fail("content_conflict","归档卡片绑定已变化。");
  const operation = revision => expected?.operationId
    ? "raw-archive-web-" + expected.operationId
    : "raw-archive-" + digest([state.identity,b.remoteId,revision,...(b.previousArchiveOp ? [b.previousArchiveOp] : [])]);
  if (b.archived) {
    if (expected && b.archiveOp !== operation(expected.revision)) fail("content_conflict","卡片已经被另一操作归档。");
    return {id:b.remoteId,archived:true,op_id:b.archiveOp};
  }
  if (expected && b.revision !== expected.revision) fail("content_conflict","归档卡片修订已变化。");
  const op_id = operation(b.revision);
  const result = await rpc("raw-archive",{identity:state.identity,id:b.remoteId,expected_revision:b.revision,op_id,
    ...(expected?.signature && {expected_signature:expected.signature})});
  if (!result.deleted || result.id !== b.remoteId) fail("readback_conflict","归档状态未核实。");
  if (digest(stored(stateDir,state.identity)) !== digest(state)) fail("content_conflict","归档期间本机基线改变，请核对操作回执。");
  b.archived=true; b.archiveOp=op_id; b.revision=result.revision; delete state.lastPlan;
  publish(join(statePath(stateDir,state.identity),"state.json"),state);
  return {id:b.remoteId,archived:true,revision:b.revision,op_id};
}

// Close a frozen batch after a conflict. Only writes that can be traced to its
// exact request may advance a mutable document's baseline.
export async function settleRawSync(args) {
  const {inventory,stateDir,rpc} = args, identity=inventory.identity;
  if (await rpc("raw-target",{}) !== identity) fail("outside_scope","目标库身份不符。");
  return withLocalWriter(stateDir,identity, async () => {
    const folder=statePath(stateDir,identity), pendingPath=join(folder,"pending.json");
    const plan=read(pendingPath);
    if (!plan) return {pending:false,applied:[],unstarted:[]};
    checkPlan(plan);
    const state=stored(stateDir,identity);
    function finish(published,outcomes = {}) {
      const conflicts = (plan.assetMoves ?? [])
        .filter(({to})=>!bindingMap(published,"assets",to))
        .map(({to})=>({kind:"assets",key:to,reason:"绑定附件缺失或被改写。"}));
      unlinkSync(pendingPath);
      return {pending:false,planId:plan.id,...outcomes,...(conflicts.length && {conflicts})};
    }
    if (state?.lastSettlement===plan.id || state?.lastPlan===plan.id) return finish(state);
    if (digest(state)!==plan.stateHash) fail("content_conflict","原批次对应的本机基线已经变化。");
    const next=structuredClone(plan.next), applied=[],unstarted=[],partial=[], resumed=[],unconfirmed=[];
    // Keep original bindings on unexecuted operations. A reserved new document
    // keeps its ID so that links already written by this batch remain correct.
    for (const a of plan.actions) {
      const old=bindingMap(plan.previous,a.kind,a.key) ?? bindingMap(state,a.kind,a.key);
      const planned=plan.next[a.kind][a.key];
      if (old) next[a.kind][a.key]=structuredClone(old);
      else if (a.kind==="cards" || a.kind==="readings") {
        next[a.kind][a.key] = a.input.expected_revision ?
          {...planned,revision:a.input.expected_revision,forceApply:true} : {...planned,revision:null,reserved:true};
      } else delete next[a.kind][a.key];
    }
    const live=remoteIndex(inventory);
    for (const a of plan.actions) {
      const planned=plan.next[a.kind][a.key], label={kind:a.kind,key:a.key,op_id:a.input.op_id};
      let outcome;
      if (a.kind==="assets" || a.kind==="sources") {
        const [actual]=await rpc("raw-probe",{identity,items:[selectors(a.kind,planned)]});
        outcome=digest(actual)===digest(readback(a.kind,planned)) ? {state:"applied",result:actual} : {state:"unstarted"};
      } else {
        outcome=await rpc("raw-outcome",{identity,method:a.method,request:a.input});
        if (outcome.state==="pending" && outcome.resumable) {
          // Completing a previously started create/order uses its original op_id,
          // ID and version protections. An unstarted request never enters here.
          try { outcome={state:"applied",result:await rpc(a.method,a.input)};resumed.push(label); }
          catch (e) {
            if (outcome.canAbandon) {unconfirmed.push({...label,error:e.message});continue;}
            outcome.error=e.message;
          }
        }
      }
      if (outcome.state==="pending") {partial.push({...label,...outcome});continue;}
      if (outcome.state==="unstarted") {
        if (outcome.restored) {
          const binding=next[a.kind][a.key], doc=live[a.kind].get(binding.remoteId);
          if (binding.remoteId!==outcome.restored.id || !doc || doc.revision!==outcome.restored.revision)
            fail("content_conflict","已恢复的文档版本已变化，请重新核对。");
          binding.revision=doc.revision;
          rememberUpdated(binding,verifiedUpdated(doc));
        }
        unstarted.push(label);continue;
      }
      if (outcome.state!=="applied") fail("readback_conflict","未知的结算状态。");
      const b=structuredClone(planned);
      if (a.kind==="cards" || a.kind==="readings") {
        if (outcome.result?.id!==b.remoteId || typeof outcome.result?.revision!=="string") fail("readback_conflict","文档结算回执无效。");
        b.revision=outcome.result.revision;
        const doc=live[a.kind].get(b.remoteId);
        if (resumed.at(-1)===label) {
          const [now] = await rpc("raw-probe",{identity,items:[{...selectors(a.kind,b),includeUpdated:true}]});
          rememberUpdated(b,now?.id===b.remoteId && now.revision===b.revision ? now.updated : undefined);
        } else rememberUpdated(b,doc?.revision===b.revision ? verifiedUpdated(doc) : undefined);
      } else if (digest(outcome.result)!==digest(readback(a.kind,b))) fail("readback_conflict","资料结算回执无效。");
      next[a.kind][a.key]=b; applied.push(label);
    }
    if (partial.length) return {pending:true,planId:plan.id,partial,applied,unstarted,resumed,unconfirmed};
    for (const {from,to} of plan.assetMoves ?? []) {
      const binding = plan.next.assets[to];
      const [actual] = await rpc("raw-probe",{identity,items:[selectors("assets",binding)]});
      if (actual?.sha256 === binding.sha256) continue;
      next.assets[from] = bindingMap(state,"assets",from) ?? binding;
      delete next.assets[to];
    }
    next.lastSettlement=plan.id;
    publish(join(folder,"state.json"),next);
    return finish(next,{applied,unstarted,resumed,unconfirmed});
  });
}

/** Explicitly accept one reviewed live revision as the base for the next raw save. */
export async function rebaseRawCard({rawId,revision,stateDir,rawRoot,inventory,rpc}) {
  if (!/^[a-f0-9]{64}$/.test(revision??"")) fail("invalid_input","请传入冲突报告中的完整当前 revision。");
  const {identity}=inventory;
  if (await rpc("raw-target",{})!==identity) fail("outside_scope","目标库身份不符。");
  return withLocalWriter(stateDir,identity, async () => {
    if (readPendingRawSync(stateDir,identity)) fail("operation_pending","请先结算待处理的同步计划。");
    let state=stored(stateDir,identity);
    if (!state) {
      const origin=baseline(read(join(rawRoot,".sync.json")));
      if (origin?.identity!==identity) fail("outside_scope","缺少当前库的原稿绑定。");
      state=blank(identity);
      for (const group of ["cards","readings","sources","assets"]) state[group]=structuredClone(origin[group]??{});
      for (const r of origin.relations??[]) state.relations[String(r.id)]={id:String(r.id),digest:digest(r)};
    }
    const group=bindingMap(state,"cards",rawId) ? "cards":"readings";
    const b=bindingMap(state,group,rawId);
    if (!b || b.reserved || b.archived) fail("outside_scope","只可接受现有绑定文档的当前版本。");
    const actual=remoteIndex(inventory)[group].get(b.remoteId);
    if (!actual || actual.revision!==revision) fail("content_conflict","当前版本与已审阅版本不符。");
    if (group==="readings") {
      if (b.parent && b.parent!==actual.parent) fail("outside_scope","阅读所属父卡已变化。");
      b.parent=actual.parent;
    }
    await verifyChecks(rpc,identity,[{group,key:rawId,item:selectors(group,b),expected:{id:b.remoteId,revision}}]);
    b.revision=revision;b.forceApply=true;delete b.needsSync;delete b.repairs;
    rememberUpdated(b,verifiedUpdated(actual));
    delete state.lastPlan;delete state.lastSettlement;
    publish(join(statePath(stateDir,identity),"state.json"),state);
    return {kind:group,key:rawId,id:b.remoteId,revision};
  });
}
