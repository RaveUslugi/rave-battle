import { defineConfig, devices } from "@playwright/test";

/**
 * Screenshot tests of the interface, run by hand (`bun run e2e:visual`) against a local stack on a
 * fresh database with dev login: the server on :3000 and Vite on :5173. Not part of CI: baselines are
 * taken on the developer machine, and font rasterising differs between machines.
 * Update the baselines after an intended change with `bun run e2e:visual --update-snapshots`.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.visual.ts",
  outputDir: "test-results",
  snapshotPathTemplate: "{testDir}/visual/{arg}{ext}",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    locale: "ru-RU",
    reducedMotion: "reduce",
    // A preinstalled browser instead of Playwright's own download, when given.
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide" } },
  timeout: 30_000,
  workers: 1,
  reporter: "list",
});
