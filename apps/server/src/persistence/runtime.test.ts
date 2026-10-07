import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, type Db } from "../db/client";
import { chunkSnapshots, pixelEvents, playerState } from "../db/schema";
import { createTestDb, insertUser, TEST_DATABASE_URL } from "../db/test-db";
import { DAY_MS, makeEngine, T0 } from "../engine/test-utils";
import { loadGame } from "./load-game";
import { GameRuntime } from "./runtime";

const t = createTestDb();
let clock = T0;
let a = 0;

beforeEach(async () => {
  await t.reset();
  clock = T0;
  a = await insertUser(t.db, "a");
});
afterAll(() => t.close());

async function boot(options: { snapshotIntervalMs?: number } = {}) {
  const { engine, seasonId, replayedChunks } = await loadGame(t.db, clock);
  const fatal: unknown[] = [];
  const runtime = new GameRuntime(engine, t.db, {
    seasonId,
    now: () => clock,
    flushIntervalMs: 0,
    snapshotIntervalMs: options.snapshotIntervalMs ?? 60_000,
    dirtyChunks: replayedChunks,
    onFatal: (error) => fatal.push(error),
  });
  return { engine, runtime, fatal };
}

const pixel = (x: number, y: number, colorId = 3) => ({ x, y, colorId, withBomb: false });

describe("GameRuntime", () => {
  test("addPlayer persists the new player", async () => {
    const { runtime } = await boot();
    const player = await runtime.addPlayer({ userId: a, accountCreatedAt: T0 - 365 * DAY_MS, guildMember: true });
    expect(player.coins).toBe(100);
    const rows = await t.db.select().from(playerState);
    expect(rows.map((r) => [r.userId, r.coins])).toEqual([[a, 100]]);
  });

  test("run resolves with the command result after it is committed", async () => {
    const { runtime, fatal } = await boot();
    await runtime.addPlayer({ userId: a, accountCreatedAt: T0 - 365 * DAY_MS, guildMember: true });
    const results = await Promise.all([
      runtime.run((engine, now) => engine.placePixel(a, pixel(1, 1), now)),
      runtime.run((engine, now) => engine.placePixel(a, pixel(-1, 1), now)),
    ]);
    expect(results).toEqual([{ ok: true, outcome: "placed" }, { ok: false, code: "out_of_bounds" }]);
    expect(await t.db.select().from(pixelEvents)).toHaveLength(1);
    const [state] = await t.db.select().from(playerState);
    expect(state?.coins).toBe(101);
    expect(fatal).toEqual([]);
  });

  test("forced snapshot writes each dirty chunk once", async () => {
    const { runtime } = await boot();
    await runtime.addPlayer({ userId: a, accountCreatedAt: T0 - 365 * DAY_MS, guildMember: true });
    await runtime.run((engine, now) => engine.placePixel(a, pixel(1, 1), now));
    await runtime.run((engine, now) => engine.placePixel(a, pixel(300, 300), now));
    await runtime.flush({ snapshot: true });
    await runtime.flush({ snapshot: true });
    const snaps = await t.db.select().from(chunkSnapshots);
    expect(snaps.map((s) => `${s.cx}:${s.cy}`).sort()).toEqual(["0:0", "1:1"]);
  });

  test("snapshots are taken automatically after the interval", async () => {
    const { runtime } = await boot({ snapshotIntervalMs: 1000 });
    await runtime.addPlayer({ userId: a, accountCreatedAt: T0 - 365 * DAY_MS, guildMember: true });
    await runtime.run((engine, now) => engine.placePixel(a, pixel(1, 1), now));
    expect(await t.db.select().from(chunkSnapshots)).toHaveLength(0);
    clock += 1000;
    await runtime.run((engine, now) => engine.placePixel(a, pixel(2, 1), now));
    expect(await t.db.select().from(chunkSnapshots)).toHaveLength(1);
  });

  test("a failed commit rejects waiting commands, calls onFatal once and stops the runtime", async () => {
    const broken = createDb(TEST_DATABASE_URL);
    await broken.close();
    const { engine, addPlayer } = makeEngine();
    addPlayer(a);
    const fatal: unknown[] = [];
    const runtime = new GameRuntime(engine, broken.db, { seasonId: 1, now: () => clock, flushIntervalMs: 0, onFatal: (e) => fatal.push(e) });

    await expect(runtime.run((e, now) => e.placePixel(a, pixel(1, 1), now))).rejects.toThrow();
    expect(fatal).toHaveLength(1);
    await expect(runtime.run((e, now) => e.placePixel(a, pixel(2, 1), now))).rejects.toThrow("stopped");
    expect(fatal).toHaveLength(1);
  });

  test("a failed commit also rejects commands queued behind it and later flushes", async () => {
    const failing = {
      transaction: () => new Promise((_, reject) => setTimeout(() => reject(new Error("commit failed")), 20)),
    } as unknown as Db;
    const { engine, addPlayer } = makeEngine();
    addPlayer(a);
    const fatal: unknown[] = [];
    const runtime = new GameRuntime(engine, failing, { seasonId: 1, now: () => clock, flushIntervalMs: 0, onFatal: (e) => fatal.push(e) });

    const first = runtime.run((e, now) => e.placePixel(a, pixel(1, 1), now));
    await Bun.sleep(5);
    const second = runtime.run((e, now) => e.placePixel(a, pixel(2, 1), now));

    const [r1, r2] = await Promise.allSettled([first, second]);
    expect(r1).toMatchObject({ status: "rejected", reason: new Error("commit failed") });
    expect(r2.status).toBe("rejected");
    expect(fatal).toHaveLength(1);
    await expect(runtime.flush()).rejects.toThrow();
  });

  test("run rejects instead of throwing when the command throws", async () => {
    const { runtime } = await boot();
    let result: Promise<unknown> | undefined;
    expect(() => {
      result = runtime.run(() => {
        throw new Error("bad command");
      });
    }).not.toThrow();
    await expect(result).rejects.toThrow("bad command");
  });
});
