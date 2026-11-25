import { createLegacyCard } from "../service/legacy-fixture.mjs";
import { sourceSnapshot, syncRawSources } from "../service/source-fixture.mjs";
import { test, expect, opId, openApp, gate, settled } from "./fixtures.mjs";

const create = (service, title, markdown = "初始正文。") => service.createDocument({title, markdown});

async function expectReadOnlyControls(page) {
  await expect(page.getByRole("button", { name: /^(新增知识卡|编辑|删除|写我的理解|模型设置)$/ })).toHaveCount(0);
  await expect(page.locator("#editor-form, input[type=file]")).toHaveCount(0);
}

test("clean sessions and legacy write links open the corresponding read-only views", async ({ service, ui }) => {
  const { page, context } = ui;
  const title = "直接使用 " + opId("startup");
  const card = await create(service, title);
  expect(await context.cookies(service.url)).toEqual([]);
  await openApp(page, service);
  await page.locator("#search-input").fill(title);
  await page.locator(`#card-list a[data-card-id="${card.id}"]`).click();
  await expect(page.locator("#document-title")).toHaveText(title);
  await context.clearCookies();
  await page.reload();
  await expect(page.locator("#reader")).toBeVisible();
  await expect(page.locator("#document-title")).toHaveText(title);
  const original = await service.call("get-document", { id: card.id });
  await service.restart();
  const filters = new URLSearchParams({ q: title });
  await page.goto(`${service.url}/cards/${card.id}/edit?${filters}`);
  await expect(page).toHaveURL(`${service.url}/cards/${card.id}?${filters}`);
  await expect(page.locator("#document-title")).toHaveText(title);
  await expect(page.locator("#document-body")).toContainText(original.markdown);
  await expectReadOnlyControls(page);

  await page.goto(`${service.url}/cards/new?${filters}`);
  await expect(page).toHaveURL(`${service.url}/cards?${filters}`);
  await expect(page.locator("#search-input")).toHaveValue(title);
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
  await expectReadOnlyControls(page);
  expect((await service.call("get-document", { id: card.id })).revision).toBe(original.revision);
  expect(await context.cookies(service.url)).toEqual([]);
  service.record("legacy-write-links-read-only", { id: card.id, cleanContext: true, restarted: true });
});

test("list data can finish before its route module and still restore the source row", async ({ service, ui }) => {
  const { page } = ui;
  const card = await create(service, "列表分块 " + opId("split"));
  const listUrl = service.url + "/cards?" + new URLSearchParams({ q: "列表分块" });
  const link = page.locator(`.card-title-link[data-card-id="${card.id}"]`);
  await page.goto(listUrl);
  await link.click();
  await expect(page.locator("#reader")).toBeVisible();
  await page.goBack();
  await expect(link).toBeFocused();

  const release = gate();
  const scripts = [];
  page.on("request", request => { if (request.resourceType() === "script") scripts.push(request.url()); });
  await page.route("**/ui/chunks/card-list-*.js", async route => { await release.promise; await route.continue(); });
  try {
    const data = page.waitForResponse("**/api/v1/commands/list");
    await page.reload({ waitUntil: "domcontentloaded" });
    expect((await (await data).json()).data.items.map(item => item.id)).toContain(card.id);
    await settled(page);
    await expect(page.locator("#list-page")).toHaveCount(0);
    release.release();
    await expect(link).toBeFocused();
    expect(scripts.some(url => url.includes("/knowledge-graph-"))).toBe(false);
  } finally { release.release(); }
});

test("an unavailable route chunk offers a reload at the same filtered URL", async ({ service, ui }) => {
  const { page } = ui;
  await page.route("**/ui/chunks/card-list-*.js", route => route.fulfill({ status: 404, body: "" }), { times: 1 });
  const url = service.url + "/cards?q=missing-chunk";
  await page.goto(url);
  await page.getByRole("button", { name: "刷新当前页" }).click();
  await expect(page.locator("#search-input")).toHaveValue("missing-chunk");
  await expect(page).toHaveURL(url);
});

