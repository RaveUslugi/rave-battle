import { DAY_MS, type UserRef } from "@rave/shared";
import { and, asc, count, desc, eq, gte, inArray, max, type SQL, sql, sum } from "drizzle-orm";
import type { Db } from "../db/client";
import { bombs, pixelEvents, statsHourly, users } from "../db/schema";
import type { Metrics } from "../net/metrics";
import type { UserDirectory } from "../net/user-directory";
import type { GameRuntime } from "../persistence/runtime";
import { HOURLY_COUNTERS, type HourlyStats, hourStart } from "../stats/hourly";
import type { ModLogEntry } from "./service";

export const DASHBOARD_PERIODS = ["1h", "24h", "7d"] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];
const PERIOD_MS: Record<DashboardPeriod, number> = { "1h": 3_600_000, "24h": DAY_MS, "7d": 7 * DAY_MS };
const TOP_ACTIVE = 5;
const RECENT_MODERATION = 5;

type Totals = Record<(typeof HOURLY_COUNTERS)[number], number>;

export interface Dashboard {
  period: DashboardPeriod;
  /** Start of the period, epoch ms (hour-aligned). */
  since: number;
  online: { now: number; peak: number };
  pixels: number;
  explosions: number;
  defuses: number;
  activeBombs: number;
  coins: {
    minted: { pixels: number; daily: number; bombBonus: number; defuse: number; admin: number };
    spent: { bomb: number; detector: number; defuser: number; color: number; boost: number; penalty: number; admin: number };
    /** Sum of every player's balance right now. */
    inCirculation: number;
  };
  /** One point per clock hour of the period, oldest first; hours without activity are zeros. */
  hours: Array<{ hour: number; pixels: number; online: number; explosions: number; defuses: number }>;
  players: { new: number; tooYoung: number };
  /** Most active in the last hour. */
  topActive: Array<{ user: UserRef; pixels: number; bombsPlaced: number; explosionsCaused: number }>;
  recentModeration: ModLogEntry[];
  server: { uptimeSec: number; commitP99Ms: number | null; actions: number; rejects: number; rateLimited: number; memoryMb: number };
}

export interface DashboardDeps {
  db: Db;
  runtime: GameRuntime;
  users: UserDirectory;
  hourly: HourlyStats;
  onlineCount: () => number;
  recentModeration: (limit: number) => Promise<ModLogEntry[]>;
  metrics?: Metrics;
  startedAt?: number;
  now?: () => number;
}

export class DashboardService {
  private readonly now: () => number;
  private readonly startedAt: number;

  constructor(private readonly deps: DashboardDeps) {
    this.now = deps.now ?? Date.now;
    this.startedAt = deps.startedAt ?? this.now();
  }

