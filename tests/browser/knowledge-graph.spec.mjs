import { test as base, expect, gate, opId, settled } from "./fixtures.mjs";

const firstQuote = "只记下支持原判断的样本时，应检查是否存在选择偏差。";
const secondQuote = "比较两次调查前，还要核对选择偏差如何改变了样本构成。";
const subjects = new Map([
  ["心理学", ["确认偏误", "推论阶梯", "锚定效应", "损失厌恶"]],
  ["统计学", ["选择偏差", "抽样误差", "幸存者偏差", "先验概率", "基准率"]],
  ["研究方法", ["反例", "可证伪性", "循证实践", "对照试验"]],
]);
function classified(title, markdown) {
  const subject = [...subjects].find(([, titles]) => titles.includes(title))?.[0];
  return subject ? markdown + `\n\n## 标签\n\n- 学科：${subject}` : markdown;
}
const create = (service, title, markdown) => service.createDocument({title, markdown:classified(title, markdown)});

const test = base.extend({
  // A separate worker fixture keeps the diagram independent of cards from other suites.
  graphCards: [async ({ service }, use) => {
    const cards = new Map();
    const add = async (title, markdown = "这张卡记录了一个独立的观察。") => {
      cards.set(title, (await create(service, title, markdown)).id);
    };
    const link = (title) => {
      const id = cards.get(title);
      if (!id) throw new Error(`Missing graph fixture: ${title}`);
      return `[${title}](/cards/${id})`;
    };
    await add("确认偏误");
    await add("选择偏差", `解读抽样结论时，也要警惕${link("确认偏误")}。`);
    await add("反例");
    await add("可证伪性", `把能推翻判断的${link("反例")}写下来。`);
    await add("循证实践");
    await add("推论阶梯", `检查推理过程，留意${link("确认偏误")}。\n\n在${link("循证实践")}中重新检验结论。`);
    await add("抽样误差");
    await add("对照试验", `说明命题的${link("可证伪性")}。\n\n分别评估各组的${link("抽样误差")}。`);
    await add("幸存者偏差", `比较失访样本以识别${link("选择偏差")}。\n\n检查${link("抽样误差")}是否足以解释结果。`);
    await add("先验概率");
    await add("基准率", `估计事件的${link("先验概率")}时使用历史频率。`);
    await add("锚定效应", `用真实${link("基准率")}校准最初的判断。`);
    await add("损失厌恶");
    await add("观察记录");

    const source = await service.call("get-document", { id: cards.get("确认偏误") });
    const markdown = [
      "## 理解",
      firstQuote.replace("选择偏差", link("选择偏差")),
      `用${link("反例")}检验最初的判断。`,
      ...Array.from({ length: 18 }, (_, i) => `第 ${i + 1} 次观察的记录保留了原始判断。`),
      secondQuote.replace("选择偏差", link("选择偏差")),
    ].join("\n\n");
    await service.admin("save-document", {
      op_id: opId("browser-graph-source"), id: source.id, title: source.title,
      expected_revision: source.revision, markdown: classified(source.title, markdown),
    });
    expect((await service.call("get-document", { id: source.id })).markdown).toContain(link("选择偏差"));
    await use(cards);
  }, { scope: "worker", timeout: 180_000 }],
});

const node = (page, id) => page.locator(`.graph-node[data-node-id="${id}"]`);
const edge = (page, from, to) => page.locator(`.graph-edge[data-source="${from}"][data-target="${to}"]`);
async function camera(page) {
  // Returning from the reader may round-trip a coordinate through D3's inverse transform.
  return page.locator(".graph-world").evaluate(g => {
    const { a, e, f } = g.getCTM();
    return [a, e, f].map(value => value.toFixed(3)).join(",");
  });
}
const screenshot = async (page, testInfo, name) => {
  await page.mouse.move(0, 0);
  await testInfo.attach(name, { body: await page.screenshot(), contentType: "image/png" });
};

async function search(page, title) {
  const input = page.getByRole("combobox", { name: "搜索卡片" });
  await input.fill(title);
  await expect(page.getByRole("option").filter({ hasText: title })).toBeVisible();
  await input.press("Enter");
}

