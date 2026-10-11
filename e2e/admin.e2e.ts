import { expect, test } from "@playwright/test";

test("admin page is served by the SPA fallback and its assets load", async ({ page }) => {
  const assets: string[] = [];
  const bad: string[] = [];
  page.on("response", (res) => {
    if (!new URL(res.url()).pathname.startsWith("/assets/")) return;
    assets.push(res.url());
    if (res.status() !== 200) bad.push(`${res.status()} ${res.url()}`);
  });

  await page.goto("/auth/dev?name=admin");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Rave Battle · админка" })).toBeVisible();

  await page.goto("/admin?tab=config");
  await expect(page.getByText("Версия").first()).toBeVisible();

  expect(assets.length).toBeGreaterThan(0);
  expect(bad).toEqual([]);
});

test("anonymous visitors get no access", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Нет доступа" })).toBeVisible();
});
