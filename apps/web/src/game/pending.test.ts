import { describe, expect, test } from "bun:test";
import { PendingPlacements } from "./pending";

describe("PendingPlacements", () => {
  test("adds with unique request ids, lists, counts bombs and resolves once", () => {
    const pending = new PendingPlacements();
    const a = pending.add({ x: 1, y: 2 }, 5, false, 100);
    const b = pending.add({ x: 3, y: 4 }, 6, true, 110);
    expect(a.reqId).not.toBe(b.reqId);
    expect(pending.size).toBe(2);
    expect(pending.bombs).toBe(1);
    expect(pending.list().map((p) => [p.x, p.y, p.colorId])).toEqual([[1, 2, 5], [3, 4, 6]]);
    expect(pending.resolve(a.reqId)).toEqual(a);
    expect(pending.resolve(a.reqId)).toBeUndefined();
    expect(pending.size).toBe(1);
  });

  test("expire removes and returns only entries older than the ttl", () => {
    const pending = new PendingPlacements();
    const old = pending.add({ x: 0, y: 0 }, 1, false, 100);
    pending.add({ x: 1, y: 1 }, 1, false, 5_000);
    expect(pending.expire(10_100, 10_000)).toEqual([old]);
    expect(pending.size).toBe(1);
  });

  test("clear forgets everything", () => {
    const pending = new PendingPlacements();
    pending.add({ x: 0, y: 0 }, 1, true, 0);
    pending.clear();
    expect(pending.size).toBe(0);
    expect(pending.bombs).toBe(0);
  });
});