async function clickDrawnLine(page, selection) {
  const point = await selection.locator(".graph-edge-hit").evaluate(path => {
    for (const fraction of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const point = path.getPointAtLength(path.getTotalLength() * fraction).matrixTransform(path.getScreenCTM());
      if (path.parentNode.contains(document.elementFromPoint(point.x, point.y))) return { x: point.x, y: point.y };
    }
    return null;
  });
  expect(point, "A visible section of the selected line can receive a pointer click").toBeTruthy();
  await page.mouse.click(point.x, point.y);
}

async function index(page, service) {
  const response = await page.request.get(`${service.url}/api/graph`);
  expect(response.ok()).toBe(true);
  const { data } = await response.json();
  expect(data.complete).toBe(true);
  return data;
}

for (const width of [1440, 1280, 390]) {
  test(`follow two citations to their exact source and restore the graph at ${width}px`, async ({ service, ui, graphCards }, testInfo) => {
    const { page } = ui;
    const source = graphCards.get("确认偏误");
    const target = graphCards.get("选择偏差");
    const isolated = graphCards.get("观察记录");
    const selected = edge(page, source, target);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const data = await index(page, service);
    const list = await service.call("list", {});
    expect(data.nodes.map(card => card.id).sort()).toEqual(list.items.map(card => card.id).sort());
    expect(data.nodes).toHaveLength(14);
    expect(data.edges).toHaveLength(12);
    const occurrences = data.edges.find(e => e.source === source && e.target === target).occurrences;
    expect(occurrences).toHaveLength(2);
    expect(new Set(occurrences.map(item => item.anchor)).size).toBe(2);
    expect(data.edges.some(e => e.target === source && e.source === target)).toBe(true);
    expect(data.edges.some(e => e.source === isolated || e.target === isolated)).toBe(false);

    await page.goto(service.url + "/cards");
    await page.getByRole("link", { name: "图谱", exact: true }).click();
    await expect(page).toHaveURL(/\/graph(?:[?#]|$)/);
    await expect(node(page, source)).toBeVisible();
    await expect(page.locator(".graph-node")).toHaveCount(14);
    if (width === 1440) {
      await testInfo.attach("synthetic-graph", { body: JSON.stringify(data), contentType: "application/json" });
    }
    const sidebarBox = await page.locator(".graph-sidebar").boundingBox();
    const stageBox = await page.locator(".graph-canvas").boundingBox();
    expect(sidebarBox.width).toBe(264);
    expect(stageBox.x).toBe(sidebarBox.x + sidebarBox.width);
    expect(stageBox.width).toBe(width - 264);
    const overview = await camera(page);
    await screenshot(page, testInfo, `overview-${width}`);

    await search(page, "确认偏误");
    await expect(node(page, source)).toHaveAttribute("data-emphasis", "current");
    await expect(node(page, target)).toHaveAttribute("data-emphasis", "neighbor");
    await expect(node(page, isolated)).toHaveAttribute("data-emphasis", "muted");
    await expect.poll(() => camera(page)).not.toBe(overview);
    const frame = await page.locator(".graph-canvas").boundingBox();
    await expect.poll(async () => {
      const point = await node(page, source).boundingBox();
      return Math.hypot(point.x + point.width / 2 - frame.x - frame.width / 2,
        point.y + point.height / 2 - frame.y - frame.height / 2);
    }).toBeLessThan(3);
    await screenshot(page, testInfo, `search-${width}`);
    if (width === 390) {
      const relations = page.locator(".graph-side-relations");
      await expect(relations.getByRole("button", { name: /← 引用.*选择偏差/ })).toBeVisible();
      const outgoing = relations.getByRole("button", { name: /引用 →.*选择偏差/ });
      await outgoing.focus();
      await outgoing.press("Enter");
    } else {
      await clickDrawnLine(page, selected);
    }
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".graph-evidence blockquote")).toHaveText(firstQuote);
    const endpoints = page.locator(".graph-evidence .graph-endpoints");
    await expect(endpoints.getByRole("button")).toHaveText(["确认偏误", "选择偏差"]);
    await expect(endpoints).toContainText("引用 →");
    const next = page.getByRole("button", { name: "下一处引用" });
    const openSource = page.locator("#graph-open-source");
    await screenshot(page, testInfo, `citation-${width}`);
    expect(await page.locator("#workspace").evaluate(pane => pane.scrollWidth)).toBeLessThanOrEqual(width);
    const readerAnchor = async (occurrence, quote) => {
      await openSource.click();
      await expect(page.locator("#document-title")).toHaveText("确认偏误");
      await expect.poll(() => decodeURIComponent(new URL(page.url()).hash.slice(1))).toBe(occurrence.anchor);
      const reference = page.locator("#reader").locator(`a[id="${occurrence.anchor}"]`);
      await expect(reference).toHaveText("选择偏差");
      await expect(reference.locator("xpath=ancestor::p[1]")).toContainText(quote);
      await expect(reference).toBeInViewport();
      await expect(reference).toBeFocused();
    };
    const checkReturn = async (quote, view) => {
      await expect(selected).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".graph-evidence blockquote")).toHaveText(quote);
      await expect.poll(() => camera(page)).toBe(view);
    };
    const canvas = page.locator(".graph-canvas");
    const beforePan = await camera(page);
    await canvas.focus();
    await canvas.press("ArrowRight");
    await expect.poll(() => camera(page)).not.toBe(beforePan);
    const beforeRead = await camera(page);
    await readerAnchor(occurrences[0], firstQuote);
    await page.getByRole("button", { name: "返回图谱" }).click();
    await checkReturn(firstQuote, beforeRead);
    await expect(openSource).toBeFocused();
    await next.click();
    await expect(page.locator(".graph-evidence blockquote")).toHaveText(secondQuote);
    await readerAnchor(occurrences[1], secondQuote);
    await page.goBack();
    await checkReturn(secondQuote, beforeRead);
    await expect(openSource).toBeFocused();
    await page.goForward();
    await expect(page.locator(`#reader a[id="${occurrences[1].anchor}"]`)).toBeInViewport();
    await page.goBack();
    const neighbour = page.locator(".graph-evidence").getByRole("button", { name: "选择偏差", exact: true });
    await neighbour.focus();
    await neighbour.press("Enter");
    await expect(page.getByRole("dialog").getByRole("heading", { name: "选择偏差", exact: true })).toBeFocused();
    await expect(node(page, target)).toHaveAttribute("data-emphasis", "current");
    await page.getByRole("button", { name: "上一步", exact: true }).last().click();
    await checkReturn(secondQuote, beforeRead);

    await search(page, "观察记录");
    await expect(node(page, isolated)).toHaveAttribute("data-emphasis", "current");
    await page.getByRole("button", { name: "上一步", exact: true }).last().click();
    await checkReturn(secondQuote, beforeRead);
    await page.goForward();
    await expect(node(page, isolated)).toHaveAttribute("data-emphasis", "current");
    const beforeMiss = await camera(page);
    const searchBox = page.getByRole("combobox", { name: "搜索卡片" });
    await searchBox.fill("图中没有这张卡");
    await expect(page.getByText(/没有匹配|未找到|无匹配/)).toBeVisible();
    expect(await camera(page)).toBe(beforeMiss);
    await searchBox.press("Escape");

    await page.getByRole("button", { name: "重置视图" }).click();
    await expect.poll(() => camera(page)).toBe(overview);
  });
}

