import { describe, expect, test } from "bun:test";
import { makeEngine, T0 } from "./test-utils";

const place = { x: 1, y: 1, colorId: 3, withBomb: false };

describe("setAccess", () => {
  test("updates guild membership and bans of an existing player", () => {
    const { engine, addPlayer } = makeEngine();
    addPlayer(1);
    engine.setAccess(1, { guildMember: false });
    expect(engine.placePixel(1, place, T0)).toEqual({ ok: false, code: "not_guild_member" });
    engine.setAccess(1, { guildMember: true, bannedUntil: Number.POSITIVE_INFINITY });
    expect(engine.placePixel(1, place, T0)).toEqual({ ok: false, code: "banned" });
    engine.setAccess(1, { bannedUntil: null });
    expect(engine.placePixel(1, place, T0)).toEqual({ ok: true, outcome: "placed" });
  });

  test("a ban with a reason pushes one player event and can be lifted", () => {
    const { engine, addPlayer } = makeEngine();
    const p = addPlayer(1);
    engine.setAccess(1, { bannedUntil: T0 + 1000, banReason: "spam" });
    expect(p.banReason).toBe("spam");
    expect(engine.drainEvents()).toEqual([{ type: "player", userId: 1 }]);
    expect(engine.placePixel(1, place, T0)).toEqual({ ok: false, code: "banned" });
    engine.setAccess(1, { bannedUntil: null, banReason: null });
    expect(engine.placePixel(1, place, T0)).toEqual({ ok: true, outcome: "placed" });
  });

  test("omitted fields stay unchanged and only a player event is emitted", () => {
    const { engine, addPlayer } = makeEngine();
    const p = addPlayer(1);
    p.bannedUntil = T0 + 1;
    engine.setAccess(1, { guildMember: false });
    expect(p.bannedUntil).toBe(T0 + 1);
    expect(engine.drainEvents()).toEqual([{ type: "player", userId: 1 }]);
  });
});
