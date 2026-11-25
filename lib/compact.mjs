import { hash, quote, fail, normalize } from "./siyuan.mjs";
import { fromMarkdown } from "mdast-util-from-markdown";
import { markdownTree } from "./markdown.mjs";
const labels = {
  usage: "用法",
  boundary: "何时别用",
  example: "例子",
  sources: "出处",
  body: "补充阅读",
  related: "相关卡片",
};
const text = (n) =>
  typeof n.value === "string" ? n.value : (n.children ?? []).map(text).join("");
export function readableMarkdown(markdown) {
  if (!markdown.includes("{{{") && !markdown.includes("}}}")) return markdown;
  const spans = [];
  function visit(n) {
    if (["code", "inlineCode", "html"].includes(n.type)) {
      spans.push([n.position.start.offset, n.position.end.offset]);
      return;
    }
    for (const c of n.children ?? []) visit(c);
  }
  visit(fromMarkdown(markdown));
  let offset = 0;
  const withoutLayout = markdown
    .split("\n")
    .filter((line) => {
      const start = offset;
      offset += line.length + 1;
      return (
        spans.some(([a, b]) => start >= a && start < b) ||
        !/^\s*(?:\{\{\{(?:row|col)?|\}\}\})\s*$/.test(line)
      );
    })
    .join("\n");
  return normalize(withoutLayout);
}
export class Compact {
  constructor(knowledge) {
    this.k = knowledge;
    this.a = knowledge.api;
  }
  async get(doc, options = {}) {
    const a = this.a;
    const info = await a.inScope(doc);
    if (
      info.type !== "d" ||
      !info.path.startsWith("/" + a.c.libraryRootId + "/")
    )
      fail("outside_scope", "Card is outside the managed tree");
    await a.requireActivePath(info.path);
    const attrs = await a.attrs(doc);
    if (
      attrs["custom-cd-schema"] !== "2" &&
      (attrs["custom-cd-schema"] || attrs["custom-cd-kind"])
    )
      fail("structure_conflict", "Not a compact card");
    const raw = await a.markdown(doc),
      markdown = readableMarkdown(normalize(raw));
    const row = (
      await a.sql(
        `SELECT content FROM blocks WHERE id=${quote(doc)} AND box=${quote(a.c.notebookId)}`,
      )
    )[0];
    const nodes = fromMarkdown(markdown).children;
    const firstSection = nodes.findIndex(
      (n) => n.type === "heading" && n.depth === 2,
    );
    const paragraph = nodes
      .slice(0, firstSection < 0 ? nodes.length : firstSection)
      .find((n) => n.type === "paragraph");
    const sourceIndex = nodes.findIndex(
      (n) => n.type === "heading" && n.depth === 2 && text(n) === "出处",
    );
    let sources = "";
    if (sourceIndex >= 0) {
      for (let i = sourceIndex + 1; i < nodes.length; i++) {
        if (nodes[i].type === "heading" && nodes[i].depth <= 2) break;
        const n = nodes[i];
        sources +=
          markdown.slice(n.position.start.offset, n.position.end.offset) +
          "\n\n";
      }
    }
    const sections = [];
    const { readings, sections: readingSections } = await this.k.readReadings(doc, options);
    if (options.sections !== false) {
      for (const b of await a.sql(
        `SELECT id,type FROM blocks WHERE root_id=${quote(doc)} AND type<>'d' LIMIT 10000`,
      )) {
        if (
          b.type === "h" &&
          (await a.attrs(b.id))["custom-cd-role"] !== "question"
        )
          continue;
        const value = await a.markdown(b.id);
        sections.push({
          key: b.type === "h" ? "question" : "body",
          id: b.id,
          markdown: value,
          hash: hash(value),
        });
      }
    }
    sections.push(...readingSections);
    return {
      id: doc,
      documentId: doc,
      legacyId: attrs["custom-cd-legacy-id"] || undefined,
      schema: 2,
      title: row.content,
      summary: paragraph
        ? text(paragraph)
            .replace(/\u200b/g, "")
            .trim()
        : "",
      sources: sources.trim(),
      markdown,
      hash: hash(raw),
      readings,
      sections,
      url: a.origin + "/?id=" + doc,
    };
  }
  async confirmAppend(rec, persist) {
    const a = this.a;
    const rows = await a.sql(
      `SELECT b.id FROM blocks b JOIN attributes v ON v.block_id=b.id WHERE b.root_id=${quote(rec.documentId)} AND b.box=${quote(a.c.notebookId)} AND v.name='custom-cd-operation' AND v.value=${quote(rec.input.op_id)} LIMIT 2`,
    );
    if (rows.length !== 1) fail("operation_pending", "Append not reconciled");
    const raw = await a.markdown(rows[0].id);
    const body = normalize(raw)
      .replace(/^\{\{\{(?:row|col)?\s*\n/, "")
      .replace(/(?:^|\n)\}\}\}$/, "")
      .trim();
    const expected =
      (rec.input.field === "note"
        ? ""
        : "## " + labels[rec.input.field] + "\n\n") + rec.intended;
    if (
      JSON.stringify(markdownTree(body)) !==
      JSON.stringify(markdownTree(expected))
    )
      fail("readback_conflict", "Appended content changed");
    rec.groupId = rows[0].id;
    rec.groupHash = hash(raw);
    rec.afterHash = (await this.get(rec.documentId, { sections: false })).hash;
    persist();
    return { id: rec.documentId, hash: rec.afterHash, op_id: rec.input.op_id };
  }
  async confirmRecovery(rec, persist) {
    const rows = await this.a.sql(
      `SELECT id FROM blocks WHERE id=${quote(rec.groupId)} AND box=${quote(this.a.c.notebookId)} LIMIT 1`,
    );
    if (rows.length) fail("operation_pending", "Appended block still present");
    const current = await this.get(rec.documentId, { sections: false });
    if (
      normalize(await this.a.markdown(rec.documentId)) !==
      normalize(rec.beforeCard)
    )
      fail("readback_conflict", "Card differs after recovery");
    persist();
    return { id: current.id, hash: current.hash, op_id: rec.input.op_id };
  }
  async recover(input, original, retryOptions) {
    return this.a.operate("recover-append", input, async (rec, persist) => {
      if (
        original.target !== (await this.a.identity()) ||
        original.state !== "verified" ||
        !original.groupId
      )
        fail("invalid_backup", "Append backup missing");
      const current = await this.get(original.documentId, { sections: false });
      if (
        current.hash !== input.expected_hash ||
        input.expected_hash !== original.afterHash
      )
        fail("content_conflict", "Card changed after append");
      const info = await this.a.inScope(original.groupId);
      if (
        info.root_id !== original.documentId ||
        hash(await this.a.markdown(original.groupId)) !== original.groupHash
      )
        fail("content_conflict", "Appended block changed");
      rec.deletedGroup = await this.a.markdown(original.groupId);
      rec.documentId = original.documentId;
      rec.groupId = original.groupId;
      rec.beforeCard = original.beforeCard;
      if (retryOptions?.retryRecovery) rec.writeStarted = true;
      persist();
      await this.a.api("/api/block/deleteBlock", { id: original.groupId });
      await this.a.flush();
      const result = await this.get(original.documentId, { sections: false });
      if (
        normalize(await this.a.markdown(original.documentId)) !==
        normalize(original.beforeCard)
      )
        fail("readback_conflict", "Card differs after append recovery");
      return { id: result.id, hash: result.hash, op_id: input.op_id };
    }, retryOptions);
  }
}
