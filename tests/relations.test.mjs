import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApiServer } from "../server/http.mjs";

async function request(origin, method, path, body) {
  const response = await fetch(`${origin}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, value: await response.json() };
}

test("symmetric Relation is stored once, notes stay bilingual, and directed Relation preserves orientation across restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "concept-relations-"));
  const dbPath = join(directory, "registry.sqlite");
  let app = createApiServer({ dbPath });
  const listen = async () => { await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve)); return `http://127.0.0.1:${app.server.address().port}`; };
  try {
    app.registry.create({ id: "alpha", locales: { cn: { name: "甲" }, en: { name: "Alpha" } } });
    app.registry.create({ id: "zeta", locales: { cn: { name: "乙" } } });
    let origin = await listen();
    const created = await request(origin, "POST", "/api/relations", { source_concept_id: "zeta", target_concept_id: "alpha", relation_type: "related_to", note: { cn: "中文关联", en: "English relation" } });
    assert.equal(created.status, 201);
    assert.equal(created.value.source_concept_id, "alpha");
    assert.equal(created.value.target_concept_id, "zeta");
    assert.equal((await request(origin, "POST", "/api/relations", { source_concept_id: "alpha", target_concept_id: "zeta", relation_type: "related_to" })).value.error, "duplicate_relation");
    const cn = await request(origin, "GET", "/api/concepts/alpha/relations?locale=cn");
    assert.equal(cn.value.relations.length, 1);
    assert.equal(cn.value.relations[0].other.name, "乙");
    assert.equal(cn.value.relations[0].note, "中文关联");
    assert.equal(cn.value.relations[0].direction, "symmetric");
    const en = await request(origin, "GET", "/api/concepts/alpha/relations?locale=en");
    assert.equal(en.value.relations[0].other.name, null);
    assert.equal(en.value.relations[0].note, "English relation");
    assert.equal((await request(origin, "GET", "/api/concepts/alpha/relations")).status, 400);

    const id = created.value.id;
    const edited = await request(origin, "PATCH", `/api/relations/${id}`, { expected_version: 1, changes: { relation_type: "extends", note: { en: "  Extends in English  " } } });
    assert.equal(edited.value.version, 2);
    assert.deepEqual(edited.value.note, { cn: "中文关联", en: "Extends in English" });
    assert.equal((await request(origin, "PATCH", `/api/relations/${id}`, { expected_version: 1, changes: { note: { cn: "旧写入" } } })).value.error, "version_conflict");
    assert.equal((await request(origin, "GET", "/api/concepts/alpha/relations?locale=cn")).value.relations[0].direction, "outgoing");
    assert.equal((await request(origin, "GET", "/api/concepts/zeta/relations?locale=cn")).value.relations[0].direction, "incoming");

    await app.close();
    app = createApiServer({ dbPath });
    origin = await listen();
    const persisted = await request(origin, "GET", `/api/relations/${id}`);
    assert.equal(persisted.value.version, 2);
    assert.equal(persisted.value.note.en, "Extends in English");
    assert.equal((await request(origin, "GET", "/api/concepts/zeta/relations?locale=en")).value.relations[0].other.name, "Alpha");
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Relation references block permanent deletion until removal, including archived targets", async () => {
  const directory = mkdtempSync(join(tmpdir(), "concept-relation-refs-"));
  const app = createApiServer({ dbPath: join(directory, "registry.sqlite") });
  try {
    app.registry.create({ id: "source", locales: { cn: { name: "源" } } });
    app.registry.create({ id: "target", locales: { cn: { name: "目标" } } });
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    const relation = await request(origin, "POST", "/api/relations", { source_concept_id: "source", target_concept_id: "target", relation_type: "part_of", note: { cn: "组成" } });
    assert.equal(relation.status, 201);
    assert.equal((await request(origin, "POST", "/api/relations", { source_concept_id: "source", target_concept_id: "missing", relation_type: "part_of" })).status, 404);
    assert.equal((await request(origin, "POST", "/api/relations", { source_concept_id: "source", target_concept_id: "source", relation_type: "part_of" })).status, 400);
    assert.equal((await request(origin, "POST", "/api/relations", { source_concept_id: "source", target_concept_id: "target", relation_type: "recipe" })).status, 400);
    const archived = await request(origin, "POST", "/api/concepts/target/archive", { expected_version: 1 });
    assert.equal(archived.status, 200);
    const listing = await request(origin, "GET", "/api/concepts/source/relations?locale=cn");
    assert.deepEqual(listing.value.relations[0].other, { id: "target", name: "目标", status: "archived", browsable: false });
    const guarded = await request(origin, "DELETE", "/api/concepts/target", { expected_version: 2, confirm_id: "target" });
    assert.equal(guarded.status, 409);
    assert.equal(guarded.value.error, "has_references");
    assert.equal((await request(origin, "GET", "/api/concepts/target")).status, 200);
    assert.equal((await request(origin, "DELETE", `/api/relations/${relation.value.id}`, { expected_version: 2 })).status, 409);
    assert.equal((await request(origin, "DELETE", `/api/relations/${relation.value.id}`, { expected_version: 1 })).status, 200);
    assert.equal((await request(origin, "DELETE", "/api/concepts/target", { expected_version: 2, confirm_id: "target" })).status, 200);
    assert.deepEqual((await request(origin, "GET", "/api/concepts/source/relations?locale=cn")).value.relations, []);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("changing Relation endpoints transfers deletion guards atomically and duplicate edits leave both relations intact", async () => {
  const directory = mkdtempSync(join(tmpdir(), "concept-relation-transfer-"));
  const app = createApiServer({ dbPath: join(directory, "registry.sqlite") });
  try {
    for (const id of ["alpha", "beta", "gamma"]) app.registry.create({ id, locales: { cn: { name: id } } });
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    const first = await request(origin, "POST", "/api/relations", { source_concept_id: "alpha", target_concept_id: "beta", relation_type: "related_to" });
    const second = await request(origin, "POST", "/api/relations", { source_concept_id: "alpha", target_concept_id: "gamma", relation_type: "related_to" });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const collision = await request(origin, "PATCH", `/api/relations/${first.value.id}`, { expected_version: 1, changes: { target_concept_id: "gamma" } });
    assert.equal(collision.status, 409);
    assert.equal(collision.value.error, "duplicate_relation");
    assert.equal((await request(origin, "GET", `/api/relations/${first.value.id}`)).value.target_concept_id, "beta");
    assert.equal((await request(origin, "GET", `/api/concepts/beta/relations?locale=cn`)).value.relations.length, 1);
    const moved = await request(origin, "PATCH", `/api/relations/${first.value.id}`, { expected_version: 1, changes: { source_concept_id: "beta", target_concept_id: "gamma", relation_type: "extends" } });
    assert.equal(moved.status, 200);
    assert.equal(moved.value.version, 2);
    assert.deepEqual((await request(origin, "GET", "/api/concepts/alpha/relations?locale=cn")).value.relations.map((relation) => relation.id), [second.value.id]);
    assert.deepEqual((await request(origin, "GET", "/api/concepts/beta/relations?locale=cn")).value.relations.map((relation) => relation.id), [first.value.id]);
    assert.equal((await request(origin, "DELETE", `/api/relations/${second.value.id}`, { expected_version: 1 })).status, 200);
    assert.equal((await request(origin, "POST", "/api/concepts/alpha/archive", { expected_version: 1 })).status, 200);
    assert.equal((await request(origin, "DELETE", "/api/concepts/alpha", { expected_version: 2, confirm_id: "alpha" })).status, 200);
    assert.equal((await request(origin, "POST", "/api/concepts/beta/archive", { expected_version: 1 })).status, 200);
    assert.equal((await request(origin, "DELETE", "/api/concepts/beta", { expected_version: 2, confirm_id: "beta" })).value.error, "has_references");
    assert.equal((await request(origin, "DELETE", "/api/relations/999", { expected_version: 1 })).status, 404);
    assert.equal((await request(origin, "GET", `/api/relations/${second.value.id}`)).status, 404);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
