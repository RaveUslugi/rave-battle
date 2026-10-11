import { describe, expect, test } from "bun:test";
import { BombStore } from "./bomb-store";

describe("BombStore", () => {
  test("add, get and remove a bomb", () => {
    const bombs = new BombStore();
    bombs.add({ x: 3, y: 4, ownerId: 1, createdAt: 100 });
    expect(bombs.get(3, 4)).toEqual({ x: 3, y: 4, ownerId: 1, createdAt: 100 });
    expect(bombs.get(4, 3)).toBeUndefined();
    expect(bombs.remove(3, 4)?.ownerId).toBe(1);
    expect(bombs.get(3, 4)).toBeUndefined();
    expect(bombs.remove(3, 4)).toBeUndefined();
  });

  test("refuses a second bomb on the same cell", () => {
    const bombs = new BombStore();
    bombs.add({ x: 1, y: 1, ownerId: 1, createdAt: 0 });
    expect(() => bombs.add({ x: 1, y: 1, ownerId: 2, createdAt: 0 })).toThrow();
  });

  test("counts active bombs per owner", () => {
    const bombs = new BombStore();
    bombs.add({ x: 1, y: 1, ownerId: 1, createdAt: 0 });
    bombs.add({ x: 2, y: 1, ownerId: 1, createdAt: 0 });
    bombs.add({ x: 3, y: 1, ownerId: 2, createdAt: 0 });
    expect(bombs.activeCount(1)).toBe(2);
    bombs.remove(1, 1);
    expect(bombs.activeCount(1)).toBe(1);
    expect(bombs.activeCount(3)).toBe(0);
  });

  test("ownedBy and inRect select bombs, rect bounds inclusive", () => {
    const bombs = new BombStore();
    bombs.add({ x: 1, y: 1, ownerId: 1, createdAt: 0 });
    bombs.add({ x: 5, y: 5, ownerId: 2, createdAt: 0 });
    bombs.add({ x: 9, y: 9, ownerId: 1, createdAt: 0 });
    expect(bombs.ownedBy(1).map((b) => [b.x, b.y])).toEqual([[1, 1], [9, 9]]);
    expect(bombs.ownedBy(3)).toEqual([]);
    expect(bombs.inRect({ x1: 1, y1: 1, x2: 5, y2: 5 }).map((b) => [b.x, b.y])).toEqual([[1, 1], [5, 5]]);
    expect(bombs.inRect({ x1: 2, y1: 2, x2: 4, y2: 4 })).toEqual([]);
  });

  test("countAround counts the 3x3 square including the center", () => {
    const bombs = new BombStore();
    for (const [x, y] of [[4, 4], [5, 6], [6, 6], [8, 8], [5, 5]] as const) {
      bombs.add({ x, y, ownerId: 1, createdAt: 0 });
    }
    expect(bombs.countAround(5, 5)).toBe(4);
    expect(bombs.countAround(0, 0)).toBe(0);
  });
});
