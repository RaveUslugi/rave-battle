import { describe, expect, test } from "bun:test";
import { heatColor, heatRects } from "./heatmap";

describe("heatmap", () => {
  test("rects scale blocks to the map and intensity is logarithmic", () => {
    const rects = heatRects(
      {
        step: 8,
        width: 64,
        height: 64,
        cells: [
          [0, 1],
          [65, 100],
        ],
      },
      { width: 128, height: 128, scale: 0.25 },
    );
    expect(rects[0]).toMatchObject({ x: 0, y: 0, w: 2, h: 2 });
    expect(rects[1]).toMatchObject({ x: 2, y: 2, w: 2, h: 2, t: 1 });
    expect(rects[0]!.t).toBeCloseTo(Math.log(2) / Math.log(101));
  });

  test("colors go from cyan to pink", () => {
    expect(heatColor(0)).toBe("rgba(34, 243, 255, 0.35)");
    expect(heatColor(1)).toBe("rgba(255, 43, 214, 1)");
  });
});