  async get(period: DashboardPeriod): Promise<Dashboard> {
    const { db, runtime } = this.deps;
    const season = runtime.season;
    const now = this.now();
    // Everything committed so far is in the counts.
    await runtime.flush();
    await this.deps.hourly.flush();
    const since = hourStart(now - PERIOD_MS[period]) + (period === "1h" ? 0 : 3_600_000);
    const inPeriod = and(eq(statsHourly.seasonId, season), gte(statsHourly.hour, new Date(since)));

    const sums: Record<string, SQL<number>> = Object.fromEntries(
      HOURLY_COUNTERS.map((k) => [k, sql<number>`coalesce(${sum(statsHourly[k])}, 0)`.mapWith(Number)]),
    );
    const [[totals], [peak], hourRows] = await Promise.all([
      db.select(sums).from(statsHourly).where(inPeriod),
      db
        .select({ peak: max(statsHourly.onlinePeak) })
        .from(statsHourly)
        .where(inPeriod),
      db
        .select({
          hour: statsHourly.hour,
          pixels: statsHourly.pixels,
          online: statsHourly.onlinePeak,
          explosions: statsHourly.explosions,
          defuses: statsHourly.defuses,
        })
        .from(statsHourly)
        .where(inPeriod)
        .orderBy(asc(statsHourly.hour)),
    ]);
    const t = totals as unknown as Totals;
    const byHour = new Map(hourRows.map((r) => [r.hour.getTime(), r]));
    const hours: Dashboard["hours"] = [];
    for (let h = since; h <= hourStart(now); h += 3_600_000) {
      const r = byHour.get(h);
      hours.push({ hour: h, pixels: r?.pixels ?? 0, online: r?.online ?? 0, explosions: r?.explosions ?? 0, defuses: r?.defuses ?? 0 });
    }

    const engine = runtime.engine;
    let inCirculation = 0;
    for (const p of engine.players.all()) inCirculation += p.coins;
    const onlineNow = this.deps.onlineCount();
    const metrics = this.deps.metrics;
    return {
      period,
      since,
      online: { now: onlineNow, peak: Math.max(peak?.peak ?? 0, onlineNow) },
      pixels: t.pixels,
      explosions: t.explosions,
      defuses: t.defuses,
      activeBombs: engine.bombs.size,
      coins: {
        minted: { pixels: t.mintedPixels, daily: t.mintedDaily, bombBonus: t.mintedBombBonus, defuse: t.mintedDefuse, admin: t.mintedAdmin },
        spent: {
          bomb: t.spentBomb,
          detector: t.spentDetector,
          defuser: t.spentDefuser,
          color: t.spentColor,
          boost: t.spentBoost,
          penalty: t.spentPenalty,
          admin: t.spentAdmin,
        },
        inCirculation,
      },
      hours,
      players: await this.newPlayers(since),
      topActive: await this.topActive(now - 3_600_000),
      recentModeration: await this.deps.recentModeration(RECENT_MODERATION),
      server: {
        uptimeSec: Math.round((now - this.startedAt) / 1000),
        commitP99Ms: metrics?.commitMs.quantile(0.99) ?? null,
        actions: metrics?.actions.total() ?? 0,
        rejects: metrics?.rejects.total() ?? 0,
        rateLimited: metrics?.rateLimited.total() ?? 0,
        memoryMb: Math.round(process.memoryUsage().rss / 1_048_576),
      },
    };
  }

  /** Registered in the period, and those whose Discord account was too young to play when they did. */
  private async newPlayers(since: number): Promise<Dashboard["players"]> {
    const minAgeMs = this.deps.runtime.engine.config.access.minAccountAgeDays * DAY_MS;
    const [row] = await this.deps.db
      .select({
        total: count(),
        tooYoung: sql<number>`count(*) filter (where ${users.createdAt} - ${users.discordCreatedAt} < make_interval(secs => ${minAgeMs / 1000}))`.mapWith(
          Number,
        ),
      })
      .from(users)
      .where(gte(users.createdAt, new Date(since)));
    return { new: row?.total ?? 0, tooYoung: row?.tooYoung ?? 0 };
  }

  private async topActive(since: number): Promise<Dashboard["topActive"]> {
    const { db, runtime, users: dir } = this.deps;
    const season = runtime.season;
    const after = new Date(since);
    const rows = await db
      .select({ userId: pixelEvents.userId, pixels: count() })
      .from(pixelEvents)
      .where(and(eq(pixelEvents.seasonId, season), eq(pixelEvents.kind, "place"), gte(pixelEvents.createdAt, after)))
      .groupBy(pixelEvents.userId)
      .orderBy(desc(count()), asc(pixelEvents.userId))
      .limit(TOP_ACTIVE);
    const active = rows.filter((r): r is { userId: number; pixels: number } => r.userId !== null);
    const ids = active.map((r) => r.userId);
    if (ids.length === 0) return [];
    const [placed, caused] = await Promise.all([
      db
        .select({ userId: bombs.ownerId, n: count() })
        .from(bombs)
        .where(and(eq(bombs.seasonId, season), gte(bombs.createdAt, after), inArray(bombs.ownerId, ids)))
        .groupBy(bombs.ownerId),
      db
        .select({ userId: bombs.ownerId, n: count() })
        .from(bombs)
        .where(and(eq(bombs.seasonId, season), eq(bombs.removedReason, "exploded"), gte(bombs.removedAt, after), inArray(bombs.ownerId, ids)))
        .groupBy(bombs.ownerId),
    ]);
    const placedBy = new Map(placed.map((r) => [r.userId, r.n]));
    const causedBy = new Map(caused.map((r) => [r.userId, r.n]));
    return active.map(({ userId: id, pixels }) => ({
      user: dir.ref(id),
      pixels,
      bombsPlaced: placedBy.get(id) ?? 0,
      explosionsCaused: causedBy.get(id) ?? 0,
    }));
  }
}
