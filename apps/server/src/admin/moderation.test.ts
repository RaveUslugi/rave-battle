import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Rect } from "@rave/shared";
import { createTestDb, insertUser } from "../db/test-db";
import { bootGame } from "../persistence/boot";
import type { GameRuntime } from "../persistence/runtime";
import { ModerationPlanner, summarize, validateArea, type ModerationAction, type PlannedAction } from "./moderation";

const t = createTestDb();
let runtime: GameRuntime;
let target: number;
let ann: number;
let ben: number;
let admin: number;

const NOW = Date.now();
const MIN = 60_000;
// Points in time, oldest first; the rollback period is [t1, t3].
const t0 = NOW - 60 * MIN;
const t1 = NOW - 50 * MIN;
const t2 = NOW - 40 * MIN;
const t2_5 = NOW - 35 * MIN;
const t3 = NOW - 30 * MIN;
const t4 = NOW - 20 * MIN;
const t5 = NOW - 10 * MIN;

beforeEach(async () => {
  await t.reset();
  target = await insertUser(t.db, "target");
  ann = await insertUser(t.db, "ann");
  ben = await insertUser(t.db, "ben");
  admin = await insertUser(t.db, "admin");
  runtime = await bootGame(t.db, { flushIntervalMs: 0, onFatal: () => {} });
  for (const id of [target, ann, ben]) {
    await runtime.addPlayer({ userId: id, accountCreatedAt: Date.UTC(2020, 0, 1), guildMember: true });
    runtime.engine.grantUnlimited(id);
  }
});
afterEach(() => runtime.stop());
afterAll(() => t.close());

const planner = () => new ModerationPlanner({ db: t.db, runtime, now: () => NOW });

async function place(userId: number, x: number, y: number, colorId: number, at: number, withBomb = false) {
  const res = await runtime.run((e) => e.placePixel(userId, { x, y, colorId, withBomb }, at));
  expect(res).toEqual({ ok: true, outcome: "placed" });
}

async function plan(action: ModerationAction): Promise<PlannedAction> {
  const res = await planner().plan(action);
  if (!res.ok) throw new Error(`plan failed: ${res.code}`);
  return res.planned;
}

const rollback = (area: Rect | null = null, removeBombs = false): ModerationAction => ({
  kind: "rollback_player",
  userId: target,
  from: t1,
  to: t3,
  area,
  removeBombs,
});

const cell = (x: number, y: number, lastColor: number, colorId: number, ownerId: number) => ({
  x,
  y,
  expect: { colorId: lastColor, ownerId: target },
  colorId,
  ownerId,
});