test("a cached list remains interactive while it refreshes, and full tags load on demand", async ({ service, ui }) => {
  const { page } = ui;
  const card = await create(service, "缓存列表 " + opId("cache"));
  const first = { id: card.id, title: "缓存列表", tags: ["当前页"] };
  const later = { id: "20261123000000-ccccccc", title: "第二页结果", tags: ["其他页"] };
  const refresh = gate(), requested = gate();
  let reads = 0, tagReads = 0;
  await page.route("**/api/v1/commands/list", async route => {
    const body = route.request().postDataJSON();
    if (body.includeTags === true) {
      if (++tagReads === 1) return route.fulfill({ status: 503, json: { ok: false } });
      return route.fulfill({ json: { ok: true, data: { tags: ["当前页", "其他页"], items: [first], total: 21 } } });
    }
    if (++reads === 2) {
      requested.release();
      await refresh.promise;
      return route.fulfill({ status: 503, json: { ok: false } });
    }
    return route.fulfill({ json: { ok: true, data: { items: body.offset ? [later] : [first], total: 21 } } });
  });
  const link = page.getByRole("link", { name: first.title, exact: true });
  await page.goto(service.url + "/cards");
  await link.click();
  await expect(page.locator("#reader")).toBeVisible();
  try {
    await page.goBack();
    await requested.promise;
    await expect(link).toBeFocused();
    await expect(page.locator(".ant-pagination-next button")).toBeEnabled();
    const chooser = page.getByRole("combobox", { name: "标签" });
    expect(tagReads).toBe(0);
    await chooser.click();
    await page.getByRole("button", { name: "重试标签" }).click();
    await expect(page.locator(".ant-select-item-option-content").filter({ hasText: /^其他页$/ })).toBeVisible();
    await chooser.press("Escape");
    await expect(chooser).toHaveAttribute("aria-expanded", "false");
    await expect(chooser).toBeFocused();
    refresh.release();
    await expect(page.locator("#list-message")).toContainText("仍显示上次读取的列表");
    await expect(link).toBeVisible();
    await page.locator(".ant-pagination-next button").click();
    await expect(page.getByRole("link", { name: later.title, exact: true })).toBeVisible();
    await expect(page).toHaveURL(/page=2/);
  } finally { refresh.release(); }
});

test("one update date filters the card list and survives navigation", async ({ service, ui }, testInfo) => {
  const { page } = ui;
  const title = "单日更新筛选 " + opId("date");
  const card = await create(service, title);
  const { updated } = await service.call("get-document", { id: card.id });
  const day = updated.slice(0, 8).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
  const cardLink = page.getByRole("link", { name: title, exact: true });
  const date = page.getByLabel("更新日期", { exact: true });
  const oldRange = "2000-01-01 至 2000-01-02";

  await page.goto(`${service.url}/cards?from=2000-01-01&to=2000-01-02`);
  await expect(page.getByText(oldRange, { exact: false })).toBeVisible();
  await expect(page.getByText("共 0 张知识卡")).toBeVisible();
  await expect(date).toHaveCount(1);
  await expect(page.getByLabel(/更新(?:开始|结束)日期/)).toHaveCount(0);

  await date.click();
  await expect(page.locator(".ant-picker-dropdown:visible")).toBeVisible();
  await date.press("Escape");
  await expect(page.locator(".ant-picker-dropdown:visible")).toHaveCount(0);
  await expect(date).toBeFocused();
  await date.fill(day);
  await date.press("Enter");
  await expect(page).toHaveURL(`${service.url}/cards?from=${day}&to=${day}`);
  await expect(page.getByText(oldRange, { exact: false })).toHaveCount(0);
  await expect(cardLink).toBeVisible();
  await cardLink.click();
  await expect(page.locator("#document-title")).toHaveText(title);
  await page.getByRole("button", { name: "返回列表" }).click();
  await expect(date).toHaveValue(day);
  await expect(cardLink).toBeVisible();

  await date.fill("2000-01-01");
  await date.press("Enter");
  await expect(page.getByText("共 0 张知识卡")).toBeVisible();
  await expect(cardLink).toHaveCount(0);
  await page.getByRole("button", { name: "重置" }).click();
  await expect(page).toHaveURL(`${service.url}/cards`);
  await expect(date).toHaveValue("");
  await expect(cardLink).toBeVisible();
  await testInfo.attach("card-filters", { body: await page.locator("#search-form").screenshot(), contentType: "image/png" });
});

