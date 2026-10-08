import { DAY_MS, dateKey } from "@rave/shared";
import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { statsDaily, users } from "../db/schema";
import type { GameRuntime } from "../persistence/runtime";

export const BOARDS = ["artists", "bombers", "sappers", "kamikaze", "territory"] as const;
export type Board = (typeof BOARDS)[number];
export const PERIODS = ["day", "week", "all"] as const;
export type Period = (typeof PERIODS)[number];

export interface Ranked {
  userId: number;
  value: number;
  /** Competition ranking: equal values share a rank (1, 2, 2, 4). */
  rank: number;
}

const COLUMNS = {
  artists: statsDaily.pixels,
  bombers: statsDaily.bombsTriggered,
  sappers: statsDaily.defused,
  kamikaze: statsDaily.explosionsSuffered,
} as const;

const CACHE_MS = 30_000;

/** Ranks by value, then user id for a stable order. */
function rank(rows: Array<{ userId: number; value: number }>): Ranked[] {
  const sorted = [...rows].sort((a, b) => b.value - a.value || a.userId - b.userId);
  let prev: { value: number; rank: number } | null = null;
  return sorted.map((r, i) => {
    const rank = prev && prev.value === r.value ? prev.rank : i + 1;
    prev = { value: r.value, rank };
    return { ...r, rank };
  });
}

/** Full rankings per board × period, recomputed at most every 30 s (spec 4: "топы кэшируются в памяти"). */
export class Leaderboards {
  private cache = new Map<string, { at: number; ranking: Promise<Ranked[]> }>();

  constructor(
    private readonly db: Db,
    private readonly runtime: GameRuntime,
    private readonly now: () => number = Date.now,
  ) {}

  ranking(board: Board, period: Period): Promise<Ranked[]> {
    // Territory is "right now": one ranking for every period.
    const key = board === "territory" ? "territory" : `${board}:${period}`;
    const now = this.now();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < CACHE_MS) return hit.ranking;
    const ranking = board === "territory" ? Promise.resolve(this.territory(now)) : this.fromStats(board, period, now);
    // A failed query must not stay cached.
    ranking.catch(() => this.cache.delete(key));
    this.cache.set(key, { at: now, ranking });
    return ranking;
  }

  private async fromStats(board: Exclude<Board, "territory">, period: Period, now: number): Promise<Ranked[]> {
    const column = COLUMNS[board];
    const tz = this.runtime.engine.config.daily.timezone;
    const from = period === "day" ? dateKey(now, tz) : period === "week" ? dateKey(now - 6 * DAY_MS, tz) : null;
    const total = sql<number>`sum(${column})::int`;
    const rows = await this.db
      .select({ userId: statsDaily.userId, value: total })
      .from(statsDaily)
      .innerJoin(users, eq(users.id, statsDaily.userId))
      .where(
        and(
          eq(statsDaily.seasonId, this.runtime.season),
          from === null ? undefined : gte(statsDaily.date, from),
          or(isNull(users.bannedUntil), lte(users.bannedUntil, new Date(now))),
        ),
      )
      .groupBy(statsDaily.userId)
      .having(sql`sum(${column}) > 0`)
      .orderBy(desc(total), asc(statsDaily.userId));
    return rank(rows);
  }

  private territory(now: number): Ranked[] {
    const players = this.runtime.engine.players;
    const rows: Array<{ userId: number; value: number }> = [];
    for (const [userId, value] of this.runtime.engine.canvas.territories()) {
      if (userId === 0) continue;
      const banned = players.has(userId) && (players.get(userId).bannedUntil ?? 0) > now;
      if (!banned) rows.push({ userId, value });
    }
    return rank(rows);
  }
}
