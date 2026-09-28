import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApiServer } from "../server/http.mjs";
import { navigationUrl, readNavigation } from "../src/product/navigation-state.ts";

test("keyword ranking and relation previews share language and lifecycle rules without changing records", async () => {
  const dir = mkdtempSync(join(tmpdir(), "knowledge-search-"));
  const app = createApiServer({ dbPath: join(dir, "db.sqlite") });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const get = async (query) => {
    const response = await fetch(origin + "/api/concepts?" + new URLSearchParams(query));
    return { status: response.status, data: await response.json() };
  };
  const local = (name, extra = {}) => ({ name, description: "Definition", source_text: "Source", ...extra });
  try {
    const entries = [
      ["by-name", { name: "QUEUE name" }], ["by-alias", { aliases: ["Queue alias"] }],
      ["by-trigger", { trigger: ["queue builds up"] }], ["by-question", { questions: ["where is the queue?"] }],
      ["by-example", { examples: ["a queue example"] }], ["by-description", { description: "queue description" }],
      ["by-tag", { tags: ["queue"] }],
    ];
    for (const [id, fields] of entries) app.registry.create({ id, domains: ["reasoning"], locales: { cn: local(id, fields), en: local("English") } });
    const rank = { "by-name": 0, "by-alias": 0, "by-trigger": 1, "by-question": 2, "by-example": 2, "by-description": 3, "by-tag": 3 };
    const list = (await get({ q: "  qUeUe ", locale: "cn", view: "browse" })).data.concepts;
    assert.equal(list.length, 7);
    assert.deepEqual(list.map((c) => rank[c.id]), [0, 0, 1, 2, 2, 3, 3]);
    for (let i = 1; i < list.length; i++) if (rank[list[i - 1].id] === rank[list[i].id]) {
      assert.ok(list[i - 1].updated_at > list[i].updated_at || (list[i - 1].updated_at === list[i].updated_at && list[i - 1].id < list[i].id));
    }
    assert.equal((await get({ q: "queue", locale: "en" })).data.count, 0);
    assert.equal((await get({ q: "queue", locale: "cn", tag: "queue", domain: "reasoning" })).data.count, 1);
    assert.equal((await get({ q: "unrecorded paraphrase", locale: "cn" })).data.count, 0);
    const draft = app.registry.create({ id: "draft", locales: { cn: { name: "queue draft" } } });
    const archived = app.registry.create({ id: "archived", locales: { cn: local("queue archived") } });
    const enOnly = app.registry.create({ id: "english-only", locales: { en: local("English only") } });
    const edge = (target, type = "related_to") => app.registry.createRelation({ source_concept_id: "by-name", target_concept_id: target, relation_type: type, note: { cn: "中文备注", en: "English note" } });
    edge(archived.id); edge(draft.id); edge(enOnly.id);
    app.registry.create({ id: "missing-target", locales: { cn: local("Missing target") } });
    edge("missing-target");
    // Simulate a damaged legacy database; ordinary API deletion is reference-protected.
    const damaged = new DatabaseSync(join(dir, "db.sqlite"));
    try { damaged.exec("PRAGMA foreign_keys=OFF; DELETE FROM concepts WHERE id='missing-target'"); } finally { damaged.close(); }
    const missing = app.registry.listRelations("by-name", "cn").find((r) => r.other.id === "missing-target");
    assert.deepEqual(missing.other, { id: "missing-target", name: null, status: "missing", browsable: false });
    const first = edge("by-trigger", "extends"); edge("by-trigger", "often_used_with"); edge("by-question"); edge("by-example");
    app.registry.archive(archived.id, { expected_version: 1 });
    const before = app.registry.revisions("by-name");
    const query = { locale: "cn", q: "QUEUE name", include: "relation_preview" };
    const withPreview = (await get(query)).data.concepts[0];
    assert.deepEqual(withPreview.relation_preview.map((r) => r.other.id), ["by-trigger", "by-question"]);
    assert.equal(withPreview.relation_preview[0].direction, "outgoing");
    assert.equal(withPreview.relation_preview[0].note, "中文备注");
    const reverse = (await get({ locale: "cn", q: "queue builds", include: "relation_preview" })).data.concepts[0].relation_preview[0];
    assert.equal(reverse.direction, "incoming");
    assert.ok(!Object.hasOwn((await get({ locale: "cn", q: "QUEUE name" })).data.concepts[0], "relation_preview"));
    assert.ok(!Object.hasOwn(app.registry.get("by-name"), "relation_preview"));
    assert.deepEqual(app.registry.revisions("by-name"), before);
    assert.equal((await get({ include: "unknown" })).status, 400);
    const english = (await get({ locale: "en", include: "relation_preview" })).data.concepts.find((c) => c.id === "by-name");
    assert.equal(english.relation_preview[0].other.id, "english-only");
    assert.ok(english.relation_preview.every((r) => r.note === "English note"));
    assert.ok(!(await get({ locale: "cn", view: "browse", q: "queue" })).data.concepts.some((c) => ["draft", "archived"].includes(c.id)));
    assert.equal((await get({ locale: "cn", status: "archived" })).data.count, 1);
    app.registry.deleteRelation(first.id, { expected_version: first.version });
    assert.equal((await get(query)).data.concepts[0].relation_preview[0].relation_type, "often_used_with");
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("addressable details preserve library query and normalize invalid pagination", () => {
  const initial = readNavigation("");
  assert.equal(initial.status, "browsable"); assert.equal(initial.pageSize, 20); assert.equal(initial.locale, "cn");
  const selected = { ...initial, concept: "theory-of-constraints", locale: "en", density: "table", search: "busy, slow", tag: "flow", domain: ["reasoning"], page: 2, pageSize: 10 };
  assert.deepEqual(readNavigation(navigationUrl(selected).slice(1)), selected);
  const related = { ...selected, concept: "wip-limits" };
  assert.deepEqual(readNavigation(navigationUrl(related).slice(1)), related);
  assert.equal(readNavigation("?page=-2&pageSize=11&status=invalid").page, 1);
  assert.equal(readNavigation("?page=Infinity&pageSize=11").pageSize, 20);
  assert.equal(readNavigation("?concept=x&section=dashboard").section, "manage");
});

test("empty search and equal-ranked matches have deterministic ordering and never join list items", async (t) => {
  const { openRegistry } = await import("../server/registry.mjs");
  const { DatabaseSync } = await import("node:sqlite");
  const dir = mkdtempSync(join(tmpdir(), "knowledge-order-"));
  const path = join(dir, "db.sqlite");
  const registry = openRegistry(path);
  t.after(() => { registry.close(); rmSync(dir, { recursive: true, force: true }); });
  for (const id of ["z-last", "a-first", "m-newest"]) registry.create({ id, locales: { cn: { name: `name ${id}`, description: "same", source_text: "source", trigger: ["busy", "slow"] } } });
  const db = new DatabaseSync(path);
  try {
    for (const id of ["z-last", "a-first", "m-newest"]) {
      const time = id === "m-newest" ? "2026-09-28T00:00:00.000Z" : "2026-09-27T00:00:00.000Z";
      db.prepare("UPDATE concepts SET data=json_set(data, '$.updated_at', ?), updated_at=? WHERE id=?").run(time, time, id);
    }
  } finally { db.close(); }
  for (const q of ["", "   ", "same"]) assert.deepEqual(registry.query({ q }).map((c) => c.id), ["m-newest", "a-first", "z-last"]);
  assert.equal(registry.query({ q: "busy slow" }).length, 0);
  assert.equal(registry.query({ q: "name a" }).length, 1);
});