test("card reader centers short cards and keeps chapter jumps in the current card", async ({ service, ui }) => {
  const { page } = ui;
  const title = "文档目录 " + opId("contents");
  const paragraph = "核对原文并记下判断所依据的材料。".repeat(120);
  const long = await create(service, title,
    `开头说明。\n\n> 第一段引用。\n>\n> 第二段引用。\n\n## 记录方法\n\n${paragraph}\n\n## 一个例子\n\n${paragraph}\n\n## 适用边界\n\n${paragraph}`);
  const short = await create(service, "短卡 " + opId("short"), "不用目录也可以直接读完。");
  const overview = await create(service, "窄窗概览 " + opId("overview"),
    "## 理解\n\n一段理解。\n\n### 例子\n\n理解里的小节。\n\n## 适用情境\n\n一段适用情境。");
  const contents = page.getByRole("navigation", { name: "本文目录" });
  const base = `${service.url}/cards`;

  await page.goto(`${base}/${short.id}`);
  const body = page.locator("#document-body");
  await expect(body).toContainText("不用目录也可以直接读完。");
  await expect(contents).toHaveCount(0);
  expect(await body.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return Math.abs(rect.left + rect.width / 2 - innerWidth / 2);
  })).toBeLessThan(12);
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto(`${base}/${overview.id}`);
  await expect(body.getByText("理解里的小节。")).toBeVisible();
  await expect(contents).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 1000 });

  const search = new URLSearchParams({ q: title });
  await page.goto(`${base}?${search}`);
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(contents.getByRole("link")).toHaveCount(3);
  const example = contents.getByRole("link", { name: "一个例子" });
  const secondHeading = page.locator("#document-body").getByRole("heading", { name: "一个例子" });
  const id = await secondHeading.getAttribute("id");
  expect(id).toMatch(/^\d{14}-[a-z0-9]{7}$/);
  await expect(example).toHaveAttribute("href", `#${id}`);
  const bodyBox = await body.locator(".reader-chapters").boundingBox();
  expect((await contents.boundingBox()).x).toBeGreaterThan(bodyBox.x + bodyBox.width);
  const quoteParagraphs = body.locator("blockquote p");
  await expect(quoteParagraphs).toHaveCount(2);
  const firstQuote = await quoteParagraphs.first().boundingBox();
  const secondQuote = await quoteParagraphs.last().boundingBox();
  expect(secondQuote.y).toBeGreaterThan(firstQuote.y + firstQuote.height);

  await example.press("Enter");
  await expect(secondHeading).toBeFocused();
  await expect(example).toHaveAttribute("aria-current", "location");
  await expect(page).toHaveURL(`${base}/${long.id}?${search}#${id}`);
  await page.locator("#workspace").evaluate(pane => pane.scrollTo(0, 0));
  await expect(contents.getByRole("link", { name: "记录方法" })).toHaveAttribute("aria-current", "location");
  await page.locator("#workspace").evaluate(pane => pane.scrollTo(0, pane.scrollHeight));
  await expect(contents.getByRole("link", { name: "适用边界" })).toHaveAttribute("aria-current", "location");
  await page.goBack();
  await expect(page).toHaveURL(`${base}?${search}`);
  await expect(page.getByRole("link", { name: title, exact: true })).toBeFocused();
});

