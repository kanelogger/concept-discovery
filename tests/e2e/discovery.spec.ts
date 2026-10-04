import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const query = "大家都很忙但越来越慢";

const recommendation = {
  locale: "cn",
  diagnosis: ["可能需要区分系统约束与排队等待。"],
  recommendations: [{
    id: "theory-of-constraints",
    concept_version: 1,
    name: "约束理论",
    reason: "这条情境与样本触发场景相符。",
    confidence: 0.81,
    card: { description: "围绕限制系统整体产出的约束安排改进，并使其他环节配合它。", tags: ["流程改进"], cover_image: "", interaction_type: "lens", epistemic_type: "theory" },
  }],
};

async function expectNoSeriousAccessibilityIssues(page: import("@playwright/test").Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""))).toEqual([]);
}

async function createDraftThroughEditor(page: import("@playwright/test").Page, id: string, name: string) {
  await page.getByRole("button", { name: "知识库", exact: true }).click();
  await page.getByRole("heading", { name: "Concept 知识库" }).waitFor();
  await page.getByRole("button", { name: "新建 Concept" }).click();
  await page.getByRole("textbox", { name: "ID · 固定标识" }).fill(id);
  await page.getByRole("textbox", { name: "名称", exact: true }).fill(name);
  await page.getByRole("textbox", { name: "一句话解释（用于卡片与搜索）" }).fill(`${name} 的测试说明。`);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("opens on discovery and shows keyword and AI results together", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "给眼前的问题，找到已有的名字。" })).toBeVisible();
  await page.route("**/api/discover", (route) => route.fulfill({ json: recommendation }));

  await page.getByRole("textbox", { name: "描述当前情境" }).fill(query);
  await page.getByRole("button", { name: "寻找可能的概念" }).click();

  await expect(page).toHaveURL(/section=discover.*q=/);
  await expect(page.getByRole("heading", { name: "约束理论" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "约束理论" })).toHaveCount(1);
  await expect(page.getByText("关键词结果", { exact: true })).toBeVisible();
  await expect(page.getByText("AI 推荐", { exact: true })).toBeVisible();
  await expect(page.getByText("未明确系统目标和边界时", { exact: false })).toBeVisible();
  await expect(page.getByText("TOC Institute", { exact: false })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("AI 建议已并入对应概念条目");
  const mergedConcept = page.locator("article").filter({ has: page.getByRole("heading", { name: "约束理论" }) });
  await expect(mergedConcept).toContainText("这条情境与样本触发场景相符。");
  await mergedConcept.getByRole("button", { name: "阅读详情" }).click();
  await expect(page).toHaveURL(/section=discover.*concept=theory-of-constraints/);
  await expect(page.getByRole("heading", { name: "约束理论" })).toBeVisible();
  await page.getByRole("button", { name: "返回发现" }).click();
  await expect(page).toHaveURL(/section=discover.*q=/);
});

test("a restored query does not contact the model until the user requests recommendations", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/discover", (route) => {
    calls += 1;
    return route.fulfill({ json: recommendation });
  });
  await page.goto(`/?locale=cn&section=discover&q=${encodeURIComponent(query)}`);

  await expect(page.getByRole("heading", { name: "约束理论" }).first()).toBeVisible();
  expect(calls).toBe(0);
  await page.getByRole("button", { name: "请求 AI 推荐" }).click();
  await expect(page.getByText("这条情境与样本触发场景相符。", { exact: true })).toBeVisible();
  expect(calls).toBe(1);
});

test("model failure leaves keyword results available and offers retry", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/discover", (route) => {
    calls += 1;
    return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "model_failed", message: "The model request failed" }) });
  });
  await page.getByRole("textbox", { name: "描述当前情境" }).fill(query);
  await page.getByRole("button", { name: "寻找可能的概念" }).click();

  await expect(page.getByRole("heading", { name: "约束理论" }).first()).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("关键词结果仍可使用");
  await expect(page.getByRole("button", { name: "重试 AI 推荐" })).toBeVisible();
  await page.getByRole("button", { name: "重试 AI 推荐" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(calls).toBe(2);
});

