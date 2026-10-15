import { defaultConfig } from "../packages/shared/src/config/defaults";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { PNG } from "pngjs";

const COLOR_ID = 5;
const TOLERANCE = 8;
const VIEW = "/?x=100.5&y=100.5&z=24";

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The main game canvas (the minimap is a second canvas with role="img"). */
const canvasOf = (page: Page) => page.locator("canvas:not([role])");

/** The pixel at the centre of the canvas screenshot (device pixels, so HiDPI-safe). */
async function centerPixel(page: Page): Promise<[number, number, number]> {
  const png = PNG.sync.read(await canvasOf(page).screenshot());
  const at = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
  return [png.data[at] ?? -1, png.data[at + 1] ?? -1, png.data[at + 2] ?? -1];
}

function isClose(actual: number[], expected: number[]): boolean {
  return actual.every((c, i) => Math.abs(c - (expected[i] ?? 0)) <= TOLERANCE);
}

async function openAs(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/auth/dev?name=${name}`);
  await page.goto(VIEW);
  await expect(page.getByTestId("status")).toContainText("онлайн");
  return page;
}

test("a pixel placed by one player shows up for another in real time", async ({ browser }) => {
  const entry = defaultConfig.palette.find((e) => e.id === COLOR_ID);
  if (!entry) throw new Error(`no palette entry ${COLOR_ID}`);
  const placed = hexToRgb(entry.base);
  const background = hexToRgb(defaultConfig.palette[0]?.base ?? "#000000");

  const a = await openAs(browser, "e2e_a");
  const b = await openAs(browser, "e2e_b");
  await expect(canvasOf(a)).toBeVisible();
  await expect(canvasOf(b)).toBeVisible();

  // Before the click B sees the background in the centre.
  await expect.poll(() => centerPixel(b).then((p) => isClose(p, background))).toBe(true);

  await a
    .getByRole("radiogroup", { name: "Цвет" })
    .getByRole("radio", { name: `Цвет ${COLOR_ID}`, exact: true })
    .click();
  await canvasOf(a).click();

  await expect.poll(() => centerPixel(b).then((p) => isClose(p, placed)), { timeout: 5_000 }).toBe(true);
});
