import { describe, expect, test } from "bun:test";
import { DAY_MS, eventsOf, makeEngine, T0 } from "./test-utils";

const place = (x: number, y: number, colorId = 3, withBomb = false) => ({ x, y, colorId, withBomb });

describe("placePixel: plain pixels", () => {
  test("paints the cell, spends a charge and pays a coin", () => {
    const { engine, canvas, addPlayer } = makeEngine();
    const a = addPlayer(1);
    expect(engine.placePixel(1, place(10, 20), T0)).toEqual({ ok: true, outcome: "placed" });
    expect(canvas.get(10, 20)).toEqual({ colorId: 3, ownerId: 1 });
    expect(a.charges).toBe(9);
    expect(a.coins).toBe(101);

    const events = engine.drainEvents();
    expect(eventsOf(events, "pixel")).toEqual([
      { type: "pixel", x: 10, y: 20, userId: 1, colorId: 3, prevColorId: 0, prevUserId: 0, at: T0 },
    ]);
    expect(eventsOf(events, "stat").map((e) => [e.stat, e.delta, e.day])).toEqual([
      ["pixels", 1, "2026-10-07"],
      ["coinsFromPixels", 1, "2026-10-07"],
    ]);
    expect(eventsOf(events, "player")).toEqual([{ type: "player", userId: 1 }]);
    expect(engine.drainEvents()).toEqual([]);
  });

  test("rejects out-of-bounds and unknown colors", () => {
    const { engine, addPlayer } = makeEngine();
    addPlayer(1);
    expect(engine.placePixel(1, place(512, 0), T0)).toEqual({ ok: false, code: "out_of_bounds" });
    expect(engine.placePixel(1, place(0, 0, 200), T0)).toEqual({ ok: false, code: "invalid_color" });
  });

  test("rejects locked colors until unlocked", () => {
    const { engine, addPlayer } = makeEngine((cfg) => {
      cfg.palette.push({ id: 32, type: "animated", base: "#FF00FF", params: {}, unlock: "shop", price: 200 });
    });
    const a = addPlayer(1);
    expect(engine.placePixel(1, place(0, 0, 32), T0)).toEqual({ ok: false, code: "color_locked" });
    a.unlockedColors.add(32);
    expect(engine.placePixel(1, place(0, 0, 32), T0)).toEqual({ ok: true, outcome: "placed" });
  });

  test("rejects when out of charges and accepts again after regen", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    a.charges = 0;
    a.chargesUpdatedAt = T0;
    expect(engine.placePixel(1, place(0, 0), T0 + 29_000)).toEqual({ ok: false, code: "no_charges" });
    expect(engine.placePixel(1, place(0, 0), T0 + 30_000)).toEqual({ ok: true, outcome: "placed" });
  });

  test("rejects banned, too-new, non-member and frozen players", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    a.bannedUntil = T0 + 1;
    expect(engine.placePixel(1, place(0, 0), T0)).toEqual({ ok: false, code: "banned" });
    a.bannedUntil = null;
    a.guildMember = false;
    expect(engine.placePixel(1, place(0, 0), T0)).toEqual({ ok: false, code: "not_guild_member" });
    a.guildMember = true;
    a.accountCreatedAt = T0 - 29 * DAY_MS;
    expect(engine.placePixel(1, place(0, 0), T0)).toEqual({ ok: false, code: "account_too_new" });
    a.accountCreatedAt = T0 - 30 * DAY_MS;
    a.frozenUntil = T0 + 1;
    expect(engine.placePixel(1, place(0, 0), T0)).toEqual({ ok: false, code: "frozen" });
  });

  test("a rejected command emits no events and changes nothing", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    engine.placePixel(1, place(-1, 0), T0);
    expect(engine.drainEvents()).toEqual([]);
    expect(a.charges).toBe(10);
  });
});