test("graph data can precede its module, and a partial refresh preserves the latest selection", async ({ service, ui, graphCards }) => {
  const { page } = ui;
  const source = graphCards.get("确认偏误");
  const next = graphCards.get("观察记录");
  const chunk = gate(), refresh = gate(), refreshing = gate();
  const scripts = [];
  page.on("request", request => { if (request.resourceType() === "script") scripts.push(request.url()); });
  await page.route("**/ui/chunks/knowledge-graph-*.js", async route => { await chunk.promise; await route.continue(); });
  await page.emulateMedia({ reducedMotion: "reduce" });
  try {
    const initial = page.waitForResponse("**/api/graph");
    await page.goto(service.url + "/graph", { waitUntil: "domcontentloaded" });
    const full = (await (await initial).json()).data;
    await settled(page);
    await expect(page.locator("#graph-heading")).toHaveCount(0);
    chunk.release();
    await expect(page.locator("#graph-heading")).toBeFocused();
    expect(scripts.some(url => url.includes("/card-list-"))).toBe(false);
    await node(page, source).click();
    await page.locator("#graph-open-card").click();
    await expect(page.locator("#reader")).toBeVisible();

    await page.route("**/api/graph", async route => {
      refreshing.release();
      await refresh.promise;
      await route.fulfill({ json: { ok: true, data: {
        nodes: [], edges: [], scanned: 0, total: full.nodes.length, complete: false,
      } } });
    }, { times: 1 });
    await page.goBack();
    await refreshing.promise;
    await expect(page.locator("#graph-open-card")).toBeFocused();
    await search(page, "观察记录");
    await expect(node(page, next)).toHaveAttribute("aria-pressed", "true");
    refresh.release();
    await expect(page.locator(".graph-notice")).toContainText("仍显示上次完整图谱");
    await expect(node(page, next)).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect(page.locator(".graph-notice")).toHaveCount(0);
    await expect(node(page, next)).toHaveAttribute("aria-pressed", "true");
  } finally { chunk.release(); refresh.release(); }
});

