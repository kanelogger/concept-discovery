import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { deletedAttr, hash, id, quote, fail, normalize, canonical } from "./siyuan.mjs";
import { readableMarkdown } from "./compact.mjs";
import { imageMarkdown } from "./image-markdown.mjs";
import { documentTags, listOptions, mapConcurrent } from "./card-list.mjs";
import { activePath, cardMatch, cardScope, readingIds, scopedContent, splitQuery } from "./library-scope.mjs";

const parseMarkdown = (source) => fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
const semanticKey = (source) => JSON.stringify(parseMarkdown(imageMarkdown(source)), function (key, value) {
  if (["position", "spread"].includes(key)) return undefined;
  if (key === "value" && this?.type === "text") return value.replace(/^\u200b+|\u200b+$/g, "");
  return value;
});
export const markdownEquivalent = (left, right) => semanticKey(left) === semanticKey(right);

const blockID = /^\d{14}-[a-z0-9]{7}$/;
const stableAttrs = (attrs) => Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== "updated" && key !== deletedAttr));
const clean = (value) => imageMarkdown(readableMarkdown(normalize(value))).replace(/^\u200b$/, "");
const sameMarkdown = markdownEquivalent;
const revisionOf = (snapshot) => hash(canonical({ title: snapshot.title, raw: snapshot.raw, attrs: snapshot.attrs }));
const signatureOf = (snapshot) => hash(canonical({
  title: snapshot.title,
  attrs: stableAttrs(snapshot.attrs),
  blocks: snapshot.nodes.map((node) => ({ id: node.id, type: node.type, parent: node.parent, markdown: normalize(node.raw), attrs: stableAttrs(node.attrs) })),
}));