test("long card reader keeps the active section in a scrolling directory", async ({ service, ui }) => {
  const { page } = ui;
  const markdown = Array.from({ length: 35 }, (_, index) =>
    `## 记录 ${index + 1}\n\n${"核对材料并记录出处。".repeat(30)}`).join("\n\n");
  const card = await create(service, "长目录 " + opId("long-index"), markdown);
  await page.setViewportSize({ width: 1280, height: 620 });
  await openApp(page, service, card.id);
  const body = page.locator("#document-body");
  const index = page.getByRole("navigation", { name: "本文目录" });
  const heading = body.getByRole("heading", { name: "记录 30", exact: true });
  await heading.evaluate(node => node.scrollIntoView({ block: "start" }));
  const active = index.getByRole("link", { name: "记录 30", exact: true });
  await expect(active).toHaveAttribute("aria-current", "location");
  await expect(active).toBeInViewport({ ratio: 1 });
  await expect(heading).toBeInViewport({ ratio: 1 });
});

test("card reader promotes existing fields, preserves anchors and starts recall only on request", async ({ service, ui }) => {
  const { page } = ui;
  const title = "回想详情 " + opId("recall");
  const markdown = [
    "一段参考解释。",
    "## 证据\n\n可核对的原句。",
    "## 名称\n\n" + title,
    "## 别名\n\n- 证据备忘\n- Evidence Note",
    "## 理解\n\n一条证据只能支持当前的判断。",
    "## 标签\n\n- 证据整理\n- 写作",
    "## 适用情境\n\n检查访谈记录和研究报告时。",
    "## 自测\n\n文章中的结论能支持到哪一步？",
    "## 我的理解\n\n我会先核对材料的上下文。",
  ].join("\n\n");
  const card = await create(service, title, markdown);
  const original = await service.call("get-document", { id: card.id });
  const questionRequests = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/v1/commands/wiki-card") questionRequests.push(request.url());
  });
  const blockId = label => original.blocks.find(block => block.markdown.trim() === "## " + label).id;
  await openApp(page, service, card.id);
  const reader = page.locator("#reader");
  const content = page.locator("#document-body");
  const understanding = content.getByText("一条证据只能支持当前的判断。");
  const situation = content.getByText("检查访谈记录和研究报告时。");
  const reference = content.getByText("一段参考解释。");
  const index = page.getByRole("navigation", { name: "本文目录" });
  const recall = page.getByRole("button", { name: "试着回想" });
  await expect(reader.getByRole("heading", { name: title, exact: true })).toBeVisible();
  const aliasHeading = reader.locator(".reader-aliases").getByRole("heading", { name: "别名", exact: true });
  const aliasId = blockId("别名");
  await expect(aliasHeading).toHaveAttribute("id", aliasId);
  await expect(reader.locator(".reader-aliases li")).toHaveText(["证据备忘", "Evidence Note"]);
  await expect(content.getByRole("heading", { name: "别名", exact: true })).toHaveCount(0);
  const aliasPosition = await aliasHeading.boundingBox();
  const tagPosition = await reader.locator(".record-meta").boundingBox();
  expect(aliasPosition.y).toBeLessThan(tagPosition.y);
  await expect(reader.locator(".record-meta .tag-chip")).toHaveText(["证据整理", "写作"]);
  await expect(reader.getByRole("heading", { name: /^(名称|标签)$/ })).toHaveCount(0);
  for (const name of ["名称", "标签"]) {
    await expect(reader.locator(`.reader-heading [id="${blockId(name)}"]`)).toHaveCount(1);
  }
  await expect(understanding).toBeVisible();
  await expect(situation).toBeVisible();
  await expect(reference).toBeVisible();
  const headings = await content.getByRole("heading").allTextContents();
  expect(headings.slice(0, 3)).toEqual(["理解", "适用情境", "证据"]);
  await expect(index.getByRole("link", { name: "理解", exact: true })).toHaveAttribute("href", "#" + blockId("理解"));
  await expect(page.getByText("先试着回想")).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 820 });
  for (const action of ["返回列表", "试着回想"]) {
    await expect(page.getByRole("button", { name: action, exact: true })).toBeInViewport({ ratio: 1 });
  }
  expect(await page.locator("#workspace").evaluate(pane => pane.scrollWidth - pane.clientWidth)).toBe(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await recall.press("Enter");
  await expect(page.getByRole("heading", { name: "先试着回想" })).toBeFocused();
  await expect(reader.locator(".reader-recall")).toContainText("文章中的结论能支持到哪一步？");
  await expect(aliasHeading).toBeVisible();
  await expect(understanding).toBeHidden();
  await expect(reference).toBeHidden();
  await expect(situation).toBeVisible();
  await expect(index).toBeHidden();
  const disclosure = page.locator(".reader-reference");
  await expect(disclosure.getByText("展开理解与参考")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(disclosure.locator("summary")).toBeFocused();
  await disclosure.locator("summary").press("Enter");
  await expect(understanding).toBeVisible();
  await expect(reference).toBeVisible();
  await page.getByRole("button", { name: "返回阅读" }).click();
  await expect(understanding).toBeVisible();
  await expect(disclosure).toHaveCount(0);

  await page.goto(`${service.url}/?id=${aliasId}`);
  await expect(aliasHeading).toBeVisible();
  const anchor = blockId("理解");
  await page.goto(`${service.url}/?id=${anchor}`);
  await expect(content.locator(".reader-understanding").getByRole("heading", { name: "理解", exact: true })).toHaveAttribute("id", anchor);
  await expect(index.getByRole("link", { name: "理解", exact: true })).toHaveAttribute("aria-current", "location");
  await expect(understanding).toBeVisible();
  const after = await service.call("get-document", { id: card.id });
  expect(after.markdown).toBe(original.markdown);
  expect(after.revision).toBe(original.revision);
  expect(questionRequests).toEqual([]);
  await expectReadOnlyControls(page);
});

