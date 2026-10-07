import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createTestDb, insertUser } from "../db/test-db";
import { T0 } from "../engine/test-utils";
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
});
