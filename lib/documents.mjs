import { documentReceiptView, hasFrozenRecoveryResult, hasWriteWitness, matchesWriteWitness } from "./document-receipt.mjs";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { deletedAttr, hash, id, quote, fail, normalize, canonical } from "./siyuan.mjs";
import { readableMarkdown } from "./compact.mjs";
import { markdownStart } from "./markdown.mjs";
import { imageMarkdown } from "./image-markdown.mjs";
import { readOrderedReadings } from "./raw-reading-order.mjs";
import { documentTags, listOptions } from "./card-list.mjs";
import { CardBodyReader } from "./card-body-reader.mjs";
import { activePath, cardMatch, cardScope, scopedContent, splitQuery } from "./library-scope.mjs";

const parseMarkdown = (source) => fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
const semanticKey = (source) => JSON.stringify(parseMarkdown(imageMarkdown(source)), function (key, value) {
  if (["position", "spread"].includes(key)) return undefined;
  if (key === "value" && this?.type === "text") return value.replace(/^\u200b+|\u200b+$/g, "");
  return value;
});
export const markdownEquivalent = (left, right) => semanticKey(left) === semanticKey(right);

const blockID = /^\d{14}-[a-z0-9]{7}$/;
const stableAttrs = (attrs) => Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== "updated" && key !== deletedAttr));
export const documentMarkdown = (value) => imageMarkdown(readableMarkdown(normalize(value))).replace(/^\u200b$/, "");
const sameMarkdown = markdownEquivalent;
export const documentRevision = ({ title, raw, attrs }) => hash(canonical({ title, raw, attrs }));
const signatureOf = (snapshot) => hash(canonical({
  title: snapshot.title,
  attrs: stableAttrs(snapshot.attrs),
  blocks: snapshot.nodes.map((node) => ({ id: node.id, type: node.type, parent: node.parent, markdown: normalize(node.raw), attrs: stableAttrs(node.attrs) })),
}));

// Old receipts include the original native blocks. Recompute their signature
// with today's literal-preserving normalization before verifying a restore.
export function matchesNativeSnapshot(current, saved) {
  const expected = Array.isArray(saved.nodes) ? signatureOf(saved) : saved.signature;
  return current.signature === expected;
}

// A pre-write checkpoint can authorize retrying this frozen restore only. It
// never serves as post-write evidence for confirmation or undo.
export function matchesRecoveryAttempt(rec, current) {
  if (rec.recoveryRevision || rec.recoverySignature) return matchesWriteWitness(rec, current);
  if (rec.restoreStart) return Boolean(rec.restoreStart.signature) &&
    current.signature === rec.restoreStart.signature && current.revision === rec.restoreStart.revision;
  const before = rec.beforeDocument;
  return !rec.writeStarted && Boolean(before?.revision) && before.revision === current.revision &&
    matchesNativeSnapshot(current, before);
}

