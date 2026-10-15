import { expect, test } from "@playwright/test";
import { defaultConfig } from "../packages/shared/src/config/defaults";
import { COLOR_ID, canvasOf, closeAll, expectCenter, hexToRgb, openAs } from "./helpers";

test.afterEach(closeAll);

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
  await expectCenter(b, background);

  await a
    .getByRole("radiogroup", { name: "Цвет", exact: true })
    .getByRole("radio", { name: `Цвет ${COLOR_ID}`, exact: true })
    .click();
  await canvasOf(a).click();

  await expectCenter(b, placed);
});
