import { describe, expect, test } from "bun:test";
import { MAX_AREA_CELLS, normalizeRect, rectCells } from "./admin";

describe("normalizeRect", () => {
  test("keeps ordered corners", () => {
    expect(normalizeRect({ x: 1, y: 2 }, { x: 5, y: 9 })).toEqual({ x1: 1, y1: 2, x2: 5, y2: 9 });
  });

  test("reorders swapped corners per axis", () => {
    expect(normalizeRect({ x: 5, y: 2 }, { x: 1, y: 9 })).toEqual({ x1: 1, y1: 2, x2: 5, y2: 9 });
    expect(normalizeRect({ x: 5, y: 9 }, { x: 1, y: 2 })).toEqual({ x1: 1, y1: 2, x2: 5, y2: 9 });
  });
});

describe("rectCells", () => {
  test("a single cell is 1", () => {
    expect(rectCells({ x1: 3, y1: 3, x2: 3, y2: 3 })).toBe(1);
  });

  test("counts inclusively", () => {
    expect(rectCells({ x1: 0, y1: 0, x2: 255, y2: 255 })).toBe(MAX_AREA_CELLS);
    expect(rectCells({ x1: 2, y1: 4, x2: 4, y2: 5 })).toBe(6);
  });
});
