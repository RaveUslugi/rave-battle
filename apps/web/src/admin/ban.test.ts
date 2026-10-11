import { describe, expect, test } from "bun:test";
import { BAN_PRESETS, banUntil, parseDelta } from "./ban";

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);

describe("banUntil", () => {
  for (const p of BAN_PRESETS) {
    test(`preset ${p.key}`, () => {
      expect(banUntil({ preset: p.key }, NOW)).toBe(p.ms === null ? "permanent" : NOW + p.ms);
    });
  }

  test("custom date in the future", () => {
    const value = "2026-10-12T12:00";
    expect(banUntil({ custom: value }, NOW)).toBe(new Date(value).getTime());
  });

  test("custom date in the past", () => {
    expect(banUntil({ custom: "2020-01-01T00:00" }, NOW)).toBeNull();
  });

  test("empty or garbage custom value", () => {
    expect(banUntil({ custom: "" }, NOW)).toBeNull();
    expect(banUntil({ custom: "not a date" }, NOW)).toBeNull();
  });
});

describe("parseDelta", () => {
  test("accepts signed integers", () => {
    expect(parseDelta("+500")).toBe(500);
    expect(parseDelta("-2")).toBe(-2);
    expect(parseDelta("0")).toBe(0);
    expect(parseDelta("7")).toBe(7);
  });
  test("empty means zero", () => {
    expect(parseDelta("")).toBe(0);
    expect(parseDelta("  ")).toBe(0);
  });
  test("rejects fractions and text", () => {
    expect(parseDelta("1.5")).toBeNull();
    expect(parseDelta("abc")).toBeNull();
    expect(parseDelta("+")).toBeNull();
  });
  test("rejects values above one million", () => {
    expect(parseDelta("1000000")).toBe(1_000_000);
    expect(parseDelta("1000001")).toBeNull();
    expect(parseDelta("-1000001")).toBeNull();
  });
});
