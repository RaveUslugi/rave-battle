import { describe, expect, test } from "bun:test";
import { eventsOf, makeEngine, T0 } from "./test-utils";
import type { ModerationMeta, ModerationPlan } from "./types";

const meta = (params: Record<string, unknown> = {}): ModerationMeta => ({
  adminId: 9,
  action: "rollback_player",
  targetUserId: 2,
  params,
});

const rollback = (writes: ModerationPlan["writes"], bombs: ModerationPlan["bombs"] = []): ModerationPlan => ({
  kind: "mod_rollback",
  writes,
  bombs,
});

describe("applyModeration", () => {
  test("applies a write whose expectation matches", () => {
    const { engine, canvas } = makeEngine();
    canvas.set(5, 5, 7, 2);
    const res = engine.applyModeration(
      rollback([{ x: 5, y: 5, expect: { colorId: 7, ownerId: 2 }, colorId: 0, ownerId: 0 }]),
      meta(),
      T0,
    );
    expect(res).toEqual({ ok: true, cells: 1, skipped: 0, bombs: 0 });
    expect(canvas.get(5, 5)).toEqual({ colorId: 0, ownerId: 0 });
    expect(canvas.territoryOf(2)).toBe(0);
    expect(eventsOf(engine.drainEvents(), "pixel")).toEqual([
      { type: "pixel", kind: "mod_rollback", x: 5, y: 5, userId: 0, colorId: 0, prevColorId: 7, prevUserId: 2, at: T0 },
    ]);
  });

  test("skips a write when the cell changed after planning", () => {
    const { engine, canvas } = makeEngine();
    canvas.set(5, 5, 7, 2);
    const plan = rollback([{ x: 5, y: 5, expect: { colorId: 7, ownerId: 2 }, colorId: 0, ownerId: 0 }]);
    canvas.set(5, 5, 4, 3);
    const res = engine.applyModeration(plan, meta(), T0);
    expect(res).toEqual({ ok: true, cells: 0, skipped: 1, bombs: 0 });
    expect(canvas.get(5, 5)).toEqual({ colorId: 4, ownerId: 3 });
    expect(eventsOf(engine.drainEvents(), "pixel")).toEqual([]);
  });

  test("skips out-of-bounds writes", () => {
    const { engine } = makeEngine();
    const res = engine.applyModeration(
      rollback([{ x: -1, y: 0, expect: { colorId: 0, ownerId: 0 }, colorId: 1, ownerId: 1 }]),
      meta(),
      T0,
    );
    expect(res.skipped).toBe(1);
  });

  test("removes listed bombs and ignores cells without one", () => {
    const { engine, bombs } = makeEngine();
    bombs.add({ x: 1, y: 1, ownerId: 2, createdAt: T0 });
    bombs.add({ x: 2, y: 2, ownerId: 2, createdAt: T0 });
    const res = engine.applyModeration(
      rollback([], [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]),
      meta(),
      T0,
    );
    expect(res).toEqual({ ok: true, cells: 0, skipped: 0, bombs: 2 });
    expect(bombs.activeCount(2)).toBe(0);
    expect(eventsOf(engine.drainEvents(), "bomb_removed")).toEqual([
      { type: "bomb_removed", x: 1, y: 1, ownerId: 2, reason: "moderated", removedBy: 9, at: T0 },
      { type: "bomb_removed", x: 2, y: 2, ownerId: 2, reason: "moderated", removedBy: 9, at: T0 },
    ]);
  });

  test("writes exactly one mod_log with params merged with the counts", () => {
    const { engine, canvas } = makeEngine();
    canvas.set(5, 5, 7, 2);
    engine.applyModeration(
      rollback([{ x: 5, y: 5, expect: { colorId: 7, ownerId: 2 }, colorId: 0, ownerId: 0 }]),
      meta({ minutes: 30 }),
      T0,
    );
    expect(eventsOf(engine.drainEvents(), "mod_log")).toEqual([
      {
        type: "mod_log",
        adminId: 9,
        action: "rollback_player",
        targetUserId: 2,
        params: { minutes: 30, cells: 1, skipped: 0, bombs: 0 },
        at: T0,
      },
    ]);
  });

  test("an empty result is still logged", () => {
    const { engine } = makeEngine();
    const res = engine.applyModeration(rollback([]), meta(), T0);
    expect(res).toEqual({ ok: true, cells: 0, skipped: 0, bombs: 0 });
    expect(eventsOf(engine.drainEvents(), "mod_log")).toHaveLength(1);
  });
});