test("same-origin proxy cookies reach the page and APIs without an application session", async ({ service, ui }) => {
  const { page, context } = ui;
  const title = "外层代理兼容 " + opId("proxy");
  const card = await create(service, title);
  const proxyCookie = { name: "outer_proxy_fixture", value: "synthetic-proxy-access" };
  await context.addCookies([{ ...proxyCookie, url: service.url, httpOnly: true, sameSite: "Strict" }]);
  const requests = [];
  const sessionRequests = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/session") sessionRequests.push(request.method());
  });
  await page.route(url => url.origin === service.url && (url.pathname === "/" || url.pathname.startsWith("/api/")), async route => {
    const headers = await route.request().allHeaders();
    const hasProxyCookie = (headers.cookie || "").split(/;\s*/).includes(`${proxyCookie.name}=${proxyCookie.value}`);
    requests.push({ path: new URL(route.request().url()).pathname, hasProxyCookie });
    if (!hasProxyCookie) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "proxy_access_required", message: "Synthetic outer proxy requires its cookie" } }) });
    return route.continue();
  });
  const html = page.waitForResponse(response => response.request().isNavigationRequest() && new URL(response.url()).pathname === "/");
  await openApp(page, service);
  expect((await html).status()).toBe(200);
  await page.locator("#search-input").fill(title);
  await expect(page.locator(`#card-list a[data-card-id="${card.id}"]`)).toBeVisible();
  expect(requests.some(request => request.path === "/api/v1/commands/list")).toBe(true);
  expect(requests.every(request => request.hasProxyCookie)).toBe(true);
  expect(sessionRequests).toEqual([]);
  await expect(page.locator("#login-screen, #access-code, #login-button, #logout-button")).toHaveCount(0);
  service.record("outer-proxy-cookie-without-app-session", { id: card.id, requests, applicationSessionRequests: sessionRequests, syntheticCookieOnly: true });
});