describe("rollback_player", () => {
  test("1: A, then T in the period -> back to A", async () => {
    await place(ann, 10, 10, 5, t0);
    await place(target, 10, 10, 7, t2);
    const p = await plan(rollback());
    expect(p.plan).toEqual({ kind: "mod_rollback", writes: [cell(10, 10, 7, 5, ann)], bombs: [] });
    expect(p.meta).toEqual({ action: "rollback_player", targetUserId: target, params: { from: t1, to: t3, area: null, removeBombs: false } });
    expect(summarize(p)).toEqual({ cells: 1, bombs: 0, bbox: { x1: 10, y1: 10, x2: 10, y2: 10 } });
  });

  test("2: T in the period, then A -> the cell is not in the plan", async () => {
    await place(target, 10, 10, 7, t2);
    await place(ann, 10, 10, 5, t4);
    const p = await plan(rollback());
    expect(p.plan.writes).toEqual([]);
    expect(summarize(p)).toEqual({ cells: 0, bombs: 0, bbox: null });
  });

  test("3: A, T, B, T -> back to B", async () => {
    await place(ann, 10, 10, 5, t0);
    await place(target, 10, 10, 7, t2);
    await place(ben, 10, 10, 4, t2_5);
    await place(target, 10, 10, 6, t3);
    const p = await plan(rollback());
    expect(p.plan.writes).toEqual([cell(10, 10, 6, 4, ben)]);
  });

  test("4: T before the period, then T in it -> back to T's older pixel", async () => {
    await place(target, 10, 10, 5, t0);
    await place(target, 10, 10, 7, t2);
    const p = await plan(rollback());
    expect(p.plan.writes).toEqual([cell(10, 10, 7, 5, target)]);
  });

  test("5: T on an empty cell -> empty", async () => {
    await place(target, 10, 10, 7, t2);
    const p = await plan(rollback());
    expect(p.plan.writes).toEqual([cell(10, 10, 7, 0, 0)]);
  });

  test("6: T in the period, then T after it -> the cell is not in the plan", async () => {
    await place(target, 10, 10, 7, t2);
    await place(target, 10, 10, 5, t5);
    const p = await plan(rollback());
    expect(p.plan.writes).toEqual([]);
  });

  test("7: with an area only the cells inside it are planned", async () => {
    await place(target, 10, 10, 7, t2);
    await place(target, 40, 40, 7, t2);
    const p = await plan(rollback({ x1: 0, y1: 0, x2: 20, y2: 20 }));
    expect(p.plan.writes).toEqual([cell(10, 10, 7, 0, 0)]);
    expect(p.meta.params).toEqual({ from: t1, to: t3, area: { x1: 0, y1: 0, x2: 20, y2: 20 }, removeBombs: false });
  });

  test("8: removeBombs takes all of T's bombs, or only those in the area", async () => {
    await place(target, 10, 10, 7, t2, true);
    await place(target, 40, 40, 7, t2, true);
    await place(ann, 12, 12, 5, t2, true);
    const all = await plan(rollback(null, true));
    expect(all.plan.bombs.sort((a, b) => a.x - b.x)).toEqual([
      { x: 10, y: 10 },
      { x: 40, y: 40 },
    ]);
    expect(all.bbox).toEqual({ x1: 10, y1: 10, x2: 40, y2: 40 });
    const inArea = await plan(rollback({ x1: 0, y1: 0, x2: 20, y2: 20 }, true));
    expect(inArea.plan.bombs).toEqual([{ x: 10, y: 10 }]);
    const without = await plan(rollback());
    expect(without.plan.bombs).toEqual([]);
  });

  test("9: a pixel placed after planning is skipped on apply", async () => {
    await place(ann, 10, 10, 5, t0);
    await place(target, 10, 10, 7, t2);
    await place(target, 11, 10, 7, t2);
    const p = await plan(rollback());
    expect(p.plan.writes).toHaveLength(2);
    await place(ann, 10, 10, 3, NOW);
    const res = await runtime.run((e, now) => e.applyModeration(p.plan, { ...p.meta, adminId: admin }, now));
    expect(res).toEqual({ ok: true, cells: 1, skipped: 1, bombs: 0 });
    expect(runtime.engine.canvas.get(10, 10)).toEqual({ colorId: 3, ownerId: ann });
    expect(runtime.engine.canvas.get(11, 10)).toEqual({ colorId: 0, ownerId: 0 });
  });

  test("a cell restored to the target by an earlier moderation is not rolled back again — use clear to_time for multi-player raids", async () => {
    await place(ann, 10, 10, 5, t0);
    await place(target, 10, 10, 7, t2);
    await place(ben, 10, 10, 4, t2_5);
    // Rolling back ben restores target's pixel through a mod_rollback event.
    const pb = await plan({ kind: "rollback_player", userId: ben, from: t1, to: t3, area: null, removeBombs: false });
    expect(pb.plan.writes).toEqual([{ x: 10, y: 10, expect: { colorId: 4, ownerId: ben }, colorId: 7, ownerId: target }]);
    await runtime.run((e) => e.applyModeration(pb.plan, { ...pb.meta, adminId: admin }, t4));
    expect(runtime.engine.canvas.get(10, 10)).toEqual({ colorId: 7, ownerId: target });
    // Documented limitation: the last event is the mod_rollback, so the cell is not planned for target.
    expect((await plan(rollback())).plan.writes).toEqual([]);
  });

  test("an applied rollback is not rolled back again", async () => {
    await place(ann, 10, 10, 5, t0);
    await place(target, 10, 10, 7, t2);
    const p = await plan(rollback());
    await runtime.run((e) => e.applyModeration(p.plan, { ...p.meta, adminId: admin }, t4));
    expect(runtime.engine.canvas.get(10, 10)).toEqual({ colorId: 5, ownerId: ann });
    expect((await plan(rollback())).plan.writes).toEqual([]);
  });
});

describe("clear_area", () => {
  test("fill empties the non-empty cells of the area", async () => {
    await place(ann, 10, 10, 5, t0);
    await place(target, 12, 12, 7, t2);
    await place(ben, 13, 13, 4, t2);
    const area = { x1: 10, y1: 10, x2: 12, y2: 12 };
    const p = await plan({ kind: "clear_area", area, mode: "fill" });
    expect(p.plan).toEqual({
      kind: "mod_clear",
      writes: [
        { x: 10, y: 10, expect: { colorId: 5, ownerId: ann }, colorId: 0, ownerId: 0 },
        { x: 12, y: 12, expect: { colorId: 7, ownerId: target }, colorId: 0, ownerId: 0 },
      ],
      bombs: [],
    });
    expect(p.meta).toEqual({ action: "clear_area", targetUserId: null, params: { area, mode: "fill" } });
    expect(p.bbox).toEqual(area);
  });

  test("to_time restores the state at the moment; cells first painted later become empty", async () => {
    await place(ann, 10, 10, 5, t0);
    await place(target, 10, 10, 7, t2);
    await place(ben, 11, 10, 4, t2);
    await place(ann, 12, 10, 6, t0); // unchanged since t1
    const area = { x1: 0, y1: 0, x2: 20, y2: 20 };
    const p = await plan({ kind: "clear_area", area, mode: "to_time", at: t1 });
    expect(p.plan.kind).toBe("mod_rollback");
    expect(p.plan.writes).toEqual([
      { x: 10, y: 10, expect: { colorId: 7, ownerId: target }, colorId: 5, ownerId: ann },
      { x: 11, y: 10, expect: { colorId: 4, ownerId: ben }, colorId: 0, ownerId: 0 },
    ]);
    expect(p.meta).toEqual({ action: "clear_area", targetUserId: null, params: { area, mode: "to_time", at: t1 } });
  });

  test("to_time skips cells already back at their old state and cells outside the area", async () => {
    await place(ann, 10, 10, 5, t0);
    await place(target, 10, 10, 7, t2);
    await place(ann, 10, 10, 5, t3);
    await place(target, 30, 30, 7, t2);
    const p = await plan({ kind: "clear_area", area: { x1: 0, y1: 0, x2: 20, y2: 20 }, mode: "to_time", at: t1 });
    expect(p.plan.writes).toEqual([]);
  });
});

