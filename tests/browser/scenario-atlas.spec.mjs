import { test, expect } from "./fixtures.mjs";

test("the read-only atlas opens catalog cards and restores the open stack", async ({ service, ui }, testInfo) => {
  const { page } = ui;
  const scenario = "先确认假设，还是直接试做？";
  const firstTitle = "记录你正在检验的假设";
  const secondTitle = "用最小试验获取证据";
  const outsideTitle = "把复盘写成学习记录";
  const firstUse = "先写下一个可被推翻的判断。";
  const secondUse = "用一次小试验验证判断。";
  const first = await service.createDocument({title:firstTitle, markdown:"## 标签\n\n- 学科：图鉴研究方法\n\n## 理解\n\n将一条假设写成可验证的句子。"});
  const second = await service.createDocument({title:secondTitle, markdown:"## 标签\n\n- 学科：图鉴项目管理\n\n## 适用情境\n\n需要在正式投入前降低不确定性。"});
  const outside = await service.createDocument({title:outsideTitle, markdown:"## 标签\n\n- 学科: 图鉴研究方法\n- 学科：图鉴学习科学\n- 个人笔记\n\n## 理解\n\n记下观察和下一次要验证的判断。"});
  const missing = "20260101000000-zzzzzzz";
  const markdown = [
    "## 图鉴决策",
    "",
    `### 【精选】${scenario}`,
    "",
    "尽快确认下一步该收集什么证据。",
    "",
    `1. [假设卡](/cards/${first.id}) — ${firstUse}`,
    `2. [试验卡](/cards/${second.id}) — ${secondUse}`,
    `3. [失效的卡片](/cards/${missing})`,
    "",
    "## 图鉴复盘",
    "",
    "### 怎样复盘试验过程？",
    "",
    `- [试验卡](/cards/${second.id})`,
  ].join("\n");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${service.url}/scenarios`);
  await expect(page.getByRole("heading", { name: "场景图鉴" })).toBeVisible();
  const scenesTab = page.getByRole("tab", { name: "按问题场景" });
  const subjectsTab = page.getByRole("tab", { name: "按学科" });
  const catalogActions = page.getByRole("button", { name: /创建图鉴目录|编辑图鉴目录/ });
  await expect(scenesTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(/还没有图鉴目录/)).toBeVisible();
  await expect(catalogActions).toHaveCount(0);

  await service.createDocument({title:"场景图鉴", markdown});
  await page.reload();
  await expect(page.getByRole("heading", { name: "图鉴决策" })).toBeVisible();
  await expect(catalogActions).toHaveCount(0);

  const response = await page.request.get(`${service.url}/api/scenarios`);
  expect(response.ok()).toBe(true);
  const { data } = await response.json();
  expect(data.catalog).toMatchObject({
    status: "ready",
    groups: [
      { title: "图鉴决策", entries: [{
        title: scenario,
        featured: true,
        description: "尽快确认下一步该收集什么证据。",
        items: [{ cardId: first.id, note: firstUse }, { cardId: second.id, note: secondUse }],
      }] },
      { title: "图鉴复盘", entries: [{ title: "怎样复盘试验过程？", items: [{ cardId: second.id, note: "" }] }] },
    ],
  });
  expect(data.catalog.diagnostics.length).toBeGreaterThan(0);
  const subjects = new Map(data.disciplines.map((subject) => [subject.title, subject.items.map((item) => item.cardId)]));
  expect(subjects.get("图鉴研究方法")).toEqual(expect.arrayContaining([first.id, outside.id]));
  expect(subjects.get("图鉴学习科学")).toContain(outside.id);
  expect(subjects.has("个人笔记")).toBe(false);
  expect(data.cards.find((card) => card.id === first.id)?.excerpt).toContain("将一条假设写成可验证的句子。");

  const sceneToggle = page.getByRole("button", { name: new RegExp(scenario.replace("？", "")) });
  await expect(sceneToggle).toHaveAttribute("aria-expanded", "false");
  await expect(sceneToggle.getByText("精选")).toBeVisible();
  await sceneToggle.click();
  const scene = page.locator(".atlas-entry").filter({ has: sceneToggle });
  const firstCard = scene.getByRole("heading", { name: firstTitle, exact: true });
  const secondCard = scene.getByRole("heading", { name: secondTitle, exact: true });
  const getCardLink = () => scene.getByRole("link", { name: "打开知识卡" });
  const stack = scene.locator("[aria-keyshortcuts]");
  const choices = scene.locator(".atlas-card-picker");
  await expect(firstCard).toBeVisible();
  await expect(scene.getByText(firstUse, { exact: true })).toBeVisible();
  await choices.getByRole("button", { name: secondTitle, exact: true }).click();
  await expect(secondCard).toBeVisible();
  await expect(choices.getByRole("button", { name: secondTitle, exact: true })).toHaveAttribute("aria-current", "true");
  await choices.getByRole("button", { name: firstTitle, exact: true }).click();
  await stack.focus();
  await stack.press("ArrowRight");
  await expect(secondCard).toBeVisible();
  await expect(scene.getByText(secondUse, { exact: true })).toBeVisible();
  await stack.press("ArrowLeft");
  await expect(firstCard).toBeVisible();

  // A pointer drag should only turn the deck. The embedded link should still
  // perform normal guarded navigation when clicked directly.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const bounds = await stack.boundingBox();
  expect(bounds?.width).toBeGreaterThan(200);
  const x = bounds.x + bounds.width * .68;
  const y = bounds.y + bounds.height * .45;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - bounds.width * .35, y, { steps: 6 });
  await page.mouse.up();
  await expect(secondCard).toBeVisible();
  await expect(page).toHaveURL(/\/scenarios(?:[?#]|$)/);
  await stack.evaluate(async node => Promise.all(node.getAnimations().map(animation => animation.finished)));
  await testInfo.attach("atlas-desktop", { body: await page.screenshot(), contentType: "image/png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 840, height: 560 });
  await getCardLink().scrollIntoViewIfNeeded();
  const workspace = page.locator("#workspace");
  const beforeOpen = await workspace.evaluate((pane) => pane.scrollTop);
  expect(beforeOpen).toBeGreaterThan(0);
  await getCardLink().click();
  await expect(page.locator("#document-title")).toHaveText(secondTitle);
  await page.goBack();
  await expect(secondCard).toBeVisible();
  await expect(getCardLink()).toBeFocused();
  await expect.poll(() => workspace.evaluate((pane) => pane.scrollTop)).toBeCloseTo(beforeOpen, 0);
  await page.goForward();
  await expect(page.locator("#document-title")).toHaveText(secondTitle);
  await page.getByRole("button", { name: "返回图鉴" }).click();
  await expect(getCardLink()).toBeFocused();
  await expect(secondCard).toBeVisible();
  await expect.poll(() => workspace.evaluate((pane) => pane.scrollTop)).toBeCloseTo(beforeOpen, 0);

  await scenesTab.focus();
  await scenesTab.press("ArrowRight");
  await expect(subjectsTab).toHaveAttribute("aria-selected", "true");
  await expect(subjectsTab).toBeFocused();
  const learning = page.getByRole("button", { name: /图鉴学习科学/ });
  await learning.click();
  await expect(learning).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText(outsideTitle, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: outsideTitle, exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "相关问题场景" })).toHaveCount(0);
  await scenesTab.click();
  await expect(secondCard).toBeVisible();

  await page.setViewportSize({ width: 320, height: 740 });
  const toc = page.getByRole("navigation").filter({ has: page.getByRole("link", { name: "图鉴复盘" }) });
  await expect(toc).toHaveCSS("position", "sticky");
  await toc.getByRole("link", { name: "图鉴复盘" }).click();
  await expect(page.getByRole("heading", { name: "图鉴复盘" })).toBeInViewport();
  await expect(toc).toBeInViewport();
  await expect(page.locator("#scenarios-nav")).toBeInViewport();
  expect(await page.locator("#app").evaluate((app) => app.scrollTop)).toBe(0);
  expect(await workspace.evaluate((pane) => pane.scrollWidth)).toBeLessThanOrEqual(320);
  await testInfo.attach("atlas-narrow", { body: await page.screenshot(), contentType: "image/png" });

  const narrowTop = await workspace.evaluate(pane => pane.scrollTop);
  expect(narrowTop).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("cd.atlas.position.v1")).top)).toBeCloseTo(narrowTop, 0);
  const revisit = await page.context().newPage();
  try {
    await revisit.setViewportSize({ width: 320, height: 740 });
    await revisit.goto(`${service.url}/scenarios`);
    await expect(revisit.getByRole("button", { name: /先确认假设，还是直接试做/ })).toHaveAttribute("aria-expanded", "true");
    await expect(revisit.getByRole("heading", { name: secondTitle, exact: true })).toBeVisible();
    await expect.poll(() => revisit.locator("#workspace").evaluate(pane => pane.scrollTop)).toBeCloseTo(narrowTop, 0);
  } finally {
    await revisit.close();
  }

  // Follow a classification from a card preview, then return to the exact
  // source card. The real link also opens the same stack in a new tab.
  await page.setViewportSize({ width: 840, height: 560 });
  const toDiscipline = scene.getByRole("list", { name: "所属学科" })
    .getByRole("link", { name: "图鉴项目管理", exact: true });
  await toDiscipline.scrollIntoViewIfNeeded();
  const beforeDiscipline = await workspace.evaluate(pane => pane.scrollTop);
  expect(beforeDiscipline).toBeGreaterThan(0);
  const disciplineHref = await toDiscipline.getAttribute("href");
  const disciplineURL = new URL(disciplineHref, service.url);
  expect(disciplineURL.searchParams.get("view")).toBe("discipline");
  expect(disciplineURL.searchParams.get("entry")).toBeTruthy();
  expect(disciplineURL.searchParams.get("card")).toBe(second.id);
  await toDiscipline.click();
  await expect(subjectsTab).toHaveAttribute("aria-selected", "true");
  const disciplineToggle = page.getByRole("button", { name: /图鉴项目管理/ });
  const discipline = page.locator(".atlas-entry").filter({ has: disciplineToggle });
  await expect(disciplineToggle).toHaveAttribute("aria-expanded", "true");
  const disciplineCard = discipline.getByRole("link", { name: secondTitle, exact: true });
  await expect(disciplineCard).toBeVisible();
  const previewScenes = discipline.getByRole("list", { name: "相关问题场景" });
  await expect(previewScenes.getByRole("link", { name: scenario, exact: true })).toBeVisible();
  await expect(previewScenes.getByRole("link", { name: "怎样复盘试验过程？", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "返回原处", exact: true }).click();
  await expect(scenesTab).toHaveAttribute("aria-selected", "true");
  await expect(secondCard).toBeVisible();
  await expect(toDiscipline).toBeFocused();
  await expect.poll(() => workspace.evaluate(pane => pane.scrollTop)).toBeCloseTo(beforeDiscipline, 0);

  // A full card reached from the discipline retains its reverse links and is
  // also a valid origin for a cross navigation.
  await toDiscipline.click();
  await disciplineCard.click();
  await expect(page.locator("#document-title")).toHaveText(secondTitle);
  const readerScene = page.locator("#reader").getByRole("list", { name: "相关问题场景" })
    .getByRole("link", { name: "怎样复盘试验过程？", exact: true });
  await page.setViewportSize({ width: 840, height: 310 });
  await readerScene.scrollIntoViewIfNeeded();
  await workspace.evaluate(pane => pane.scrollBy(0, 45));
  await readerScene.scrollIntoViewIfNeeded();
  const beforeReaderJump = await workspace.evaluate(pane => pane.scrollTop);
  expect(beforeReaderJump).toBeGreaterThan(0);
  await readerScene.click();
  await expect(scenesTab).toHaveAttribute("aria-selected", "true");
  const reviewToggle = page.getByRole("button", { name: /怎样复盘试验过程/ });
  const review = page.locator(".atlas-entry").filter({ has: reviewToggle });
  await expect(reviewToggle).toHaveAttribute("aria-expanded", "true");
  await expect(review.getByRole("heading", { name: secondTitle, exact: true })).toBeVisible();

  await page.goBack();
  await expect(page.locator("#document-title")).toHaveText(secondTitle);
  await expect(readerScene).toBeFocused();
  await expect.poll(() => workspace.evaluate(pane => pane.scrollTop)).toBeCloseTo(beforeReaderJump, 0);

  // Returning while the destination is still loading must not wait on a new
  // index before it restores the relation link in the original reader.
  const holdIndex = Promise.withResolvers();
  await page.route("**/api/scenarios", async route => {
    await holdIndex.promise;
    await route.continue().catch(() => {});
  }, { times: 1 });
  try {
    await readerScene.click();
    await page.getByRole("button", { name: "返回原处" }).click();
    await expect(page.locator("#document-title")).toHaveText(secondTitle);
    await expect(readerScene).toBeFocused();
    await expect.poll(() => workspace.evaluate(pane => pane.scrollTop)).toBeCloseTo(beforeReaderJump, 0);
  } finally { holdIndex.resolve(); }

  const direct = await page.context().newPage();
  try {
    await direct.setViewportSize({ width: 390, height: 520 });
    await direct.goto(disciplineURL.href);
    await expect(direct.getByRole("tab", { name: "按学科" })).toHaveAttribute("aria-selected", "true");
    await expect(direct.getByRole("button", { name: /图鉴项目管理/ })).toHaveAttribute("aria-expanded", "true");
    await expect(direct.getByRole("heading", { name: secondTitle, exact: true })).toBeInViewport();
    await expect(direct.locator(".atlas-cross-context")).toHaveText("图鉴项目管理");
    expect(new URL(direct.url()).searchParams.get("card")).toBe(second.id);
  } finally {
    await direct.close();
  }

  // Both directory views track the reading pane, including when a jump is
  // clamped near the end. Passive scroll must not rewrite the category URL.
  await page.getByRole("button", { name: "返回图鉴" }).click();
  await page.setViewportSize({ width: 390, height: 460 });
  for (const [tab, navigation] of [
    [scenesTab, "问题场景类目"],
    [subjectsTab, "学科类目"],
  ]) {
    await tab.click();
    const links = page.getByRole("navigation", { name: navigation }).getByRole("link");
    await links.last().click();
    await expect(links.last()).toHaveAttribute("aria-current", "location");
    await expect.poll(() => workspace.evaluate(pane => pane.scrollTop)).toBeGreaterThan(0);
    const url = page.url();
    await workspace.evaluate(pane => pane.scrollTo(0, 0));
    await expect(links.first()).toHaveAttribute("aria-current", "location");
    await workspace.evaluate(pane => pane.scrollTo(0, pane.scrollHeight));
    await expect(links.last()).toHaveAttribute("aria-current", "location");
    await expect(page).toHaveURL(url);
  }
});
