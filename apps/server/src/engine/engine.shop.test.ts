import { describe, expect, test } from "bun:test";
import { chargeCap } from "./charges";
import { eventsOf, makeEngine, T0 } from "./test-utils";

describe("buyItem", () => {
  test("buys a bomb", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    expect(engine.buyItem(1, "bomb", T0)).toEqual({ ok: true });
    expect(a.coins).toBe(70);
    expect(a.inventory.bomb).toBe(4);
    expect(eventsOf(engine.drainEvents(), "ledger").map((e) => [e.item, e.delta, e.balanceAfter, e.reason])).toEqual([
      ["coins", -30, 70, "shop"],
      ["bomb", 1, 4, "shop"],
    ]);
  });

  test("a detector purchase grants its configured number of uses", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    engine.buyItem(1, "detector", T0);
    expect(a.inventory.detector).toBe(10);
  });

  test("rejects when coins are short and when banned; frozen players may buy", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    a.coins = 29;
    expect(engine.buyItem(1, "bomb", T0)).toEqual({ ok: false, code: "insufficient_coins" });
    a.coins = 100;
    a.bannedUntil = Number.POSITIVE_INFINITY;
    expect(engine.buyItem(1, "bomb", T0)).toEqual({ ok: false, code: "banned" });
    a.bannedUntil = null;
    a.frozenUntil = T0 + 1;
    expect(engine.buyItem(1, "bomb", T0)).toEqual({ ok: true });
  });
});

describe("buyChargeBoost", () => {
  test("raises the charge cap up to the configured total", () => {
    const { engine, cfg, addPlayer } = makeEngine();
    const a = addPlayer(1);
    a.coins = 1500;
    expect(engine.buyChargeBoost(1, T0)).toEqual({ ok: true });
    expect(chargeCap(a, cfg)).toBe(15);
    expect(engine.buyChargeBoost(1, T0)).toEqual({ ok: true });
    expect(engine.buyChargeBoost(1, T0)).toEqual({ ok: false, code: "boost_limit" });
    expect(a.coins).toBe(500);
  });
});

describe("buyColor", () => {
  const withShopColor = () =>
    makeEngine((cfg) => {
      cfg.palette.push({ id: 40, type: "animated", base: "#FF00FF", params: {}, unlock: "shop", price: 200 });
      cfg.palette.push({ id: 41, type: "solid", base: "#00FFFF", params: {}, unlock: "daily" });
    });

  test("unlocks a shop color", () => {
    const { engine, addPlayer } = withShopColor();
    const a = addPlayer(1);
    a.coins = 300;
    expect(engine.buyColor(1, 40, T0)).toEqual({ ok: true });
    expect(a.coins).toBe(100);
    expect(a.unlockedColors.has(40)).toBe(true);
    expect(eventsOf(engine.drainEvents(), "color_unlocked")).toEqual([{ type: "color_unlocked", userId: 1, colorId: 40, source: "shop", at: T0 }]);
    expect(engine.buyColor(1, 40, T0)).toEqual({ ok: false, code: "already_unlocked" });
  });

  test("rejects colors that are not sold or do not exist", () => {
    const { engine, addPlayer } = withShopColor();
    addPlayer(1);
    expect(engine.buyColor(1, 5, T0)).toEqual({ ok: false, code: "not_for_sale" });
    expect(engine.buyColor(1, 41, T0)).toEqual({ ok: false, code: "not_for_sale" });
    expect(engine.buyColor(1, 99, T0)).toEqual({ ok: false, code: "invalid_color" });
  });

  test("rejects when coins are short", () => {
    const { engine, addPlayer } = withShopColor();
    addPlayer(1);
    expect(engine.buyColor(1, 40, T0)).toEqual({ ok: false, code: "insufficient_coins" });
  });
});