describe("remove_bombs", () => {
  test("by owner and by area", async () => {
    await place(target, 10, 10, 7, t2, true);
    await place(target, 40, 40, 7, t2, true);
    await place(ann, 12, 12, 5, t2, true);
    const byOwner = await plan({ kind: "remove_bombs", userId: target });
    expect(byOwner.plan.writes).toEqual([]);
    expect(byOwner.plan.bombs.sort((a, b) => a.x - b.x)).toEqual([
      { x: 10, y: 10 },
      { x: 40, y: 40 },
    ]);
    expect(byOwner.meta).toEqual({ action: "remove_bombs", targetUserId: target, params: { userId: target } });

    const area = { x1: 0, y1: 0, x2: 20, y2: 20 };
    const byArea = await plan({ kind: "remove_bombs", area });
    expect(byArea.plan.bombs.sort((a, b) => a.x - b.x)).toEqual([
      { x: 10, y: 10 },
      { x: 12, y: 12 },
    ]);
    expect(byArea.meta).toEqual({ action: "remove_bombs", targetUserId: null, params: { area } });
    expect(summarize(byArea)).toEqual({ cells: 0, bombs: 2, bbox: null });

    const res = await runtime.run((e, now) => e.applyModeration(byArea.plan, { ...byArea.meta, adminId: admin }, now));
    expect(res).toEqual({ ok: true, cells: 0, skipped: 0, bombs: 2 });
    expect(runtime.engine.bombs.ownedBy(target).map((b) => b.x)).toEqual([40]);
  });
});

describe("rejections", () => {
  const canvas = { width: 512, height: 512 };

  test("validateArea", () => {
    expect(validateArea({ x1: 0, y1: 0, x2: 255, y2: 255 }, canvas)).toBeNull();
    expect(validateArea({ x1: 0, y1: 0, x2: 256, y2: 255 }, canvas)).toBe("area_too_large");
    expect(validateArea({ x1: 0, y1: 0, x2: 512, y2: 0 }, canvas)).toBe("bad_area");
    expect(validateArea({ x1: -1, y1: 0, x2: 0, y2: 0 }, canvas)).toBe("bad_area");
    expect(validateArea({ x1: 5, y1: 0, x2: 4, y2: 0 }, canvas)).toBe("bad_area");
    expect(validateArea({ x1: 0.5, y1: 0, x2: 4, y2: 0 }, canvas)).toBe("bad_area");
  });

  test("whole-canvas rollback over the cell cap -> too_many_cells", async () => {
    await place(target, 1, 1, 7, t2);
    await place(target, 2, 1, 7, t2);
    await place(target, 3, 1, 7, t2);
    const cap2 = new ModerationPlanner({ db: t.db, runtime, now: () => NOW, maxRollbackCells: 2 });
    expect(await cap2.plan(rollback())).toEqual({ ok: false, code: "too_many_cells" });
    const cap3 = new ModerationPlanner({ db: t.db, runtime, now: () => NOW, maxRollbackCells: 3 });
    const res = await cap3.plan(rollback());
    expect(res.ok).toBe(true);
  });

  test("plan returns error codes", async () => {
    const { width, height } = runtime.engine.canvas;
    const p = planner();
    expect(await p.plan({ kind: "clear_area", area: { x1: 0, y1: 0, x2: 256, y2: 255 }, mode: "fill" })).toEqual({ ok: false, code: "area_too_large" });
    expect(await p.plan({ kind: "clear_area", area: { x1: 0, y1: 0, x2: width, y2: height }, mode: "fill" })).toEqual({ ok: false, code: "bad_area" });
    expect(await p.plan({ kind: "remove_bombs", area: { x1: 0, y1: height, x2: 1, y2: height } })).toEqual({ ok: false, code: "bad_area" });
    expect(await p.plan({ ...rollback(), from: t3, to: t1 } as ModerationAction)).toEqual({ ok: false, code: "bad_period" });
    expect(await p.plan({ ...rollback(), to: NOW + 2 * MIN } as ModerationAction)).toEqual({ ok: false, code: "bad_period" });
    expect(await p.plan({ kind: "clear_area", area: { x1: 0, y1: 0, x2: 1, y2: 1 }, mode: "to_time", at: NOW + 2 * MIN })).toEqual({
      ok: false,
      code: "bad_period",
    });
    expect(await p.plan({ ...rollback(), userId: 9999 } as ModerationAction)).toEqual({ ok: false, code: "not_found" });
    expect(await p.plan({ kind: "remove_bombs", userId: 9999 })).toEqual({ ok: false, code: "not_found" });
  });
});
