import { hasWriteWitness, isUnprovenDocumentReceipt } from "./document-receipt.mjs";
import { dirname, join, resolve, sep } from "node:path";
import { existsSync, lstatSync, realpathSync, readFileSync, mkdirSync, writeFileSync, linkSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { hash, canonical, quote, fail, deletedAttr } from "./siyuan.mjs";
import { Knowledge } from "./knowledge.mjs";
import { Documents, documentMarkdown, documentRevision, markdownChunks, markdownEquivalent, matchesNativeSnapshot, matchesRecoveryAttempt } from "./documents.mjs";
import { createWikiStore } from "./wiki-store.mjs";
import { confirmReceipt, execute } from "./commands.mjs";
import { orderRawReadings } from "./raw-reading-order.mjs";
import { inspectArchivedNative, removeArchivedNative, verifyNativePurged } from "./card-lifecycle-native.mjs";
import { inspectPurgeCopies, purgeAssetReferences, removePurgeCopies, verifyPurgeCopies } from "./card-lifecycle-copies.mjs";

const blockId = /^\d{14}-[a-z0-9]{7}$/;
const digest = value => hash(canonical(value));
export function rawLegacyMeta(meta) {
  const fields=["id","lifecycle_status","interaction_type","epistemic_type","domains","intents","version","created_at","updated_at"];
  return Object.fromEntries(Object.entries(meta??{}).filter(([key,value]) =>
    fields.includes(key) && (value===null || typeof value==="string" || Number.isFinite(value) ||
    (["domains","intents"].includes(key) && Array.isArray(value) && value.every(item=>typeof item === "string")))));
}
const store = (api, identity, options) => createWikiStore(resolve(dirname(api.c.dataDir), "wiki"), identity, options);
async function relation(api, key) {
  const rows = await api.sql(`SELECT r.value FROM attributes r JOIN blocks b ON b.id=r.block_id WHERE
    r.name='custom-cd-relation' AND b.box=${quote(api.c.notebookId)} AND b.type='d'
    AND b.path LIKE ${quote("/"+api.c.relationsRootId+"/%")} AND CAST(json_extract(r.value,'$.id') AS TEXT)=${quote(key)} LIMIT 2`);
  if (rows.length>1) fail("identity_conflict","归档关系的原始标识重复。");
  return rows[0] ? JSON.parse(rows[0].value) : null;
}

function assetFile(api, path) {
  if (typeof path !== "string" || !path.startsWith("assets/") || /[\\\0]/u.test(path) ||
      path.split("/").some(part => !part || part === "." || part === ".."))
    fail("outside_scope", "附件需要知识库内的相对路径。");
  const data = resolve(dirname(api.c.dataDir), "workspace/data");
  const file = join(data, path);
  // Do not follow symlinks through any component of a shared workspace.
  let current = data;
  for (const part of ["", ...path.split("/")]) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) fail("outside_scope", "附件路径包含符号链接。");
  }
  if (existsSync(file) && (!lstatSync(file).isFile() || !realpathSync(file).startsWith(realpathSync(data) + sep)))
    fail("outside_scope", "附件不在知识库内。");
  return file;
}

