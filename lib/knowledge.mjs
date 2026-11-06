import { Compact } from "./compact.mjs";
import { renderValue, readValue, markdownTree } from "./markdown.mjs";
import { hash, id, quote, fail, normalize } from "./siyuan.mjs";
import { activePath, cardScope } from "./library-scope.mjs";
export const arrays = [
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
const labels = {
  name: "名称",
  aliases: "别名",
  description: "理解",
  cover_image: "封面",
  cover_images: "图片",
  wiki_url: "参考链接",
  tags: "标签",
  trigger: "适用情境",
  questions: "自问",
  examples: "例子",
  avoid_when: "边界",
  transform: "行动步骤",
  agent_instruction: "使用提示",
  source_text: "来源",
};
const fence = (value) => {
  const n = Math.max(
    3,
    ...[...value.matchAll(/`+/g)].map((m) => m[0].length + 1),
  );
  return "`".repeat(n) + "text\n" + value + "\n" + "`".repeat(n);
};
export class Knowledge {
  constructor(api) {
    this.api = api;
  }
  async documents(kind = "concept") {
    const a = this.api;
    if (kind === "concept")
      return a.sql(
        `SELECT b.id,b.content,b.path FROM blocks b WHERE ${cardScope(a.c)} ORDER BY b.id LIMIT 10000`,
      );
    return a.sql(
      `SELECT b.id,b.content,b.path FROM blocks b JOIN attributes a ON a.block_id=b.id WHERE b.box=${quote(a.c.notebookId)} AND b.type='d' AND b.path LIKE ${quote("/" + (kind === "relation" ? a.c.relationsRootId : a.c.libraryRootId) + "/%")} AND ${activePath('b.path','b.box')} AND a.name='custom-cd-kind' AND a.value=${quote(kind)} ORDER BY b.id LIMIT 10000`,
    );
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
  async create(input) {
    if (input?.card) return new Compact(this).create(input);
    return this.createLegacy(input);
  }
  async createLegacy(input) {
    const data = input?.concept;
    if (!data || !data.locales || typeof data.locales !== "object")
      fail("invalid_input", "Concept locales required");
    if (Object.keys(data.locales).some((l) => !["cn", "en"].includes(l)))
      fail("invalid_input", "Unknown locale");
    if (
      data.id !== undefined &&
      (typeof data.id !== "string" ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.id) ||
        data.id.length > 80)
    )
      fail("invalid_input", "Invalid original ID");
    for (const l of ["cn", "en"]) {
      const v = data.locales[l] ?? {};
      if (!v || typeof v !== "object" || Array.isArray(v))
        fail("invalid_input", "Invalid locale");
      for (const key of Object.keys(v)) {
        if (![...fields, "article_body"].includes(key))
          fail("invalid_input", "Unknown locale field");
        if (
          arrays.includes(key)
            ? !Array.isArray(v[key]) ||
              v[key].some((item) => typeof item !== "string")
            : typeof v[key] !== "string"
        )
          fail("invalid_input", "Invalid field type: " + key);
      }
    }
    const known = [
      "id",
      "lifecycle_status",
      "interaction_type",
      "epistemic_type",
      "domains",
      "intents",
      "version",
      "created_at",
      "updated_at",
      "locales",
    ];
    if (Object.keys(data).some((key) => !known.includes(key)))
      fail("invalid_input", "Unknown concept field");
    if (!["cn", "en"].some((l) => data.locales[l]?.name?.trim()))
      fail("invalid_input", "At least one nonempty name required");
    for (const key of ["interaction_type", "epistemic_type"])
      if (
        data[key] !== undefined &&
        data[key] !== null &&
        typeof data[key] !== "string"
      )
        fail("invalid_input", "Invalid " + key);
    for (const key of ["created_at", "updated_at"])
      if (data[key] !== undefined && typeof data[key] !== "string")
        fail("invalid_input", "Invalid " + key);
    if (
      data.version !== undefined &&
      (!Number.isInteger(data.version) || data.version < 1)
    )
      fail("invalid_input", "Invalid original version");
    if (
      data.lifecycle_status !== undefined &&
      !["active", "archived"].includes(data.lifecycle_status)
    )
      fail("invalid_input", "Invalid lifecycle");
    for (const key of ["domains", "intents"])
      if (
        data[key] !== undefined &&
        (!Array.isArray(data[key]) ||
          data[key].some((v) => typeof v !== "string"))
      )
        fail("invalid_input", "Invalid " + key);
    return this.api.operate("create", input, async (rec, persist) => {
      const a = this.api;
      const concept = input.concept;
      if (
        !concept?.locales ||
        !["cn", "en"].some((l) => concept.locales[l]?.name)
      )
        fail("invalid_input", "At least one locale name required");
      const doc = rec.documentId ?? id();
      for (const prior of await this.documents()) {
        if (
          prior.id !== doc &&
          concept.id &&
          (await a.attrs(prior.id))["custom-cd-legacy-id"] === concept.id
        )
          fail("identity_conflict", "Original ID already exists");
      }
      rec.documentId = doc;
      persist();
      const metadata = {};
      for (const key of [
        "id",
        "lifecycle_status",
        "interaction_type",
        "epistemic_type",
        "domains",
        "intents",
        "version",
        "created_at",
        "updated_at",
      ])
        if (concept[key] !== undefined) metadata[key] = concept[key];
      let md = "";
      const sections = [];
      for (const l of ["cn", "en"]) {
        const data = concept.locales[l] ?? {};
        md += `# ${l === "cn" ? "回想" : "Recall"}：${data.questions?.[0] ?? data.name ?? "知识卡"}\n\n`;
        for (const key of fields) {
          const value = data[key] ?? (arrays.includes(key) ? [] : "");
          sections.push({ l, key, value });
          md += `## ${l === "cn" ? "中文" : "English"} · ${labels[key]}\n\n{{{row\n\n${renderValue(value)}\n\n}}}\n{: custom-cd-field="${key}" custom-cd-locale="${l}"}\n\n`;
        }
      }
      const existing = await a.sql(
        `SELECT id FROM blocks WHERE id=${quote(doc)} AND box=${quote(a.c.notebookId)}`,
      );
      if (!existing.length)
        await a.newDoc(
          doc,
          concept.locales.cn?.name || concept.locales.en.name,
          md,
          a.c.libraryRootId,
        );
      else {
        const current = await this.readFields(doc);
        for (const section of sections)
          if (
            JSON.stringify(current.locales[section.l][section.key]) !==
            JSON.stringify(section.value)
          )
            fail(
              "structure_conflict",
              "Partial creation changed; inspect before resuming",
            );
        const prior = await a.attrs(doc);
        if (
          prior["custom-cd-request"] &&
          prior["custom-cd-request"] !== rec.requestHash
        )
          fail("operation_conflict", "Creation ID belongs to another request");
      }
      await a.setAttrs(doc, {
        "custom-cd-kind": "concept",
        "custom-cd-schema": "1",
        "custom-cd-meta": JSON.stringify(metadata),
        "custom-cd-legacy-id": concept.id ?? "",
        "custom-cd-request": rec.requestHash,
      });
      await a.flush();
      for (const l of ["cn", "en"]) {
        const article = concept.locales[l]?.article_body;
        if (article) {
          rec.articles ??= {};
          const child = rec.articles[l] ?? id();
          rec.articles[l] = child;
          persist();
          const found = await a.sql(
            `SELECT id,path FROM blocks WHERE id=${quote(child)} AND box=${quote(a.c.notebookId)}`,
          );
          if (!found.length)
            await a.newDoc(
              child,
              l === "cn" ? "中文长文" : "English article",
              article,
              doc,
            );
          else {
            if (!found[0].path.endsWith("/" + doc + "/" + child + ".sy"))
              fail("outside_scope", "Partial article parent changed");
            const current = await a.markdown(child);
            if (
              rec.articleHashes?.[l]
                ? hash(current) !== rec.articleHashes[l]
                : JSON.stringify(markdownTree(normalize(current))) !==
                  JSON.stringify(markdownTree(article))
            )
              fail(
                "content_conflict",
                "Partial article changed; inspect source before resuming",
              );
          }
          rec.articleHashes ??= {};
          rec.articleHashes[l] = hash(await a.markdown(child));
          persist();
          await a.setAttrs(child, {
            "custom-cd-kind": "article",
            "custom-cd-parent": doc,
            "custom-cd-locale": l,
          });
        }
      }
      await a.setAttrs(doc, { "custom-cd-complete": "1" });
      await a.flush();
      const result = await this.get(doc, { sections: false });
      return { id: doc, op_id: input.op_id, concept: result };
    });
  }
  async readFields(doc, options = {}) {
    const a = this.api;
    const groups = await a.sql(
      `SELECT b.id,b.type,b.parent_id FROM blocks b JOIN attributes a ON a.block_id=b.id WHERE b.root_id=${quote(doc)} AND a.name='custom-cd-field' ${options.keys ? `AND a.value IN (${options.keys.map(quote).join(",")}) AND EXISTS(SELECT 1 FROM attributes l WHERE l.block_id=b.id AND l.name='custom-cd-locale' AND l.value=${quote(options.locale)})` : ""} LIMIT 10000`,
    );
    const sections = [];
    const locales = { cn: {}, en: {} };
    for (const group of groups) {
      if (group.type !== "s")
        fail("structure_conflict", "Field marker must belong to a superblock");
      const marker = await a.attrs(group.id);
      const key = marker["custom-cd-field"],
        locale = marker["custom-cd-locale"];
      if (
        !fields.includes(key) ||
        !["cn", "en"].includes(locale) ||
        key in locales[locale]
      )
        fail("structure_conflict", "Invalid or duplicated field marker");
      const raw = await a.markdown(group.id);
      const body = normalize(raw)
        .replace(/^\{\{\{(?:row|col)?\s*\n/, "")
        .replace(/(?:^|\n)\}\}\}$/, "")
        .trim();
      try {
        locales[locale][key] = readValue(body, arrays.includes(key));
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
          const md = await a.markdown(child.id);
          sections.push({
            locale,
            key,
            id: child.id,
            markdown: md,
            hash: hash(md),
          });
        }
      }
    }
    if (
      (options.keys ? [options.locale] : ["cn", "en"]).some((l) =>
        (options.keys ?? fields).some((k) => !(k in locales[l])),
      )
    )
      fail(
        "structure_conflict",
        "Managed fields missing: " +
          JSON.stringify({
            cn: Object.keys(locales.cn),
            en: Object.keys(locales.en),
            count: groups.length,
          }),
      );
    return { locales, sections };
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
    const { locales, sections } = await this.readFields(doc, options);
    for (const l of ["cn", "en"]) {
      const rows = await a.sql(
        `SELECT b.id FROM blocks b JOIN attributes p ON p.block_id=b.id AND p.name='custom-cd-parent' JOIN attributes l ON l.block_id=b.id AND l.name='custom-cd-locale' WHERE b.box=${quote(a.c.notebookId)} AND b.type='d' AND b.path LIKE ${quote("/" + a.c.libraryRootId + "/%")} AND ${activePath('b.path','b.box')} AND p.value=${quote(doc)} AND l.value=${quote(l)} LIMIT 2`,
      );
      const matching = rows.map((r) => r.id);
      if (matching.length > 1)
        fail("structure_conflict", "Duplicate article locale");
      locales[l].article_body = matching.length
        ? normalize(await a.markdown(matching[0]))
        : "";
      if (matching.length && options.sections !== false) {
        const children = await a.sql(
          `SELECT id,type FROM blocks WHERE root_id=${quote(matching[0])} AND type NOT IN ('d','h') LIMIT 10000`,
        );
        for (const child of children) {
          const markdown = await a.markdown(child.id);
          sections.push({
            locale: l,
            key: "article_body",
            id: child.id,
            markdown,
            hash: hash(markdown),
          });
        }
      }
    }
    const relations = [];
    const metadata = JSON.parse(attr["custom-cd-meta"]);
    for (const row of await a.sql(
      `SELECT r.value FROM blocks b JOIN attributes r ON r.block_id=b.id AND r.name='custom-cd-relation' WHERE b.box=${quote(a.c.notebookId)} AND b.type='d' AND b.path LIKE ${quote("/" + a.c.relationsRootId + "/%")} LIMIT 10000`,
    )) {
      const r = JSON.parse(row.value);
      if ([r.source_concept_id, r.target_concept_id].includes(metadata.id))
        relations.push(r);
    }
    return {
      ...JSON.parse(attr["custom-cd-meta"]),
      documentId: doc,
      locales,
      sections,
      relations,
      url: a.origin + "/?id=" + doc,
    };
  }
  async search({ query = "", locale = "cn", limit = 5 }) {
    if (
      !["cn", "en"].includes(locale) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 20 ||
      typeof query !== "string" ||
      query.length > 1000
    )
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
    const allowed = new Set((await this.documents()).map((d) => d.id));
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
      const { locales } = await this.readFields(hit.id, {
        keys: ["name", "description", "source_text"],
        locale,
      });
      const value = locales[locale];
      results.push({
        id: hit.id,
        legacyId: meta.id,
        name: value.name,
        summary: value.description.slice(0, 400),
        sources: value.source_text,
        url: a.origin + "/?id=" + hit.id,
      });
      if (results.length === limit) break;
    }
    return results;
  }
}
