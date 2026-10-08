import { describe, expect, test } from "bun:test";
import { chargesAt, isFrozen } from "./charges";

const REGEN = 30_000;
const base = { charges: 0, chargesUpdatedAt: 1_000_000, chargeCap: 10, frozenUntil: 0 };

describe("chargesAt", () => {
  test("a full player has nothing to wait for", () => {
    expect(chargesAt({ ...base, charges: 10 }, REGEN, 2_000_000)).toEqual({ charges: 10, nextAt: null });
  });

  test("regenerates one charge per interval and reports the next tick", () => {
    expect(chargesAt(base, REGEN, 1_000_000 + 65_000)).toEqual({ charges: 2, nextAt: 1_000_000 + 90_000 });
    expect(chargesAt(base, REGEN, 1_000_000)).toEqual({ charges: 0, nextAt: 1_000_000 + REGEN });
  });

  test("never exceeds the cap", () => {
    expect(chargesAt({ ...base, charges: 9 }, REGEN, 1_000_000 + 600_000)).toEqual({ charges: 10, nextAt: null });
  });

  test("regeneration counts from the end of the freeze", () => {
    const frozen = { ...base, frozenUntil: 1_000_000 + 60_000 };
    expect(chargesAt(frozen, REGEN, 1_000_000 + 75_000)).toEqual({ charges: 0, nextAt: 1_000_000 + 90_000 });
    expect(chargesAt(frozen, REGEN, 1_000_000 + 90_000)).toEqual({ charges: 1, nextAt: 1_000_000 + 120_000 });
  });

  test("during a freeze the next charge is a full interval after it ends", () => {
    expect(chargesAt({ ...base, frozenUntil: 1_000_000 + 60_000 }, REGEN, 1_000_000 + 10_000)).toEqual({
      charges: 0,
      nextAt: 1_000_000 + 90_000,
    });
  });
});

describe("isFrozen", () => {
  test("frozen strictly before frozenUntil", () => {
    expect(isFrozen({ frozenUntil: 100, unlimited: false }, 99)).toBe(true);
    expect(isFrozen({ frozenUntil: 100, unlimited: false }, 100)).toBe(false);
    expect(isFrozen({ frozenUntil: 0, unlimited: false }, 5)).toBe(false);
  });

  test("unlimited players are never frozen", () => {
    expect(isFrozen({ frozenUntil: 10, unlimited: true }, 5)).toBe(false);
  });
});
