import { defaultConfig, type PlayerView } from "@rave/shared";
import { describe, expect, test } from "bun:test";
import { CONFIRM_FROM, shopOffers } from "./shop";

// The view carries only the total cap; the bonus is `chargeCap - charges.max` (10 by default).
const player = (overrides: Partial<PlayerView> = {}) =>
  ({ coins: 260, chargeCap: 10, unlockedColors: [33], unlimited: false, ...overrides }) as PlayerView;

describe("shopOffers", () => {
  test("items, boost and colors with affordability and confirmation", () => {
    const offers = shopOffers(defaultConfig, player());
    const bomb = offers.find((o) => o.key === "item:bomb")!;
    expect(bomb).toMatchObject({ price: 30, affordable: true, confirm: false, owned: false });
    const defuser = offers.find((o) => o.key === "item:defuser")!;
    expect(defuser).toMatchObject({ price: 150, affordable: true, confirm: true });
    const boost = offers.find((o) => o.key === "boost")!;
    expect(boost).toMatchObject({ price: 500, affordable: false, maxed: false, title: "⚡ Ёмкость зарядов +5 (0/10)" });
    expect(offers.filter((o) => o.kind === "color").map((o) => o.key)).toEqual([32, 33, 34, 35, 36, 37, 38, 39].map((id) => `color:${id}`));
    expect(offers.find((o) => o.key === "color:33")).toMatchObject({ owned: true });
    expect(CONFIRM_FROM).toBe(100);
  });

  test("the boost is maxed at maxTotal", () => {
    const boost = shopOffers(defaultConfig, player({ coins: 9999, chargeCap: 20 })).find((o) => o.key === "boost")!;
    expect(boost).toMatchObject({ maxed: true, title: "⚡ Ёмкость зарядов +5 (10/10)" });
  });
});
