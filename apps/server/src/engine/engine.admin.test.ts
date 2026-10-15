import { describe, expect, test } from "bun:test";
import { eventsOf, makeEngine, T0 } from "./test-utils";

describe("adminAdjust", () => {
  test("applies every delta, writes admin ledger rows and one mod_log entry", () => {
    const { engine, addPlayer } = makeEngine();
    const p = addPlayer(1);
    const coins = p.coins;
    const result = engine.adminAdjust(1, { coins: 500, bomb: -1, detector: 0 }, T0, { adminId: 9, comment: "compensation" });
    expect(result).toEqual({ ok: true });
    expect(p.coins).toBe(coins + 500);
    const events = engine.drainEvents();
    expect(eventsOf(events, "ledger").map((e) => [e.item, e.delta, e.reason, e.ref])).toEqual([
      ["coins", 500, "admin", { adminId: 9, comment: "compensation" }],
      ["bomb", -1, "admin", { adminId: 9, comment: "compensation" }],
    ]);
    expect(eventsOf(events, "mod_log")).toEqual([
      { type: "mod_log", adminId: 9, action: "player_edit", targetUserId: 1, params: { changes: { coins: 500, bomb: -1 }, comment: "compensation" }, at: T0 },
    ]);
    expect(eventsOf(events, "player")).toEqual([{ type: "player", userId: 1 }]);
  });

  test("rejects a change that would go below zero and changes nothing", () => {
    const { engine, addPlayer } = makeEngine();
    const p = addPlayer(1);
    const before = structuredClone({ coins: p.coins, inventory: p.inventory });
    expect(engine.adminAdjust(1, { coins: 10, bomb: -(p.inventory.bomb + 1) }, T0, { adminId: 9, comment: "x" })).toEqual({
      ok: false,
      code: "negative_balance",
    });
    expect({ coins: p.coins, inventory: p.inventory }).toEqual(before);
    expect(engine.drainEvents()).toEqual([]);
  });

  test("rejects an all-zero change", () => {
    const { engine, addPlayer } = makeEngine();
    addPlayer(1);
    expect(engine.adminAdjust(1, { coins: 0 }, T0, { adminId: 9, comment: "x" })).toEqual({ ok: false, code: "nothing_to_change" });
  });
});
