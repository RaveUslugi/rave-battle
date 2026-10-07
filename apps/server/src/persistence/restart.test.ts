import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { chunkSnapshots, statsDaily, users } from "../db/schema";
import { createTestDb, insertUser } from "../db/test-db";
import type { GameEngine } from "../engine/engine";
import { T0 } from "../engine/test-utils";
import type { PlayerState } from "../engine/types";
import { PERMANENT_BAN_DATE } from "./codec";
import { loadGame } from "./load-game";
import { GameRuntime } from "./runtime";

const t = createTestDb();
let clock = T0;
let a = 0;
let b = 0;

beforeEach(async () => {
  await t.reset();
  clock = T0;
  a = await insertUser(t.db, "a");
  b = await insertUser(t.db, "b");
});
afterAll(() => t.close());

async function boot() {
  const { engine, seasonId, replayedChunks } = await loadGame(t.db, clock);
  const runtime = new GameRuntime(engine, t.db, {
    seasonId,
    now: () => clock,
    flushIntervalMs: 0,
    dirtyChunks: replayedChunks,
    onFatal: () => {},
  });
  return { engine, runtime };
}

const place = (runtime: GameRuntime, x: number, y: number, colorId: number) =>
  runtime.run((engine, now) => engine.placePixel(a, { x, y, colorId, withBomb: false }, now));

async function bootWithPlayers() {
  const booted = await boot();
  for (const userId of [a, b]) {
    // Same value insertUser() stores in users.discord_created_at, so reloaded players compare equal.
    await booted.runtime.addPlayer({ userId, accountCreatedAt: Date.UTC(2020, 0, 1), guildMember: true });
  }
  return booted;
}

const comparable = (p: PlayerState) => ({ ...p, unlockedColors: [...p.unlockedColors].sort() });
const pl = (x: number, y: number, colorId = 3, withBomb = false) => ({ x, y, colorId, withBomb });

describe("restart", () => {
  test("pixels survive two restarts with snapshots in between", async () => {
    const first = await boot();
    await first.runtime.addPlayer({ userId: a, accountCreatedAt: Date.UTC(2020, 0, 1), guildMember: true });
    await place(first.runtime, 1, 1, 3);
    await first.runtime.flush({ snapshot: true });
    await place(first.runtime, 300, 300, 4);

    const second = await boot();
    expect(second.engine.canvas.get(300, 300)).toEqual({ colorId: 4, ownerId: a });
    await place(second.runtime, 2, 2, 5);
    await second.runtime.flush({ snapshot: true });

    const third = await boot();
    expect(third.engine.canvas.get(300, 300)).toEqual({ colorId: 4, ownerId: a });
    expect(third.engine.canvas.get(1, 1)).toEqual({ colorId: 3, ownerId: a });
    expect(third.engine.canvas.get(2, 2)).toEqual({ colorId: 5, ownerId: a });
    expect(third.engine.canvas.territoryOf(a)).toBe(3);
  });

  test("players, canvas and bombs survive a restart", async () => {
    const first = await bootWithPlayers();
    const run = first.runtime.run.bind(first.runtime);
    await run((e, now) => e.placePixel(a, pl(5, 5, 3, true), now));
    await run((e, now) => e.placePixel(a, pl(7, 7, 6, true), now));
    await run((e, now) => e.placePixel(a, pl(300, 10, 4), now));
    await run((e, now) => e.placePixel(b, pl(5, 5, 9), now));
    await run((e, now) => e.buyItem(b, "bomb", now));
    await run((e, now) => e.claimDaily(a, now));

    const second = await boot();
    for (const [x, y] of [[5, 5], [7, 7], [300, 10]] as const) {
      expect(second.engine.canvas.get(x, y)).toEqual(first.engine.canvas.get(x, y));
    }
    expect(second.engine.canvas.territoryOf(a)).toBe(3);
    expect(second.engine.bombs.get(5, 5)).toBeUndefined();
    expect(second.engine.bombs.get(7, 7)?.ownerId).toBe(a);
    for (const id of [a, b]) {
      expect(comparable(second.engine.players.get(id))).toEqual(comparable(first.engine.players.get(id)));
    }
  });

  test("snapshot plus log replay restores every pixel", async () => {
    const first = await bootWithPlayers();
    const run = first.runtime.run.bind(first.runtime);
    for (const [x, y] of [[0, 0], [1, 0], [2, 0], [300, 300]] as const) {
      await run((e, now) => e.placePixel(a, pl(x, y), now));
    }
    await first.runtime.flush({ snapshot: true });
    await run((e, now) => e.placePixel(a, pl(0, 0, 7), now));
    await run((e, now) => e.placePixel(a, pl(3, 0), now));
    await run((e, now) => e.placePixel(b, pl(301, 300), now));

    expect(await t.db.select().from(chunkSnapshots)).toHaveLength(2);
    const second = await boot();
    for (const [x, y] of [[0, 0], [1, 0], [2, 0], [3, 0], [300, 300], [301, 300]] as const) {
      expect(second.engine.canvas.get(x, y)).toEqual(first.engine.canvas.get(x, y));
    }
    expect(second.engine.canvas.get(0, 0)).toEqual({ colorId: 7, ownerId: a });
    expect(second.engine.canvas.territoryOf(a)).toBe(5);
    expect(second.engine.canvas.territoryOf(b)).toBe(1);
  });

  test("the anti-farm limit survives a restart", async () => {
    const first = await bootWithPlayers();
    const run = first.runtime.run.bind(first.runtime);
    await run((e, now) => e.buyItem(a, "bomb", now));
    for (let x = 0; x < 4; x++) await run((e, now) => e.placePixel(a, pl(x, 0, 3, true), now));
    for (let x = 0; x < 3; x++) {
      await run((e, now) => e.placePixel(b, pl(x, 0, 9), now));
      clock += 60_000;
    }

    const second = await boot();
    const result = await second.runtime.run((e: GameEngine, now) => e.placePixel(b, pl(3, 0, 9), now));
    expect(result.ok && result.outcome).toBe("exploded");
    const [stats] = await t.db.select().from(statsDaily).where(eq(statsDaily.userId, a));
    expect(stats?.bombsTriggered).toBe(3);
  });

  test("a permanent ban is loaded as Infinity and blocks play", async () => {
    await bootWithPlayers();
    await t.db.update(users).set({ bannedUntil: PERMANENT_BAN_DATE }).where(eq(users.id, a));
    const second = await boot();
    expect(second.engine.players.get(a).bannedUntil).toBe(Number.POSITIVE_INFINITY);
    const result = await second.runtime.run((e, now) => e.placePixel(a, pl(1, 1), now));
    expect(result).toEqual({ ok: false, code: "banned" });
  });
});
