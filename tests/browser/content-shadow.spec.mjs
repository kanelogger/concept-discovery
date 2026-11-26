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


test("the initial SQLite list and direct detail render without a duplicate command request", async ({page,shadowUrl})=>{
  const commands=[];
  page.on("request", req=>{
    const path=new URL(req.url()).pathname;
    if(path.startsWith("/api/v1/commands/")) commands.push(path);
  });
  await page.goto(shadowUrl+"/cards");
  await expect(page.locator(".card-title-link").first()).toBeVisible();
  expect(commands).not.toContain("/api/v1/commands/list");
  await page.goto(shadowUrl+"/?id=new");
  await expect(page.locator("#document-title")).toHaveText(title);
  expect(commands).not.toContain("/api/v1/commands/get-document");
  await expect(page.locator("#initial-page")).toHaveCount(0);
});

test("a late reader stylesheet waits for layout, respects navigation, and offers recovery after a network failure", async ({ page, shadowUrl }) => {
  const css = "**/ui/assets/card-reader-*.css";
  const requested = Promise.withResolvers();
  const release = Promise.withResolvers();
  await page.route(css, async route => {
    requested.resolve();
    await release.promise;
    await route.continue();
  }, { times: 1 });
  await page.goto(shadowUrl + "/cards");
  const link = page.getByRole("link", { name: title, exact: true });
  try {
    await link.click();
    await requested.promise;
    await expect(page.locator("#reader")).toHaveCount(0);
    await page.locator("#cards-nav").click();
    await expect(link).toBeVisible();
  } finally { release.resolve(); }
  await link.click();
  await expect(page.locator("#document-title")).toHaveText(title);
  await expect(page.locator(".reader-heading")).toHaveCSS("margin-bottom", "27px");

  await page.route(css, route => route.abort("failed"), { times: 1 });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("页面组件未能加载");
  await page.getByRole("button", { name: "刷新当前页" }).click();
  await expect(page.locator("#document-title")).toHaveText(title);
  await expect(page).toHaveURL(shadowUrl + "/?id=new");
});

test("owner rechecks the current session before revealing the SQLite seed, including a logout while JS is delayed", async ({browser}) => {
  const {withShadowList} = await import('../performance/shadow-list.mjs');
  const {owner} = await import('../service/auth-https-fixture.mjs');
  await withShadowList(async service=>{
    const context=await browser.newContext({ignoreHTTPSErrors:true});
    try {
      const current=await context.newPage();
      const requests=[];
      current.on('request',req=>requests.push(new URL(req.url()).pathname));
      await current.goto(service.url+'/login');
      await current.locator('#login-username').fill(owner.username);
      await current.locator('#login-password').fill(owner.password);
      await current.locator('.session-form button[type=submit]').click();
      await expect(current.locator('.card-title-link')).toHaveCount(20);
      expect(requests).toContain('/api/session');
      expect(requests).not.toContain('/api/v1/commands/list');
      const delayed=await context.newPage();
      let revealed=false;
      await delayed.exposeFunction('reportedPrivateView',()=>{revealed=true;});
      await delayed.addInitScript(()=>{
        new MutationObserver(()=>{
          if(document.querySelector('.card-title-link')?.checkVisibility()) window.reportedPrivateView();
        }).observe(document,{subtree:true,childList:true,attributes:true});
      });
      const waiting=Promise.withResolvers(), release=Promise.withResolvers();
      await delayed.route('**/ui/app-*.js',async route=>{
        waiting.resolve();
        await release.promise;
        await route.continue();
      },{times:1});
      try {
        await delayed.goto(service.url+'/cards',{waitUntil:'commit'});
        await waiting.promise;
        await expect(delayed.locator('#initial-page')).toHaveCount(1);
        await current.bringToFront();
        await current.getByRole('button',{name:'退出登录'}).click();
        await expect(current.locator('#login-username')).toBeVisible();
        await delayed.bringToFront();
      } finally {release.resolve();}
      await expect(delayed.locator('#login-username')).toBeVisible();
      expect(revealed).toBe(false);
    } finally{await context.close();}
  });
});

test("a logout broadcast precedes a delayed successful first session response", async ({browser}) => {
  const {withShadowList} = await import('../performance/shadow-list.mjs');
  const {owner} = await import('../service/auth-https-fixture.mjs');
  await withShadowList(async service=>{
    const context=await browser.newContext({ignoreHTTPSErrors:true});
    try {
      const current=await context.newPage();
      await current.goto(service.url+'/login');
      await current.locator('#login-username').fill(owner.username);
      await current.locator('#login-password').fill(owner.password);
      await current.locator('.session-form button[type=submit]').click();
      await expect(current.locator('.card-title-link')).toHaveCount(20);
      const pending=await context.newPage(), checked=Promise.withResolvers(), release=Promise.withResolvers();
      const logoutSeen=Promise.withResolvers();
      await pending.exposeFunction('recordLogout',()=>logoutSeen.resolve());
      await pending.addInitScript(()=>{
        const channel=new BroadcastChannel('concept-discovery.session');
        channel.onmessage=event=>{if(event.data?.logout)window.recordLogout();};
      });
      await pending.route('**/api/session',async route=>{
        const response=await route.fetch();
        checked.resolve(response.status());
        await release.promise;
        await route.fulfill({response});
      },{times:1});
      try {
        await pending.goto(service.url+'/cards',{waitUntil:'commit'});
        expect(await checked.promise).toBe(200);
        await current.getByRole('button',{name:'退出登录'}).evaluate(button=>button.click());
        await logoutSeen.promise;
        await expect(current.locator('#login-username')).toBeVisible();
      } finally {release.resolve();}
      await expect(pending.locator('#login-username')).toBeVisible();
      await expect(pending.locator('.card-title-link')).toHaveCount(0);
    } finally {await context.close();}
  });
});
