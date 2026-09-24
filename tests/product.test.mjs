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
