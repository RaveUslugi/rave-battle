import { type Browser, type BrowserContextOptions, expect, type Page } from "@playwright/test";
import { PNG } from "pngjs";

export const COLOR_ID = 5;
const TOLERANCE = 8;
export const VIEW = "/?x=100.5&y=100.5&z=24";

export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The main game canvas (the minimap is a second canvas with role="img"). */
export const canvasOf = (page: Page) => page.locator("canvas:not([role])");

/**
 * The pixel at the centre of the canvas. Only a 3×3 CSS-pixel clip is captured, without freezing
 * animations: a full-canvas screenshot is slow on software-rendered CI runners (the first one takes
 * 2–3 s), which left the 5 s polls one or two tries.
 */
export async function centerPixel(page: Page): Promise<[number, number, number]> {
  const box = await canvasOf(page).boundingBox();
  if (!box) return [-1, -1, -1];
  const clip = { x: Math.floor(box.x + box.width / 2) - 1, y: Math.floor(box.y + box.height / 2) - 1, width: 3, height: 3 };
  const png = PNG.sync.read(await page.screenshot({ clip, animations: "allow", caret: "initial" }));
  // The middle of the clip, in device pixels (HiDPI-safe).
  const at = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
  return [png.data[at] ?? -1, png.data[at + 1] ?? -1, png.data[at + 2] ?? -1];
}

export function isClose(actual: number[], expected: number[]): boolean {
  return actual.every((c, i) => Math.abs(c - (expected[i] ?? 0)) <= TOLERANCE);
}

/** Polls until the canvas centre has `expected`; on timeout the error says what was there instead. */
export async function expectCenter(page: Page, expected: number[], timeout = 20_000): Promise<void> {
  let last: number[] = [];
  try {
    await expect
      .poll(
        async () => {
          last = await centerPixel(page);
          return isClose(last, expected);
        },
        { timeout },
      )
      .toBe(true);
  } catch (error) {
    const box = await canvasOf(page).boundingBox();
    const onTop = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el ? `${el.tagName.toLowerCase()}.${String(el.className)} ${el.getAttribute("aria-label") ?? ""}`.trim() : "nothing";
      },
      { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 },
    );
    const status = await page.getByTestId("status").textContent();
    throw new Error(
      `centre is rgb(${last.join(",")}), expected rgb(${expected.join(",")}); on top: ${onTop}; status: ${status}; canvas: ${JSON.stringify(box)}`,
      {
        cause: error,
      },
    );
  }
}

export async function openAs(browser: Browser, name: string, options: BrowserContextOptions = {}, view = VIEW): Promise<Page> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.goto(`/auth/dev?name=${name}`);
  await page.goto(view);
  await expect(page.getByTestId("status")).toContainText("онлайн", { timeout: 15_000 });
  return page;
}
