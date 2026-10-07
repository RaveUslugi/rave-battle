import { describe, expect, test } from "bun:test";
import { DAY_MS, eventsOf, makeEngine, T0 } from "./test-utils";

describe("claimDaily", () => {
  test("grants the first reward once per day", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    expect(engine.claimDaily(1, T0)).toEqual({ ok: true, reward: { item: "coins", amount: 30 } });
    expect(a.coins).toBe(130);
    expect(a.dailyStep).toBe(1);
    expect(a.dailyLastClaim).toBe("2026-10-07");
    expect(eventsOf(engine.drainEvents(), "ledger").map((e) => [e.item, e.delta, e.reason])).toEqual([["coins", 30, "daily"]]);
    expect(engine.claimDaily(1, T0 + 1000)).toEqual({ ok: false, code: "already_claimed" });
  });

  test("the next day grants the next reward", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    engine.claimDaily(1, T0);
    expect(engine.claimDaily(1, T0 + DAY_MS)).toEqual({ ok: true, reward: { item: "bomb", amount: 1 } });
    expect(a.inventory.bomb).toBe(4);
  });

  test("skipping days does not reset progress", () => {
    const { engine, addPlayer } = makeEngine();
    addPlayer(1);
    engine.claimDaily(1, T0);
    expect(engine.claimDaily(1, T0 + 5 * DAY_MS)).toEqual({ ok: true, reward: { item: "bomb", amount: 1 } });
  });

  test("the cycle wraps after the last reward", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    for (let day = 0; day < 7; day++) engine.claimDaily(1, T0 + day * DAY_MS);
    expect(a.dailyStep).toBe(0);
    expect(a.inventory.defuser).toBe(2);
    expect(engine.claimDaily(1, T0 + 7 * DAY_MS)).toEqual({ ok: true, reward: { item: "coins", amount: 30 } });
  });

  test("the day changes at midnight in the configured time zone", () => {
    const { engine, addPlayer } = makeEngine();
    addPlayer(1);
    engine.claimDaily(1, T0); // 15:00 Moscow, Oct 7
    // 21:30 UTC = 00:30 Moscow, Oct 8
    expect(engine.claimDaily(1, Date.UTC(2026, 9, 7, 21, 30)).ok).toBe(true);
  });

  test("banned players cannot claim; frozen players can", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    a.bannedUntil = T0 + 1;
    expect(engine.claimDaily(1, T0)).toEqual({ ok: false, code: "banned" });
    a.bannedUntil = null;
    a.frozenUntil = T0 + 1;
    expect(engine.claimDaily(1, T0).ok).toBe(true);
  });
});
