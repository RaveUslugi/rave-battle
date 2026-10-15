import { defaultConfig, type PlayerView } from "@rave/shared";
import { beforeEach, describe, expect, test } from "bun:test";
import { applyLocale } from "../i18n";
import { claimBlocked, dailyState, rewardText } from "./daily";

// 2026-10-08 12:00 UTC = 15:00 Moscow.
const NOON = Date.UTC(2026, 9, 8, 12);
const player = (dailyStep: number, dailyLastClaim: string | null) => ({ dailyStep, dailyLastClaim }) as Pick<PlayerView, "dailyStep" | "dailyLastClaim">;

beforeEach(() => applyLocale("ru"));

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

  test("reward texts", () => {
    expect(rewardText({ item: "coins", amount: 30 })).toBe("30 монет");
    expect(rewardText({ item: "bomb", amount: 2 })).toBe("2 бомбы");
    expect(rewardText({ item: "detector", amount: 5 })).toBe("Детектор +5");
    expect(rewardText({ item: "defuser", amount: 2 })).toBe("Дефьюзер +2");
  });
});

describe("claimBlocked", () => {
  const open = { claimedToday: false, pending: false, watchOnly: false };
  test("open only when nothing is in the way", () => {
    expect(claimBlocked(open)).toBe(false);
    expect(claimBlocked({ ...open, claimedToday: true })).toBe(true);
    expect(claimBlocked({ ...open, pending: true })).toBe(true);
    expect(claimBlocked({ ...open, watchOnly: true })).toBe(true);
  });
});
