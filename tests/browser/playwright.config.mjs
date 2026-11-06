import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
const localResults = fileURLToPath(new URL('../../.local/browser-results/', import.meta.url));

export default defineConfig({
  testDir: ".",
  testMatch: ["critical.spec.mjs"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  outputDir: localResults + "artifacts",
  reporter: [["line"], ["json", { outputFile: localResults + "report.json" }]],
  use: {
    browserName: "chromium",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    colorScheme: "dark",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
