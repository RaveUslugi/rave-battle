import { defaultConfig, type PlayerView } from "@rave/shared";
import { describe, expect, test } from "bun:test";
import { dailyState } from "./daily";

// 2026-10-08 12:00 UTC = 15:00 Moscow.
const NOON = Date.UTC(2026, 9, 8, 12);
const player = (dailyStep: number, dailyLastClaim: string | null) => ({ dailyStep, dailyLastClaim }) as Pick<PlayerView, "dailyStep" | "dailyLastClaim">;

describe("dailyState", () => {
  test("available when not claimed today in the config time zone", () => {
    expect(dailyState(player(2, "2026-10-07"), defaultConfig, NOON)).toEqual({ claimedToday: false, step: 2 });
    expect(dailyState(player(3, "2026-10-08"), defaultConfig, NOON)).toEqual({ claimedToday: true, step: 3 });
  });

  test("the day turns at midnight Moscow time, not UTC", () => {
    const lateUtc = Date.UTC(2026, 9, 8, 21, 30); // 00:30 on the 9th in Moscow
    expect(dailyState(player(3, "2026-10-08"), defaultConfig, lateUtc).claimedToday).toBe(false);
  });

  test("a step beyond a shortened reward list wraps", () => {
    expect(dailyState(player(9, null), defaultConfig, NOON).step).toBe(2);
  });
});
