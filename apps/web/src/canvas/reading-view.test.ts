import { describe, expect, test } from "bun:test";
import { READING_MIN_ZOOM, readingColor, visibleReadings } from "./reading-view";

const r = (x: number, y: number) => ({ x, y, count: 1, at: 0 });

describe("visibleReadings", () => {
  test("nothing below the minimum zoom", () => {
    expect(visibleReadings([r(10, 10)], { x: 10, y: 10, zoom: READING_MIN_ZOOM - 1 }, { w: 100, h: 100 })).toEqual([]);
  });

  test("keeps readings on screen, newest first, up to the cap", () => {
    const cam = { x: 10, y: 10, zoom: 10 }; // 100x100 screen shows cells 5..15
    const list = [r(5, 5), r(14, 14), r(30, 30), r(10, 10)];
    expect(visibleReadings(list, cam, { w: 100, h: 100 })).toEqual([r(10, 10), r(14, 14), r(5, 5)]);
    expect(visibleReadings(list, cam, { w: 100, h: 100 }, 1)).toEqual([r(10, 10)]);
  });

  test("colors saturate at four", () => {
    expect(readingColor(9)).toBe(readingColor(4));
    expect(readingColor(0)).not.toBe(readingColor(1));
  });
});
