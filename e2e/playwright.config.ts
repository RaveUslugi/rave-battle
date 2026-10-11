import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.ts",
  outputDir: "test-results",
  use: { baseURL: "http://localhost:8080" },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  timeout: 30_000,
  retries: 0,
  reporter: "list",
});
