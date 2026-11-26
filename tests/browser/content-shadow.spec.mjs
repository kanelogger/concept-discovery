import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test as base } from "@playwright/test";
import { buildContent, historyInventory } from "../../scripts/build-content.mjs";
import { startContentShadow } from "../../scripts/start-content-shadow.mjs";
import { digest, repositoryRoot, writeJSON } from "../../scripts/test-runtime.mjs";
import { sourceSnapshot } from "../service/source-fixture.mjs";

const libraryId = "browser-shadow-fixture";
const title = "整理观察笔记";
const keyword = "窗边蓝石";
const question = "怎样保存观察？";
const source = sourceSnapshot("shadow-observation", {
  title: "观察手记原文",
  markdown: "第一行观察。\n\n第二行保留原样。",
  author: "测试记录员",
});

function buildFixture(root) {
  const rawRoot = join(root, "raw");
  const baseline = { version: 1, libraryId, sources: [source], proposals: [], events: [] };
  const articles = [
    ["new", title, `记录${keyword}的颜色。\n\n[查阅观察手记](/wiki?source=${source.id})`],
    ["guide", "观察指南", "参阅 [[new]]，整理每次记录。"],
    ["atlas", "场景图鉴", `按问题查找卡片。\n\n## 观察方法\n\n### ${question}\n\n- [整理笔记](../new/article.md)`],
  ];
  const cards = {};
  for (const [id, name, body] of articles) {
    const directory = join(rawRoot, "研究方法", id);
    mkdirSync(directory, { recursive: true });
    const article = `---\nname: ${name}\nid: ${id}\n---\n\n## 核心理解\n\n${body}\n`;
    writeFileSync(join(directory, "article.md"), article);
    cards[id] = { id, updated: "20261126090000" };
  }
  const metadataFile = join(root, "metadata.json");
  const baselineFile = join(root, "baseline.json");
  writeJSON(metadataFile, { version: 1, libraryId, cards, readings: {}, history: historyInventory(baseline) });
  writeJSON(baselineFile, baseline);
  buildContent({ rawRoot, metadataFile, baselineFile, output: join(root, "release") });
}

async function loopbackPort() {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await probe[Symbol.asyncDispose]();
  return port;
}

const test = base.extend({
  shadowUrl: [async ({}, use) => {
    const root = mkdtempSync(join(tmpdir(), "cd-shadow-browser-"));
    let server;
    try {
      execFileSync(process.execPath, [join(repositoryRoot, "scripts/build-web.mjs")]);
      buildFixture(root);
      const port = await loopbackPort();
      const publicUrl = "http://127.0.0.1:" + port;
      const config = join(root, "shadow.json");
      writeFileSync(join(root, "agent-token"), randomUUID(), { mode: 0o600 });
      writeJSON(config, {
        backend: "content-shadow", publicUrl, port, auth: { mode: "local" }, libraryId,
        agentTokenFile: "agent-token", contentRelease: "release",
        manifestSha256: digest(readFileSync(join(root, "release", "manifest.json"))),
      });
      server = await startContentShadow(config);
      await use(publicUrl);
    } finally {
      if (server) await server[Symbol.asyncDispose]();
      rmSync(root, { recursive: true, force: true });
    }
  }, { scope: "worker" }],
});

test("SQLite list searches card bodies and distinguishes the new bookmark from the card slug", async ({ page, shadowUrl }) => {
  await page.goto(shadowUrl + "/cards");
  const cards = page.locator("#card-list .card-title-link");
  await expect(cards).toHaveCount(3);
  await page.locator("#search-input").fill(keyword);
  await expect(cards).toHaveCount(1);
  const filters = new URLSearchParams({ q: keyword });
  const detail = shadowUrl + "/?id=new&" + filters;
  await expect(cards).toHaveText(title);
  await expect(cards).toHaveAttribute("href", "/?id=new&" + filters);
  await cards.click();
  await expect(page).toHaveURL(detail);
  await expect(page.locator("#document-title")).toHaveText(title);
  await page.reload();
  await expect(page.locator("#document-body")).toContainText(keyword);

  await page.getByRole("link", { name: "查阅观察手记" }).click();
  await expect(page).toHaveURL(shadowUrl + "/wiki?source=" + source.id);
  await expect(page.getByRole("heading", { name: source.title })).toBeVisible();
  await expect(page.locator(".wiki-source-text")).toHaveJSProperty("textContent", source.markdown);
  await page.goBack();
  await expect(page).toHaveURL(detail);
  await expect(page.locator("#document-title")).toHaveText(title);

  await page.goto(shadowUrl + "/cards/new?" + filters);
  await expect(page).toHaveURL(shadowUrl + "/cards?" + filters);
  await expect(page.locator("#search-input")).toHaveValue(keyword);
  await expect(cards).toHaveText([title]);
});

test("SQLite graph opens its linked slug in a new tab and the atlas restores its selected card", async ({ page, shadowUrl }) => {
  await page.goto(shadowUrl + "/graph");
  await expect(page.locator('.graph-edge[data-source="guide"][data-target="new"]')).toHaveCount(1);
  const [reader] = await Promise.all([
    page.waitForEvent("popup"),
    page.locator('.graph-node[data-node-id="new"]').dblclick(),
  ]);
  try {
    await expect(reader).toHaveURL(shadowUrl + "/?id=new");
    await expect(reader.locator("#document-title")).toHaveText(title);
  } finally {
    await reader.close();
  }
  await expect(page).toHaveURL(shadowUrl + "/graph");
  await page.getByRole("button", { name: "场景", exact: true }).click();
  const toggle = page.getByRole("button", { name: new RegExp(question) });
  await toggle.click();
  const card = page.locator(".atlas-entry").getByRole("link", { name: title, exact: true });
  await expect(card).toHaveAttribute("href", "/?id=new");
  await card.click();
  await expect(page).toHaveURL(shadowUrl + "/?id=new");
  await expect(page.locator("#document-title")).toHaveText(title);
  await page.getByRole("button", { name: "返回图鉴" }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(card).toBeVisible();
});