export function markdownChunks(markdown) {
  if (typeof markdown !== "string" || markdown.length > 4 * 1024 * 1024)
    fail("invalid_input", "Markdown must be text of at most 4 MiB");
  const nodes = parseMarkdown(markdown).children;
  const protectedSpans = [];
  function visit(node) {
    if (["code", "inlineCode", "html"].includes(node.type)) {
      protectedSpans.push([node.position.start.offset, node.position.end.offset]);
      return;
    }
    for (const child of node.children ?? []) visit(child);
  }
  for (const node of nodes) visit(node);
  for (const expression of [/(?<!\\)\{:\s+/g, /^(?:\s*>?\s*)(?:\{\{\{(?:row|col)?|\}\}\})\s*$/gm]) {
    for (const match of markdown.matchAll(expression)) {
      if (!protectedSpans.some(([start, end]) => match.index >= start && match.index < end))
        fail("unsupported_structure", "Native layout or attribute syntax cannot be edited as plain Markdown");
    }
  }
  if (nodes.length > 1000) fail("invalid_input", "Document has too many top-level blocks");
  return nodes.map((node) => ({ kind: node.type, markdown: markdown.slice(node.position.start.offset, node.position.end.offset) }));
}

// Equal blocks retain their identity even when reordered. LCS anchors resolve
// repeated text in context; remaining equal occurrences retain source order.
export function diffBlocks(before, after) {
  const m = before.length, n = after.length;
  if (m > 1000 || n > 1000) fail("unsupported_structure", "Document has too many editable blocks");
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  const keysA = before.map((node) => semanticKey(node.markdown));
  const keysB = after.map((node) => semanticKey(node.markdown));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = keysA[i] === keysB[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const anchors = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (keysA[i] === keysB[j]) anchors.push([i++, j++]);
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const assigned = Array(n), used = new Set();
  const assign = (oldAt, newAt) => { assigned[newAt] = before[oldAt].id; used.add(oldAt); };
  for (const [oldAt, newAt] of anchors) assign(oldAt, newAt);
  for (let newAt = 0; newAt < n; newAt++) {
    if (assigned[newAt]) continue;
    const oldAt = before.findIndex((_node, at) => !used.has(at) && keysA[at] === keysB[newAt]);
    if (oldAt >= 0) assign(oldAt, newAt);
  }
  let oldStart = 0, newStart = 0;
  for (const [oldEnd, newEnd] of [...anchors, [m, n]]) {
    const oldRun = [], newRun = [];
    for (let at = oldStart; at < oldEnd; at++) if (!used.has(at)) oldRun.push(at);
    for (let at = newStart; at < newEnd; at++) if (!assigned[at]) newRun.push(at);
    for (let at = 0; at < Math.min(oldRun.length, newRun.length); at++) assign(oldRun[at], newRun[at]);
    oldStart = oldEnd + 1; newStart = newEnd + 1;
  }
  const byID = new Map(before.map((node) => [node.id, node]));
  for (let at = 0; at < n; at++) assigned[at] ??= id();
  const changes = [];
  for (let at = 0; at < n; at++) {
    const old = byID.get(assigned[at]);
    if (old && !sameMarkdown(old.markdown, after[at].markdown)) changes.push({ action: "update", id: old.id, markdown: after[at].markdown, attrs: old.attrs, descendants: old.descendants });
  }
  for (let at = 0; at < m; at++) if (!used.has(at)) changes.push({ action: "delete", id: before[at].id });
  const desired = assigned.filter((key) => byID.has(key));
  const retained = before.filter((_node, at) => used.has(at));
  if (JSON.stringify(desired) !== JSON.stringify(retained.map((node) => node.id))) {
    if (new Set(retained.map((node) => node.parent)).size > 1)
      fail("unsupported_structure", "跨原生布局块调序暂不支持，请保留顺序或通过 Agent 按块维护。");
    // Anchoring every subsequent retained block after its desired predecessor
    // also moves a new first block into place without rebuilding any block.
    for (let at = 1; at < desired.length; at++) changes.push({ action: "move", id: desired[at], previousID: desired[at - 1] });
  }
  for (let at = 0; at < n; at++) {
    if (byID.has(assigned[at])) continue;
    const next = assigned.slice(at + 1).find((key) => byID.has(key));
    changes.push({ action: "insert", id: assigned[at], markdown: after[at].markdown, nextID: next, previousID: !next && at > 0 ? assigned[at - 1] : undefined });
  }
  return { changes, assigned };
}

function titleInput(title) {
  if (typeof title !== "string" || !title.trim() || title.length > 1000 || /[\r\n\u0000]/.test(title))
    fail("invalid_input", "A nonempty single-line title is required (at most 1000 characters)");
  return title.trim();
}

export class Documents {
  constructor(api, knowledge, publicUrl = "") { this.a = api; this.k = knowledge; this.publicUrl = publicUrl.replace(/\/$/, ""); }
  async resolve(ref, { includeDeleted = false } = {}) {
    let info;
    if (blockID.test(ref ?? "")) info = await this.a.inScope(ref);
    else info = await this.a.inScope(await this.k.locate(ref));
    if (!info.path.startsWith("/" + this.a.c.libraryRootId + "/")) fail("outside_scope", "Document is outside the knowledge library");
    const doc = info.type === "d" ? info.id : info.root_id;
    const attrs = await this.a.attrs(doc);
    if (attrs["custom-cd-kind"] && !["concept", "article"].includes(attrs["custom-cd-kind"]))
      fail("outside_scope", "Document is not a knowledge card or reading");
    await this.a.requireActivePath(info.path, includeDeleted ? doc : undefined);
    return { doc, anchor: info.type === "d" ? undefined : info.id, attrs };
  }
  async snapshot(ref, options) {
    const { doc, anchor, attrs } = await this.resolve(ref, options);
    const row = (await this.a.sql(`SELECT id,content,updated FROM blocks WHERE id=${quote(doc)} AND box=${quote(this.a.c.notebookId)}`))[0];
    if (!row) fail("outside_scope", "Document missing");
    const raw = await this.a.markdown(doc);
    const nodes = [], units = [];
    let reason = attrs["custom-cd-schema"] === "1" ? "早期固定字段卡片通过 Agent 按块维护。" : "";
    const visit = async (parent, visible, depth = 0) => {
      if (depth > 30 || nodes.length > 5000) fail("unsupported_structure", "Document structure is too large");
      for (const child of (await this.a.api("/api/block/getChildBlocks", { id: parent })) ?? []) {
        const node = { id: child.id, type: child.type, parent, raw: await this.a.markdown(child.id), attrs: await this.a.attrs(child.id) };
        nodes.push(node);
        if (node.type === "s") {
          const own = Boolean(node.attrs["custom-cd-operation"]);
          if (!own) reason ||= "此卡片包含原生布局，暂通过 Agent 按块维护。";
          await visit(node.id, visible && own, depth + 1);
        } else {
          const markdown = clean(node.raw);
          if (visible && markdown) {
            try { markdownChunks(markdown); } catch { reason ||= "此卡片包含无法保真编辑的原生结构。"; }
            if (["av", "query_embed", "widget", "iframe", "video", "audio"].includes(node.type)) reason ||= "此卡片包含暂不支持整篇编辑的内容。";
            const unit = { ...node, markdown, descendants: [] };
            units.push(unit);
            // Retain metadata of nested list/quote blocks when native updates
            // preserve their IDs. Leaf blocks have an empty child list.
            if (["l", "b", "q", "i"].includes(node.type)) {
              const start = nodes.length;
              await visit(node.id, false, depth + 1);
              unit.descendants = nodes.slice(start);
            }
          } else if (["l", "b", "q", "i"].includes(node.type)) {
            await visit(node.id, false, depth + 1);
          }
        }
      }
    };
    await visit(doc, true);
    const snapshot = { id: doc, anchor, title: row.content, updated: row.updated, raw, attrs, nodes, units, markdown: clean(raw), editable: !reason, readOnlyReason: reason };
    snapshot.revision = revisionOf(snapshot);
    snapshot.signature = signatureOf(snapshot);
    return snapshot;
  }
  updatedSql() {
    return `coalesce((SELECT max(s.updated) ${scopedContent()}), b.updated)`;
  }
  async get(ref) {
    const snapshot = await this.snapshot(ref);
    const legacyFixedFields = snapshot.attrs?.["custom-cd-schema"] === "1";
    const updated = await this.a.sql(`SELECT ${this.updatedSql()} AS updated FROM blocks b WHERE b.id=${quote(snapshot.id)} AND b.box=${quote(this.a.c.notebookId)} LIMIT 1`);
    const readings = await this.a.sql(`SELECT d.id,d.content,
      (SELECT value FROM attributes WHERE block_id=d.id AND name='custom-cd-locale' LIMIT 1) AS locale
      FROM blocks b JOIN blocks d ON d.id IN (${readingIds()})
      WHERE b.id=${quote(snapshot.id)} AND b.box=${quote(this.a.c.notebookId)} ORDER BY d.id LIMIT 1000`);
    return { id: snapshot.id, anchor: snapshot.anchor, title: snapshot.title, updated: updated[0]?.updated ?? snapshot.attrs?.updated ?? "", tags: documentTags(snapshot.markdown, { legacyFixedFields }), markdown: snapshot.markdown, blocks: snapshot.units.map(({ id, markdown }) => ({ id, markdown })), revision: snapshot.revision, editable: snapshot.editable, deletable: snapshot.attrs?.["custom-cd-kind"] !== "article" && !snapshot.attrs?.["custom-cd-parent"], readOnlyReason: snapshot.readOnlyReason, ...(legacyFixedFields && { legacyFixedFields }), readings: readings.map((row) => ({ id: row.id, title: row.content, ...(legacyFixedFields && row.locale && { locale: row.locale }), url: this.publicUrl + "/?id=" + row.id })), url: this.publicUrl + "/?id=" + snapshot.id };
  }
  async list(input = {}) {
    const {offset,limit,query,tag,updatedFrom,updatedTo,includeTags} = listOptions(input);
    const terms = splitQuery(query);
    const search = terms.length ? `AND ${cardMatch(terms)}` : "";
    const updated = this.updatedSql();
    const dates = `${updatedFrom ? " AND "+updated+" >= "+quote(updatedFrom.replaceAll('-','')+'000000') : ''}${updatedTo ? " AND "+updated+" <= "+quote(updatedTo.replaceAll('-','')+'235959') : ''}`;
    const scope = `${cardScope(this.a.c)} ${search} ${dates}`;
    const legacyField = includeTags || tag ? `, EXISTS(SELECT 1 FROM attributes WHERE block_id=b.id AND name='custom-cd-schema' AND value='1') AS legacyFixedFields` : "";
    const chineseArticle = includeTags ? `, (
      SELECT locale.block_id FROM attributes locale
      WHERE locale.name='custom-cd-locale' AND locale.value='cn'
        AND locale.block_id IN (${readingIds()})
        AND EXISTS (SELECT 1 FROM attributes kind
          WHERE kind.block_id=locale.block_id AND kind.name='custom-cd-kind' AND kind.value='article')
      ORDER BY locale.block_id LIMIT 1
    ) AS chineseArticleId` : "";
    const selection = `SELECT b.id,b.content,${updated} AS updated${legacyField}${chineseArticle} FROM blocks b WHERE ${scope} ORDER BY updated DESC,b.id DESC`;
    if (!includeTags && !tag) {
      const count = await this.a.sql(`SELECT count(*) AS total FROM blocks b WHERE ${scope}`);
      const rows = await this.a.sql(`${selection} LIMIT ${limit} OFFSET ${offset}`);
      const total = Number(count[0]?.total ?? 0);
      return {items:rows.map(row=>({id:row.id,title:row.content,summary:'',updated:row.updated})),offset,limit,total,hasMore:offset+rows.length<total};
    }
    const rows = await this.a.sql(`${selection} LIMIT 10001`);
    if (rows.length>10000) fail('invalid_input','Narrow the filters before loading tags');
    const cards = await mapConcurrent(rows, async row => ({
      id: row.id,
      title: row.content,
      summary: '',
      updated: row.updated,
      tags: documentTags(await this.a.markdown(row.id), { legacyFixedFields: Boolean(row.legacyFixedFields) }),
      ...(row.legacyFixedFields && row.chineseArticleId && { chineseArticleId: row.chineseArticleId }),
    }));
    const tags = [...new Set(cards.flatMap(card=>card.tags))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
    const filtered = tag ? cards.filter(card=>card.tags.includes(tag)) : cards;
    return {items:filtered.slice(offset,offset+limit),offset,limit,total:filtered.length,hasMore:offset+limit<filtered.length,tags};
  }
  async create(input) {
    const title = titleInput(input.document?.title);
    const markdown = input.document?.markdown ?? "";
    markdownChunks(markdown);
    return this.a.operate("create-document", input, async (rec, persist) => {
      rec.documentId ??= id();
      rec.intendedTitle = title; rec.intendedMarkdown = markdown; persist();
      const existing = await this.a.sql(`SELECT id,path FROM blocks WHERE id=${quote(rec.documentId)} AND box=${quote(this.a.c.notebookId)}`);
      if (!existing.length) await this.a.newDoc(rec.documentId, title, markdown, this.a.c.libraryRootId);
      else {
        if (!existing[0].path.endsWith("/" + this.a.c.libraryRootId + "/" + rec.documentId + ".sy"))
          fail("outside_scope", "Partially created document moved");
        const current = await this.snapshot(rec.documentId);
        if (current.attrs["custom-cd-request"] && current.attrs["custom-cd-request"] !== rec.requestHash)
          fail("operation_conflict", "Document belongs to another creation request");
        if ((current.attrs["custom-cd-schema"] && current.attrs["custom-cd-schema"] !== "2") ||
            (current.attrs["custom-cd-kind"] && current.attrs["custom-cd-kind"] !== "concept"))
          fail("content_conflict", "Partially created document structure changed");
        if (current.title !== title || !sameMarkdown(current.markdown, markdown)) fail("content_conflict", "Partially created document changed");
      }
      await this.a.setAttrs(rec.documentId, { "custom-cd-kind": "concept", "custom-cd-schema": "2", "custom-cd-language": "cn", "custom-cd-request": rec.requestHash, "custom-cd-complete": "1" });
      return this.confirmCreation(rec);
    });
  }
  async confirmCreation(rec) {
    const current = await this.snapshot(rec.documentId);
    if (current.attrs["custom-cd-request"] !== rec.requestHash || current.attrs["custom-cd-complete"] !== "1" || current.title !== rec.intendedTitle || !sameMarkdown(current.markdown, rec.intendedMarkdown))
      fail("operation_pending", "创建内容尚未完整核对。");
    return { id: current.id, revision: current.revision, op_id: rec.input.op_id, document: await this.get(current.id) };
  }
  async delete(input) {
    if (!blockID.test(input.id ?? "")) fail("invalid_input", "A card ID is required");
    return this.a.operate("delete-document", input, async (rec, persist) => {
      const before = await this.snapshot(input.id, { includeDeleted: Boolean(rec.beforeDocument) });
      if (rec.beforeDocument && before.attrs[deletedAttr] === rec.deletionMarker)
        return this.confirmDeletion(rec, persist);
      if (before.attrs[deletedAttr])
        fail("content_conflict", "卡片已被另一项操作删除。");
      if (before.id !== input.id || before.attrs["custom-cd-kind"] === "article" || before.attrs["custom-cd-parent"])
        fail("outside_scope", "Only a knowledge card can be deleted");
      if (before.revision !== input.expected_revision)
        fail("content_conflict", "卡片已修改，请重新读取后再删除。");
      rec.documentId = before.id;
      rec.beforeDocument = before;
      rec.deletionMarker = input.op_id;
      persist();
      return this.writeDeletion(rec, persist);
    });
  }
  async restoreDeleted(input, original) {
    return this.a.operate("recover-deleted-document", input, async (rec, persist) => {
      if (original.target !== rec.target || original.state !== "verified" || !original.afterRevision)
        fail("invalid_backup", "A verified deletion from this library is required");
      const before = await this.snapshot(original.documentId, { includeDeleted: true });
      if (before.attrs[deletedAttr] !== original.input.op_id || before.revision !== original.afterRevision ||
          input.expected_revision !== original.afterRevision)
        fail("content_conflict", "卡片状态已变化，无法恢复此次删除。");
      rec.documentId = before.id;
      rec.beforeDocument = before;
      rec.deletionMarker = "";
      persist();
      return this.writeDeletion(rec, persist);
    });
  }
  async writeDeletion(rec, persist) {
    try {
      await this.a.setAttrs(rec.documentId, { [deletedAttr]: rec.deletionMarker });
      return await this.confirmDeletion(rec, persist);
    } catch {
      fail("operation_pending", "删除或恢复结果尚未确认，请查询操作状态。");
    }
  }
  async confirmDeletion(rec, persist) {
    if (!rec.beforeDocument) fail("operation_pending", "删除尚未开始。");
    await this.a.flush();
    const current = await this.snapshot(rec.documentId, { includeDeleted: true });
    const visible = await this.a.sql(`SELECT b.id FROM blocks b WHERE b.id=${quote(current.id)}
      AND b.box=${quote(this.a.c.notebookId)} AND ${activePath("b.path", "b.box")} LIMIT 1`);
    if ((current.attrs[deletedAttr] || "") !== rec.deletionMarker ||
        Boolean(visible.length) === Boolean(rec.deletionMarker) ||
        current.signature !== rec.beforeDocument.signature)
      fail("operation_pending", "删除或恢复结果尚未确认。");
    rec.afterRevision = current.revision;
    persist();
    return { id: current.id, revision: current.revision, deleted: Boolean(rec.deletionMarker), op_id: rec.input.op_id };
  }
  async save(input) {
    const title = titleInput(input.title);
    const chunks = markdownChunks(input.markdown);
    return this.a.operate("save-document", input, async (rec, persist) => {
      const before = await this.snapshot(input.id);
      if (!before.editable) fail("unsupported_structure", before.readOnlyReason);
      if (before.revision !== input.expected_revision) fail("content_conflict", "内容已修改，请重新读取；当前编辑内容尚未保存。");
      const plan = diffBlocks(before.units, chunks);
      rec.documentId = before.id; rec.beforeDocument = before;
      rec.intendedTitle = title; rec.intendedMarkdown = input.markdown;
      rec.steps = plan.changes; rec.completed = 0; persist();
      if (!plan.changes.length && title === before.title) return this.confirmSave(rec, persist);
      try {
        for (const step of plan.changes) {
          rec.writeStarted = true; persist();
          if (step.action === "update") {
            await this.a.api("/api/block/updateBlock", { id: step.id, dataType: "markdown", data: step.markdown, lockType: false });
            // Type changes (e.g. list to paragraph) can remove descendants.
            // Flush before testing their existence to avoid stale index rows.
            await this.a.flush();
            const oldNodes = [{ id: step.id, attrs: step.attrs }, ...(step.descendants ?? [])];
            for (const old of oldNodes) {
              const exists = await this.a.sql(`SELECT id FROM blocks WHERE id=${quote(old.id)} AND box=${quote(this.a.c.notebookId)}`);
              if (exists.length) await this.a.setAttrs(old.id, stableAttrs(old.attrs));
            }
          } else if (step.action === "delete") await this.a.api("/api/block/deleteBlock", { id: step.id });
          else if (step.action === "move") await this.a.api("/api/block/moveBlock", { id: step.id, previousID: step.previousID });
          else await this.a.api("/api/block/insertBlock", { dataType: "markdown", data: step.markdown + `\n{: id="${step.id}"}`, nextID: step.nextID, previousID: step.previousID, parentID: !step.nextID && !step.previousID ? before.id : undefined });
          await this.a.flush(); rec.completed++; persist();
        }
        if (title !== before.title) {
          rec.writeStarted = true; persist();
          await this.a.api("/api/filetree/renameDocByID", { id: before.id, title });
          await this.a.flush();
        }
        return await this.confirmSave(rec, persist);
      } catch (error) {
        // Capture an observed post-error revision while the shared write lock is
        // still held. Recovery may use it, but may never guess a network result.
        if (rec.writeStarted) {
          try { rec.recoveryRevision = (await this.snapshot(rec.documentId)).revision; persist(); } catch {}
        }
        if (rec.writeStarted && !["transport_unknown", "readback_conflict", "operation_pending"].includes(error.code))
          fail("operation_pending", "保存可能部分完成，请先查询操作状态。" );
        throw error;
      }
    });
  }
  result(snapshot, op_id) { return { id: snapshot.id, title: snapshot.title, markdown: snapshot.markdown, revision: snapshot.revision, hash: hash(snapshot.raw), op_id }; }
  async confirmSave(rec, persist) {
    const current = await this.snapshot(rec.documentId);
    if (current.title !== rec.intendedTitle || !sameMarkdown(current.markdown, rec.intendedMarkdown)) fail("operation_pending", "保存结果尚未核对完成；请保留当前编辑内容。");
    rec.afterRevision = current.revision; rec.afterHash = hash(current.raw); rec.afterSignature = current.signature; persist();
    return this.result(current, rec.input.op_id);
  }
  async recover(input, original) {
    return this.a.operate("recover-document", input, async (rec, persist) => {
      const savedRevision = original.state === "verified" ? original.afterRevision : original.state === "unknown" ? original.recoveryRevision : null;
      if (original.target !== await this.a.identity() || !savedRevision || !original.beforeDocument)
        fail("invalid_backup", "此知识库中没有可核对写后状态的整篇保存备份。");
      const current = await this.snapshot(original.documentId);
      const expected = input.expected_revision ?? input.expected_hash;
      if (expected !== savedRevision && !(original.state === "verified" && expected === original.afterHash)) fail("content_conflict", "恢复需要原保存操作的写后版本。");
      if (current.revision !== savedRevision) fail("content_conflict", "保存后内容已有变化，不能覆盖后续修改。");
      rec.documentId = original.documentId; rec.restoreDocument = original.beforeDocument;
      rec.beforeDocument = current; rec.intendedTitle = original.beforeDocument.title; rec.intendedMarkdown = original.beforeDocument.markdown; persist();
      rec.writeStarted = true; persist();
      try {
        // A native backup includes the original IDs and metadata. It is restored
        // only after matching the complete post-write revision, never for saves.
        await this.a.api("/api/block/updateBlock", { id: rec.documentId, dataType: "markdown", data: rec.restoreDocument.raw });
        await this.a.api("/api/filetree/renameDocByID", { id: rec.documentId, title: rec.restoreDocument.title });
        await this.a.setAttrs(rec.documentId, stableAttrs(rec.restoreDocument.attrs));
        await this.a.flush();
        return await this.confirmRecovery(rec, persist);
      } catch (error) {
        // The recovery itself can stop after only some writes. Keep an observed
        // revision under the same lock so that operation can be safely undone.
        if (rec.writeStarted) {
          try { rec.recoveryRevision = (await this.snapshot(rec.documentId)).revision; persist(); } catch {}
        }
        if (!["transport_unknown", "readback_conflict", "operation_pending"].includes(error.code)) fail("operation_pending", "恢复可能部分完成，请先查询操作状态。");
        throw error;
      }
    });
  }
  async confirmRecovery(rec, persist) {
    const current = await this.snapshot(rec.documentId);
    if (current.signature !== rec.restoreDocument.signature) fail("operation_pending", "恢复后的原生内容尚未完整核对。");
    rec.afterRevision = current.revision; rec.afterHash = hash(current.raw); persist();
    return this.result(current, rec.input.op_id);
  }
}