test("removing the cached citation on refresh preserves typing in graph search", async ({ service, ui, graphCards }) => {
  const { page } = ui;
  const source = graphCards.get("确认偏误"), target = graphCards.get("选择偏差");
  const refresh = gate(), requested = gate();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(service.url + "/graph");
  await edge(page, source, target).press("Enter");
  const openSource = page.locator("#graph-open-source");
  await openSource.click();
  await expect(page.locator("#document-title")).toHaveText("确认偏误");

  await page.route("**/api/graph", async route => {
    const response = await route.fetch();
    const { data } = await response.json();
    const edges = data.edges.filter(edge => edge.source !== source || edge.target !== target);
    requested.release();
    await refresh.promise;
    await route.fulfill({ json: { ok: true, data: { ...data, edges } } });
  }, { times: 1 });
  try {
    await page.goBack();
    await requested.promise;
    await expect(openSource).toBeFocused();
    const input = page.getByRole("combobox", { name: "搜索卡片" });
    await input.fill("观察");
    await expect(input).toBeFocused();
    refresh.release();
    await expect(page.getByRole("dialog")).toHaveAccessibleName("确认偏误");
    await expect(openSource).toHaveCount(0);
    await expect(input).toBeFocused();
    await page.keyboard.type("123");
    await expect(input).toHaveValue("观察123");
  } finally { refresh.release(); }
});

