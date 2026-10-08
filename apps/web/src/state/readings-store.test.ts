import { describe, expect, test } from "bun:test";
import {
  createReadingsStore,
  formatAge,
  MAX_READINGS,
  READING_FADE_MS,
  READING_TTL_MS,
  readingAlpha,
  readingAt,
} from "./readings-store";
import type { StorageLike } from "./ui-store";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe("readings store", () => {
  test("readings belong to a user, persist and come back", () => {
    const storage = memoryStorage();
    const store = createReadingsStore(storage, () => 1_000);
    store.getState().add({ x: 1, y: 1, count: 2, at: 1_000 }); // no user yet: ignored
    expect(store.getState().readings).toEqual([]);
    store.getState().setUser(7);
    store.getState().add({ x: 1, y: 1, count: 2, at: 1_000 });
    store.getState().add({ x: 1, y: 1, count: 3, at: 1_000 }); // same cell: replaced
    expect(store.getState().readings).toEqual([{ x: 1, y: 1, count: 3, at: 1_000 }]);
    expect(JSON.parse(storage.data["rb:readings:7"]!)).toHaveLength(1);
    store.getState().setUser(8);
    expect(store.getState().readings).toEqual([]);
    store.getState().setUser(7);
    expect(store.getState().readings).toHaveLength(1);
    store.getState().setUser(null);
    expect(store.getState().readings).toEqual([]);
  });

  test("expired and malformed entries are dropped on load and prune", () => {
    let now = READING_TTL_MS + 10;
    const storage = memoryStorage({
      "rb:readings:1": JSON.stringify([
        { x: 0, y: 0, count: 1, at: 5 },
        { x: 1, y: 0, count: 1, at: READING_TTL_MS },
        { x: "bad" },
      ]),
    });
    const store = createReadingsStore(storage, () => now);
    store.getState().setUser(1);
    expect(store.getState().readings.map((r) => r.x)).toEqual([1]);
    now += READING_TTL_MS;
    store.getState().prune();
    expect(store.getState().readings).toEqual([]);
    expect(storage.data["rb:readings:1"]).toBe("[]");
  });

  test("broken storage yields an empty list and adds still work in memory", () => {
    const store = createReadingsStore(memoryStorage({ "rb:readings:1": "{oops" }), () => 0);
    store.getState().setUser(1);
    expect(store.getState().readings).toEqual([]);
    const throwing: StorageLike = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const other = createReadingsStore(throwing, () => 0);
    other.getState().setUser(1);
    other.getState().add({ x: 0, y: 0, count: 0, at: 0 });
    expect(other.getState().readings).toHaveLength(1);
  });

  test("keeps the newest MAX_READINGS", () => {
    const store = createReadingsStore(null, () => 0);
    store.getState().setUser(1);
    for (let i = 0; i <= MAX_READINGS; i++) store.getState().add({ x: i, y: 0, count: 0, at: 0 });
    const xs = store.getState().readings.map((r) => r.x);
    expect(xs).toHaveLength(MAX_READINGS);
    expect(xs[0]).toBe(1);
  });
});

describe("reading helpers", () => {
  test("alpha fades from 1 to 0.3 over an hour", () => {
    expect(readingAlpha(0)).toBe(1);
    expect(readingAlpha(READING_FADE_MS / 2)).toBeCloseTo(0.65);
    expect(readingAlpha(READING_FADE_MS * 5)).toBeCloseTo(0.3);
    expect(readingAlpha(-1000)).toBe(1);
  });

  test("ages read naturally", () => {
    expect(formatAge(30_000)).toBe("только что");
    expect(formatAge(12 * 60_000)).toBe("12 мин назад");
    expect(formatAge(3 * 3_600_000 + 5)).toBe("3 ч назад");
  });

  test("readingAt finds the reading of a cell", () => {
    const list = [{ x: 1, y: 2, count: 3, at: 0 }];
    expect(readingAt(list, { x: 1, y: 2 })?.count).toBe(3);
    expect(readingAt(list, { x: 2, y: 1 })).toBeNull();
  });
});