test("Chinese fixed-field cards show their body and general supplemental reading", async ({ service, ui }) => {
  const { page } = ui;
  const title = "中文旧卡 " + opId("legacy");
  const description = "中文旧卡保留自己的理解与 API 链接。";
  const reading = { title: "旧卡补充阅读", markdown: "补充原文独立阅读，正文理解仍在原卡。" };
  const card = await createLegacyCard(service, { legacyId: opId("legacy-reference"), title, description, reading });
  await openApp(page, service, card.id);
  await expect(page.locator("#document-title")).toHaveText(title);
  await expect(page.locator("#document-body")).toContainText(description);
  await expectReadOnlyControls(page);
  await page.locator(`#reading-list a[data-card-id="${card.readingId}"]`).click();
  await expect(page.locator("#document-title")).toHaveText(reading.title);
  await expect(page.locator("#document-body")).toContainText(reading.markdown);
  expect((await service.call("get-document", { id: card.id })).editable).toBe(false);
  service.record("chinese-fixed-field-browser-reading", { id: card.id, readingId: card.readingId, originalBodyVisible: true, wholeCardReadOnly: true, readingOpened: true });
});

test("stale search and document responses cannot overwrite current state", async ({ service, ui }) => {
  const { page } = ui;
  const oldTerm = opId("outdated").replaceAll("-", "");
  const newTerm = opId("current").replaceAll("-", "");
  const a = await create(service, "旧线索 " + oldTerm, "## 自测\n\n旧卡的问题？");
  const b = await create(service, "新线索 " + newTerm);
  expect((await service.call("search", { query: oldTerm, limit: 20 })).map((item) => item.id)).toEqual([a.id]);
  expect((await service.call("search", { query: newTerm, limit: 20 })).map((item) => item.id)).toEqual([b.id]);
  await openApp(page, service, b.id);
  await page.locator("#back-to-list").click();
  await expect(page.locator("#list-page")).toBeVisible();
  const oldSearch = gate(), searched = gate(), searchFinished = gate();
  await page.route("**/api/v1/commands/list", async (route) => {
    if (route.request().postDataJSON().query !== oldTerm) return route.continue();
    const response = await route.fetch();
    searched.release();
    await oldSearch.promise;
    try { await route.fulfill({ response }); } finally { searchFinished.release(); }
  });
  try {
    await page.locator("#search-input").fill(oldTerm);
    await searched.promise;
    const currentSearch = page.waitForResponse((response) => response.url().endsWith("/api/v1/commands/list") && response.request().postDataJSON().query === newTerm);
    await page.locator("#search-input").fill(newTerm);
    expect((await (await currentSearch).json()).data.items.map((item) => item.id)).toEqual([b.id]);
    await expect(page.locator(`#card-list a[data-card-id="${b.id}"]`)).toBeVisible();
    await expect(page.locator(`#card-list a[data-card-id="${a.id}"]`)).toHaveCount(0);
    oldSearch.release();
    await searchFinished.promise;
    await settled(page);
    await expect(page.locator(`#card-list a[data-card-id="${a.id}"]`)).toHaveCount(0);
    await expect(page.locator(`#card-list a[data-card-id="${b.id}"]`)).toBeVisible();
  } finally { oldSearch.release(); }
  await page.locator("#clear-search").click();
  await expect(page.locator(`#card-list a[data-card-id="${a.id}"]`)).toBeVisible();

  const oldDocument = gate(), documentRequested = gate(), documentFinished = gate();
  await page.route("**/api/v1/commands/get-document", async (route) => {
    if (route.request().postDataJSON().id !== a.id) return route.continue();
    const response = await route.fetch();
    documentRequested.release();
    await oldDocument.promise;
    try { await route.fulfill({ response }); } finally { documentFinished.release(); }
  });
  try {
    await page.locator(`#card-list a[data-card-id="${a.id}"]`).click();
    await documentRequested.promise;
    const currentDocument = page.waitForResponse((response) => response.url().endsWith("/api/v1/commands/get-document") && response.request().postDataJSON().id === b.id);
    await page.locator(`#card-list a[data-card-id="${b.id}"]`).click();
    expect((await (await currentDocument).json()).data.id).toBe(b.id);
    await expect(page.locator("#document-title")).toHaveText("新线索 " + newTerm);
    oldDocument.release();
    await documentFinished.promise;
    await settled(page);
    await expect(page.locator("#document-title")).toHaveText("新线索 " + newTerm);
    await expect(page.locator("#try-recall")).toHaveCount(0);
  } finally { oldDocument.release(); }

  service.record("obsolete-response-protection", { oldCard: a.id, selectedCard: b.id });
});

