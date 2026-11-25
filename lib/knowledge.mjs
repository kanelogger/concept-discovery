import { Compact, readableMarkdown } from "./compact.mjs";
import { readValue } from "./markdown.mjs";
import { hash, quote, fail, normalize } from "./siyuan.mjs";
import { activePath, cardScope } from "./library-scope.mjs";
import { readOrderedReadings } from "./raw-reading-order.mjs";
const arrays = [
  "aliases",
  "tags",
  "trigger",
  "questions",
  "examples",
  "avoid_when",
  "transform",
  "cover_images",
];
export const fields = [
  "name",
  "aliases",
  "description",
  "cover_image",
  "cover_images",
  "wiki_url",
  "tags",
  "trigger",
  "questions",
  "examples",
  "avoid_when",
  "transform",
  "agent_instruction",
  "source_text",
];
export class Knowledge {
  constructor(api) {
    this.api = api;
  }
  async locate(ref) {
    const a = this.api;
    const scope = cardScope(a.c);
    const duplicates = await a.sql(
      `SELECT v.value FROM blocks b JOIN attributes v ON v.block_id=b.id AND v.name='custom-cd-legacy-id' WHERE ${scope} AND EXISTS(SELECT 1 FROM attributes s WHERE s.block_id=b.id AND s.name='custom-cd-schema' AND s.value='1') AND v.value<>'' GROUP BY v.value HAVING count(*)>1 LIMIT 1`,
    );
    if (duplicates.length)
      fail("identity_conflict", "Duplicate original identity");
    const found = await a.sql(
      `SELECT b.id FROM blocks b LEFT JOIN attributes v ON v.block_id=b.id AND v.name='custom-cd-legacy-id' WHERE ${scope} AND (b.id=${quote(ref)} OR v.value=${quote(ref)}) LIMIT 2`,
    );
    if (found.length !== 1)
      fail("identity_conflict", "Concept missing or identity duplicated");
    return found[0].id;
  }
  async readFields(doc, options = {}) {
    const a = this.api;
    const groups = await a.sql(
      `SELECT b.id,b.type,b.parent_id FROM blocks b JOIN attributes a ON a.block_id=b.id WHERE b.root_id=${quote(doc)} AND a.name='custom-cd-field' ${options.keys ? `AND a.value IN (${options.keys.map(quote).join(",")})` : ""} LIMIT 10000`,
    );
    const sections = [];
    const content = {};
    for (const group of groups) {
      if (group.type !== "s")
        fail("structure_conflict", "Field marker must belong to a superblock");
      const key = (await a.attrs(group.id))["custom-cd-field"];
      if (!fields.includes(key) || key in content)
        fail("structure_conflict", "Invalid or duplicated field marker");
      const raw = await a.markdown(group.id);
      const body = normalize(raw)
        .replace(/^\{\{\{(?:row|col)?\s*\n/, "")
        .replace(/(?:^|\n)\}\}\}$/, "")
        .trim();
      try {
        content[key] = readValue(body, arrays.includes(key));
      } catch {
        fail("structure_conflict", "Invalid field body: " + key);
      }
      if (options.sections !== false) {
        const children = await a.sql(
          `SELECT id FROM blocks WHERE parent_id=${quote(group.id)} LIMIT 10000`,
        );
        const ordered = children.sort(
          (x, y) =>
            raw.indexOf('id="' + x.id + '"') - raw.indexOf('id="' + y.id + '"'),
        );
        for (const child of ordered.length ? ordered : [group]) {
          const markdown = await a.markdown(child.id);
          sections.push({ key, id: child.id, markdown, hash: hash(markdown) });
        }
      }
    }
    return { content, sections };
  }
  async readReadings(doc, options = {}) {
    const a = this.api;
    const readings = [], sections = [];
    for (const row of await readOrderedReadings(a, doc, await a.attrs(doc))) {
      readings.push({ id: row.id, title: row.content, markdown: normalize(await a.markdown(row.id)) });
      if (options.sections !== false)
        for (const child of await a.sql(
          `SELECT id,type FROM blocks WHERE root_id=${quote(row.id)} AND type NOT IN('d','h') LIMIT 10000`,
        )) {
          const markdown = await a.markdown(child.id);
          sections.push({ key: "reading", id: child.id, markdown, hash: hash(markdown) });
        }
    }
    return { readings, sections };
  }
  async get(ref, options = {}) {
    const a = this.api;
    const doc = await this.locate(ref);
    const attr = await a.attrs(doc);
    if (
      attr["custom-cd-schema"] === "2" ||
      (!attr["custom-cd-schema"] && !attr["custom-cd-kind"])
    )
      return new Compact(this).get(doc, options);
    if (attr["custom-cd-schema"] !== "1")
      fail("structure_conflict", "Unsupported schema");
    const { content, sections } = await this.readFields(doc, options);
    const { readings, sections: readingSections } = await this.readReadings(doc, options);
    sections.push(...readingSections);
    const raw = await a.markdown(doc);
    const row = (await a.sql(`SELECT content FROM blocks WHERE id=${quote(doc)} AND box=${quote(a.c.notebookId)}`))[0];
    const relations = [];
    const metadata = JSON.parse(attr["custom-cd-meta"] ?? "{}");
    for (const row of await a.sql(
      `SELECT r.value FROM blocks b JOIN attributes r ON r.block_id=b.id AND r.name='custom-cd-relation' WHERE b.box=${quote(a.c.notebookId)} AND b.type='d' AND b.path LIKE ${quote("/" + a.c.relationsRootId + "/%")} LIMIT 10000`,
    )) {
      const r = JSON.parse(row.value);
      if ([r.source_concept_id, r.target_concept_id].includes(metadata.id))
        relations.push(r);
    }
    return {
      ...Object.fromEntries(Object.entries(metadata).filter(([key]) => [
        "lifecycle_status", "interaction_type", "epistemic_type", "domains", "intents", "version", "created_at", "updated_at",
      ].includes(key))),
      id: doc,
      documentId: doc,
      legacyId: attr["custom-cd-legacy-id"] || metadata.id || undefined,
      schema: 1,
      title: content.name || row?.content || "知识卡",
      summary: content.description ?? "",
      sources: content.source_text ?? "",
      markdown: readableMarkdown(normalize(raw)),
      hash: hash(raw),
      content,
      readings,
      sections,
      relations,
      url: a.origin + "/?id=" + doc,
    };
  }
  async search(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some(key => !["query", "limit"].includes(key)))
      fail("invalid_input", "Invalid search fields");
    const { query = "", limit = 5 } = input;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20 ||
        typeof query !== "string" || query.length > 1000)
      fail("invalid_input", "Invalid search");
    const terms = query.trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const a = this.api;
    const predicates = terms
      .map(
        (t) =>
          `b.content LIKE ${quote("%" + t.replace(/[\\%_]/g, "\\$&") + "%")} ESCAPE '\\'`,
      )
      .join(" OR ");
    const hits = await a.sql(
      `SELECT DISTINCT coalesce((SELECT value FROM attributes WHERE block_id=b.root_id AND name='custom-cd-parent'),b.root_id) AS id FROM blocks b WHERE b.box=${quote(a.c.notebookId)} AND b.path LIKE ${quote("/" + a.c.libraryRootId + "/%")} AND ${activePath('b.path','b.box')} AND (${predicates}) ORDER BY b.root_id LIMIT 200`,
    );
    const cards = await a.sql(
      `SELECT b.id,b.content,b.path FROM blocks b WHERE ${cardScope(a.c)} ORDER BY b.id LIMIT 10000`,
    );
    const allowed = new Set(cards.map((card) => card.id));
    const results = [];
    for (const hit of hits) {
      if (!allowed.has(hit.id)) continue;
      const attrs = await a.attrs(hit.id);
      if (attrs["custom-cd-schema"] === "1" && !attrs["custom-cd-meta"])
        fail("structure_conflict", "Legacy metadata missing");
      const meta = JSON.parse(attrs["custom-cd-meta"] ?? "{}");
      if (meta.lifecycle_status === "archived") continue;
      if (
        attrs["custom-cd-schema"] === "2" ||
        (!attrs["custom-cd-schema"] && !attrs["custom-cd-kind"])
      ) {
        const c = await new Compact(this).get(hit.id, { sections: false });
        results.push({
          id: c.id,
          legacyId: c.legacyId,
          name: c.title,
          summary: c.summary.slice(0, 400),
          sources: c.sources,
          url: c.url,
        });
        if (results.length === limit) break;
        continue;
      }
      if (attrs["custom-cd-schema"] !== "1")
        fail("structure_conflict", "Unsupported schema");
      const { content: value } = await this.readFields(hit.id, {
        keys: ["name", "description", "source_text"], sections: false,
      });
      results.push({
        id: hit.id,
        legacyId: meta.id,
        name: value.name ?? "",
        summary: (value.description ?? "").slice(0, 400),
        sources: value.source_text ?? "",
        url: a.origin + "/?id=" + hit.id,
      });
      if (results.length === limit) break;
    }
    return results;
  }
}
