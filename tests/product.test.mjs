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

test("public API persists one bilingual identity and field-path revisions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "concept-discovery-test-"));
  const dbPath = join(directory, "registry.sqlite");
  let app = createApiServer({ dbPath });
  const listen = async () => {
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${app.server.address().port}`;
  };
  try {
    let origin = await listen();
    const input = { id: "first-principles", domains: ["reasoning"], locales: { cn: { name: "第一性原理" } } };
    const created = await request(origin, "POST", "/api/concepts", input);
    assert.equal(created.status, 201);
    assert.equal(created.value.version, 1);
    assert.equal(created.value.locales.cn.name, "第一性原理");
    assert.equal(created.value.locales.en.name, "");
    assert.deepEqual(created.value.domains, ["reasoning"]);
    assert.equal(created.value.readiness.cn.browsable, false);
    assert.equal((await request(origin, "POST", "/api/concepts", input)).status, 409);
    assert.equal((await request(origin, "POST", "/api/concepts", { id: "Bad ID", locales: { cn: { name: "Wrong" } } })).status, 400);
    assert.equal((await request(origin, "POST", "/api/concepts", { id: "no-name", locales: { cn: { name: "   " } } })).status, 400);
    assert.equal((await request(origin, "GET", "/api/concepts")).value.concepts.length, 1);
    const revised = await request(origin, "PATCH", "/api/concepts/first-principles", { expected_version: 1, changes: { "locales.cn.description": "  从基础事实重建  " } });
    assert.equal(revised.status, 200);
    assert.equal(revised.value.version, 2);
    assert.equal(revised.value.locales.cn.description, "从基础事实重建");
    assert.equal(revised.value.locales.en.description, "");
    const noOp = await request(origin, "PATCH", "/api/concepts/first-principles", { expected_version: 2, changes: { "locales.cn.description": "从基础事实重建" } });
    assert.equal(noOp.value.version, 2);
    assert.equal((await request(origin, "PATCH", "/api/concepts/first-principles", { expected_version: 1, changes: { "locales.cn.name": "旧写入" } })).status, 409);
    const revisions = (await request(origin, "GET", "/api/concepts/first-principles/revisions")).value.revisions;
    assert.equal(revisions.length, 2);
    assert.equal(revisions[0].changes[0].path, "locales.cn.description");
    assert.ok(revisions[1].changes.some((change) => change.path === "locales.cn.name"));
    await app.close();
    app = createApiServer({ dbPath });
    origin = await listen();
    const afterRestart = await request(origin, "GET", "/api/concepts/first-principles");
    assert.equal(afterRestart.value.version, 2);
    assert.equal(afterRestart.value.locales.cn.name, "第一性原理");
    assert.equal(afterRestart.value.locales.en.name, "");
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("catalog search publishes each language independently and survives restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "concept-discovery-search-"));
  const dbPath = join(directory, "registry.sqlite");
  let app = createApiServer({ dbPath });
  const listen = async () => {
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${app.server.address().port}`;
  };
  const query = (origin, params) => request(origin, "GET", `/api/concepts?${new URLSearchParams(params)}`);
  try {
    let origin = await listen();
    const created = await request(origin, "POST", "/api/concepts", {
      id: "inversion", domains: ["reasoning"],
      locales: {
        cn: { name: "逆向思维", aliases: ["反向思考", " 反向思考 "], description: "从失败倒推", source_text: "来源：未联网核验的纯文本", tags: ["决策"] },
        en: { name: "Inversion", aliases: ["Reverse thinking"], description: "Think backward", source_text: "   ", tags: ["Decision"] },
      },
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.value.locales.cn.aliases, ["反向思考"]);
    assert.equal(created.value.locales.en.source_text, "");
    assert.equal(created.value.readiness.cn.browsable, true);
    assert.equal(created.value.readiness.en.browsable, false);
    assert.equal((await query(origin, { locale: "cn", view: "browse" })).value.count, 1);
    assert.equal((await query(origin, { locale: "en", view: "browse" })).value.count, 0);
    assert.equal((await query(origin, { locale: "cn", view: "browse", q: "反向思考" })).value.count, 1);
    assert.equal((await query(origin, { locale: "cn", view: "browse", q: "Think backward" })).value.count, 0);
    assert.equal((await query(origin, { locale: "cn", view: "browse", tag: "决策", domain: "reasoning" })).value.count, 1);
    assert.equal((await query(origin, { locale: "cn", view: "browse", tag: "Decision" })).value.count, 0);
    const managedEn = await query(origin, { locale: "en", view: "manage", status: "draft" });
    assert.equal(managedEn.value.count, 1);
    assert.deepEqual(managedEn.value.concepts[0].readiness.en.browse_missing, ["source_text"]);
    assert.equal((await query(origin, { locale: "en", view: "manage", q: "逆向思维" })).value.count, 0);
    const completed = await request(origin, "PATCH", "/api/concepts/inversion", { expected_version: 1, changes: { "locales.en.source_text": "English source" } });
    assert.equal(completed.value.readiness.en.browsable, true);
    assert.equal((await query(origin, { locale: "en", view: "browse", q: "Reverse thinking" })).value.count, 1);
    await app.close();
    app = createApiServer({ dbPath });
    origin = await listen();
    assert.equal((await query(origin, { locale: "en", view: "browse", q: "Inversion" })).value.count, 1);
    assert.equal((await query(origin, { locale: "cn", view: "browse", q: "Inversion" })).value.count, 0);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