test("a failed card read can be retried from its legacy link", async ({ service, ui }) => {
  const { page } = ui;
  const card = await create(service, "重试正文 " + opId("read"));
  await page.route("**/api/v1/commands/get-document", route => route.fulfill({
    status: 503, json: { ok: false, error: { code: "service_unavailable", message: "合成读取失败" } },
  }), { times: 1 });

  await page.goto(`${service.url}/cards/${card.id}/edit`);
  await expect(page).toHaveURL(`${service.url}/cards/${card.id}`);
  await expect(page.locator("#document-message")).toBeVisible();
  await page.getByRole("button", { name: "重新读取" }).click();
  await expect(page.locator("#document-body")).toContainText("初始正文。");
  await expectReadOnlyControls(page);
});

test("a double retry on a parent link opens the child once and Back returns to the parent", async ({ service, ui }) => {
  const { page } = ui;
  const childTitle = "子卡 " + opId("retry-child");
  const parentTitle = "父卡 " + opId("retry-parent");
  const child = await create(service, childTitle);
  const parent = await create(service, parentTitle, `[阅读子卡](/cards/${child.id})`);
  await openApp(page, service, parent.id);
  const ready = gate(), release = gate();
  const requested = [];
  await page.route("**/api/v1/commands/get-document", async route => {
    const id = route.request().postDataJSON().id;
    requested.push(id);
    if (requested.length === 1) return route.fulfill({ status: 503, json: { ok: false } });
    if (id === child.id) {
      ready.release();
      await release.promise;
    }
    await route.continue();
  });
  try {
    await page.getByRole("link", { name: "阅读子卡" }).click();
    await expect(page.locator("#document-title")).toHaveText(parentTitle);
    const retry = page.getByRole("button", { name: "重新读取" });
    await retry.click();
    await ready.promise;
    await retry.click();
    release.release();
    await expect(page).toHaveURL(service.url + "/cards/" + child.id);
    await expect(page.locator("#document-title")).toHaveText(childTitle);
    expect(requested).toEqual([child.id, child.id]);
    await page.goBack();
    await expect(page.locator("#document-title")).toHaveText(parentTitle);
  } finally { release.release(); }
});

