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

test("recommendability preview uses the same per-language rules as saved records", async () => {
  const directory = mkdtempSync(join(tmpdir(), "concept-discovery-readiness-"));
  const dbPath = join(directory, "registry.sqlite");
  const red = readFileSync(new URL("./fixtures/red.webp", import.meta.url));
  const blue = readFileSync(new URL("./fixtures/blue.webp", import.meta.url));
  const app = createApiServer({ dbPath });
  try {
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    const draftPreview = await request(origin, "POST", "/api/concepts/preview", { id: "preview-draft", locales: { cn: { name: "资格" }, en: {} } });
    assert.equal(draftPreview.status, 200);
    assert.deepEqual(draftPreview.value.readiness.cn.browse_missing, ["description", "source_text"]);
    assert.deepEqual(draftPreview.value.readiness.en.browse_missing, ["name", "description", "source_text"]);
    assert.equal((await request(origin, "GET", "/api/concepts?view=manage")).value.count, 0);
    const created = await request(origin, "POST", "/api/concepts", { id: "readiness", locales: { cn: { name: "资格", description: "中文描述", source_text: "中文出处" }, en: { name: "Readiness", description: "English description", source_text: "English source" } } });
    assert.equal(created.value.readiness.cn.browsable, true);
    assert.equal(created.value.readiness.cn.recommendable, false);
    const update = { expected_version: 1, changes: { "locales.cn.trigger": ["  决策困难 ", "决策困难"], "locales.cn.avoid_when": ["信息不足"], "locales.cn.transform": ["明确选择"], "locales.cn.agent_instruction": "  帮助用户反向推演  ", "locales.en.trigger": ["Decision uncertainty"], "locales.en.agent_instruction": "Help reason backward", domains: ["reasoning"], intents: ["simplify"] }, media: { cn: { action: "set", data: red.toString("base64") }, en: { action: "set", data: blue.toString("base64") } } };
    const preview = await request(origin, "POST", "/api/concepts/readiness/preview", update);
    assert.equal(preview.status, 200);
    assert.equal(preview.value.after.cn.recommendable, true);
    assert.equal(preview.value.after.en.recommendable, true);
    assert.equal((await request(origin, "GET", "/api/concepts/readiness")).value.version, 1);
    const saved = await request(origin, "PATCH", "/api/concepts/readiness", update);
    assert.equal(saved.status, 200);
    assert.equal(saved.value.version, 2);
    assert.equal(saved.value.readiness.cn.recommendable, true);
    assert.equal(saved.value.readiness.en.recommendable, true);
    assert.deepEqual(saved.value.locales.cn.trigger, ["决策困难"]);
    assert.equal(saved.value.locales.cn.agent_instruction, "帮助用户反向推演");
    assert.equal(saved.value.interaction_type, null);
    assert.equal(saved.value.epistemic_type, null);
    assert.equal((await request(origin, "GET", "/api/concepts?locale=cn&view=manage&status=recommendable")).value.count, 1);
    const invalid = await request(origin, "PATCH", "/api/concepts/readiness", { expected_version: 2, changes: { domains: ["unknown"] } });
    assert.equal(invalid.status, 400);
    assert.equal((await request(origin, "PATCH", "/api/concepts/readiness", { expected_version: 2, changes: { epistemic_type: "made_up" } })).status, 400);
    const lower = { expected_version: 2, changes: { "locales.cn.trigger": [] } };
    const lowerPreview = await request(origin, "POST", "/api/concepts/readiness/preview", lower);
    assert.equal(lowerPreview.value.before.cn.recommendable, true);
    assert.equal(lowerPreview.value.after.cn.recommendable, false);
    assert.equal(lowerPreview.value.after.cn.browsable, true);
    assert.equal(lowerPreview.value.after.en.recommendable, true);
    assert.equal((await request(origin, "GET", "/api/concepts/readiness")).value.version, 2);
    const lowered = await request(origin, "PATCH", "/api/concepts/readiness", lower);
    assert.equal(lowered.value.version, 3);
    assert.equal(lowered.value.readiness.cn.recommendable, false);
    assert.equal(lowered.value.readiness.en.recommendable, true);
    assert.equal((await request(origin, "GET", "/api/concepts?locale=cn&view=manage&status=recommendable")).value.count, 0);
    assert.equal((await request(origin, "GET", "/api/concepts?locale=en&view=manage&status=recommendable")).value.count, 1);
    const unpublish = await request(origin, "POST", "/api/concepts/readiness/preview", { expected_version: 3, changes: { "locales.cn.source_text": " " } });
    assert.equal(unpublish.value.after.cn.browsable, false);
    assert.equal(unpublish.value.after.en.recommendable, true);
    const revisions = (await request(origin, "GET", "/api/concepts/readiness/revisions")).value.revisions;
    assert.equal(revisions.length, 3);
    assert.ok(revisions[1].changes.some((change) => change.path === "locales.cn.agent_instruction"));
    assert.ok(revisions[1].changes.some((change) => change.path === "domains"));
    assert.equal(revisions[0].changes[0].path, "locales.cn.trigger");
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
