import { defaultConfig, type PlayerView } from "@rave/shared";
import { describe, expect, test } from "bun:test";
import { planPlacement, type PlacementInput } from "./placement";

const NOW = 2_000_000;
const player = (overrides: Partial<PlayerView> = {}): PlayerView => ({
  coins: 100,
  charges: 5,
  chargesUpdatedAt: NOW,
  chargeCap: 10,
  frozenUntil: 0,
  inventory: { bomb: 2, detector: 0, defuser: 0 },
  unlockedColors: [],
  dailyStep: 0,
  dailyLastClaim: null,
  bannedUntil: null,
  unlimited: false,
  ...overrides,
});
const input = (overrides: Partial<PlacementInput> = {}): PlacementInput => ({
  user: { id: 1, name: "a" },
  player: player(),
  config: defaultConfig,
  colorId: 5,
  withBomb: false,
  pendingCount: 0,
  pendingBombs: 0,
  now: NOW,
  ...overrides,
});

describe("planPlacement", () => {
  test("unlimited players skip the freeze, charge and bomb checks", () => {
    const p = player({ unlimited: true, charges: 0, frozenUntil: NOW + 60_000, inventory: { bomb: 0, detector: 0, defuser: 0 } });
    expect(planPlacement(input({ player: p, withBomb: true, pendingCount: 5, pendingBombs: 5 }))).toEqual({ ok: true });
  });

  test("accepts a valid placement", () => {
    expect(planPlacement(input())).toEqual({ ok: true });
  });

  test("requires a logged-in user and a player", () => {
    expect(planPlacement(input({ user: null }))).toEqual({ ok: false, code: "unauthorized" });
    expect(planPlacement(input({ player: null }))).toEqual({ ok: false, code: "unavailable" });
  });

  test("refuses banned and frozen players", () => {
    expect(planPlacement(input({ player: player({ bannedUntil: "permanent" }) }))).toEqual({ ok: false, code: "banned" });
    expect(planPlacement(input({ player: player({ bannedUntil: NOW + 1 }) }))).toEqual({ ok: false, code: "banned" });
    expect(planPlacement(input({ player: player({ bannedUntil: NOW - 1 }) }))).toEqual({ ok: true });
    expect(planPlacement(input({ player: player({ frozenUntil: NOW + 5000 }) }))).toEqual({ ok: false, code: "frozen" });
  });

  test("refuses locked colors but allows unlocked ones and unknown ids are invalid", () => {
    const config = structuredClone(defaultConfig);
    config.palette.push({ id: 40, type: "solid", base: "#00FFFF", params: {}, unlock: "shop", price: 100 });
    expect(planPlacement(input({ config, colorId: 40 }))).toEqual({ ok: false, code: "color_locked" });
    expect(planPlacement(input({ config, colorId: 40, player: player({ unlockedColors: [40] }) }))).toEqual({ ok: true });
    expect(planPlacement(input({ colorId: 200 }))).toEqual({ ok: false, code: "invalid_color" });
  });

  test("accounts for pending placements in charges and bombs", () => {
    expect(planPlacement(input({ pendingCount: 5 }))).toEqual({ ok: false, code: "no_charges" });
    expect(planPlacement(input({ pendingCount: 4 }))).toEqual({ ok: true });
    expect(planPlacement(input({ withBomb: true, player: player({ inventory: { bomb: 0, detector: 0, defuser: 0 } }) }))).toEqual({
      ok: false,
      code: "no_bombs",
    });
    expect(planPlacement(input({ withBomb: true, pendingBombs: 2 }))).toEqual({ ok: false, code: "no_bombs" });
    expect(planPlacement(input({ withBomb: true, pendingBombs: 1 }))).toEqual({ ok: true });
  });
});
