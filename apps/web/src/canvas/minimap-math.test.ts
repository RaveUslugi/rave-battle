import { describe, expect, test } from "bun:test";
import { minimapLayout, minimapToCanvas, viewportRect } from "./minimap-math";

describe("minimap math", () => {
  test("layout fits the longest side into the box", () => {
    expect(minimapLayout({ width: 512, height: 256 }, 160)).toEqual({ width: 160, height: 80, scale: 160 / 512 });
  });

  test("map points become clamped canvas cells", () => {
    const layout = minimapLayout({ width: 512, height: 512 }, 128); // 4 cells per map px
    expect(minimapToCanvas(layout, 10, 20, { width: 512, height: 512 })).toEqual({ x: 40, y: 80 });
    expect(minimapToCanvas(layout, -5, 999, { width: 512, height: 512 })).toEqual({ x: 0, y: 511 });
  });

  test("the viewport rectangle follows camera and screen", () => {
    const layout = minimapLayout({ width: 512, height: 512 }, 128);
    const rect = viewportRect({ camera: { x: 256, y: 256, zoom: 2 }, screen: { w: 400, h: 200 } }, layout);
    expect(rect).toEqual({ x: (256 - 100) / 4, y: (256 - 50) / 4, w: 50, h: 25 });
  });
});
