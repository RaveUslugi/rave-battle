import { describe, expect, test } from "bun:test";
import { tapCorner } from "./area";

describe("tapCorner", () => {
  test("the first tap only remembers the corner", () => {
    expect(tapCorner(null, { x: 3, y: 4 })).toEqual({ corner: { x: 3, y: 4 }, area: null });
  });

  test("the second tap closes the rectangle", () => {
    expect(tapCorner({ x: 3, y: 4 }, { x: 7, y: 9 })).toEqual({ corner: null, area: { x1: 3, y1: 4, x2: 7, y2: 9 } });
  });

  test("corner order does not matter", () => {
    expect(tapCorner({ x: 7, y: 9 }, { x: 3, y: 4 }).area).toEqual({ x1: 3, y1: 4, x2: 7, y2: 9 });
  });

  test("tapping the same cell gives a 1x1 area", () => {
    expect(tapCorner({ x: 5, y: 5 }, { x: 5, y: 5 }).area).toEqual({ x1: 5, y1: 5, x2: 5, y2: 5 });
  });
});
