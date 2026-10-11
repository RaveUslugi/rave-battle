import { describe, expect, test } from "bun:test";
import { defaultConfig } from "@rave/shared";
import { chargeCap, settleCharges } from "./charges";
import type { PlayerState } from "./types";

const T0 = 1_000_000;
const cfg = defaultConfig; // max 10, regen 30 s

function player(overrides: Partial<PlayerState>): PlayerState {
  return {
    userId: 1,
    coins: 0,
    charges: 10,
    chargesUpdatedAt: T0,
    frozenUntil: 0,
    chargeCapBonus: 0,
    inventory: { bomb: 0, detector: 0, defuser: 0 },
    unlockedColors: new Set(),
    dailyStep: 0,
    dailyLastClaim: null,
    bannedUntil: null,
    banReason: null,
    accountCreatedAt: 0,
    guildMember: true,
    ...overrides,
  };
}

describe("chargeCap", () => {
  test("adds the bought bonus to the configured max", () => {
    expect(chargeCap(player({ chargeCapBonus: 5 }), cfg)).toBe(15);
  });
});

describe("settleCharges", () => {
  test("full player stays full and the regen timer restarts at now", () => {
    const p = player({ charges: 10 });
    settleCharges(p, cfg, T0 + 500_000);
    expect(p.charges).toBe(10);
    expect(p.chargesUpdatedAt).toBe(T0 + 500_000);
  });

  test("regenerates one charge per interval and keeps the partial progress", () => {
    const p = player({ charges: 0 });
    settleCharges(p, cfg, T0 + 65_000);
    expect(p.charges).toBe(2);
    expect(p.chargesUpdatedAt).toBe(T0 + 60_000);
  });

  test("never exceeds the cap", () => {
    const p = player({ charges: 9 });
    settleCharges(p, cfg, T0 + 600_000);
    expect(p.charges).toBe(10);
    expect(p.chargesUpdatedAt).toBe(T0 + 600_000);
  });

  test("does not regenerate while frozen; regen starts at frozenUntil", () => {
    const p = player({ charges: 0, frozenUntil: T0 + 60_000 });
    settleCharges(p, cfg, T0 + 75_000);
    expect(p.charges).toBe(0);
    settleCharges(p, cfg, T0 + 90_000);
    expect(p.charges).toBe(1);
  });
});
