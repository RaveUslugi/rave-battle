import { describe, expect, test } from "bun:test";
import { dateKey } from "./time";

describe("dateKey", () => {
  test("returns YYYY-MM-DD in the given time zone", () => {
    // 20:59:59 UTC = 23:59:59 in Moscow (UTC+3)
    expect(dateKey(Date.UTC(2026, 9, 7, 20, 59, 59), "Europe/Moscow")).toBe("2026-10-07");
    // 21:00:00 UTC = 00:00:00 next day in Moscow
    expect(dateKey(Date.UTC(2026, 9, 7, 21, 0, 0), "Europe/Moscow")).toBe("2026-10-08");
  });

  test("works for UTC", () => {
    expect(dateKey(Date.UTC(2026, 0, 1, 0, 0, 0), "UTC")).toBe("2026-01-01");
  });
});
