import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
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

test("localized WebP and Wiki edits commit atomically and preserve historical assets", async () => {
  const directory = mkdtempSync(join(tmpdir(), "concept-discovery-media-"));
  const dbPath = join(directory, "registry.sqlite");
  const red = readFileSync(new URL("./fixtures/red.webp", import.meta.url));
  const blue = readFileSync(new URL("./fixtures/blue.webp", import.meta.url));
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  let app = createApiServer({ dbPath });
  const listen = async () => {
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${app.server.address().port}`;
  };
  try {
    let origin = await listen();
    const created = await request(origin, "POST", "/api/concepts", { id: "two-images", locales: { cn: { name: "双语", description: "中文描述", source_text: "中文出处" }, en: { name: "Bilingual", description: "English description", source_text: "English source" } } });
    assert.equal(created.status, 201);
    assert.equal(created.value.locales.cn.cover_image, "");
    assert.equal(created.value.locales.en.cover_image, "");
    const first = await request(origin, "PATCH", "/api/concepts/two-images", { expected_version: 1, changes: { "locales.cn.wiki_url": "https://example.invalid/cn" }, media: { cn: { action: "set", data: red.toString("base64") } } });
    assert.equal(first.status, 200);
    assert.equal(first.value.version, 2);
    assert.equal(first.value.locales.cn.cover_image, hash(red));
    assert.equal(first.value.locales.en.cover_image, "");
    assert.equal(first.value.locales.cn.wiki_url, "https://example.invalid/cn");
    const imageResponse = await fetch(`${origin}/api/assets/${hash(red)}`);
    assert.equal(imageResponse.headers.get("content-type"), "image/webp");
    assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), red);
    const fake = await request(origin, "PATCH", "/api/concepts/two-images", { expected_version: 2, changes: { "locales.en.wiki_url": "https://example.invalid/en" }, media: { en: { action: "set", data: Buffer.from("fake image/webp").toString("base64") } } });
    assert.equal(fake.status, 400);
    assert.equal((await request(origin, "GET", "/api/concepts/two-images")).value.version, 2);
    assert.equal((await request(origin, "GET", "/api/concepts/two-images")).value.locales.en.wiki_url, "");
    const badUrl = await request(origin, "PATCH", "/api/concepts/two-images", { expected_version: 2, changes: { "locales.en.wiki_url": "http://example.invalid/en" }, media: { en: { action: "set", data: blue.toString("base64") } } });
    assert.equal(badUrl.status, 400);
    assert.equal((await fetch(`${origin}/api/assets/${hash(blue)}`)).status, 404);
    const replaced = await request(origin, "PATCH", "/api/concepts/two-images", { expected_version: 2, changes: { "locales.en.wiki_url": "https://example.invalid/en" }, media: { cn: { action: "set", data: blue.toString("base64") }, en: { action: "set", data: red.toString("base64") } } });
    assert.equal(replaced.status, 200);
    assert.equal(replaced.value.version, 3);
    assert.equal(replaced.value.locales.cn.cover_image, hash(blue));
    assert.equal(replaced.value.locales.en.cover_image, hash(red));
    const removed = await request(origin, "PATCH", "/api/concepts/two-images", { expected_version: 3, changes: { "locales.cn.wiki_url": "" }, media: { cn: { action: "remove" } } });
    assert.equal(removed.status, 200);
    assert.equal(removed.value.locales.cn.cover_image, "");
    assert.equal(removed.value.locales.en.cover_image, hash(red));
    assert.equal((await fetch(`${origin}/api/assets/${hash(blue)}`)).status, 200);
    const revisions = (await request(origin, "GET", "/api/concepts/two-images/revisions")).value.revisions;
    assert.equal(revisions.length, 4);
    assert.ok(revisions[2].changes.some((change) => change.path === "locales.cn.cover_image" && change.before === "" && change.after === hash(red)));
    assert.ok(revisions[1].changes.some((change) => change.path === "locales.cn.cover_image" && change.before === hash(red) && change.after === hash(blue)));
    assert.ok(revisions[1].changes.some((change) => change.path === "locales.en.wiki_url"));
    await app.close();
    app = createApiServer({ dbPath });
    origin = await listen();
    assert.equal((await request(origin, "GET", "/api/concepts/two-images")).value.locales.en.cover_image, hash(red));
    assert.deepEqual(Buffer.from(await (await fetch(`${origin}/api/assets/${hash(red)}`)).arrayBuffer()), red);
    assert.deepEqual(Buffer.from(await (await fetch(`${origin}/api/assets/${hash(blue)}`)).arrayBuffer()), blue);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
