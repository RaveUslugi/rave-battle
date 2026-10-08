import { describe, expect, test } from "bun:test";
import { BOARD_TABS, formatValue, periodsFor } from "./leaders";

describe("leaders", () => {
  test("territory has no period choice", () => {
    expect(periodsFor("territory")).toEqual([]);
    expect(periodsFor("artists").map((p) => p.period)).toEqual(["day", "week", "all"]);
  });

  test("tabs and values", () => {
    expect(BOARD_TABS.map((b) => b.board)).toEqual(["artists", "bombers", "sappers", "kamikaze", "territory"]);
    expect(formatValue(1234567)).toBe("1 234 567");
  });
});