async function probe(api, doc, item, identity) {
  if (item.kind === "relation") {
    const record = await relation(api,item.relationId);
    return record ? {digest:digest(record)} : null;
  }
  if (item.kind === "asset") {
    const path = assetFile(api, item.path);
    return existsSync(path) ? {sha256: hash(readFileSync(path))} : null;
  }
  if (item.kind === "source") {
    try { const source = store(api,identity,{readOnly:true}).getSource(item.id); return {id: source.id, digest: digest(source)}; }
    catch (e) { if (e.code === "not_found") return null; throw e; }
  }
  if (!["card","reading"].includes(item.kind) || !blockId.test(item.id)) fail("invalid_input", "同步文档标识无效。");
  const [row] = await api.sql(`SELECT id,content,path,type FROM blocks WHERE id=${quote(item.id)} LIMIT 1`);
  if (!row) return null;
  const {doc: id, attrs} = await doc.resolve(item.id);
  if (id !== item.id || row.type !== "d") fail("outside_scope", "标识不属于当前文档。");
  if (item.kind === "reading") {
    if (attrs["custom-cd-parent"] !== item.parent || !row.path.endsWith("/" + item.parent + "/" + id + ".sy"))
      fail("outside_scope", "补充阅读所属卡已改变。");
  } else if (attrs["custom-cd-parent"] || attrs["custom-cd-kind"] === "article")
    fail("outside_scope", "不能将补充阅读作为卡片操作。");
  const raw = await api.markdown(id);
  return {id, revision: documentRevision({title:row.content,raw,attrs}),
    ...(item.includeUpdated && typeof attrs.updated === "string" && {updated:attrs.updated})};
}

async function createDocument(api, documents, input) {
  const {id, title, markdown, parent, kind} = input;
  const expectedParent = kind === "reading" ? parent : api.c.libraryRootId;
  return api.operate("raw-create-document", input, async (rec, persist) => {
    if (kind === "reading") await probe(api, documents, {kind:"card",id:parent}).then(value => {
      if (!value) fail("outside_scope", "补充阅读的父卡不存在。");
    });
    if (kind === "card" && input.legacyId) {
      const duplicate = await api.sql(`SELECT b.id FROM attributes a JOIN blocks b ON b.id=a.block_id WHERE b.box=${quote(api.c.notebookId)}
        AND a.name='custom-cd-legacy-id' AND a.value=${quote(input.legacyId)} AND b.id<>${quote(id)} LIMIT 1`);
      if (duplicate.length) fail("identity_conflict","目标库已有相同的原始卡片标识。");
    }
    const rows = await api.sql(`SELECT id,path FROM blocks WHERE id=${quote(id)} LIMIT 1`);
    if (rows.length && !rec.documentId) fail("identity_conflict", "待创建的文档标识已被占用。");
    rec.documentId = id; persist();
    if (!rows.length) await api.newDoc(id, title, markdown, expectedParent);
    const info = await api.inScope(id);
    const [current] = await api.sql(`SELECT content title FROM blocks WHERE id=${quote(id)} AND box=${quote(api.c.notebookId)}`);
    const attrsBefore = await api.attrs(id);
    const expectedKind = kind === "reading" ? "article" : "concept";
    if ((attrsBefore["custom-cd-schema"] && attrsBefore["custom-cd-schema"] !== "2") ||
        (attrsBefore["custom-cd-kind"] && attrsBefore["custom-cd-kind"] !== expectedKind))
      fail("content_conflict", "未完成的文档类型已改变。");
    if (!info.path.endsWith("/" + expectedParent + "/" + id + ".sy") ||
        current?.title !== title || !markdownEquivalent(documentMarkdown(await api.markdown(id)), markdown) ||
        (attrsBefore["custom-cd-request"] && attrsBefore["custom-cd-request"] !== rec.requestHash))
      fail("content_conflict", "未完成的创建与冻结请求不符。");
    const attrs = {"custom-cd-kind":expectedKind,
      "custom-cd-schema":"2", "custom-cd-request":rec.requestHash, "custom-cd-complete":"1"};
    if (kind === "card" && input.legacyId) {
      attrs["custom-cd-legacy-id"] = input.legacyId;
      attrs["custom-cd-meta"] = JSON.stringify({lifecycle_status:"active",...rawLegacyMeta(input.legacyMeta),id:input.legacyId});
    }
    if (kind === "reading") Object.assign(attrs, {"custom-cd-parent":parent, "custom-cd-reading":"1"});
    await api.setAttrs(id, attrs); await api.flush();
    const result = await probe(api, documents, input);
    const actual = await api.attrs(id);
    if (!result || Object.entries(attrs).some(([key,value]) => actual[key] !== value))
      fail("readback_conflict", "新文档属性核对失败。");
    if (kind === "card") {
      const native = await documents.snapshot(id);
      if (native.revision !== result.revision || !native.signature)
        fail("readback_conflict","新卡原生版本在读回期间发生变化。");
      rec.createdSignature = native.signature;
      persist();
    }
    return result;
  });
}