test("filter categories, inspect and drag a card, follow a neighbour and open the reader in a new tab", async ({ service, ui, graphCards }, testInfo) => {
  const { page } = ui;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(service.url + "/graph");
  const card = node(page, graphCards.get("确认偏误"));
  const isolated = node(page, graphCards.get("观察记录"));
  const neighbor = node(page, graphCards.get("选择偏差"));
  const linked = edge(page, graphCards.get("确认偏误"), graphCards.get("选择偏差"));
  const cross = edge(page, graphCards.get("基准率"), graphCards.get("先验概率"));
  const category = page.getByRole("button", { name: "心理学", exact: true });
  const labels = page.getByRole("button", { name: "关系标签" });
  const core = page.getByRole("button", { name: "只看核心" });
  const reset = page.getByRole("button", { name: "重置视图" });
  const sidebar = page.locator(".graph-sidebar");
  const dialog = page.getByRole("dialog");
  await expect(card).toBeVisible();
  await expect(page.locator(".graph-region:visible")).toHaveCount(4);
  const home = await camera(page);
  const filters = page.getByRole("group", { name: "分类筛选" });
  for (const chip of await filters.getByRole("button").all()) await chip.click();
  await expect(page.locator(".graph-node:visible")).toHaveCount(0);
  await expect(page.locator(".graph-edge:visible")).toHaveCount(0);
  await page.getByRole("button", { name: "显示全部卡片" }).click();
  await expect(page.locator(".graph-node:visible")).toHaveCount(14);
  await category.click();
  await expect(category).toHaveAttribute("aria-pressed", "false");
  await expect(card).toBeHidden();
  await expect(linked).toBeHidden();
  await expect(neighbor).toBeVisible();
  await expect(page.locator(".graph-region:visible")).toHaveCount(3);
  await search(page, "确认偏误");
  await expect(category).toHaveAttribute("aria-pressed", "true");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-emphasis", "current");
  await reset.click();
  await expect.poll(() => camera(page)).toBe(home);
  await expect(card).toHaveAttribute("aria-pressed", "true");
  const beforeFilter = await neighbor.getAttribute("transform");
  await core.click();
  await expect(core).toHaveAttribute("aria-pressed", "true");
  await expect(neighbor).toHaveAttribute("transform", beforeFilter);
  await expect(isolated).toBeHidden();
  await expect(neighbor).toBeVisible();
  await reset.click();
  await expect(core).toHaveAttribute("aria-pressed", "true");
  await expect(isolated).toBeHidden();
  await core.click();
  await expect(isolated).toBeVisible();

  await card.hover();
  await expect(page.getByRole("tooltip")).toContainText("确认偏误");
  await expect(sidebar.getByRole("heading", { name: "确认偏误" })).toBeVisible();
  await expect(card).toHaveAttribute("data-emphasis", "current");
  await expect(neighbor).toHaveAttribute("data-emphasis", "neighbor");
  await expect(isolated).toHaveAttribute("data-emphasis", "muted");
  await expect(linked).toHaveClass(/\bhot\b/);
  await expect(cross).toHaveClass(/\bdim\b/);
  await expect(page.locator(".graph-link-label.show").first()).toHaveText("引用");
  await testInfo.attach("hover-1440", { body: await page.screenshot(), contentType: "image/png" });
  const beforeSelection = await neighbor.getAttribute("transform");
  await card.click();
  await expect(dialog).toHaveAccessibleName("确认偏误");
  await settled(page);
  await expect(neighbor).toHaveAttribute("transform", beforeSelection);
  await expect(dialog.getByRole("button", { name: "查看 2 处引用" })).toBeVisible();
  await expect(dialog).toContainText(firstQuote);
  await screenshot(page, testInfo, "card-1440");
  await labels.click();
  await expect(labels).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".graph-link-label.show")).toHaveCount(0);
  await labels.click();
  await expect(page.locator(".graph-link-label.show").first()).toBeVisible();
  await dialog.getByRole("button", { name: "反例", exact: true }).click();
  await expect(dialog).toHaveAccessibleName("反例");
  await dialog.getByRole("button", { name: "上一步" }).click();
  await expect(dialog).toHaveAccessibleName("确认偏误");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(card).toBeFocused();
  await expect(page.locator(".graph-edge.hot, .graph-node.dim")).toHaveCount(0);

  await reset.click();
  await expect.poll(() => camera(page)).toBe(home);
  const dot = card.locator(".graph-node-disc");
  const position = await dot.boundingBox();
  const x = position.x + position.width / 2, y = position.y + position.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  try {
    await page.mouse.move(x + 55, y + 35, { steps: 6 });
    await expect.poll(async () => {
      const moved = await dot.boundingBox();
      return Math.abs(moved.x - position.x - 55) < 4 && Math.abs(moved.y - position.y - 35) < 4;
    }).toBe(true);
  } finally { await page.mouse.up(); }
  await expect(dialog).toBeHidden();
  expect(await camera(page)).toBe(home);

  const box = await page.locator(".graph-canvas").boundingBox();
  await page.mouse.move(box.x + 35, box.y + 35);
  await page.mouse.wheel(0, -160);
  await expect.poll(() => camera(page)).not.toBe(home);
  const zoomed = await camera(page);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 60, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => camera(page)).not.toBe(zoomed);
  await reset.click();
  await expect.poll(() => camera(page)).toBe(home);
  const opened = page.waitForEvent("popup");
  await card.dblclick();
  const reader = await opened;
  try {
    await expect(reader.locator("#document-title")).toHaveText("确认偏误");
    await expect(reader.locator("#reader")).toContainText(firstQuote);
    await expect(page).toHaveURL(/\/graph(?:[?#]|$)/);
  } finally { await reader.close(); }
});

test("restore a search interrupted by browser history while its camera is moving", async ({ service, ui, graphCards }) => {
  const { page } = ui;
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(service.url + "/graph");
  const card = node(page, graphCards.get("确认偏误"));
  const core = page.getByRole("button", { name: "只看核心" });
  const isolated = node(page, graphCards.get("观察记录"));
  await expect(card).toBeVisible();
  await core.click();
  await expect(isolated).toBeHidden();
  const home = await camera(page);
  const world = page.locator(".graph-world");
  const zoom = () => world.evaluate(g => g.getCTM().a);
  await search(page, "观察记录");
  await expect(isolated).toHaveAttribute("data-emphasis", "current");
  await expect(core).toHaveAttribute("aria-pressed", "false");
  await expect.poll(zoom).toBeGreaterThan(1);
  expect(await zoom()).toBeLessThan(1.5);
  await page.goBack();
  await expect(isolated).toBeHidden();
  await expect.poll(() => camera(page)).toBe(home);
  await page.goForward();
  await expect(isolated).toHaveAttribute("data-emphasis", "current");
  await expect.poll(zoom).toBe(1.5);
  // Sample through the remaining force ticks, including the last stable frames.
  const deviation = await isolated.evaluate(async element => {
    const svg = element.ownerSVGElement;
    const frame = svg.getBoundingClientRect();
    let stableFrames = 0, previous = "", maxError = 0, peak;
    const deadline = performance.now() + 8000;
    while (stableFrames < 5 && performance.now() < deadline) {
      await new Promise(requestAnimationFrame);
      const at = element.getBoundingClientRect();
      const position = at.x + "," + at.y + "," + element.getAttribute("transform");
      stableFrames = position === previous ? stableFrames + 1 : 0;
      previous = position;
      const distance = Math.hypot(at.x + at.width / 2 - frame.x - frame.width / 2,
        at.y + at.height / 2 - frame.y - frame.height / 2);
      if (distance > maxError) {
        maxError = distance;
        peak = { camera: history.state.cd_graph_view?.camera, node: element.getAttribute("transform"),
          world: svg.querySelector(".graph-world").getAttribute("transform"), frame: frame.toJSON() };
      }
    }
    return { maxError, stableFrames, peak };
  });
  expect(deviation.stableFrames).toBe(5);
  expect(deviation.maxError, JSON.stringify(deviation.peak)).toBeLessThan(3);
  const canvas = page.locator(".graph-canvas");
  const centered = await camera(page);
  await canvas.focus();
  await canvas.press("ArrowRight");
  await expect.poll(() => camera(page)).not.toBe(centered);
  const panned = await camera(page);
  await page.goBack();
  await expect(isolated).toBeHidden();
  await page.goForward();
  await expect(isolated).toHaveAttribute("data-emphasis", "current");
  await expect.poll(() => camera(page)).toBe(panned);
});

test("search all pages, distinguish repeated titles and report a source edited since selection", async ({ service, ui, graphCards }) => {
  const { page } = ui;
  const duplicate = "独立观测";
  const first = await create(service, duplicate, "第一本田野记录。");
  const second = await create(service, duplicate, "第二本田野记录。");
  const longTitle = "如何定量区分实验中的观察误差与可重复的样本偏差";
  const oldest = graphCards.get("确认偏误");
  const link = `[确认偏误](/cards/${oldest})`;
  const notes = `回看最早的${link}笔记。\n\n为检验另一次观察，再读${link}。`;
  for (const title of ["对照组", "频率估计", "研究提纲", "样本量"]) await create(service, title, "独立研究记录。");
  const inventory = await service.call("list", {});
  const otherLinks = inventory.items.filter(card => card.id !== oldest).map(card => `- [${card.title}](/cards/${card.id})`);
  const latest = await create(service, longTitle, [notes, otherLinks.join("\n")].join("\n\n"));

  const pages = await Promise.all([0, 20].map(offset => service.call("list", { limit: 20, offset })));
  expect(pages[0].items).toHaveLength(20);
  expect(pages[1].items).toHaveLength(1);
  const graph = await index(page, service);
  expect(graph.nodes.map(card => card.id).sort()).toEqual(pages.flatMap(part => part.items).map(card => card.id).sort());
  const outgoing = graph.edges.filter(edge => edge.source === latest.id);
  expect(outgoing).toHaveLength(20);
  const firstPage = new Set(pages[0].items.map(card => card.id));
  expect(outgoing.some(line => firstPage.has(line.source) !== firstPage.has(line.target))).toBe(true);
  expect(outgoing).toContainEqual(expect.objectContaining({ target: oldest }));
  await page.goto(service.url + "/graph");
  const input = page.getByRole("combobox", { name: "搜索卡片" });
  await input.fill(duplicate);
  const options = page.getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.filter({ hasText: first.id })).toBeVisible();
  await options.filter({ hasText: second.id }).click();
  await expect(node(page, second.id)).toHaveAttribute("data-emphasis", "current");
  await expect(node(page, first.id)).toHaveAttribute("data-emphasis", "muted");
  await search(page, longTitle);
  await expect(node(page, latest.id)).toHaveAttribute("data-emphasis", "current");
  await expect(node(page, oldest)).toHaveAttribute("data-emphasis", "neighbor");

  const line = edge(page, latest.id, oldest);
  await line.focus();
  await line.press("Enter");
  const openSource = page.locator("#graph-open-source");
  await page.getByRole("button", { name: "下一处引用" }).click();
  const excerpt = "为检验另一次观察，再读确认偏误。";
  await expect(page.locator(".graph-evidence blockquote")).toHaveText(excerpt);
  await openSource.click();
  await expect(page.locator("#document-title")).toHaveText(longTitle);
  const beforeInsert = await service.call("get-document", { id: latest.id });
  await service.admin("save-document", { id: latest.id, title: longTitle,
    op_id: opId("browser-graph-insert"), expected_revision: beforeInsert.revision,
    markdown: `访谈前也要复习${link}。\n\n${notes}` });
  await page.goBack();
  await expect(page.locator(".graph-citations")).toContainText("3 / 3");
  await expect(page.locator(".graph-evidence blockquote")).toHaveText(excerpt);
  const document = await service.call("get-document", { id: latest.id });
  const replacement = "田野记录已整理，本次修订移除了原引用。";
  await service.admin("save-document", { id: latest.id, title: longTitle,
    op_id: opId("browser-graph-edit"), expected_revision: document.revision, markdown: replacement });
  expect((await service.call("get-document", { id: latest.id })).markdown).toContain(replacement);
  await page.locator("#graph-open-source").click();
  await expect(page.locator("#document-title")).toHaveText(longTitle);
  await expect(page.locator("#reader")).toContainText(replacement);
  await expect(page.getByText(/原来的引用位置已变化/)).toBeVisible();
});

