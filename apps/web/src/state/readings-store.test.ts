import { describe, expect, test } from "bun:test";
import { createGameStore } from "./game-store";
import {
  bindReadings,
  createReadingsStore,
  formatAge,
  MAX_READINGS,
  READING_FADE_MS,
  READING_TTL_MS,
  readingAlpha,
  readingAt,
  type ReadingsStorage,
} from "./readings-store";

function memoryStorage(initial: Record<string, string> = {}): ReadingsStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => void delete data[k],
    key: (i) => Object.keys(data)[i] ?? null,
    get length() {
      return Object.keys(data).length;
    },
  };
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
      "rb:readings:1": JSON.stringify([{ x: 0, y: 0, count: 1, at: 5 }, { x: 1, y: 0, count: 1, at: READING_TTL_MS }, { x: "bad" }]),
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
    const throwing: ReadingsStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
      key: () => {
        throw new Error("blocked");
      },
      length: 0,
    };
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

  test("switching users sweeps other accounts' keys that hold nothing fresh", () => {
    const now = READING_TTL_MS * 3;
    const storage = memoryStorage({
      "rb:readings:2": JSON.stringify([{ x: 0, y: 0, count: 1, at: 0 }]), // expired
      "rb:readings:3": JSON.stringify([{ x: 0, y: 0, count: 1, at: now }]), // fresh: kept
      "rb:readings:4": "{broken",
      "rb:color": "5", // not ours
    });
    const store = createReadingsStore(storage, () => now);
    store.getState().setUser(1);
    expect(Object.keys(storage.data).sort()).toEqual(["rb:color", "rb:readings:3"]);
  });

  test("counts above 9 are rejected as malformed", () => {
    const storage = memoryStorage({ "rb:readings:1": JSON.stringify([{ x: 0, y: 0, count: 10, at: 0 }]) });
    const store = createReadingsStore(storage, () => 0);
    store.getState().setUser(1);
    expect(store.getState().readings).toEqual([]);
  });
});

describe("bindReadings", () => {
  test("follows the game store's user, including the current one", () => {
    const game = createGameStore(() => 0);
    game.setState({ user: { id: 5, name: "a" } });
    const readings = createReadingsStore(null, () => 0);
    const unbind = bindReadings(game, readings);
    expect(readings.getState().userId).toBe(5);
    game.setState({ user: null });
    expect(readings.getState().userId).toBeNull();
    unbind();
    game.setState({ user: { id: 6, name: "b" } });
    expect(readings.getState().userId).toBeNull();
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