// A schema-1 document may be promoted only by this administrator command,
// after a real raw edit. The native snapshot is restorable via ordinary recover.
async function convertLegacy(api, documents, input, retryOptions) {
  return api.operate("raw-convert-document", input, async (rec, persist) => {
    const before = await documents.snapshot(input.id);
    if (before.revision !== input.expected_revision || before.attrs["custom-cd-schema"] !== "1")
      fail("content_conflict","旧卡当前版本与冻结计划不符。");
    const refs = await api.sql(`SELECT id FROM refs WHERE def_block_root_id=${quote(input.id)} AND def_block_id<>${quote(input.id)} LIMIT 1`);
    if (refs.length || input.hasAnchors) fail("unsupported_structure","旧卡中仍有被引用的原生块。请先核对原稿里的引用目标，再转换整篇格式。");
    rec.documentId = before.id; rec.beforeDocument = before;
    rec.intendedTitle = input.title; rec.intendedMarkdown = input.markdown;
    try {
      return await documents.writeDocument(rec, persist, async () => {
        rec.writeStarted = true; persist();
        await api.api("/api/block/updateBlock", {id:before.id, dataType:"markdown", data:input.markdown});
        if (before.title !== input.title) await api.api("/api/filetree/renameDocByID", {id:before.id, title:input.title});
        await api.setAttrs(before.id, {"custom-cd-schema":"2"});
        await api.flush();
      });
    } catch (error) {
      fail("operation_pending","旧卡保存可能部分完成，请用操作回执及写后版本核对恢复。");
    }
  }, retryOptions);
}

