import { hash, id, quote, fail, normalize } from "./siyuan.mjs";
import { fromMarkdown } from "mdast-util-from-markdown";
import { markdownTree, escapeText } from "./markdown.mjs";
export const compactFields = [
  "title",
  "understanding",
  "sources",
  "language",
  "usage",
  "boundary",
  "example",
  "question",
  "body",
  "related",
  "id",
  "aliases",
  "tags",
  "readings",
];
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
export function renderCard(card) {
  if (
    !card ||
    typeof card !== "object" ||
    Array.isArray(card) ||
    Object.keys(card).some((k) => !compactFields.includes(k))
  )
    fail("invalid_input", "Unknown card field");
  for (const [k, v] of Object.entries(card)) {
    if (["aliases", "tags"].includes(k)) {
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string"))
        fail("invalid_input", "Expected text list: " + k);
    } else if (k === "readings") {
      if (
        !Array.isArray(v) ||
        v.some(
          (r) =>
            !r ||
            typeof r.title !== "string" ||
            typeof r.markdown !== "string" ||
            !r.title.trim() ||
            !r.markdown.trim() ||
            (r.language !== undefined && typeof r.language !== "string"),
        )
      )
        fail("invalid_input", "Invalid readings");
    } else if (typeof v !== "string")
      fail("invalid_input", "Expected text: " + k);
  }
  if (card.question && /[\r\n]/.test(card.question))
    fail("invalid_input", "Self-test question must be one line");
  if (card.id && card.id.length > 80)
    fail("invalid_input", "Card reference too long");
  if (!card.title?.trim()) fail("invalid_input", "Card title required");
  if (card.id && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(card.id))
    fail("invalid_input", "Invalid card reference");
  const parts = [];
  if (card.question?.trim())
    parts.push("# 自测：" + escapeText(card.question.trim()));
  if (card.understanding?.trim()) parts.push(card.understanding.trim());
  for (const k of ["usage", "boundary", "example", "sources", "related"])
    if (card[k]?.trim())
      parts.push("## " + labels[k] + "\n\n" + card[k].trim());
  if (card.body?.trim() && card.body.length <= 6000)
    parts.push("## 补充阅读\n\n" + card.body.trim());
  const aliases = card.aliases?.filter((v) => v.trim()) ?? [],
    tags = card.tags?.filter((v) => v.trim()) ?? [];
  if (aliases.length)
    parts.push("## 别名\n\n" + aliases.map(escapeText).join("、"));
  if (tags.length) parts.push("## 标签\n\n" + tags.map(escapeText).join("、"));
  return parts.join("\n\n");
}
export function readableMarkdown(markdown) {
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
  return markdown
    .split("\n")
    .filter((line) => {
      const start = offset;
      offset += line.length + 1;
      return (
        spans.some(([a, b]) => start >= a && start < b) ||
        !/^\s*(?:\{\{\{(?:row|col)?|\}\}\})\s*$/.test(line)
      );
    })
    .join("\n")
    .trim();
}
export class Compact {
  constructor(knowledge) {
    this.k = knowledge;
    this.a = knowledge.api;
  }
  async create(input) {
    const card = input.card;
    const md = renderCard(card);
    return this.a.operate("create", input, async (rec, persist) => {
      const a = this.a;
      const doc = rec.documentId ?? id();
      rec.documentId = doc;
      persist();
      if (card.id) {
        const found = await a.sql(
          `SELECT b.id FROM blocks b JOIN attributes v ON v.block_id=b.id AND v.name='custom-cd-legacy-id' WHERE b.box=${quote(a.c.notebookId)} AND v.value=${quote(card.id)} AND b.id<>${quote(doc)} LIMIT 1`,
        );
        if (found.length) fail("identity_conflict", "Card reference exists");
      }
      const existing = await a.sql(
        `SELECT id,path FROM blocks WHERE id=${quote(doc)} AND box=${quote(a.c.notebookId)} LIMIT 1`,
      );
      if (!existing.length)
        await a.newDoc(doc, card.title, md, a.c.libraryRootId);
      else {
        if (
          !existing[0].path.endsWith(
            "/" + a.c.libraryRootId + "/" + doc + ".sy",
          )
        )
          fail("outside_scope", "Partial card moved");
        const current = normalize(await a.markdown(doc));
        if (
          JSON.stringify(markdownTree(current)) !==
          JSON.stringify(markdownTree(md))
        )
          fail("content_conflict", "Partial card changed");
        const attrs = await a.attrs(doc);
        if (
          attrs["custom-cd-request"] &&
          attrs["custom-cd-request"] !== rec.requestHash
        )
          fail("operation_conflict", "Card belongs to another request");
      }
      await a.setAttrs(doc, {
        "custom-cd-kind": "concept",
        "custom-cd-schema": "2",
        "custom-cd-language": card.language ?? "cn",
        "custom-cd-legacy-id": card.id ?? "",
        "custom-cd-meta": JSON.stringify({
          id: card.id,
          lifecycle_status: "active",
        }),
        "custom-cd-request": rec.requestHash,
      });
      if (card.question?.trim()) {
        const h = await a.sql(
          `SELECT id,content FROM blocks WHERE root_id=${quote(doc)} AND type='h' AND subtype='h1' LIMIT 100`,
        );
        const question = h.find(
          (x) => x.content === "自测：" + card.question.trim(),
        );
        if (!question) fail("structure_conflict", "Question heading missing");
        await a.setAttrs(question.id, { "custom-cd-role": "question" });
      }
      const readings = [
        ...(card.readings ?? []),
        ...(card.body?.length > 6000
          ? [
              {
                title: "阅读材料",
                markdown: card.body,
                language: card.language ?? "cn",
              },
            ]
          : []),
      ];
      rec.readings ??= [];
      for (let i = 0; i < readings.length; i++) {
        const reading = readings[i];
        const child = rec.readings[i] ?? id();
        rec.readings[i] = child;
        persist();
        const prior = await a.sql(
          `SELECT id,path FROM blocks WHERE id=${quote(child)} AND box=${quote(a.c.notebookId)}`,
        );
        if (!prior.length)
          await a.newDoc(child, reading.title, reading.markdown, doc);
        else if (
          !prior[0].path.endsWith("/" + doc + "/" + child + ".sy") ||
          JSON.stringify(markdownTree(normalize(await a.markdown(child)))) !==
            JSON.stringify(markdownTree(reading.markdown))
        )
          fail("content_conflict", "Partial reading changed");
        await a.setAttrs(child, {
          "custom-cd-kind": "article",
          "custom-cd-parent": doc,
          "custom-cd-locale": reading.language ?? card.language ?? "cn",
          "custom-cd-reading": "1",
        });
      }
      await a.setAttrs(doc, { "custom-cd-complete": "1" });
      await a.flush();
      return {
        id: doc,
        op_id: input.op_id,
        card: await this.get(doc, { sections: false }),
      };
    });
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
    const readings = [];
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
    for (const r of await a.sql(
      `SELECT b.id,b.content FROM blocks b JOIN attributes p ON p.block_id=b.id AND p.name='custom-cd-parent' WHERE b.box=${quote(a.c.notebookId)} AND b.type='d' AND p.value=${quote(doc)} LIMIT 1000`,
    )) {
      const readingScope = await a.inScope(r.id);
      if (
        !readingScope.path.startsWith("/" + a.c.libraryRootId + "/") ||
        !readingScope.path.includes("/" + doc + "/")
      )
        fail("structure_conflict", "Reading moved outside card");
      readings.push({
        id: r.id,
        title: r.content,
        language: (await a.attrs(r.id))["custom-cd-locale"],
        markdown: normalize(await a.markdown(r.id)),
      });
      if (options.sections !== false)
        for (const b of await a.sql(
          `SELECT id,type FROM blocks WHERE root_id=${quote(r.id)} AND type NOT IN('d','h') LIMIT 10000`,
        )) {
          const value = await a.markdown(b.id);
          sections.push({
            key: "reading",
            id: b.id,
            markdown: value,
            hash: hash(value),
          });
        }
    }
    return {
      id: doc,
      documentId: doc,
      legacyId: attrs["custom-cd-legacy-id"] || undefined,
      schema: 2,
      title: row.content,
      language: attrs["custom-cd-language"] ?? "cn",
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
  async append(input) {
    if (
      typeof input.markdown === "string" &&
      (/(?:^|\n)\s*(?:\{\{\{(?:row|col)?|\}\}\})\s*(?:\n|$)/.test(
        input.markdown,
      ) ||
        readableMarkdown(input.markdown) !== input.markdown.trim())
    )
      fail(
        "invalid_input",
        "Native layout delimiters cannot be appended safely; use normal Markdown or a separate reading",
      );
    if (!labels[input.field] && input.field !== "note")
      fail(
        "invalid_input",
        "Expected sources, usage, boundary, example, related, body or note",
      );
    if (typeof input.markdown !== "string" || !input.markdown.trim())
      fail("invalid_input", "Append content required");
    return this.a.operate("append", input, async (rec, persist) => {
      const card = await this.get(await this.k.locate(input.id));
      if (
        input.field !== "note" &&
        fromMarkdown(card.markdown).children.some(
          (n) =>
            n.type === "heading" &&
            n.depth === 2 &&
            text(n) === labels[input.field],
        )
      )
        fail(
          "section_exists",
          "Section already exists; update its current block",
        );
      if (card.hash !== input.expected_hash)
        fail("content_conflict", "Card changed; read again");
      rec.documentId = card.id;
      rec.beforeCard = await this.a.markdown(card.id);
      rec.intended = input.markdown;
      persist();
      const content =
        (input.field === "note" ? "" : "## " + labels[input.field] + "\n\n") +
        input.markdown;
      await this.a.api("/api/block/appendBlock", {
        parentID: card.id,
        dataType: "markdown",
        data: `{{{row\n\n${content}\n\n}}}\n{: custom-cd-operation="${input.op_id}"}`,
      });
      await this.a.flush();
      return this.confirmAppend(rec, persist);
    });
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
  async recover(input, original) {
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
    });
  }
}
