import { randomUUID } from "node:crypto";
import { test as base, expect } from "@playwright/test";
import { runtime } from "../service/runtime.mjs";

export const opId = (prefix) => `${prefix}-${randomUUID()}`;
export const test = base.extend({
  service: [async ({}, use) => {
    const service = await runtime("browser-critical");
    service.failedTests = [];
    try { await use(service); }
    finally { await service.finish(service.failedTests.length === 0); }
  }, { scope: "worker", timeout: 300_000 }],
  ui: async ({ context, service }, use, testInfo) => {
    const diagnostics = { pageErrors: [], csp: [], externalAssets: [] };
    let page;
    let fixtureError;
    try {
      await context.exposeBinding("__captureCSPViolation", (_, event) => diagnostics.csp.push(event));
      await context.addInitScript(() => {
        window.addEventListener("securitypolicyviolation", (event) => window.__captureCSPViolation({ directive: event.effectiveDirective, blockedURI: event.blockedURI }));
      });
      page = await context.newPage();
      page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (["http:", "https:"].includes(url.protocol) && url.origin !== service.url && ["script", "stylesheet", "font"].includes(request.resourceType())) {
          diagnostics.externalAssets.push({ url: request.url(), type: request.resourceType() });
        }
      });
      await use({ page, context });
      if (testInfo.status === testInfo.expectedStatus) {
        expect(diagnostics.pageErrors).toEqual([]);
        expect(diagnostics.csp).toEqual([]);
        expect(diagnostics.externalAssets).toEqual([]);
      }
    } catch (error) {
      fixtureError = error;
      service.failedTests.push(testInfo.title);
      throw error;
    } finally {
      const failed = fixtureError || testInfo.status !== testInfo.expectedStatus;
      try {
        if (failed && page && !page.isClosed()) {
          const screenshot = testInfo.outputPath("failure.png");
          await page.screenshot({ path: screenshot, fullPage: true });
          await testInfo.attach("failure", { path: screenshot, contentType: "image/png" });
        }
      } finally {
        service.record("browser-case", { title: testInfo.title, status: failed ? "failed" : testInfo.status, expectedStatus: testInfo.expectedStatus, diagnostics });
      }
      // The runner owns this context and its trace, including setup failures.
    }
  },
});

test.afterEach(async ({ service }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) service.failedTests.push(testInfo.title);
});

export { expect };

export async function openApp(page, service, id) {
  await page.goto(service.url + (id ? `/?id=${encodeURIComponent(id)}` : "/"));
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator("#login-screen, #access-code, #login-button, #logout-button")).toHaveCount(0);
  if (id) await expect(page.locator("#reader")).toBeVisible();
  else await expect(page.getByRole("heading", { name: "知识卡", exact: true })).toBeVisible();
}

export function gate() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

export async function settled(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
