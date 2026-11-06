import { readFileSync } from "node:fs";
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
        window.__previewExecuted = false;
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
      const manifest = JSON.parse(readFileSync(new URL("../../web/generated/manifest.json", import.meta.url)));
      if (typeof manifest.lazyEditor !== "string") throw new Error("Build manifest must identify its lazy editor module");
      const editorURL = "/ui/" + manifest.lazyEditor;
      await use({ page, context, editorURL });
      if (testInfo.status === testInfo.expectedStatus) {
        expect(diagnostics.pageErrors).toEqual([]);
        expect(diagnostics.csp).toEqual([]);
        expect(diagnostics.externalAssets).toEqual([]);
        expect(await page.evaluate(() => window.__previewExecuted)).toBe(false);
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

export async function login(page, service, id) {
  await page.goto(service.url + (id ? `/?id=${encodeURIComponent(id)}` : "/"));
  await page.locator("#access-code").fill(service.accessCode);
  await page.locator("#login-button").click();
  await expect(page.locator("#app")).toBeVisible();
  if (id) await expect(page.locator("#reader")).toBeVisible();
  else await expect(page.locator("#new-card")).toBeVisible();
}

export async function chooseEditorMode(page, name) {
  await page.locator(".editor-mode-actions").getByText(name, { exact: true }).click();
  await expect(page.getByRole("radio", { name, exact: true })).toBeChecked();
}

export async function ensureSource(page) {
  const source = page.getByRole('radio', { name: '源码', exact: true });
  await source.waitFor({ state: 'attached' });
  if (!await source.isChecked()) await chooseEditorMode(page, '源码');
  await page.getByRole('textbox', { name: 'Markdown 源码' }).waitFor({ state: 'visible' });
}
export async function markdownValue(page,editorURL){
  await page.locator('#knowledge-markdown').waitFor({state:'visible'});
  return page.evaluate(async moduleURL=>{const m=await import(moduleURL);const host=document.getElementById('knowledge-markdown');return m.getMarkdownValue?m.getMarkdownValue(host):m.EditorView.findFromDOM(host.querySelector('.cm-editor')).state.doc.toString();},editorURL);
}

export async function setMarkdown(page, editorURL, value) {
  await ensureSource(page);
  const content = page.getByRole('textbox', { name: 'Markdown 源码' });
  await content.waitFor({ state: 'visible' });
  await content.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await expect.poll(() => markdownValue(page, editorURL)).toBe('');
  await page.keyboard.insertText(value);
  await expect.poll(() => markdownValue(page, editorURL)).toBe(value);
}

export function gate() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

export async function settled(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
