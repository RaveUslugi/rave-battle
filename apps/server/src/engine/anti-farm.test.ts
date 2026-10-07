import { describe, expect, test } from "bun:test";
import { AntiFarm } from "./anti-farm";

describe("AntiFarm", () => {
  test("rates at most `limit` triggers per owner/victim pair per day", () => {
    const farm = new AntiFarm();
    const results = [1, 2, 3, 4].map(() => farm.register("2026-10-07", 1, 2, 3));
    expect(results).toEqual([true, true, true, false]);
  });

  test("pairs are independent and directional", () => {
    const farm = new AntiFarm();
    farm.register("2026-10-07", 1, 2, 1);
    expect(farm.register("2026-10-07", 1, 3, 1)).toBe(true);
    expect(farm.register("2026-10-07", 2, 1, 1)).toBe(true);
    expect(farm.register("2026-10-07", 1, 2, 1)).toBe(false);
  });

  test("a new day resets the counters", () => {
    const farm = new AntiFarm();
    farm.register("2026-10-07", 1, 2, 1);
    expect(farm.register("2026-10-08", 1, 2, 1)).toBe(true);
  });
});
