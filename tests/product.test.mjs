import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
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

test("Concept creation and editing support multiple ordered images per locale and removing individual images", async () => {
  const directory = mkdtempSync(join(tmpdir(), "concept-discovery-image-list-"));
  const app = createApiServer({ dbPath: join(directory, "registry.sqlite") });
  const red = readFileSync(new URL("./fixtures/red.webp", import.meta.url));
  const blue = readFileSync(new URL("./fixtures/blue.webp", import.meta.url));
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  try {
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    const created = await request(origin, "POST", "/api/concepts", {
      id: "localized-image-gallery",
      media: {
        cn: { action: "sync", images: [{ data: red.toString("base64") }, { data: blue.toString("base64") }] },
        en: { action: "sync", images: [{ data: blue.toString("base64") }, { data: red.toString("base64") }] },
      },
      locales: { cn: { name: "多图中文", description: "描述", source_text: "出处" }, en: { name: "Gallery", description: "Description", source_text: "Source" } },
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.value.locales.cn.cover_images, [hash(red), hash(blue)]);
    assert.deepEqual(created.value.locales.en.cover_images, [hash(blue), hash(red)]);
    assert.equal(created.value.locales.cn.cover_image, hash(red));
    assert.equal(created.value.locales.en.cover_image, hash(blue));
    assert.equal((await fetch(`${origin}/api/assets/${hash(red)}`)).status, 200);
    assert.equal((await fetch(`${origin}/api/assets/${hash(blue)}`)).status, 200);

    const edited = await request(origin, "PATCH", "/api/concepts/localized-image-gallery", {
      expected_version: 1, changes: {}, media: { cn: { action: "sync", images: [{ hash: hash(blue) }] } },
    });
    assert.equal(edited.status, 200);
    assert.deepEqual(edited.value.locales.cn.cover_images, [hash(blue)]);
    assert.equal(edited.value.locales.cn.cover_image, hash(blue));
    assert.deepEqual(edited.value.locales.en.cover_images, [hash(blue), hash(red)]);

    const removed = await request(origin, "PATCH", "/api/concepts/localized-image-gallery", {
      expected_version: 2, changes: {}, media: { en: { action: "sync", images: [{ hash: hash(red) }] } },
    });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.value.locales.en.cover_images, [hash(red)]);
    assert.equal(removed.value.locales.en.cover_image, hash(red));
    assert.equal((await fetch(`${origin}/api/assets/${hash(blue)}`)).status, 200, "historical revisions keep removed assets available");
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
    assert.deepEqual(created.value.readiness.cn.recommend_missing, ["trigger", "agent_instruction"]);
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
    const removeImage = await request(origin, "POST", "/api/concepts/readiness/preview", { expected_version: 2, changes: {}, media: { cn: { action: "remove" } } });
    assert.equal(removeImage.value.after.cn.recommendable, true);
    assert.deepEqual(removeImage.value.after.cn.recommend_missing, []);
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
    const withoutImages = { id: "default-cover", locales: { cn: { name: "默认图", description: "中文描述", source_text: "中文出处", trigger: ["需要选择"], agent_instruction: "中文指引" }, en: { name: "Default cover", description: "English description", source_text: "English source", trigger: ["Choosing"], agent_instruction: "English instruction" } } };
    const noImagePreview = await request(origin, "POST", "/api/concepts/preview", withoutImages);
    assert.equal(noImagePreview.value.readiness.cn.recommendable, true);
    assert.equal(noImagePreview.value.readiness.en.recommendable, true);
    const noImageSaved = await request(origin, "POST", "/api/concepts", withoutImages);
    assert.equal(noImageSaved.value.readiness.cn.recommendable, true);
    assert.equal(noImageSaved.value.readiness.en.recommendable, true);
    assert.equal(noImageSaved.value.locales.cn.cover_image, "");
    assert.equal(noImageSaved.value.locales.en.cover_image, "");
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("revision history preserves before and after values while stale edits cannot overwrite newer media or text", async () => {
  const directory = mkdtempSync(join(tmpdir(), "concept-discovery-revisions-"));
  const app = createApiServer({ dbPath: join(directory, "registry.sqlite") });
  const red = readFileSync(new URL("./fixtures/red.webp", import.meta.url));
  const blue = readFileSync(new URL("./fixtures/blue.webp", import.meta.url));
  const redHash = createHash("sha256").update(red).digest("hex");
  const blueHash = createHash("sha256").update(blue).digest("hex");
  try {
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    const created = await request(origin, "POST", "/api/concepts", { id: "history", locales: { cn: { name: "修订", description: "初始描述", source_text: "中文出处" }, en: { name: "History" } } });
    assert.equal(created.value.version, 1);
    const firstSession = await request(origin, "GET", "/api/concepts/history");
    const secondSession = await request(origin, "GET", "/api/concepts/history");
    const newer = await request(origin, "PATCH", "/api/concepts/history", { expected_version: firstSession.value.version, changes: { "locales.cn.description": "新的描述", "locales.cn.wiki_url": "https://example.org/cn" }, media: { cn: { action: "set", data: red.toString("base64") } } });
    assert.equal(newer.status, 200);
    assert.equal(newer.value.version, 2);
    const stale = await request(origin, "PATCH", "/api/concepts/history", { expected_version: secondSession.value.version, changes: { "locales.cn.description": "过期描述", "locales.en.wiki_url": "https://example.org/en" }, media: { cn: { action: "set", data: blue.toString("base64") } } });
    assert.equal(stale.status, 409);
    assert.equal(stale.value.error, "version_conflict");
    assert.equal((await request(origin, "GET", "/api/concepts/history")).value.locales.cn.description, "新的描述");
    assert.equal((await fetch(`${origin}/api/assets/${blueHash}`)).status, 404);
    const noOp = await request(origin, "PATCH", "/api/concepts/history", { expected_version: 2, changes: { "locales.cn.description": "新的描述" }, media: { cn: { action: "set", data: red.toString("base64") } } });
    assert.equal(noOp.value.version, 2);
    const replaced = await request(origin, "PATCH", "/api/concepts/history", { expected_version: 2, changes: { "locales.cn.wiki_url": "https://example.org/updated", domains: ["reasoning"] }, media: { cn: { action: "set", data: blue.toString("base64") } } });
    assert.equal(replaced.value.version, 3);
    const revisions = (await request(origin, "GET", "/api/concepts/history/revisions")).value.revisions;
    assert.equal(revisions.length, 3);
    assert.deepEqual(revisions.map((revision) => [revision.version_before, revision.version_after, revision.operation]), [[2, 3, "update"], [1, 2, "update"], [0, 1, "create"]]);
    assert.ok(revisions.every((revision) => revision.actor && revision.changed_at));
    assert.deepEqual(revisions[0].changes.find((change) => change.path === "locales.cn.cover_image"), { path: "locales.cn.cover_image", before: redHash, after: blueHash });
    assert.deepEqual(revisions[0].changes.find((change) => change.path === "locales.cn.wiki_url"), { path: "locales.cn.wiki_url", before: "https://example.org/cn", after: "https://example.org/updated" });
    assert.deepEqual(revisions[0].changes.find((change) => change.path === "domains"), { path: "domains", before: [], after: ["reasoning"] });
    assert.equal(revisions[1].changes.find((change) => change.path === "locales.cn.description").before, "初始描述");
    assert.ok(!JSON.stringify(revisions).includes(red.toString("base64")));
    assert.equal((await fetch(`${origin}/api/assets/${redHash}`)).status, 200);
    assert.equal((await fetch(`${origin}/api/assets/${blueHash}`)).status, 200);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("archive, restore, and guarded deletion update locale visibility and clean only unshared assets", async () => {
  const directory = mkdtempSync(join(tmpdir(), "concept-discovery-lifecycle-"));
  const dbPath = join(directory, "registry.sqlite");
  const app = createApiServer({ dbPath });
  const red = readFileSync(new URL("./fixtures/red.webp", import.meta.url));
  const blue = readFileSync(new URL("./fixtures/blue.webp", import.meta.url));
  const redHash = createHash("sha256").update(red).digest("hex");
  const blueHash = createHash("sha256").update(blue).digest("hex");
  try {
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    const data = (id) => ({ id, locales: { cn: { name: "中文", description: "中文描述", source_text: "中文出处", trigger: ["决策"], agent_instruction: "提供建议" }, en: { name: "English", description: "English description", source_text: "English source", trigger: ["Decision"], agent_instruction: "Offer guidance" } } });
    assert.equal((await request(origin, "POST", "/api/concepts", data("lifecycle"))).status, 201);
    assert.equal((await request(origin, "POST", "/api/concepts", data("other"))).status, 201);
    const media = { cn: { action: "set", data: red.toString("base64") }, en: { action: "set", data: red.toString("base64") } };
    const first = await request(origin, "PATCH", "/api/concepts/lifecycle", { expected_version: 1, changes: {}, media });
    assert.equal(first.value.readiness.cn.recommendable, true);
    assert.equal(first.value.readiness.en.recommendable, true);
    await request(origin, "PATCH", "/api/concepts/other", { expected_version: 1, changes: {}, media });
    const replaced = await request(origin, "PATCH", "/api/concepts/lifecycle", { expected_version: 2, changes: {}, media: { cn: { action: "set", data: blue.toString("base64") } } });
    assert.equal(replaced.value.version, 3);
    assert.equal((await request(origin, "DELETE", "/api/concepts/lifecycle", { expected_version: 3, confirm_id: "lifecycle" })).value.error, "not_archived");
    const archived = await request(origin, "POST", "/api/concepts/lifecycle/archive", { expected_version: 3 });
    assert.equal(archived.value.version, 4);
    assert.equal(archived.value.lifecycle_status, "archived");
    assert.equal(archived.value.readiness.cn.recommendable, false);
    assert.equal(archived.value.readiness.en.browsable, false);
    assert.equal((await request(origin, "GET", "/api/concepts?locale=cn&view=browse")).value.count, 1);
    assert.equal((await request(origin, "GET", "/api/concepts?locale=en&view=browse")).value.count, 1);
    assert.equal((await request(origin, "GET", "/api/concepts?locale=cn&view=manage&status=recommendable")).value.count, 1);
    assert.equal((await request(origin, "GET", "/api/concepts?locale=en&view=manage&status=archived")).value.concepts[0].id, "lifecycle");
    assert.equal((await request(origin, "POST", "/api/concepts/lifecycle/archive", { expected_version: 4 })).value.version, 4);
    const restored = await request(origin, "POST", "/api/concepts/lifecycle/restore", { expected_version: 4 });
    assert.equal(restored.value.version, 5);
    assert.equal(restored.value.readiness.cn.recommendable, true);
    assert.equal(restored.value.readiness.en.recommendable, true);
    assert.equal((await request(origin, "GET", "/api/concepts?locale=en&view=browse")).value.count, 2);
    assert.equal((await request(origin, "POST", "/api/concepts/lifecycle/archive", { expected_version: 5 })).value.version, 6);
    const external = new DatabaseSync(dbPath);
    try {
      external.prepare("INSERT INTO concept_references (concept_id, source_type, source_id) VALUES (?, ?, ?)").run("lifecycle", "test-relation", "linked");
      assert.equal((await request(origin, "DELETE", "/api/concepts/lifecycle", { expected_version: 6, confirm_id: "lifecycle" })).value.error, "has_references");
      assert.equal((await request(origin, "GET", "/api/concepts/lifecycle")).value.version, 6);
      external.prepare("DELETE FROM concept_references WHERE concept_id = ?").run("lifecycle");
    } finally { external.close(); }
    assert.equal((await request(origin, "DELETE", "/api/concepts/lifecycle", { expected_version: 6, confirm_id: "wrong" })).status, 400);
    assert.equal((await request(origin, "DELETE", "/api/concepts/lifecycle", { expected_version: 5, confirm_id: "lifecycle" })).value.error, "version_conflict");
    assert.deepEqual((await request(origin, "DELETE", "/api/concepts/lifecycle", { expected_version: 6, confirm_id: "lifecycle" })).value, { deleted: true, id: "lifecycle" });
    assert.equal((await request(origin, "GET", "/api/concepts/lifecycle")).status, 404);
    assert.equal((await request(origin, "GET", "/api/concepts/lifecycle/revisions")).status, 404);
    assert.equal((await fetch(`${origin}/api/assets/${blueHash}`)).status, 404);
    assert.equal((await fetch(`${origin}/api/assets/${redHash}`)).status, 200);
    assert.equal((await request(origin, "GET", "/api/concepts/other")).value.version, 2);
    const otherRevisions = (await request(origin, "GET", "/api/concepts/other/revisions")).value.revisions;
    assert.equal(otherRevisions.length, 2);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Dashboard counts and recent revisions follow real registry changes across restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "concept-discovery-dashboard-"));
  const dbPath = join(directory, "registry.sqlite");
  let app = createApiServer({ dbPath });
  const listen = async () => {
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${app.server.address().port}`;
  };
  try {
    let origin = await listen();
    const dashboard = async () => (await request(origin, "GET", "/api/dashboard")).value;
    assert.deepEqual({ active: (await dashboard()).active_total, archived: (await dashboard()).archived_total, recent: (await dashboard()).recent_revisions.length }, { active: 0, archived: 0, recent: 0 });
    const created = await request(origin, "POST", "/api/concepts", { id: "dashboard-one", locales: { cn: { name: "中文", description: "描述", source_text: "出处" }, en: { name: "English" } } });
    assert.equal(created.value.version, 1);
    let result = await dashboard();
    assert.equal(result.active_total, 1);
    assert.equal(result.both_draft, 0);
    assert.deepEqual(result.locales, { cn: { browsable: 1, recommendable: 0 }, en: { browsable: 0, recommendable: 0 } });
    assert.equal(result.recent_revisions[0].concept_id, "dashboard-one");
    assert.deepEqual(result.recent_revisions[0].affected_languages, ["cn", "en"]);
    const image = readFileSync(new URL("./fixtures/red.webp", import.meta.url)).toString("base64");
    const completed = await request(origin, "PATCH", "/api/concepts/dashboard-one", { expected_version: 1, changes: { "locales.cn.trigger": ["决策"], "locales.cn.agent_instruction": "帮助决策", "locales.en.description": "Description", "locales.en.source_text": "Source", "locales.en.trigger": ["Decision"], "locales.en.agent_instruction": "Help decide" }, media: { cn: { action: "set", data: image }, en: { action: "set", data: image } } });
    assert.equal(completed.value.version, 2);
    await request(origin, "POST", "/api/concepts", { id: "dashboard-draft", locales: { cn: { name: "草稿" } } });
    result = await dashboard();
    assert.equal(result.active_total, 2);
    assert.equal(result.both_draft, 1);
    assert.deepEqual(result.locales, { cn: { browsable: 1, recommendable: 1 }, en: { browsable: 1, recommendable: 1 } });
    assert.equal(result.recent_revisions.length, 3);
    assert.deepEqual(result.recent_revisions[1].affected_languages, ["cn", "en"]);
    const lowered = await request(origin, "PATCH", "/api/concepts/dashboard-one", { expected_version: 2, changes: { "locales.en.agent_instruction": "" } });
    assert.equal(lowered.value.version, 3);
    result = await dashboard();
    assert.equal(result.locales.en.browsable, 1);
    assert.equal(result.locales.en.recommendable, 0);
    assert.deepEqual(result.recent_revisions[0].affected_languages, ["en"]);
    const archived = await request(origin, "POST", "/api/concepts/dashboard-one/archive", { expected_version: 3 });
    assert.equal(archived.value.version, 4);
    result = await dashboard();
    assert.equal(result.active_total, 1);
    assert.equal(result.archived_total, 1);
    assert.equal(result.both_draft, 1);
    assert.equal(result.locales.cn.browsable, 0);
    assert.deepEqual(result.recent_revisions[0].affected_languages, ["cn", "en"]);
    assert.equal(result.recent_revisions[0].operation, "archive");
    const restored = await request(origin, "POST", "/api/concepts/dashboard-one/restore", { expected_version: 4 });
    assert.equal(restored.value.version, 5);
    result = await dashboard();
    assert.equal(result.active_total, 2);
    assert.equal(result.archived_total, 0);
    assert.equal(result.locales.cn.recommendable, 1);
    assert.equal(result.locales.en.recommendable, 0);
    await app.close();
    app = createApiServer({ dbPath });
    origin = await listen();
    result = await dashboard();
    assert.equal(result.active_total, 2);
    assert.equal(result.recent_revisions[0].operation, "restore");
    await request(origin, "POST", "/api/concepts/dashboard-one/archive", { expected_version: 5 });
    await request(origin, "DELETE", "/api/concepts/dashboard-one", { expected_version: 6, confirm_id: "dashboard-one" });
    result = await dashboard();
    assert.equal(result.active_total, 1);
    assert.equal(result.archived_total, 0);
    assert.equal(result.both_draft, 1);
    assert.deepEqual(result.locales, { cn: { browsable: 0, recommendable: 0 }, en: { browsable: 0, recommendable: 0 } });
    assert.equal(result.recent_revisions.length, 1);
    assert.equal(result.recent_revisions[0].concept_id, "dashboard-draft");
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
