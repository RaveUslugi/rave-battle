import { expect, type Locator, test } from "@playwright/test";
import { defaultConfig } from "../packages/shared/src/config/defaults";
import { canvasOf, centerPixel, expectCenter, hexToRgb, isClose, openAs } from "./helpers";

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`not visible: ${locator}`);
  return box;
}

function overlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function expectApart(parts: Record<string, Locator>): Promise<void> {
  const boxes = await Promise.all(Object.entries(parts).map(async ([name, l]) => [name, await boxOf(l)] as const));
  for (const [i, [a, boxA]] of boxes.entries()) {
    for (const [b, boxB] of boxes.slice(i + 1)) expect(overlap(boxA, boxB), `${a} overlaps ${b}`).toBe(false);
  }
}

test("desktop 1440×900: the top bar, the dock and the chat do not overlap; the palette shows every colour", async ({ browser }) => {
  const page = await openAs(browser, "e2e_desk");
  const palette = page.getByRole("radiogroup", { name: "Цвет", exact: true });
  await expect(palette).toBeVisible();
  await expectApart({
    "top bar": page.locator("header").first(),
    dock: palette.locator(".."),
    chat: page.getByRole("region", { name: "Чат и события" }),
    rail: page.getByRole("navigation", { name: "Разделы" }),
  });
  const radios = palette.getByRole("radio");
  await expect(radios).toHaveCount(defaultConfig.palette.length);
  const area = await boxOf(palette);
  for (const radio of await radios.all()) {
    const box = await boxOf(radio);
    expect(box.y >= area.y - 1 && box.y + box.height <= area.y + area.height + 1, "every swatch is in view without scrolling").toBe(true);
  }
});

test("desktop: a section opens next to the rail and Esc closes it", async ({ browser }) => {
  const page = await openAs(browser, "e2e_panel");
  await page.getByRole("button", { name: "Магазин", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Магазин" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Снаряжение")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("phone 390×844: tap, confirm, and the pixel shows up for another player", async ({ browser }) => {
  const view = "/?x=120.5&y=120.5&z=24";
  const phone = await openAs(browser, "e2e_phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, view);
  const watcher = await openAs(browser, "e2e_watch", {}, view);

  await expectApart({
    "top bar": phone.locator("header").first(),
    ticker: phone.getByRole("button", { name: /Открыть чат/ }),
    dock: phone.getByRole("radiogroup", { name: "Инструмент" }).locator("../.."),
  });

  // Paint the cell a colour it does not have yet, picked from the full palette.
  await expect(canvasOf(watcher)).toBeVisible();
  const before = await centerPixel(watcher);
  const color = defaultConfig.palette.find((e) => e.unlock === "default" && e.id !== 0 && !isClose(before, hexToRgb(e.base)))!;
  await phone.getByRole("button", { name: "Все" }).click();
  await phone
    .getByRole("radiogroup", { name: "Цвет", exact: true })
    .getByRole("radio", { name: `Цвет ${color.id}`, exact: true })
    .click();

  const box = await boxOf(canvasOf(phone));
  await phone.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  const confirm = phone.getByRole("group", { name: "Подтверждение клетки" });
  await expect(confirm).toContainText("Клетка 120, 120");
  await confirm.getByRole("button", { name: "Поставить" }).click();
  await expect(confirm).toBeHidden();
  await expectCenter(watcher, hexToRgb(color.base));
});