test("distinguish an empty library, a failed request and partial graph coverage", async ({ service, ui }) => {
  const { page } = ui;
  let reply = null;
  await page.route("**/api/graph", route => route.fulfill({
    status: reply ? 200 : 503, json: reply ? { ok: true, data: reply } : { ok: false, error: { message: "读取暂时中断" } },
  }));
  await page.goto(service.url + "/graph");
  await expect(page.getByRole("heading", { name: "图谱读取失败" })).toBeVisible();
  reply = { nodes: [], edges: [], scanned: 0, total: 0, complete: true };
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByRole("heading", { name: "还没有知识卡" })).toBeVisible();
  await page.getByRole("button", { name: "查看知识卡" }).click();
  await expect(page).toHaveURL(/\/cards(?:[?#]|$)/);
  reply = null;
  await page.locator("#graph-nav").click();
  await expect(page.locator(".graph-notice")).toContainText("仍显示上次完整图谱");
  await expect(page.getByRole("heading", { name: "还没有知识卡" })).toBeVisible();
  reply = { nodes: [{ id: "20261122000000-aaaaaaa", title: "单独记录" },
    { id: "20261122000000-bbbbbbb", title: "尚待核对" }], edges: [], scanned: 1, total: 2, complete: false };
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByText(/部分知识卡未能读取|部分.*未能读取/)).toBeVisible();
  await expect(page.getByText(/已读取正文\s*1\s*\/\s*2\s*张/)).toBeVisible();
  reply = { ...reply, scanned: 2, complete: true };
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.locator(".graph-stats")).toContainText("0引用");
  await expect(page.locator(".graph-edge")).toHaveCount(0);
  await search(page, "单独记录");
  await expect(node(page, reply.nodes[0].id)).toHaveAttribute("data-emphasis", "current");
});