test("a newer query replaces an in-flight model response", async ({ page }) => {
  const newerQuery = "平均产能似乎够，等待却越来越长";
  await page.route("**/api/discover", async (route) => {
    const task = route.request().postDataJSON().task as string;
    if (task === query) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      try { await route.fulfill({ json: { ...recommendation, diagnosis: ["过期的旧查询结果"] } }); } catch { /* The browser may have aborted this request. */ }
      return;
    }
    await route.fulfill({ json: { ...recommendation, diagnosis: ["来自最新查询的分析"] } });
  });
  const input = page.getByRole("textbox", { name: "描述当前情境" });
  await input.fill(query);
  await page.getByRole("button", { name: "寻找可能的概念" }).click();
  await expect(page.getByRole("status").filter({ hasText: "正在寻找相关概念" })).toBeVisible();
  await input.fill(newerQuery);
  await page.getByRole("button", { name: "寻找可能的概念" }).click();

  await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(newerQuery)}`));
  await expect(page.getByText("来自最新查询的分析", { exact: true })).toBeVisible();
  await page.waitForTimeout(1300);
  await expect(page.getByText("过期的旧查询结果", { exact: true })).toHaveCount(0);
});

test("an unavailable model points to settings without hiding keyword results", async ({ page }) => {
  await page.route("**/api/discover", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "model_unavailable", message: "Configure a model before requesting recommendations" }) }));
  await page.route("**/api/model-settings", (route) => route.fulfill({ json: { providers: [{ id: "deepseek", label: "DeepSeek", authType: "api_key", connected: false, credentialType: null, models: [] }], active: null } }));
  await page.getByRole("textbox", { name: "描述当前情境" }).fill(query);
  await page.getByRole("button", { name: "寻找可能的概念" }).click();
  await expect(page.getByRole("heading", { name: "排队论" }).first()).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("没有已连接并选定的模型");
  await page.getByRole("button", { name: "前往模型设置" }).click();
  await expect(page).toHaveURL(/section=settings/);
  await expect(page.getByRole("heading", { name: "模型设置" })).toBeVisible();
});

test("discovery keeps keyword results and model output in the selected language", async ({ page }) => {
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Find a name for what you are seeing." })).toBeVisible();
  await page.route("**/api/discover", (route) => route.fulfill({ json: {
    locale: "en",
    diagnosis: ["Check the system constraint and the queueing delay separately."],
    recommendations: [{
      id: "queueing-theory", concept_version: 1, name: "Queueing Theory", reason: "This context mentions adequate capacity and increasing waits.", confidence: 0.79,
      card: { description: "Studies how arrivals, service capacity and variability affect waiting times and queue lengths.", tags: ["flow improvement"], cover_image: "", interaction_type: "lens", epistemic_type: "theory" },
    }],
  } }));
  await page.getByRole("textbox", { name: "Describe the situation" }).fill("Everyone is busy but delivery is getting slower");
  await page.getByRole("button", { name: "Find possible Concepts" }).click();
  await expect(page.getByRole("heading", { name: "Queueing Theory" }).first()).toBeVisible();
  await expect(page.getByText("This context mentions adequate capacity", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "排队论" })).toHaveCount(0);
});

test("discovery submits from the keyboard and respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/discover", (route) => route.fulfill({ json: recommendation }));
  const input = page.getByRole("textbox", { name: "描述当前情境" });
  await input.focus();
  await input.fill(query);
  await input.press("Enter");

  await expect(page).toHaveURL(/section=discover.*q=/);
  await expect(page.getByRole("heading", { name: "约束理论" }).first()).toBeVisible();
  const motion = await page.evaluate(() => ({
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    transitionDuration: getComputedStyle(document.querySelector("button[type=submit]") as HTMLElement).transitionDuration,
  }));
  expect(motion.reduced).toBe(true);
  expect(motion.scrollBehavior).toBe("auto");
  expect(Number.parseFloat(motion.transitionDuration)).toBeLessThanOrEqual(0.001);
});

test("discovery landing page has no serious automated accessibility violations", async ({ page }) => {
  const landing = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(landing.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""))).toEqual([]);

  await page.route("**/api/discover", (route) => route.fulfill({ json: recommendation }));
  await page.getByRole("textbox", { name: "描述当前情境" }).fill(query);
  await page.getByRole("button", { name: "寻找可能的概念" }).click();
  await expect(page.getByRole("heading", { name: "约束理论" }).first()).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""))).toEqual([]);
});

test("editing sections keep the current locale draft when the user changes sections", async ({ page }) => {
  await page.getByRole("button", { name: "知识库", exact: true }).click();
  await page.getByRole("heading", { name: "Concept 知识库" }).waitFor();
  await page.getByRole("button").filter({ hasText: "批量大小" }).first().click();
  await page.getByRole("button", { name: "编辑", exact: true }).last().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: /情境与边界/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "什么时候想到它" })).toBeVisible();
  await page.getByRole("button", { name: "核心定义" }).click();
  await page.getByLabel("名称", { exact: true }).fill("批量大小草稿");
  await page.getByRole("button", { name: "证据与出处" }).click();
  await page.getByRole("button", { name: "核心定义" }).click();
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue("批量大小草稿");
});

test("create and edit saves persist through the browser and reload", async ({ page }) => {
  const id = `e2e-${randomUUID()}`;
  await createDraftThroughEditor(page, id, "编辑保存验证");
  await page.getByRole("button", { name: "编辑", exact: true }).last().click();
  await page.getByRole("textbox", { name: "名称", exact: true }).fill("编辑保存已完成");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("heading", { name: "编辑保存已完成" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`concept=${id}`));
  await page.reload();
  await expect(page.getByRole("heading", { name: "编辑保存已完成" })).toBeVisible();
});

test("version conflict keeps the edited draft until the user chooses to reload", async ({ page }) => {
  const id = `e2e-conflict-${randomUUID()}`;
  await createDraftThroughEditor(page, id, "冲突原始条目");
  await page.getByRole("button", { name: "编辑", exact: true }).last().click();
  await page.getByRole("textbox", { name: "名称", exact: true }).fill("冲突时保留此草稿");
  await page.route(`**/api/concepts/${id}`, async (route) => {
    if (route.request().method() === "PATCH") return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "version_conflict", message: "Concept changed" }) });
    return route.continue();
  });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("此 Concept 已更新");
  await expect(page.getByRole("textbox", { name: "名称", exact: true })).toHaveValue("冲突时保留此草稿");
  await page.getByRole("button", { name: /重新载入最新版本/ }).click();
  await expect(page.getByRole("textbox", { name: "名称", exact: true })).toHaveValue("冲突原始条目");
});

test("discard edits uses an accessible confirmation and keeps the draft on cancel", async ({ page }) => {
  await page.getByRole("button", { name: "知识库", exact: true }).click();
  await page.getByRole("heading", { name: "Concept 知识库" }).waitFor();
  await page.getByRole("button").filter({ hasText: "批量大小" }).first().click();
  await page.getByRole("button", { name: "编辑", exact: true }).last().click();
  await page.getByLabel("名称", { exact: true }).fill("批量大小未保存草稿");
  await page.getByRole("button", { name: "取消", exact: true }).last().click();

  const confirmation = page.getByRole("dialog", { name: "放弃未保存的修改？" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "继续编辑" }).click();
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue("批量大小未保存草稿");
  await page.getByRole("button", { name: "取消", exact: true }).last().click();
  await page.getByRole("dialog", { name: "放弃未保存的修改？" }).getByRole("button", { name: "放弃修改" }).click();
  await expect(page.getByRole("dialog", { name: /编辑/ })).toHaveCount(0);
});

test("readiness downgrade requires an accessible explicit save choice", async ({ page }) => {
  await page.getByRole("button", { name: "知识库", exact: true }).click();
  await page.getByRole("heading", { name: "Concept 知识库" }).waitFor();
  await page.getByRole("button").filter({ hasText: "批量大小" }).first().click();
  await page.getByRole("button", { name: "编辑", exact: true }).last().click();
  await page.getByRole("button", { name: "证据与出处" }).click();
  await page.getByRole("textbox", { name: "出处文本", exact: true }).fill("");
  await page.getByRole("button", { name: "保存", exact: true }).click();

  const confirmation = page.getByRole("dialog", { name: "保存会改变语言资格" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByText(/不再出现在浏览与关键词结果中/)).toBeVisible();
  await confirmation.getByRole("button", { name: "返回编辑" }).click();
  await expect(page.getByRole("textbox", { name: "出处文本", exact: true })).toHaveValue("");
});

test("legacy library and detail URLs retain their knowledge management behavior", async ({ page }) => {
  await page.goto("/?locale=cn&section=manage&view=cards&status=browsable");
  await expect(page.getByRole("button", { name: "知识库", exact: true })).toHaveAttribute("aria-current", "page");
  await page.goto("/?locale=cn&q=TOC");
  await expect(page.getByRole("button", { name: "知识库", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Concept 知识库" })).toBeVisible();
  await page.goto("/?locale=cn&concept=batch-size");
  await expect(page.getByRole("heading", { name: "批量大小" })).toBeVisible();
  await expect(page.getByRole("button", { name: "返回知识库" })).toBeVisible();
  await expect(page.getByRole("button", { name: "编辑", exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "移除", exact: true }).first().click();
  const relationDialog = page.getByRole("dialog", { name: "移除 Concept 关系" });
  await expect(relationDialog).toBeVisible();
  await relationDialog.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("button", { name: "移除", exact: true }).first()).toBeVisible();
});

test("disconnecting a model provider uses an accessible confirmation", async ({ page }) => {
  await page.route("**/api/model-settings", (route) => route.fulfill({ json: { providers: [{
    id: "openai", label: "OpenAI / ChatGPT", authType: "oauth", connected: true, credentialType: "oauth", models: [{ id: "model-id", name: "Model", reasoning: false, contextWindow: 1000 }],
  }], active: { provider: "openai", model: "model-id" } } }));
  await page.getByRole("button", { name: "模型设置", exact: true }).click();
  await page.getByRole("heading", { name: "模型设置" }).waitFor();
  await page.getByRole("button", { name: "断开连接" }).click();
  const dialog = page.getByRole("dialog", { name: "断开连接" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("不会删除知识库内容")).toBeVisible();
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("button", { name: "断开连接" })).toBeVisible();
});

test("archive consequences are explained before the lifecycle action", async ({ page }) => {
  await page.getByRole("button", { name: "知识库", exact: true }).click();
  await page.getByRole("heading", { name: "Concept 知识库" }).waitFor();
  await page.getByRole("button", { name: "删除", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "归档 Concept" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("不再出现在正常浏览和搜索中", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("dialog", { name: "归档 Concept" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "删除", exact: true }).first()).toBeVisible();
});

test("discovery fits 320, 390, 768 and 1440px widths and keeps primary controls touch-sized", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    input: document.querySelector<HTMLInputElement>("#discovery-query")?.getBoundingClientRect().height ?? 0,
    button: [...document.querySelectorAll("button")].find((element) => element.textContent?.includes("寻找可能的概念"))?.getBoundingClientRect().height ?? 0,
  }));
  expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
  expect(metrics.input).toBeGreaterThanOrEqual(44);
  expect(metrics.button).toBeGreaterThanOrEqual(44);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "给眼前的问题，找到已有的名字。" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }
});

test("discovery pagination updates the URL and shows the next result page", async ({ page }) => {
  await page.route("**/api/concepts?*", async (route) => {
    const response = await route.fetch({ url: "http://127.0.0.1:4188/api/concepts?locale=cn&view=browse&status=browsable" });
    const data = await response.json() as { concepts: import("../../src/product/model").Concept[] };
    const base = data.concepts[0];
    const concepts = Array.from({ length: 25 }, (_, index) => ({
      ...structuredClone(base),
      id: `sample-${index + 1}`,
      locales: { ...structuredClone(base.locales), cn: { ...base.locales.cn, name: `Sample Concept ${index + 1}` } },
      relation_preview: [],
    }));
    return route.fulfill({ json: { count: concepts.length, concepts } });
  });
  await page.goto("/?locale=cn&section=discover&q=sample");
  await expect(page.getByRole("heading", { name: "Sample Concept 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole("heading", { name: "Sample Concept 21", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sample Concept 1", exact: true })).toHaveCount(0);
});

test("the discovery entry meets the agreed lab LCP and CLS budgets", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const vitals = { lcp: 0, cls: 0 };
    Object.defineProperty(window, "__conceptDiscoveryVitals", { value: vitals });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) vitals.lcp = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEntryList & { value?: number; hadRecentInput?: boolean }[]) {
        if (!entry.hadRecentInput) vitals.cls += entry.value ?? 0;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "给眼前的问题，找到已有的名字。" })).toBeVisible();
  await page.waitForFunction(() => (window as Window & { __conceptDiscoveryVitals?: { lcp: number } }).__conceptDiscoveryVitals?.lcp); 
  await page.waitForTimeout(500);
  const vitals = await page.evaluate(() => (window as Window & { __conceptDiscoveryVitals: { lcp: number; cls: number } }).__conceptDiscoveryVitals);
  console.log(`Discovery 390px lab metrics: LCP=${Math.round(vitals.lcp)}ms, CLS=${vitals.cls.toFixed(3)}`);
  expect(vitals.lcp).toBeLessThanOrEqual(2500);
  expect(vitals.cls).toBeLessThanOrEqual(0.1);
});

test("library, detail, editor, workspace and settings fit mobile and pass automated accessibility checks", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const expectMobileFit = async () => {
    const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
    expect(width.document).toBeLessThanOrEqual(width.viewport);
  };

  await page.goto("/?locale=cn&section=manage");
  await expect(page.getByRole("heading", { name: "Concept 知识库" })).toBeVisible();
  await expectMobileFit();
  await expectNoSeriousAccessibilityIssues(page);

  await page.getByRole("heading", { name: "批量大小" }).click();
  await expect(page.getByRole("heading", { name: "批量大小" })).toBeVisible();
  await expectMobileFit();
  await expectNoSeriousAccessibilityIssues(page);

  await page.getByRole("button", { name: "编辑", exact: true }).last().click();
  await expect(page.getByRole("button", { name: "核心定义" })).toBeVisible();
  await expectMobileFit();
  await expectNoSeriousAccessibilityIssues(page);
  await page.getByRole("button", { name: "取消", exact: true }).last().click();

  await page.getByRole("button", { name: "工作台", exact: true }).click();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await expectMobileFit();
  await expectNoSeriousAccessibilityIssues(page);

  await page.route("**/api/model-settings", (route) => route.fulfill({ json: { providers: [{ id: "deepseek", label: "DeepSeek", authType: "api_key", connected: false, credentialType: null, models: [] }], active: null } }));
  await page.getByRole("button", { name: "模型设置", exact: true }).click();
  await expect(page.getByRole("heading", { name: "模型设置" })).toBeVisible();
  await expectMobileFit();
  await expectNoSeriousAccessibilityIssues(page);
});

test("the English maintenance workflow fits a 320px viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const assertNoOverflow = async () => {
    const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
    expect(width.document).toBeLessThanOrEqual(width.viewport);
  };
  await page.goto("/?locale=en&section=manage");
  await expect(page.getByRole("heading", { name: "Concept Library" })).toBeVisible();
  await assertNoOverflow();
  await page.getByRole("heading", { name: "Batch Size" }).click();
  await expect(page.getByRole("heading", { name: "Batch Size" })).toBeVisible();
  await assertNoOverflow();
  await page.getByRole("button", { name: "Edit", exact: true }).last().click();
  await expect(page.getByRole("button", { name: /Situations & boundaries/ })).toBeVisible();
  await assertNoOverflow();
  await page.getByRole("button", { name: "Cancel", exact: true }).last().click();
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Workspace" })).toBeVisible();
  await assertNoOverflow();
  await page.route("**/api/model-settings", (route) => route.fulfill({ json: { providers: [{ id: "deepseek", label: "DeepSeek", authType: "api_key", connected: false, credentialType: null, models: [] }], active: null } }));
  await page.getByRole("button", { name: "Models", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Model settings" })).toBeVisible();
  await assertNoOverflow();
});
