import { describe, expect, test } from "bun:test";
import { eventsOf, makeEngine, T0 } from "./test-utils";

const place = (x: number, y: number, withBomb = false) => ({ x, y, colorId: 3, withBomb });

function setup() {
  const ctx = makeEngine((cfg) => {
    cfg.bombs.maxActivePerPlayer = 1;
  });
  const admin = ctx.addPlayer(1);
  ctx.addPlayer(2);
  ctx.engine.grantUnlimited(1);
  return { ...ctx, admin };
}

describe("unlimited players", () => {
  test("isUnlimited reflects grants only", () => {
    const { engine } = setup();
    expect(engine.isUnlimited(1)).toBe(true);
    expect(engine.isUnlimited(2)).toBe(false);
  });

  test("place pixels and bombs without charges, inventory or the active limit", () => {
    const { engine, admin, bombs } = setup();
    admin.charges = 0;
    admin.chargesUpdatedAt = T0;
    admin.inventory.bomb = 0;
    expect(engine.placePixel(1, place(1, 1, true), T0)).toEqual({ ok: true, outcome: "placed" });
    expect(engine.placePixel(1, place(2, 2, true), T0)).toEqual({ ok: true, outcome: "placed" });
    expect(admin.charges).toBe(0);
    expect(admin.inventory.bomb).toBe(0);
    expect(bombs.activeCount(1)).toBe(2);
    const events = engine.drainEvents();
    expect(eventsOf(events, "bomb_added")).toHaveLength(2);
    expect(eventsOf(events, "ledger").filter((e) => e.item === "bomb")).toEqual([]);
    expect(eventsOf(events, "stat").filter((e) => e.stat === "pixels")).toHaveLength(2);
  });

  test("an explosion is not frozen and costs no coins, but the bomb owner is still paid", () => {
    const { engine, admin, players, bombs, cfg } = setup();
    bombs.add({ x: 5, y: 5, ownerId: 2, createdAt: T0 });
    const coins = admin.coins;
    const ownerCoins = players.get(2).coins;
    const result = engine.placePixel(1, place(5, 5), T0);
    expect(result).toMatchObject({ ok: true, outcome: "exploded", self: false, frozenUntil: 0, coinsLost: 0 });
    expect(admin.frozenUntil).toBe(0);
    expect(admin.coins).toBe(coins);
    expect(players.get(2).coins).toBe(ownerCoins + cfg.explosion.authorBonus);
    expect(bombs.get(5, 5)).toBeUndefined();
    expect(engine.placePixel(1, place(6, 6), T0)).toEqual({ ok: true, outcome: "placed" });
  });

  test("an existing freeze does not block actions", () => {
    const { engine, admin } = setup();
    admin.frozenUntil = T0 + 60_000;
    expect(engine.placePixel(1, place(1, 1), T0)).toEqual({ ok: true, outcome: "placed" });
    expect(engine.detect(1, { x: 1, y: 1 }, T0)).toEqual({ ok: true, count: 0 });
  });

  test("detector and defuser spend no uses", () => {
    const { engine, admin, bombs, cfg } = setup();
    admin.inventory.detector = 0;
    admin.inventory.defuser = 0;
    bombs.add({ x: 3, y: 3, ownerId: 2, createdAt: T0 });
    expect(engine.detect(1, { x: 3, y: 3 }, T0)).toEqual({ ok: true, count: 1 });
    expect(engine.defuse(1, { x: 3, y: 3 }, T0)).toEqual({ ok: true, found: true, reward: cfg.defuse.reward });
    expect(admin.inventory.detector).toBe(0);
    expect(admin.inventory.defuser).toBe(0);
    const ledger = eventsOf(engine.drainEvents(), "ledger");
    expect(ledger.filter((e) => e.item === "detector" || e.item === "defuser")).toEqual([]);
  });

  test("other players keep the normal rules", () => {
    const { engine, players } = setup();
    players.get(2).charges = 0;
    players.get(2).chargesUpdatedAt = T0;
    expect(engine.placePixel(2, place(1, 1), T0)).toEqual({ ok: false, code: "no_charges" });
  });
});
