import { describe, expect, test } from "bun:test";
import { decodeOverview, encodeOverview, overviewShape } from "./protocol";

describe("overview", () => {
  test("shape keeps the longest side at most 256", () => {
    expect(overviewShape(512, 512)).toEqual({ step: 2, width: 256, height: 256 });
    expect(overviewShape(256, 512)).toEqual({ step: 2, width: 128, height: 256 });
    expect(overviewShape(256, 256)).toEqual({ step: 1, width: 256, height: 256 });
    expect(overviewShape(16384, 256)).toEqual({ step: 64, width: 256, height: 4 });
  });

  test("round-trips and rejects wrong sizes", () => {
    const colors = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const bytes = encodeOverview({ step: 2, width: 3, height: 2, colors });
    expect(decodeOverview(bytes)).toEqual({ step: 2, width: 3, height: 2, colors });
    expect(decodeOverview(bytes.slice(0, -1))).toBeNull();
  });

  test("rejects zero step and sides beyond the maximum", () => {
    expect(decodeOverview(encodeOverview({ step: 0, width: 1, height: 1, colors: new Uint8Array(1) }))).toBeNull();
    expect(decodeOverview(encodeOverview({ step: 1, width: 0, height: 0, colors: new Uint8Array(0) }))).toBeNull();
    const big = 257;
    expect(decodeOverview(encodeOverview({ step: 1, width: big, height: 1, colors: new Uint8Array(big) }))).toBeNull();
  });
});
