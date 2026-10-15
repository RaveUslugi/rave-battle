import { expect, type Page, test } from "@playwright/test";

// Canvases (the board, the minimap, previews) show live data and sit under the interface: hidden, not masked.
const hideCanvases = (page: Page) => page.addStyleTag({ content: "canvas { visibility: hidden !important; }" });

/** Live parts that differ from run to run: online counts, timers. */
const live = (page: Page) => [page.getByTestId("status"), page.locator("time")];

test("game, guest, desktop", async ({ page }) => {
  await page.goto("/?x=64&y=64&z=4");
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await hideCanvases(page);
  await expect(page).toHaveScreenshot("game-desktop.png", { mask: live(page) });
});

test("game, guest, phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?x=64&y=64&z=4");
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await hideCanvases(page);
  await expect(page).toHaveScreenshot("game-phone.png", { mask: live(page) });
});

test("admin config", async ({ page }) => {
  await page.goto("/auth/dev?name=admin");
  await page.goto("/admin?tab=config&section=explosion");
  await expect(page.getByRole("heading", { name: "История версий" })).toBeVisible();
  await hideCanvases(page);
  await expect(page).toHaveScreenshot("admin-config.png", { mask: [page.getByRole("list").last(), ...live(page)] });
});

test("admin palette", async ({ page }) => {
  await page.goto("/auth/dev?name=admin");
  await page.goto("/admin?tab=config&section=palette");
  await expect(page.getByRole("heading", { name: "История версий" })).toBeVisible();
  await hideCanvases(page);
  await expect(page).toHaveScreenshot("admin-palette.png", { mask: [page.getByRole("list").last(), ...live(page)] });
});
