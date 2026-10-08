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
});
