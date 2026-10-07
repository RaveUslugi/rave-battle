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
