import { describe, expect, test } from "bun:test";
import { defaultConfig } from "@rave/shared";
import { quickColors } from "./Dock";

describe("quick colours", () => {
  const open = (e: { id: number; unlock: string }) => e.unlock === "default" || e.id === 33;
  test("recent first, locked ones dropped, topped up from the palette to eight", () => {
    const ids = quickColors(defaultConfig.palette, [33, 40, 5], open).map((e) => e.id);
    expect(ids).toEqual([33, 5, 0, 1, 2, 3, 4, 6]);
  });
  test("no more than eight", () => {
    expect(quickColors(defaultConfig.palette, [1, 2, 3, 4, 5, 6, 7, 8, 9], open)).toHaveLength(8);
  });
});
