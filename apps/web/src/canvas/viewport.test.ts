import { describe, expect, test } from "bun:test";
import {
  cameraFromSearch,
  cameraToSearch,
  cellAt,
  clampCenter,
  fitZoom,
  pan,
  screenToWorld,
  visibleChunks,
  worldToScreen,
  zoomAt,
} from "./viewport";

const size = { w: 800, h: 600 };
const limits = { min: 0.5, max: 64 };

describe("viewport", () => {
  test("screen and world coordinates round-trip", () => {
    const cam = { x: 100, y: 50, zoom: 4 };
    const world = screenToWorld(cam, size, 500, 200);
    expect(world).toEqual({ x: 125, y: 25 });
    expect(worldToScreen(cam, size, world.x, world.y)).toEqual({ x: 500, y: 200 });
  });

  test("zoomAt keeps the point under the cursor fixed and clamps the zoom", () => {
    const cam = { x: 100, y: 100, zoom: 2 };
    const zoomed = zoomAt(cam, size, 600, 300, 2, limits);
    expect(zoomed.zoom).toBe(4);
    expect(screenToWorld(zoomed, size, 600, 300)).toEqual(screenToWorld(cam, size, 600, 300));
    expect(zoomAt(cam, size, 0, 0, 1000, limits).zoom).toBe(64);
    expect(zoomAt(cam, size, 0, 0, 0.0001, limits).zoom).toBe(0.5);
  });

  test("pan moves the camera opposite to the drag", () => {
    expect(pan({ x: 10, y: 10, zoom: 2 }, 20, -10)).toEqual({ x: 0, y: 15, zoom: 2 });
  });

  test("clampCenter keeps the center on the canvas", () => {
    expect(clampCenter({ x: -5, y: 900, zoom: 1 }, { width: 512, height: 512 })).toEqual({ x: 0, y: 512, zoom: 1 });
  });

  test("non-finite input leaves the camera unchanged", () => {
    const cam = { x: 100, y: 100, zoom: 2 };
    expect(zoomAt(cam, size, 0, 0, Number.NaN, limits)).toBe(cam);
    expect(zoomAt(cam, size, Number.POSITIVE_INFINITY, 0, 2, limits)).toBe(cam);
    expect(pan(cam, Number.NaN, 1)).toBe(cam);
    expect(clampCenter({ x: Number.NaN, y: 900, zoom: 1 }, { width: 512, height: 512 })).toEqual({ x: 256, y: 512, zoom: 1 });
  });

  test("fitZoom fits the whole canvas with a margin", () => {
    expect(fitZoom({ width: 512, height: 512 }, size)).toBeCloseTo((600 / 512) * 0.9);
  });

  test("visibleChunks covers the view plus a margin, clipped to the canvas, row by row", () => {
    expect(visibleChunks({ x: 256, y: 256, zoom: 1 }, size, { width: 512, height: 512 }, 0)).toEqual([
      { cx: 0, cy: 0 },
      { cx: 1, cy: 0 },
      { cx: 0, cy: 1 },
      { cx: 1, cy: 1 },
    ]);
    const zoomed = { x: 10, y: 10, zoom: 32 };
    expect(visibleChunks(zoomed, size, { width: 1024, height: 1024 }, 0)).toEqual([{ cx: 0, cy: 0 }]);
    expect(visibleChunks(zoomed, size, { width: 1024, height: 1024 }, 1)).toEqual([
      { cx: 0, cy: 0 },
      { cx: 1, cy: 0 },
      { cx: 0, cy: 1 },
      { cx: 1, cy: 1 },
    ]);
  });

  test("visibleChunks never exceeds the subscription limit and keeps the nearest chunks", () => {
    const chunks = visibleChunks({ x: 8192, y: 8192, zoom: 0.05 }, size, { width: 16_384, height: 16_384 }, 1);
    expect(chunks).toHaveLength(64);
    expect(chunks).toContainEqual({ cx: 32, cy: 32 });
  });

  test("visibleChunks keeps every on-screen chunk when the margin exceeds the limit", () => {
    const cam = { x: 8192, y: 8192, zoom: 1 };
    const screen = { w: 2560, h: 1440 };
    const canvas = { width: 16_384, height: 16_384 };
    const onScreen = visibleChunks(cam, screen, canvas, 0);
    expect(onScreen).toHaveLength(60);
    const chunks = visibleChunks(cam, screen, canvas, 1);
    expect(chunks.length).toBeLessThanOrEqual(64);
    for (const chunk of onScreen) expect(chunks).toContainEqual(chunk);
    expect(chunks).toEqual([...chunks].sort((a, b) => a.cy - b.cy || a.cx - b.cx));
  });

  test("cellAt returns the integer cell or null outside the canvas", () => {
    const cam = { x: 10, y: 10, zoom: 10 };
    expect(cellAt(cam, size, 400, 300, { width: 512, height: 512 })).toEqual({ x: 10, y: 10 });
    expect(cellAt(cam, size, 0, 0, { width: 512, height: 512 })).toBeNull();
  });

  test("the camera round-trips through the URL and garbage is ignored", () => {
    expect(cameraToSearch({ x: 12.345, y: 67.8, zoom: 8.123 })).toBe("?x=12&y=68&z=8.12");
    expect(cameraFromSearch("?x=12&y=68&z=8.12")).toEqual({ x: 12, y: 68, zoom: 8.12 });
    expect(cameraFromSearch("?x=abc&y=1&z=2")).toBeNull();
    expect(cameraFromSearch("?x=1&y=1&z=0")).toBeNull();
    expect(cameraFromSearch("")).toBeNull();
    expect(cameraFromSearch("?x=&y=1&z=2")).toBeNull();
    expect(cameraFromSearch("?x=1&y=1&z=")).toBeNull();
  });
});