export function markdownChunks(markdown) {
  if (typeof markdown !== "string" || markdown.length > 4 * 1024 * 1024)
    fail("invalid_input", "Markdown must be text of at most 4 MiB");
  markdown = markdown.replace(/^\uFEFF/, "");
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
  return nodes.map((node) => ({ kind: node.type, markdown: markdown.slice(markdownStart(markdown, node), node.position.end.offset) }));
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
  const beforeIndex = new Map(before.map((node, at) => [node.id, at]));
  for (let at = 0; at < n; at++) assigned[at] ??= id();
  const changes = [];
  for (let at = 0; at < n; at++) {
    const oldAt = beforeIndex.get(assigned[at]);
    if (oldAt !== undefined && keysA[oldAt] !== keysB[at]) {
      const old = before[oldAt];
      changes.push({ action: "update", id: old.id, markdown: after[at].markdown, attrs: old.attrs, descendants: old.descendants });
    }
  }
  for (let at = 0; at < m; at++) if (!used.has(at)) changes.push({ action: "delete", id: before[at].id });
  const desired = assigned.filter((key) => beforeIndex.has(key));
  const retained = before.filter((_node, at) => used.has(at));
  if (JSON.stringify(desired) !== JSON.stringify(retained.map((node) => node.id))) {
    if (new Set(retained.map((node) => node.parent)).size > 1)
      fail("unsupported_structure", "跨原生布局块调序暂不支持，请在原稿中保留这些块的顺序。");
    // Anchoring every subsequent retained block after its desired predecessor
    // also moves a new first block into place without rebuilding any block.
    for (let at = 1; at < desired.length; at++) changes.push({ action: "move", id: desired[at], previousID: desired[at - 1] });
  }
  for (let at = 0; at < n; at++) {
    if (beforeIndex.has(assigned[at])) continue;
    const next = assigned.slice(at + 1).find((key) => beforeIndex.has(key));
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
    let reason = attrs["custom-cd-schema"] === "1" ? "此卡片使用早期固定字段格式。" : "";
    const visit = async (parent, visible, depth = 0) => {
      if (depth > 30 || nodes.length > 5000) fail("unsupported_structure", "Document structure is too large");
      for (const child of (await this.a.api("/api/block/getChildBlocks", { id: parent })) ?? []) {
        const node = { id: child.id, type: child.type, parent, raw: await this.a.markdown(child.id), attrs: await this.a.attrs(child.id) };
        nodes.push(node);
        if (node.type === "s") {
          const own = Boolean(node.attrs["custom-cd-operation"]);
          if (!own) reason ||= "此卡片包含原生布局，整篇替换会改变其结构。";
          await visit(node.id, visible && own, depth + 1);
        } else {
          const markdown = documentMarkdown(node.raw);
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
    const snapshot = { id: doc, anchor, title: row.content, updated: row.updated, raw, attrs, nodes, units, markdown: documentMarkdown(raw), editable: !reason, readOnlyReason: reason };
    snapshot.revision = documentRevision(snapshot);
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
    const readings = await readOrderedReadings(this.a, snapshot.id, snapshot.attrs);
    return { id: snapshot.id, anchor: snapshot.anchor, title: snapshot.title, updated: updated[0]?.updated ?? snapshot.attrs?.updated ?? "", tags: documentTags(snapshot.markdown), markdown: snapshot.markdown, blocks: snapshot.units.map(({ id, markdown }) => ({ id, markdown })), revision: snapshot.revision, editable: snapshot.editable, deletable: snapshot.attrs?.["custom-cd-kind"] !== "article" && !snapshot.attrs?.["custom-cd-parent"], readOnlyReason: snapshot.readOnlyReason, ...(legacyFixedFields && { legacyFixedFields }), readings: readings.map((row) => ({ id: row.id, title: row.content, url: this.publicUrl + "/?id=" + row.id })), url: this.publicUrl + "/?id=" + snapshot.id };
  }
  async list(input = {}, { signal, cardBodies = new CardBodyReader(this.a) } = {}) {
    signal?.throwIfAborted();
    const {offset,limit,query,tag,updatedFrom,updatedTo,includeTags} = listOptions(input);
    const terms = splitQuery(query);
    const search = terms.length ? `AND ${cardMatch(terms)}` : "";
    const updated = this.updatedSql();
    const dates = `${updatedFrom ? " AND "+updated+" >= "+quote(updatedFrom.replaceAll('-','')+'000000') : ''}${updatedTo ? " AND "+updated+" <= "+quote(updatedTo.replaceAll('-','')+'235959') : ''}`;
    const scope = `${cardScope(this.a.c)} ${search} ${dates}`;
    const selection = `SELECT b.id,b.content,${updated} AS updated FROM blocks b WHERE ${scope} ORDER BY updated DESC,b.id DESC`;
    const item = row => ({ id: row.id, title: row.content, summary: '', updated: row.updated });
    const withTags = (row, raw) => ({
      ...item(row), tags: cardBodies.derive('tags', row.id, raw, documentTags),
    });
    if (includeTags !== true && !tag) {
      const count = await this.a.sql(`SELECT count(*) AS total FROM blocks b WHERE ${scope}`, { signal });
      signal?.throwIfAborted();
      const rows = await this.a.sql(`${selection} LIMIT ${limit} OFFSET ${offset}`, { signal });
      signal?.throwIfAborted();
      const total = Number(count[0]?.total ?? 0);
      const items = includeTags === 'page' ? await cardBodies.read(rows, { signal }, withTags) : rows.map(item);
      return { items, offset, limit, total, hasMore: offset + rows.length < total };
    }
    const rows = await this.a.sql(`${selection} LIMIT 10001`, { signal });
    signal?.throwIfAborted();
    if (rows.length>10000) fail('invalid_input','Narrow the filters before loading tags');
    const cards = await cardBodies.read(rows, { signal }, withTags);
    const filtered = tag ? cards.filter(card=>card.tags.includes(tag)) : cards;
    const result = {items:filtered.slice(offset,offset+limit),offset,limit,total:filtered.length,hasMore:offset+limit<filtered.length};
    if (includeTags !== 'page') result.tags = [...new Set(cards.flatMap(card=>card.tags))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
    return result;
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
      if (input.expected_signature && before.signature !== input.expected_signature)
        fail("content_conflict", "卡片原生块已修改，请重新预览归档。");
      rec.documentId = before.id;
      rec.beforeDocument = before;
      rec.deletionMarker = input.op_id;
      persist();
      return this.writeDeletion(rec, persist);
    });
  }
  async restoreDeleted(input, original, retryOptions) {
    return this.a.operate("recover-deleted-document", input, async (rec, persist) => {
      if (original.target !== rec.target || original.state !== "verified" || !original.afterRevision)
        fail("invalid_backup", "A verified deletion from this library is required");
      const before = await this.snapshot(original.documentId, { includeDeleted: true });
      if (before.attrs[deletedAttr] !== original.input.op_id || before.revision !== original.afterRevision ||
          input.expected_revision !== original.afterRevision || (input.expected_signature && before.signature !== input.expected_signature))
        fail("content_conflict", "卡片状态已变化，无法恢复此次删除。");
      rec.documentId = before.id;
      rec.beforeDocument = before;
      rec.deletionMarker = "";
      if (retryOptions?.retryRecovery) rec.writeStarted = true;
      persist();
      return this.writeDeletion(rec, persist);
    }, retryOptions);
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
        !matchesNativeSnapshot(current, rec.beforeDocument))
      fail("operation_pending", "删除或恢复结果尚未确认。");
    rec.afterRevision = current.revision;
    persist();
    return { id: current.id, revision: current.revision, deleted: Boolean(rec.deletionMarker), op_id: rec.input.op_id };
  }
  async save(input, retryOptions) {
    const title = titleInput(input.title);
    const chunks = markdownChunks(input.markdown);
    return this.a.operate("save-document", input, async (rec, persist) => {
      const before = await this.snapshot(input.id);
      if (!before.editable) fail("unsupported_structure", before.readOnlyReason);
      if (before.revision !== input.expected_revision) fail("content_conflict", "内容已修改，请重新读取；当前编辑内容尚未保存。");
      if (input.expected_signature && before.signature !== input.expected_signature)
        fail("content_conflict", "卡片原生块已修改，请重新读取后再保存。");
      const plan = diffBlocks(before.units, chunks);
      rec.documentId = before.id; rec.beforeDocument = before;
      rec.intendedTitle = title; rec.intendedMarkdown = input.markdown;
      rec.steps = plan.changes; rec.completed = 0;
      try {
        return await this.writeDocument(rec, persist, async () => {
          if (!plan.changes.length && title === before.title) return before;
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
        });
      } catch (error) {
        if (rec.writeStarted && !["transport_unknown", "readback_conflict", "operation_pending"].includes(error.code))
          fail("operation_pending", "保存可能部分完成，请先查询操作状态。" );
        throw error;
      }
    }, retryOptions);
  }
  result(snapshot, op_id) { return { id: snapshot.id, title: snapshot.title, markdown: snapshot.markdown, revision: snapshot.revision, hash: hash(snapshot.raw), op_id }; }
  // Only the original writer (or its guarded retry) may capture a post-write
  // version. A later reader may compare both fields, never create either.
  async writeDocument(rec, persist, mutate) {
    delete rec.recoveryRevision;
    delete rec.recoverySignature;
    delete rec.afterRevision;
    delete rec.afterSignature;
    delete rec.afterHash;
    rec.writeStarted = false;
    persist();

    const capture = snapshot => {
      if (!snapshot.revision || !snapshot.signature) fail("readback_conflict", "缺少原生文档的完整写后版本。");
      rec.recoveryRevision = snapshot.revision;
      rec.recoverySignature = snapshot.signature;
      persist();
    };
    try {
      const unchanged = await mutate();
      const current = unchanged ?? await this.snapshot(rec.documentId);
      capture(current);
      return await this.confirmDocumentWrite(rec, persist, current);
    } catch (error) {
      if (rec.writeStarted && !hasWriteWitness(rec)) {
        try { capture(await this.snapshot(rec.documentId)); } catch {}
      }
      throw error;
    }
  }

  async confirmDocumentWrite(rec, persist, observed) {
    if (!hasWriteWitness(rec)) fail("operation_pending", "回执缺少原写入方记录的修订或原生块签名。");
    const current = observed ?? await this.snapshot(rec.documentId);
    if (!matchesWriteWitness(rec, current)) fail("operation_pending", "当前文档与原写入记录未能核对。");
    if (rec.command === "recover-document") {
      if (!matchesNativeSnapshot(current, rec.restoreDocument)) fail("operation_pending", "恢复后的原生内容尚未完整核对。");
    } else {
      if (rec.command === "raw-convert-document" && current.attrs["custom-cd-schema"] !== "2")
        fail("operation_pending", "旧卡格式状态未核实。");
      if (current.title !== rec.intendedTitle || !sameMarkdown(current.markdown, rec.intendedMarkdown))
        fail("operation_pending", "保存结果尚未核对完成；请保留当前编辑内容。");
    }
    rec.afterRevision = current.revision; rec.afterHash = hash(current.raw); rec.afterSignature = current.signature; persist();
    return this.result(current, rec.input.op_id);
  }
  async recover(input, original, retryOptions) {
    return this.a.operate("recover-document", input, async (rec, persist) => {
      original = documentReceiptView(original);
      const savedRevision = original.state === "verified" ? original.afterRevision :
        ["prepared", "unknown"].includes(original.state) ? original.recoveryRevision : null;
      if (original.target !== await this.a.identity() || !savedRevision || !original.beforeDocument)
        fail("invalid_backup", "此知识库中没有可核对写后状态的整篇保存备份。");
      const expected = input.expected_revision ?? input.expected_hash;
      if (expected !== savedRevision && !(original.state === "verified" && expected === original.afterHash))
        fail("content_conflict", "恢复需要原保存操作的写后版本。");
      const legacyRestore = hasFrozenRecoveryResult(original);
      if (!hasWriteWitness(original) && !legacyRestore)
        fail("content_conflict", "原回执缺少可核实的原生块签名，不能自动恢复。");
      const current = await this.snapshot(original.documentId);
      // A retry of a partially applied restore needs its own witness. The first
      // restore checks the original write, or the frozen target of an old full restore.
      let matches;
      if (rec.restoreDocument || rec.writeStarted || rec.recoveryRevision) matches = matchesRecoveryAttempt(rec, current);
      else if (legacyRestore) matches = current.revision === savedRevision && matchesNativeSnapshot(current, original.restoreDocument);
      else matches = matchesWriteWitness(original, current);
      if (!matches) fail("content_conflict", "保存后的完整版本无法核对，不能覆盖后续修改。");
      if (!rec.restoreDocument) {
        rec.documentId = original.documentId; rec.restoreDocument = original.beforeDocument;
        rec.beforeDocument = current; rec.intendedTitle = original.beforeDocument.title; rec.intendedMarkdown = original.beforeDocument.markdown;
      }
      rec.restoreStart = {revision:current.revision, signature:current.signature};
      try {
        return await this.writeDocument(rec, persist, async () => {
          rec.writeStarted = true; persist();
          await this.a.api("/api/block/updateBlock", {id:rec.documentId, dataType:"markdown", data:rec.restoreDocument.raw});
          await this.a.api("/api/filetree/renameDocByID", {id:rec.documentId, title:rec.restoreDocument.title});
          await this.a.setAttrs(rec.documentId, stableAttrs(rec.restoreDocument.attrs));
          await this.a.flush();
        });
      } catch (error) {
        if (!["transport_unknown", "readback_conflict", "operation_pending"].includes(error.code)) fail("operation_pending", "恢复可能部分完成，请先查询操作状态。");
        throw error;
      }
    }, retryOptions);
  }
}