/** Local maintenance RPC only. Each mutation checks the frozen target and owns a readback. */
export async function rawWrite(api, method, input = {}) {
  const identity = await api.identity();
  if (method === "raw-target") return identity;
  if (input.identity !== identity) fail("outside_scope","同步计划属于其他知识库。");
  if (method === "raw-seal-unstarted") {
    const op_id=input.op_id;
    if (!/^db-card-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(op_id ?? ''))
      fail('invalid_input','需要已登记的数据库维护操作标识。');
    return api.withReceipt(op_id,(receipt,publish)=>{
      if (receipt?.target===identity && receipt.command==='db-card-unwritten')
        return {operationId:op_id,state:'sealed-unwritten'};
      if (receipt && (receipt.target!==identity || receipt.state!=='failed' || receipt.writeStarted ||
          receipt.documentId || receipt.beforeDocument || receipt.completed || receipt.result))
        fail('operation_pending','不能证明原生写入没有开始。');
      publish({target:identity,command:'db-card-unwritten',input:{op_id},state:'failed',
        error:{code:'operation_conflict',message:'原生操作已确认未写入并取消。'}});
      return {operationId:op_id,state:'sealed-unwritten'};
    });
  }
  if (method === "raw-inspect-purge") {
    const native = await inspectArchivedNative(api,input);
    if (!input.bindings) return {native};
    const documents = native.documents.map(document=>document.id);
    const known = new Set(input.bindings?.knownRemote ?? []);
    const related = await api.sql(`SELECT block_id FROM attributes WHERE name='custom-cd-relation' AND
      (json_extract(value,'$.source_concept_id') IN (${[input.rawId,...documents].map(quote).join(',')})
      OR json_extract(value,'$.target_concept_id') IN (${[input.rawId,...documents].map(quote).join(',')})) LIMIT 1`);
    if (related.length) fail("outside_scope","目标仍有关联关系文档，先核对线上关系的归属。");
    for (const id of documents) {
      const raw = await api.markdown(id);
      for (const path of purgeAssetReferences(raw))
        if (!known.has(path)) fail("outside_scope","存在无法核实归属的线上附件：" + path);
    }
    return { native, copies:await inspectPurgeCopies(api,{identity,documents,assets:input.bindings.assets ?? [],knownRemote:known}) };
  }
  if (method === "raw-remove-purge") {
    const authorization = input.decision;
    const native = await removeArchivedNative(api,input.native,{operation:input.operation,authorize:()=>authorization});
    const copies = await removePurgeCopies(api,{identity,documents:native.documents,frozen:input.copies,opId:input.operation.opId});
    return { native, copies };
  }
  if (method === "raw-verify-purge") return await verifyNativePurged(api,input.native) &&
    verifyPurgeCopies(api,identity,input.copies);
  if (method === "raw-purge-documents-present") {
    const ids = input.documents;
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id=>!blockId.test(id)))
      fail("invalid_input","删除决定文档清单无效。");
    const rows = await api.sql(`SELECT id FROM blocks WHERE box=${quote(api.c.notebookId)}
      AND root_id IN (${ids.map(quote).join(',')}) LIMIT 1`);
    return rows.length > 0;
  }
  if (method === "raw-status") return execute(api, "operation-status", {op_id:input.op_id});
  const documents = new Documents(api, new Knowledge(api));
  if (method === "raw-database-card") {
    if (!blockId.test(input.id ?? "")) fail("invalid_input","需要卡片文档标识。");
    const snapshot=await documents.snapshot(input.id,{includeDeleted:input.includeArchived===true});
    if (snapshot.anchor || snapshot.id!==input.id || snapshot.attrs["custom-cd-parent"] ||
        snapshot.attrs["custom-cd-kind"]==="article")
      fail("outside_scope","目标不是主卡片。");
    return { id:snapshot.id,title:snapshot.title,revision:snapshot.revision,signature:snapshot.signature,
      archiveOp:snapshot.attrs[deletedAttr] || null,editable:snapshot.editable,
      rawId:snapshot.attrs['custom-cd-legacy-id'] || null,
      ...(input.body===true && {markdown:snapshot.markdown}) };
  }
  if (method === "raw-active-card-evidence") {
    if (!blockId.test(input.id ?? "")) fail("invalid_input", "需要卡片文档标识。");
    const snapshot = await documents.snapshot(input.id);
    if (snapshot.anchor || snapshot.id !== input.id || snapshot.attrs["custom-cd-parent"] ||
        snapshot.attrs["custom-cd-kind"] === "article")
      fail("outside_scope", "目标不是主卡片。");
    return { id:snapshot.id, revision:snapshot.revision, signature:snapshot.signature, title:snapshot.title };
  }
  if (method === "raw-created-card-evidence") {
    const { id, op_id, rawId, orderOp } = input;
    if (!blockId.test(id ?? "") || typeof rawId !== "string")
      fail("invalid_input","需要冻结的创建操作和卡片标识。");
    const {value:receipt} = await api.receipt(op_id);
    if (!receipt || (!receipt.documentId && !receipt.writeStarted)) {
      const rows = await api.sql(`SELECT id FROM blocks WHERE box=${quote(api.c.notebookId)} AND id=${quote(id)} LIMIT 1`);
      if (rows.length) fail("content_conflict","文档标识已占用，但缺少可核实的创建回执。");
      return {state:"unstarted"};
    }
    if (receipt.target !== identity || receipt.command !== "raw-create-document" ||
        receipt.input?.kind !== "card" || receipt.input.legacyId !== rawId ||
        receipt.input.id !== id || receipt.documentId !== id)
      fail("content_conflict","创建回执不属于原恢复任务。");
    if (receipt.state !== "verified" || receipt.result?.id !== id || !receipt.createdSignature)
      fail("operation_pending","创建操作尚未完整读回，请先续跑原操作。");
    const snapshot = await documents.snapshot(id);
    let witness = { revision:receipt.result.revision, signature:receipt.createdSignature };
    if (orderOp) {
      const {value:order} = await api.receipt(orderOp);
      if (order?.state === "verified") {
        if (order.target !== identity || order.command !== "raw-order-readings" || order.input?.id !== id ||
            order.input.expected_operation !== op_id || order.beforeRevision !== receipt.result.revision ||
            order.result?.id !== id || !order.afterOrderSignature)
          fail("content_conflict","补充阅读顺序回执不属于原恢复任务。");
        witness = {revision:order.result.revision,signature:order.afterOrderSignature};
      }
    }
    if (snapshot.anchor || snapshot.attrs["custom-cd-parent"] ||
        snapshot.attrs["custom-cd-request"] !== receipt.requestHash || snapshot.revision !== witness.revision ||
        snapshot.signature !== witness.signature)
      fail("content_conflict","恢复创建的卡片在写入后发生变化。");
    return {state:"applied",id,revision:snapshot.revision,signature:snapshot.signature};
  }
  if (method === "raw-archive-evidence") {
    const { id, op_id } = input;
    if (!blockId.test(id ?? "")) fail("invalid_input", "需要卡片文档标识。");
    const { value: receipt } = await api.receipt(op_id);
    if (receipt?.target !== identity || receipt.command !== "delete-document" || receipt.state !== "verified" ||
        receipt.documentId !== id || receipt.deletionMarker !== op_id || receipt.result?.id !== id ||
        receipt.result?.deleted !== true || receipt.result.revision !== receipt.afterRevision || !receipt.beforeDocument)
      return { verified: false, reason: "archive_receipt_mismatch" };
    const snapshot = await documents.snapshot(id, { includeDeleted: true }).catch(error => {
      if (error.code === "outside_scope" || error.code === "not_found") return null;
      throw error;
    });
    if (!snapshot || snapshot.anchor || snapshot.attrs[deletedAttr] !== op_id ||
        snapshot.attrs["custom-cd-parent"] || snapshot.attrs["custom-cd-kind"] === "article" ||
        snapshot.revision !== receipt.afterRevision || !matchesNativeSnapshot(snapshot, receipt.beforeDocument))
      return { verified: false, reason: "archive_document_mismatch" };
    return { verified: true, id, revision: snapshot.revision, signature: snapshot.signature,
      title: snapshot.title, archivedAt: receipt.createdAt };
  }
  if (method === "raw-recover") {
    if (!/^[0-9a-f]{64}$/.test(input.expected_revision ?? "")) fail("invalid_input","需要原操作的完整写后修订或哈希。");
    if (input.expected_signature !== undefined && (typeof input.expected_signature !== "string" || !/^[0-9a-f]{64}$/.test(input.expected_signature)))
      fail("invalid_input", "需要原生块签名。");
    if (input.pendingOps && !input.pendingOps.includes(input.backup_op_id))
      fail("operation_pending","请用当前批次的原操作 ID 重试恢复，其他操作须先结算。");
    const checkBackup = backup => {
      if (backup?.target !== identity) {
        if (input.pendingOps) fail("operation_pending","需要当前知识库的原始操作回执。");
        fail("invalid_backup","找不到此知识库的原始操作。");
      }
      if (input.pendingOps && backup.state === "verified")
        fail("operation_pending","此操作已完成，请先结算当前批次。");
    };
    const backup = (await api.receipt(input.backup_op_id)).value;
    checkBackup(backup);
    if (input.expected_signature && backup.command !== "delete-document") fail("invalid_input", "归档签名仅用于恢复归档卡。");
    // Status can finish a batch action between routing and acquiring the write lock.
    const recoveryGuard = input.pendingOps && (async () => checkBackup((await api.receipt(input.backup_op_id)).value));
    const args = {
      op_id:input.op_id, backup_op_id:input.backup_op_id,
      expected_revision:input.expected_revision, expected_hash:input.expected_revision,
      ...(input.expected_signature && {expected_signature:input.expected_signature}),
    };
    const recoveryOptions = {
      retryRecovery: true,
      guard: recoveryGuard,
      confirm: (rec, persist) => confirmReceipt(documents, rec, persist),
      async retryDocument(rec) {
        if (!rec.writeStarted && !rec.documentId) return true;
        if (!rec.restoreDocument || rec.documentId !== backup.documentId) return false;
        return matchesRecoveryAttempt(rec, await documents.snapshot(rec.documentId));
      }
    };
    const restored = await execute(api, "recover", args, {recoveryOptions});
    return { id:restored.id, revision:restored.revision, hash:restored.hash, deleted:restored.deleted, op_id:input.op_id };
  }
  if (method === "raw-order-readings") return orderRawReadings(api,documents,input);
  if (method === "raw-outcome") {
    const request=input.request;
    if (request?.identity!==identity) fail("outside_scope","待结算请求属于其他知识库。");
    const command = input.method==="raw-relation" ? "raw-create-relation" :
      input.method==="raw-order-readings" ? "raw-order-readings" : !request.expected_revision ? "raw-create-document" :
      request.legacy ? "raw-convert-document" : "save-document";
    const {id,title,markdown,op_id,expected_revision} = request;
    const originalInput=command==="save-document" ? {id,title,markdown,op_id,expected_revision,
      ...(request.expected_signature && {expected_signature:request.expected_signature})} : request;
    return api.withReceipt(op_id, async (rec, publish) => {
      if (rec && (rec.target!==identity || rec.command!==command || rec.requestHash!==digest({command,input:originalInput,target:identity})))
        fail("operation_conflict","结算回执与冻结请求不符。");
      if (!publish) return {state:"pending",op_id,recoveryRevision:null};
      if (!rec) return {state:"unstarted"};
      if (isUnprovenDocumentReceipt(rec)) return {state:"pending", op_id, error:rec.error.message,
        recoveryRevision:hasWriteWitness(rec) ? rec.recoveryRevision : null};
      if (rec.documentId && ["save-document", "raw-convert-document"].includes(command))
        await confirmReceipt(documents, rec, () => publish(rec));
      if (rec.state==="verified") return {state:"applied",result:rec.result};
      if (!rec.writeStarted && !rec.documentId) return {state:"unstarted"};
      if (rec.beforeDocument) {
        const now=await documents.snapshot(rec.documentId);
        if (matchesNativeSnapshot(now, rec.beforeDocument)) {
          // A native restore can refresh timestamps while preserving every stable block.
          return {state:"unstarted",restored:{id:now.id,revision:now.revision}};
        }
      }
      return {state:"pending",op_id,recoveryRevision:hasWriteWitness(rec) ? rec.recoveryRevision : null,
        // The previously bound parent revision still guards a failed reading order change.
        canAbandon: command==="raw-order-readings",
        resumable:["raw-create-document","raw-create-relation","raw-order-readings","raw-convert-document"].includes(command)};
    }, {readWhenBusy: true});
  }
  if (method === "raw-probe") {
    const results = [];
    for (const item of input.items) results.push(await probe(api, documents, item,identity));
    return results;
  }
  if (method === "raw-source") {
    const library = store(api,identity), stored = library.restoreSource(input.record);
    return {id:stored.id, digest:digest(library.getSource(stored.id))};
  }
  if (method === "raw-relation") {
    const {record,documentId} = input;
    if (!blockId.test(documentId) || !(Number.isSafeInteger(record?.id) || (typeof record?.id === "string" && record.id))) fail("invalid_input","归档关系标识无效。");
    return api.operate("raw-create-relation",input,async (rec,persist) => {
      const previous = await relation(api,record.id);
      if (previous && digest(previous)!==digest(record)) fail("content_conflict","归档关系元信息不同。");
      if (!previous) {
        const path = "/"+api.c.relationsRootId+"/"+documentId+".sy";
        const [row] = await api.sql(`SELECT id,path FROM blocks WHERE id=${quote(documentId)} LIMIT 1`);
        if (row && (!rec.documentId || row.path !== path)) fail("identity_conflict","归档文档标识已占用。");
        rec.documentId=documentId; persist();
        if (!row) await api.newDoc(documentId,String(record.id),String(record.note || record.relation_type || record.id),api.c.relationsRootId);
        await api.setAttrs(documentId,{"custom-cd-kind":"relation","custom-cd-relation":JSON.stringify(record)});
        await api.flush();
      }
      const saved = await relation(api,record.id);
      if (!saved || digest(saved)!==digest(record)) fail("readback_conflict","归档关系未核实。");
      return {digest:digest(saved)};
    });
  }
  if (method === "raw-asset") {
    const bytes = Buffer.from(input.bytes, "base64");
    if (hash(bytes) !== input.sha256 || !/^assets\/raw-[0-9a-f]{64}(?:\.[a-z0-9]{1,12})?$/.test(input.path) ||
        !input.path.startsWith("assets/raw-" + input.sha256)) fail("invalid_input","冻结的附件名称或哈希不匹配。");
    const path = assetFile(api, input.path);
    mkdirSync(dirname(path), {recursive:true});
    if (!existsSync(path)) {
      const tmp = path + ".tmp-" + randomUUID();
      writeFileSync(tmp, bytes, {mode:0o600, flag:"wx"});
      try { linkSync(tmp, path); } catch (e) { if(e.code !== "EEXIST") throw e; }
      finally { unlinkSync(tmp); }
    }
    const result = await probe(api, documents, {kind:"asset",path:input.path});
    if (result?.sha256 !== input.sha256) fail("readback_conflict","已有附件的字节与冻结计划不符。");
    return result;
  }
  if (method === "raw-archive") {
    if (input.expected_signature !== undefined && (typeof input.expected_signature !== "string" || !/^[0-9a-f]{64}$/.test(input.expected_signature)))
      fail("invalid_input", "需要原生块签名。");
    const response = await documents.delete({op_id:input.op_id,id:input.id,expected_revision:input.expected_revision,
      ...(input.expected_signature && {expected_signature:input.expected_signature})});
    return {id:response.id,revision:response.revision,deleted:response.deleted};
  }
  if (method !== "raw-document") fail("invalid_command","未知的原稿同步操作。");
  const {kind, id, title, markdown, expected_revision, op_id} = input;
  if (!["card","reading"].includes(kind) || !blockId.test(id) || (kind === "reading" && !blockId.test(input.parent)) ||
      typeof title !== "string" || !title.trim() || title.length > 1000 || /[\r\n\0]/u.test(title))
    fail("invalid_input","冻结的文档输入无效。");
  markdownChunks(markdown);
  if (!expected_revision) return createDocument(api, documents, input);
  if (input.expected_signature !== undefined && (typeof input.expected_signature !== "string" || !/^[0-9a-f]{64}$/.test(input.expected_signature)))
    fail("invalid_input","需要原生块签名。");
  const args = {id, title, markdown, op_id, expected_revision,
    ...(input.expected_signature && {expected_signature:input.expected_signature})};
  const retryOptions = {
    async guard(receipt) {
      if (receipt) return;
      const current = await probe(api, documents, input);
      if (current?.revision !== expected_revision) fail("content_conflict","写前文档版本冲突。");
    },
    confirm: (rec, persist) => confirmReceipt(documents, rec, persist),
    async retryDocument(rec) {
      if (!rec.writeStarted && !rec.documentId && !rec.beforeDocument && !rec.completed) return true;
      if (rec.documentId !== id || !rec.beforeDocument || rec.beforeDocument.revision !== expected_revision) return false;
      const current = await documents.snapshot(id);
      return current.revision === expected_revision && matchesNativeSnapshot(current, rec.beforeDocument);
    }
  };
  const result = input.legacy ? await convertLegacy(api, documents, input, retryOptions) : await documents.save(args,retryOptions);
  return {id:result.id,revision:result.revision};
}
