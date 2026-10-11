import { decodeOverview } from "@rave/shared";
import { describe, expect, test } from "bun:test";
import { CanvasStore } from "../engine/canvas-store";
import { buildOverview, OverviewCache } from "./overview";

describe("overview", () => {
  test("samples the top-left cell of each block", () => {
    const canvas = new CanvasStore(512, 512);
    canvas.set(2, 2, 5, 1);
    canvas.set(3, 3, 9, 1); // inside the same 2x2 block: not sampled
    const o = decodeOverview(buildOverview(canvas))!;
    expect(o.step).toBe(2);
    expect(o.colors[1 * 256 + 1]).toBe(5);
    expect(o.colors[0]).toBe(0);
  });

  test("the cache rebuilds only after maxAge", () => {
    let now = 0;
    const canvas = new CanvasStore(256, 256);
    const cache = new OverviewCache(5_000, () => now);
    const first = cache.get(canvas);
    canvas.set(0, 0, 7, 1);
    expect(cache.get(canvas)).toBe(first);
    now = 5_000;
    const fresh = decodeOverview(Bun.gunzipSync(cache.get(canvas)))!;
    expect(fresh.colors[0]).toBe(7);
  });

  test("the cache rebuilds at once when the canvas grows", () => {
    const canvas = new CanvasStore(256, 256);
    const cache = new OverviewCache(5_000, () => 0);
    const first = cache.get(canvas);
    canvas.resize(512, 256);
    const grown = cache.get(canvas);
    expect(grown).not.toBe(first);
    expect(decodeOverview(Bun.gunzipSync(grown))).toMatchObject({ width: 256, height: 128 });
  });
});
