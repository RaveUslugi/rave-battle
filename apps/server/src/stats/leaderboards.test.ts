import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { dateKey, DAY_MS } from "@rave/shared";
import { eq } from "drizzle-orm";
import { statsDaily, users } from "../db/schema";
import { createTestDb, insertUser } from "../db/test-db";
import { bootGame } from "../persistence/boot";
import type { GameRuntime } from "../persistence/runtime";
import { Leaderboards, minusDays } from "./leaderboards";

const t = createTestDb();
const NOW = Date.UTC(2026, 9, 8, 12); // 15:00 Moscow
const TZ = "Europe/Moscow";
let runtime: GameRuntime;
type Name = "ann" | "ben" | "cat" | "dan";
let ids: Record<Name, number>;

beforeEach(async () => {
  await t.reset();
  ids = {} as Record<Name, number>;
  for (const name of ["ann", "ben", "cat", "dan"] as const) ids[name] = await insertUser(t.db, name);
  runtime = await bootGame(t.db, { flushIntervalMs: 0, onFatal: () => {} });
});
afterEach(() => runtime.stop());
afterAll(() => t.close());

async function stat(name: Name, daysAgo: number, values: Partial<typeof statsDaily.$inferInsert>) {
  await t.db.insert(statsDaily).values({ userId: ids[name]!, seasonId: runtime.season, date: dateKey(NOW - daysAgo * DAY_MS, TZ), ...values });
}

describe("minusDays", () => {
  test("steps back whole calendar days across months, years and leap days", () => {
    expect(minusDays("2026-10-08", 6)).toBe("2026-10-02");
    expect(minusDays("2026-03-03", 6)).toBe("2026-02-25");
    expect(minusDays("2024-03-02", 2)).toBe("2024-02-29");
    expect(minusDays("2026-01-03", 6)).toBe("2025-12-28");
  });
});

describe("Leaderboards", () => {
  test("sums by period, ranks with ties, skips zeros and reports my place", async () => {
    await stat("ann", 0, { pixels: 5 });
    await stat("ann", 3, { pixels: 10 });
    await stat("ben", 0, { pixels: 7 });
    await stat("cat", 10, { pixels: 50 });
    await stat("dan", 0, { pixels: 7, defused: 1 });
    const boards = new Leaderboards(t.db, runtime, () => NOW);

    const day = await boards.ranking("artists", "day");
    expect(day.map((r) => [r.userId, r.value, r.rank])).toEqual([
      [ids.ben, 7, 1],
      [ids.dan, 7, 1],
      [ids.ann, 5, 3],
    ]);
    const week = await boards.ranking("artists", "week");
    expect(week.map((r) => [r.userId, r.value])).toEqual([
      [ids.ann, 15],
      [ids.ben, 7],
      [ids.dan, 7],
    ]);
    const all = await boards.ranking("artists", "all");
    expect(all[0]).toMatchObject({ userId: ids.cat, value: 50, rank: 1 });
    expect((await boards.ranking("sappers", "all")).map((r) => r.userId)).toEqual([ids.dan]);
  });

  test("the ranking is cached for 30 s", async () => {
    let now = NOW;
    const boards = new Leaderboards(t.db, runtime, () => now);
    await stat("ann", 0, { pixels: 1 });
    expect(await boards.ranking("artists", "all")).toHaveLength(1);
    await stat("ben", 0, { pixels: 2 });
    expect(await boards.ranking("artists", "all")).toHaveLength(1);
    now += 30_000;
    expect(await boards.ranking("artists", "all")).toHaveLength(2);
  });

  test("bans come from the engine and a reset hook shows them without waiting 30 s", async () => {
    for (const name of ["ann", "ben"] as const) {
      await runtime.addPlayer({ userId: ids[name]!, accountCreatedAt: Date.UTC(2020, 0, 1), guildMember: true });
    }
    await stat("ann", 0, { pixels: 1 });
    await stat("ben", 0, { pixels: 2 });
    const boards = new Leaderboards(t.db, runtime, () => NOW);
    expect((await boards.ranking("artists", "all")).map((r) => r.userId)).toEqual([ids.ben, ids.ann]);

    await runtime.run((engine) => engine.setAccess(ids.ben!, { bannedUntil: NOW + DAY_MS }));
    expect((await boards.ranking("artists", "all")).map((r) => r.userId)).toEqual([ids.ben, ids.ann]); // still cached
    boards.invalidate();
    expect((await boards.ranking("artists", "all")).map((r) => r.userId)).toEqual([ids.ann]);

    await runtime.run((engine) => engine.setAccess(ids.ben!, { bannedUntil: NOW - DAY_MS }));
    boards.invalidate();
    expect((await boards.ranking("artists", "all")).map((r) => r.userId)).toEqual([ids.ben, ids.ann]);
  });

  test("users.banned_until without the engine does not affect rankings", async () => {
    await runtime.addPlayer({ userId: ids.ben!, accountCreatedAt: Date.UTC(2020, 0, 1), guildMember: true });
    await stat("ben", 0, { pixels: 2 });
    await t.db
      .update(users)
      .set({ bannedUntil: new Date(NOW + DAY_MS) })
      .where(eq(users.id, ids.ben!));
    const boards = new Leaderboards(t.db, runtime, () => NOW);
    expect((await boards.ranking("artists", "all")).map((r) => r.userId)).toEqual([ids.ben]);
  });

  test("territory comes from the canvas in memory and ignores the period", async () => {
    for (const name of ["ann", "ben"] as const) {
      await runtime.addPlayer({ userId: ids[name]!, accountCreatedAt: Date.UTC(2020, 0, 1), guildMember: true });
    }
    await runtime.run((engine, now) => {
      engine.placePixel(ids.ann!, { x: 1, y: 1, colorId: 3, withBomb: false }, now);
      engine.placePixel(ids.ann!, { x: 2, y: 1, colorId: 3, withBomb: false }, now);
      engine.placePixel(ids.ben!, { x: 3, y: 1, colorId: 3, withBomb: false }, now);
    });
    const boards = new Leaderboards(t.db, runtime, () => NOW);
    const ranking = await boards.ranking("territory", "day");
    expect(ranking.map((r) => [r.userId, r.value])).toEqual([
      [ids.ann, 2],
      [ids.ben, 1],
    ]);
  });
});
