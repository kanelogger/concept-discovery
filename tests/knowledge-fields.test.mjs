import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApiServer } from "../server/http.mjs";
import { fromConcept, updatePayload } from "../src/product/model.ts";

test("knowledge fields preserve sentences through editor payload, HTTP, revisions and old JSON", async () => {
  const directory = mkdtempSync(join(tmpdir(), "knowledge-fields-"));
  const dbPath = join(directory, "db.sqlite");
  let app = createApiServer({ dbPath });
  const start = async () => {
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${app.server.address().port}`;
  };
  let origin = await start();
  const request = async (method, path, body) => {
    const response = await fetch(origin + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  try {
    const sentence = "Busy, but slower.\n大家都很忙，却越来越慢。";
    const article = "排队会延长等待。\n第一段的第二行。\n\n先找到瓶颈，再控制在制品。";
    const created = await request("POST", "/api/concepts", { id: "queue", locales: { cn: { name: "排队", description: "说明", article_body: article, source_text: "来源", trigger: [sentence], questions: ["  哪个环节？  ", "哪个环节？", ""], examples: [sentence] }, en: { name: "Queue", examples: ["Example, with commas.\nSecond line."] } } });
    assert.equal(created.status, 201);
    assert.deepEqual(created.data.locales.cn.questions, ["哪个环节？"]);
    assert.equal(created.data.readiness.cn.browsable, true);
    assert.equal(created.data.readiness.cn.recommendable, false);
    assert.equal(created.data.locales.cn.article_body, article);
    assert.equal(created.data.locales.en.article_body, "");
    assert.equal((await request("GET", `/api/concepts?locale=cn&q=${encodeURIComponent("控制在制品")}`)).data.count, 0);
    const draft = fromConcept(created.data);
    assert.deepEqual(updatePayload(created.data, draft, { cn: null, en: null }).changes, {});
    draft.cnExamples.push("Second, illustrative case.\n仍是同一条案例。");
    draft.enArticle = "English article.\n\nSecond paragraph.";
    const saved = await request("PATCH", "/api/concepts/queue", updatePayload(created.data, draft, { cn: null, en: null }));
    assert.equal(saved.data.version, 2);
    assert.deepEqual(saved.data.locales.cn.examples, draft.cnExamples);
    assert.deepEqual(saved.data.locales.cn.trigger, [sentence]);
    assert.deepEqual(saved.data.locales.en.examples, created.data.locales.en.examples);
    assert.equal(saved.data.locales.en.article_body, draft.enArticle);
    assert.equal(saved.data.locales.cn.article_body, article);
    for (const invalid of ["not array", [42], null]) {
      assert.equal((await request("PATCH", "/api/concepts/queue", { expected_version: 2, changes: { "locales.cn.questions": invalid } })).status, 400);
    }
    assert.equal((await request("PATCH", "/api/concepts/queue", { expected_version: 2, changes: { "locales.cn.article_body": ["invalid"] } })).status, 400);
    assert.equal((await request("PATCH", "/api/concepts/queue", { expected_version: 2, changes: { "locales.cn.article_body": `![missing](/api/assets/${"0".repeat(64)})` } })).status, 400);
    assert.equal((await request("PATCH", "/api/concepts/queue", { expected_version: 1, changes: { "locales.cn.examples": [] } })).status, 409);
    const revisions = (await request("GET", "/api/concepts/queue/revisions")).data.revisions;
    assert.equal(revisions.length, 2);
    assert.deepEqual(revisions[0].changes.map((change) => change.path), ["locales.cn.examples", "locales.en.article_body"]);
    await app.close();
    // Simulate a pre-upgrade record without rewriting any of its historical revisions.
    const db = new DatabaseSync(dbPath);
    const old = JSON.parse(db.prepare("SELECT data FROM concepts WHERE id = 'queue'").get().data);
    for (const locale of ["cn", "en"]) { delete old.locales[locale].questions; delete old.locales[locale].examples; delete old.locales[locale].article_body; }
    db.prepare("UPDATE concepts SET data = ? WHERE id = 'queue'").run(JSON.stringify(old));
    db.close();
    app = createApiServer({ dbPath }); origin = await start();
    const read = (await request("GET", "/api/concepts/queue")).data;
    assert.deepEqual(read.locales.cn.questions, []);
    assert.deepEqual(read.locales.en.examples, []);
    assert.equal(read.locales.cn.article_body, "");
    assert.equal(read.locales.en.article_body, "");
    assert.equal(read.version, 2);
    const noOp = await request("PATCH", "/api/concepts/queue", updatePayload(read, fromConcept(read), { cn: null, en: null }));
    assert.equal(noOp.data.version, 2);
    assert.deepEqual((await request("GET", "/api/concepts/queue/revisions")).data.revisions, revisions);
    assert.deepEqual((await request("GET", "/api/concepts?locale=cn")).data.concepts[0].locales.cn.examples, []);
    const partial = await request("PATCH", "/api/concepts/queue", { expected_version: 2, changes: { "locales.cn.questions": [sentence] } });
    assert.deepEqual(partial.data.locales.cn.trigger, [sentence]);
    assert.deepEqual(partial.data.locales.cn.examples, []);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});