test("source links, choices and history read the selected snapshot and archived proposal", async ({ service, ui }, testInfo) => {
  const { page } = ui;
  const first = sourceSnapshot("browser-reading", {
    title: "第一份阅读材料", markdown: "第一行。\n\n保留空行与 Markdown。", author: "甲",
    url: "https://example.org/reading", version: 2,
  });
  const second = sourceSnapshot("browser-interview", {
    title: "第二份访谈材料", markdown: "访谈原句。\n<script>原始资料按文本展示</script>",
  });
  await syncRawSources(service, [first, second]);
  // The legacy proposal format has no writer. Restore a synthetic archive to the
  // worker's private library, then exercise its normal list and detail requests.
  const proposal = await service.core(`
    const { writeFileSync } = await import("node:fs");
    const { resolve, dirname, join } = await import("node:path");
    const { canonical, hash } = await import("./lib/siyuan.mjs");
    const library = hash(canonical(await api.identity()));
    const dir = resolve(dirname(api.c.dataDir), "wiki", library, "proposals");
    const record = { id: input.id, sourceId: input.sourceId, kind: "proposal", state: "pending",
      updatedAt: "2025-05-06", createdAt: "2025-05-06",
      items: [{ id: "old-item", title: "访谈的局限", reason: "核对当时采用的材料。", body: "归档提案保留这段解释。", quotes: [{quote: "第一行。"}] }] };
    writeFileSync(join(dir, record.id + ".json"), JSON.stringify({ ...record, revision: hash(canonical(record)) }), { flag: "wx" });
    console.log(JSON.stringify(record));
  `, { id: opId("prop").replace("prop-", "prop_"), sourceId: first.id });
  const url = source => `${service.url}/wiki?source=${source.id}`;
  const body = page.locator(".wiki-selected-source .wiki-source-text");
  const chooser = page.getByRole("combobox", { name: "选择原文" });
  const cited = await create(service, "历史资料引用", `[核对原文](/wiki?source=${first.id})`);
  await openApp(page, service, cited.id);
  await page.getByRole("link", { name: "核对原文", exact: true }).click();
  await expect(page).toHaveURL(url(first));
  await expect(body).toHaveJSProperty("textContent", first.markdown);

  await page.goto(url(first));
  await expect(page.getByRole("heading", { name: "资料", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "资料", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: first.title })).toBeVisible();
  await expect(page.locator(".wiki-selected-source").getByText("第 2 版", { exact: true })).toBeVisible();
  await expect(body).toHaveJSProperty("textContent", first.markdown);
  await expect(page.getByRole("link", { name: "打开出处" })).toHaveAttribute("href", first.url);
  await testInfo.attach("source-reader", {body:await page.screenshot(),contentType:"image/png"});
  await chooser.fill("访谈");
  await page.getByText(second.title + " · 第 1 版", { exact: true }).click();
  await expect(page).toHaveURL(url(second));
  await expect(body).toHaveJSProperty("textContent", second.markdown);
  await expect(body.locator("script")).toHaveCount(0);

  const oldSource = gate(), requested = gate(), finished = gate();
  await page.route("**/api/v1/commands/source-get", async route => {
    if (route.request().postDataJSON().id !== first.id) return route.continue();
    const response = await route.fetch();
    requested.release();
    await oldSource.promise;
    try { await route.fulfill({ response }); } finally { finished.release(); }
  });
  try {
    await page.goBack();
    await expect(page).toHaveURL(url(first));
    await requested.promise;
    await page.goForward();
    await expect(page).toHaveURL(url(second));
    await expect(body).toHaveJSProperty("textContent", second.markdown);
    oldSource.release();
    await finished.promise;
    await settled(page);
    await expect(body).toHaveJSProperty("textContent", second.markdown);
  } finally { oldSource.release(); }
  await page.goBack();
  await expect(body).toHaveJSProperty("textContent", first.markdown);
  await page.getByText("历史整理提案", { exact: true }).click();
  const history = page.getByRole("combobox", { name: "选择历史提案" });
  await history.click();
  await page.getByText(first.title + " · " + proposal.createdAt, { exact: true }).click();
  const item = proposal.items[0];
  await expect(page.getByRole("heading", { name: item.title })).toBeVisible();
  await expect(page.getByText(item.body, { exact: true })).toBeVisible();
  await expect(page.locator("blockquote")).toHaveText(item.quotes[0].quote);
  await expectReadOnlyControls(page);
  await expect(page.locator("#wiki-source-form, #wiki-save-source, #wiki-generate-draft, #wiki-open-draft, textarea")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /导入|保存|生成|采用|写入/ })).toHaveCount(0);
  expect((await service.call("source-get", { id: first.id })).markdown).toBe(first.markdown);
});
