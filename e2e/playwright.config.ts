import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.ts",
  outputDir: "test-results",
  // The interface follows the browser language for guests and dev accounts: the tests read Russian labels.
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080", locale: "ru-RU" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  timeout: 30_000,
  retries: 0,
  reporter: "list",
});
