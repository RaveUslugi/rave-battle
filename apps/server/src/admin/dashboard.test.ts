import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { dateKey } from "@rave/shared";
import { eq } from "drizzle-orm";
import { statsDaily, users } from "../db/schema";
import { createTestDb, insertUser } from "../db/test-db";
import { bootGame } from "../persistence/boot";
import type { GameRuntime } from "../persistence/runtime";
import { Metrics } from "../net/metrics";
import { UserDirectory } from "../net/user-directory";
import { HourlyStats } from "../stats/hourly";
import { DashboardService } from "./dashboard";
import { PlayerListService } from "./players";

const t = createTestDb();
const H0 = Date.UTC(2026, 9, 15, 10);
let clock = H0 + 10 * 60_000;
let runtime: GameRuntime;
let hourly: HourlyStats;
let dir: UserDirectory;
let ann: number;
let bob: number;
let online = new Set<number>();

const place = (userId: number, x: number, withBomb = false) => runtime.run((engine, now) => engine.placePixel(userId, { x, y: 0, colorId: 3, withBomb }, now));

async function join(name: string, discordCreatedAt = new Date("2020-01-01T00:00:00Z")): Promise<number> {
  const id = await insertUser(t.db, name, discordCreatedAt);
  await t.db
    .update(users)
    .set({ createdAt: new Date(clock) })
    .where(eq(users.id, id));
  dir.set(id, name);
  await runtime.addPlayer({ userId: id, accountCreatedAt: discordCreatedAt.getTime(), guildMember: true });
  return id;
}

beforeEach(async () => {
  await t.reset();
  clock = H0 + 10 * 60_000;
  online = new Set();
  dir = new UserDirectory();
  hourly = undefined as unknown as HourlyStats;
  runtime = await bootGame(t.db, { flushIntervalMs: 0, onFatal: () => {}, now: () => clock, onCommit: (events) => hourly?.record(events) });
  hourly = new HourlyStats(t.db, runtime.season, () => clock);
  ann = await join("ann");
  bob = await join("bob");
});
afterEach(() => runtime.stop());
afterAll(() => t.close());

describe("DashboardService", () => {
  const make = (metrics?: Metrics) =>
    new DashboardService({
      db: t.db,
      runtime,
      users: dir,
      hourly,
      metrics,
      onlineCount: () => 7,
      recentModeration: async () => [],
      startedAt: H0,
      now: () => clock,
    });

  test("totals, hourly series, bombs, coins and the most active players", async () => {
    await place(ann, 1);
    await place(ann, 2, true);
    await place(bob, 3);
    // bob steps on ann's bomb.
    await place(bob, 2);
    await runtime.run((engine, now) => engine.buyItem(ann, "detector", now));
    hourly.observeOnline(9);
    const metrics = new Metrics();
    metrics.track("place", { ok: true });
    metrics.commitMs.observe(12);

    const d = await make(metrics).get("24h");
    expect(d.since).toBe(H0 - 23 * 3_600_000);
    expect(d.hours).toHaveLength(24);
    expect(d.hours.at(-1)).toEqual({ hour: H0, pixels: 3, online: 9, explosions: 1, defuses: 0 });
    expect(d).toMatchObject({ pixels: 3, explosions: 1, defuses: 0, activeBombs: 0, online: { now: 7, peak: 9 } });
    expect(d.coins.spent).toMatchObject({ detector: 40, penalty: 10 });
    expect(d.coins.minted).toMatchObject({ pixels: 3, bombBonus: 15 });
    const players = [...runtime.engine.players.all()];
    expect(d.coins.inCirculation).toBe(players.reduce((s, p) => s + p.coins, 0));
    expect(d.players).toEqual({ new: 2, tooYoung: 0 });
    expect(d.topActive).toEqual([
      { user: { id: ann, name: "ann" }, pixels: 2, bombsPlaced: 1, explosionsCaused: 1 },
      { user: { id: bob, name: "bob" }, pixels: 1, bombsPlaced: 0, explosionsCaused: 0 },
    ]);
    expect(d.server).toMatchObject({ uptimeSec: 600, commitP99Ms: 20, actions: 1, rejects: 0 });
  });

  test("periods: the last hour is two buckets, a week is 168", async () => {
    expect((await make().get("1h")).hours.map((h) => h.hour)).toEqual([H0 - 3_600_000, H0]);
    expect((await make().get("7d")).hours).toHaveLength(168);
  });

  test("counts players whose Discord account was too young when they registered", async () => {
    await join("kid", new Date(clock - 5 * 86_400_000));
    expect((await make().get("24h")).players).toEqual({ new: 3, tooYoung: 1 });
  });
});

describe("PlayerListService", () => {
  const make = () => new PlayerListService({ db: t.db, runtime, onlineUserIds: () => online, now: () => clock });
  const list = (
    filter: "all" | "online" | "banned" | "new" | "muted" = "all",
    sort: "pixels7d" | "coins" | "name" = "pixels7d",
    dir: "asc" | "desc" = "desc",
  ) => make().list({ filter, sort, dir, page: 0 });

  test("rows with pixels for 7 days, coins and active bombs, sorted", async () => {
    const today = dateKey(clock, runtime.engine.config.daily.timezone);
    await t.db.insert(statsDaily).values([
      { userId: bob, seasonId: runtime.season, date: today, pixels: 40 },
      { userId: ann, seasonId: runtime.season, date: today, pixels: 5 },
      { userId: ann, seasonId: runtime.season, date: "2020-01-01", pixels: 999 },
    ]);
    await place(ann, 1, true);
    const res = await list();
    expect(res.rows.map((r) => [r.name, r.pixels7d, r.activeBombs])).toEqual([
      ["bob", 40, 0],
      // 5 from the seeded row plus the pixel placed above.
      ["ann", 6, 1],
    ]);
    expect(res.rows[0]).toMatchObject({ coins: 100, online: false, banned: false, muted: false, isNew: true });
    expect((await list("all", "name", "asc")).rows.map((r) => r.name)).toEqual(["ann", "bob"]);
    expect(res).toMatchObject({ total: 2, page: 0, pageSize: 50 });
  });

  test("filters and their counts", async () => {
    online = new Set([bob]);
    await t.db
      .update(users)
      .set({ bannedUntil: new Date(clock + 60_000) })
      .where(eq(users.id, ann));
    await t.db
      .update(users)
      .set({ chatMutedUntil: new Date(clock + 60_000) })
      .where(eq(users.id, bob));
    const old = await insertUser(t.db, "old");
    await t.db
      .update(users)
      .set({ createdAt: new Date(clock - 2 * 86_400_000) })
      .where(eq(users.id, old));
    const res = await list();
    expect(res.counts).toEqual({ all: 3, online: 1, banned: 1, new: 2, muted: 1 });
    expect((await list("online")).rows.map((r) => r.name)).toEqual(["bob"]);
    expect((await list("banned")).rows.map((r) => r.name)).toEqual(["ann"]);
    expect((await list("muted")).rows.map((r) => r.name)).toEqual(["bob"]);
    expect((await list("new", "name", "asc")).rows.map((r) => r.name)).toEqual(["ann", "bob"]);
    // Never entered the game: no coins.
    expect((await list("all", "name", "asc")).rows.find((r) => r.name === "old")?.coins).toBeNull();
    online = new Set();
    expect((await list("online")).rows).toEqual([]);
  });
});