describe("placePixel: bombs", () => {
  test("placing with a bomb spends a bomb and arms the cell", () => {
    const { engine, bombs, addPlayer } = makeEngine();
    const a = addPlayer(1);
    expect(engine.placePixel(1, place(5, 5, 3, true), T0)).toEqual({ ok: true, outcome: "placed" });
    expect(a.inventory.bomb).toBe(2);
    expect(bombs.get(5, 5)?.ownerId).toBe(1);
    const events = engine.drainEvents();
    expect(eventsOf(events, "bomb_added")).toEqual([{ type: "bomb_added", x: 5, y: 5, ownerId: 1, at: T0 }]);
    expect(eventsOf(events, "ledger")).toEqual([
      { type: "ledger", userId: 1, item: "bomb", delta: -1, balanceAfter: 2, reason: "use", ref: {}, at: T0 },
    ]);
  });

  test("rejects when the player has no bombs or hit the active-bomb limit", () => {
    const { engine, addPlayer } = makeEngine((cfg) => {
      cfg.bombs.maxActivePerPlayer = 1;
    });
    const a = addPlayer(1);
    engine.placePixel(1, place(1, 1, 3, true), T0);
    expect(engine.placePixel(1, place(2, 2, 3, true), T0)).toEqual({ ok: false, code: "bomb_limit" });
    a.inventory.bomb = 0;
    expect(engine.placePixel(1, place(2, 2, 3, true), T0)).toEqual({ ok: false, code: "no_bombs" });
  });

  test("stepping on someone else's bomb: pixel not placed, victim frozen and fined, author paid", () => {
    const { engine, canvas, bombs, addPlayer } = makeEngine();
    const a = addPlayer(1);
    const b = addPlayer(2);
    engine.placePixel(1, place(5, 5, 3, true), T0);
    engine.drainEvents();

    const result = engine.placePixel(2, place(5, 5, 9), T0 + 1000);
    expect(result).toEqual({ ok: true, outcome: "exploded", self: false, frozenUntil: T0 + 61_000, coinsLost: 10, bombOwnerId: 1 });
    expect(canvas.get(5, 5)).toEqual({ colorId: 3, ownerId: 1 });
    expect(bombs.get(5, 5)).toBeUndefined();
    expect(b.charges).toBe(9);
    expect(b.coins).toBe(90);
    expect(b.frozenUntil).toBe(T0 + 61_000);
    expect(a.coins).toBe(101 + 15);

    const events = engine.drainEvents();
    expect(eventsOf(events, "pixel")).toEqual([]);
    expect(eventsOf(events, "bomb_removed")).toEqual([
      { type: "bomb_removed", x: 5, y: 5, ownerId: 1, reason: "exploded", removedBy: 2, at: T0 + 1000 },
    ]);
    expect(eventsOf(events, "stat").map((e) => [e.userId, e.stat])).toEqual([
      [2, "explosionsSuffered"],
      [1, "bombsTriggered"],
    ]);
    expect(eventsOf(events, "ledger").map((e) => [e.userId, e.delta, e.reason])).toEqual([
      [2, -10, "explosion"],
      [1, 15, "bomb_bonus"],
    ]);
  });

  test("a victim placing with a bomb keeps their bomb", () => {
    const { engine, addPlayer } = makeEngine();
    addPlayer(1);
    const b = addPlayer(2);
    engine.placePixel(1, place(5, 5, 3, true), T0);
    engine.placePixel(2, place(5, 5, 9, true), T0);
    expect(b.inventory.bomb).toBe(3);
  });

  test("stepping on your own bomb: double penalty, no bonus, not rated", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    engine.placePixel(1, place(5, 5, 3, true), T0);
    engine.drainEvents();

    const result = engine.placePixel(1, place(5, 5, 4), T0);
    expect(result).toEqual({ ok: true, outcome: "exploded", self: true, frozenUntil: T0 + 120_000, coinsLost: 20, bombOwnerId: 1 });
    expect(a.coins).toBe(101 - 20);
    const events = engine.drainEvents();
    expect(eventsOf(events, "stat").map((e) => e.stat)).toEqual(["selfExplosions"]);
    expect(eventsOf(events, "ledger").map((e) => e.reason)).toEqual(["explosion"]);
  });

  test("frozen victim keeps charges and can play after the freeze", () => {
    const { engine, addPlayer } = makeEngine();
    addPlayer(1);
    const b = addPlayer(2);
    engine.placePixel(1, place(5, 5, 3, true), T0);
    engine.placePixel(2, place(5, 5, 9), T0);
    expect(engine.placePixel(2, place(6, 6), T0 + 59_999)).toEqual({ ok: false, code: "frozen" });
    expect(engine.placePixel(2, place(6, 6), T0 + 60_000)).toEqual({ ok: true, outcome: "placed" });
    expect(b.charges).toBe(8);
  });

  test("fine never drops coins below zero", () => {
    const { engine, addPlayer } = makeEngine();
    addPlayer(1);
    const b = addPlayer(2);
    b.coins = 4;
    engine.placePixel(1, place(5, 5, 3, true), T0);
    const result = engine.placePixel(2, place(5, 5, 9), T0);
    expect(result.ok && result.outcome === "exploded" && result.coinsLost).toBe(4);
    expect(b.coins).toBe(0);
  });

  test("anti-farm: the same pair is rated at most 3 times a day, bonus is always paid", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    a.inventory.bomb = 4;
    addPlayer(2);
    for (let i = 0; i < 4; i++) engine.placePixel(1, place(i, 0, 3, true), T0);
    engine.drainEvents();

    for (let i = 0; i < 4; i++) {
      const result = engine.placePixel(2, place(i, 0, 9), T0 + i * 60_000);
      expect(result.ok && result.outcome).toBe("exploded");
    }
    const rated = eventsOf(engine.drainEvents(), "stat").filter((e) => e.userId === 1 && e.stat === "bombsTriggered");
    expect(rated).toHaveLength(3);
    expect(a.coins).toBe(104 + 4 * 15);
  });
});
