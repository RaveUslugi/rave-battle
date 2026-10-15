import { DAY_MS, dateKey } from "@rave/shared";
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { bombs, playerState, statsDaily, users } from "../db/schema";
import { minusDays } from "../stats/leaderboards";
import type { GameRuntime } from "../persistence/runtime";

export const PLAYER_FILTERS = ["all", "online", "banned", "new", "muted"] as const;
export type PlayerFilter = (typeof PLAYER_FILTERS)[number];
export const PLAYER_SORTS = ["pixels7d", "coins", "activeBombs", "lastSeen", "name", "registered"] as const;
export type PlayerSort = (typeof PLAYER_SORTS)[number];
export const PLAYERS_PAGE = 50;

export interface PlayerRow {
  id: number;
  name: string;
  discordId: string;
  online: boolean;
  banned: boolean;
  muted: boolean;
  /** Registered in the last 24 hours. */
  isNew: boolean;
  pixels7d: number;
  /** Null when the user never entered the game. */
  coins: number | null;
  activeBombs: number;
  lastSeenAt: number | null;
  createdAt: number;
}

export interface PlayerList {
  rows: PlayerRow[];
  /** Rows matching the filter. */
  total: number;
  /** Size of every filter, for the filter chips. */
  counts: Record<PlayerFilter, number>;
  page: number;
  pageSize: number;
}

export interface PlayerListDeps {
  db: Db;
  runtime: GameRuntime;
  onlineUserIds: () => Set<number>;
  now?: () => number;
}

/** Paged, filtered and sorted player table for the admin. */
export class PlayerListService {
  private readonly now: () => number;

  constructor(private readonly deps: PlayerListDeps) {
    this.now = deps.now ?? Date.now;
  }

  async list(input: { filter: PlayerFilter; sort: PlayerSort; dir: "asc" | "desc"; page: number }): Promise<PlayerList> {
    const { db, runtime } = this.deps;
    const season = runtime.season;
    const now = this.now();
    const online = [...this.deps.onlineUserIds()];
    const filters = this.filters(now, online);

    const today = dateKey(now, runtime.engine.config.daily.timezone);
    const pixels = db
      .select({ userId: statsDaily.userId, pixels: sql<number>`sum(${statsDaily.pixels})`.mapWith(Number).as("pixels") })
      .from(statsDaily)
      .where(and(eq(statsDaily.seasonId, season), gte(statsDaily.date, minusDays(today, 6))))
      .groupBy(statsDaily.userId)
      .as("p");
    const active = db
      .select({ ownerId: bombs.ownerId, n: count().as("n") })
      .from(bombs)
      .where(and(eq(bombs.seasonId, season), isNull(bombs.removedAt)))
      .groupBy(bombs.ownerId)
      .as("b");

    const pixels7d = sql<number>`coalesce(${pixels.pixels}, 0)`.mapWith(Number);
    const activeBombs = sql<number>`coalesce(${active.n}, 0)`.mapWith(Number);
    const orderKey: Record<PlayerSort, SQL> = {
      pixels7d: sql`coalesce(${pixels.pixels}, 0)`,
      coins: sql`${playerState.coins}`,
      activeBombs: sql`coalesce(${active.n}, 0)`,
      lastSeen: sql`${users.lastSeenAt}`,
      name: sql`lower(${users.username})`,
      registered: sql`${users.createdAt}`,
    };
    const order = input.dir === "asc" ? sql`${orderKey[input.sort]} asc nulls last` : sql`${orderKey[input.sort]} desc nulls last`;

    const where = filters[input.filter];
    const [rows, totals] = await Promise.all([
      db
        .select({
          id: users.id,
          name: users.username,
          discordId: users.discordId,
          bannedUntil: users.bannedUntil,
          chatMutedUntil: users.chatMutedUntil,
          lastSeenAt: users.lastSeenAt,
          createdAt: users.createdAt,
          coins: playerState.coins,
          pixels7d,
          activeBombs,
        })
        .from(users)
        .leftJoin(playerState, and(eq(playerState.userId, users.id), eq(playerState.seasonId, season)))
        .leftJoin(pixels, eq(pixels.userId, users.id))
        .leftJoin(active, eq(active.ownerId, users.id))
        .where(where)
        .orderBy(order, input.dir === "asc" ? asc(users.id) : desc(users.id))
        .limit(PLAYERS_PAGE)
        .offset(input.page * PLAYERS_PAGE),
      Promise.all(PLAYER_FILTERS.map(async (f) => [f, (await db.select({ n: count() }).from(users).where(filters[f]))[0]?.n ?? 0] as const)),
    ]);
    const counts = Object.fromEntries(totals) as Record<PlayerFilter, number>;
    const onlineSet = new Set(online);
    return {
      rows: rows.map((r) => ({
        id: r.id,
        name: r.name,
        discordId: r.discordId,
        online: onlineSet.has(r.id),
        banned: r.bannedUntil !== null && r.bannedUntil.getTime() > now,
        muted: r.chatMutedUntil !== null && r.chatMutedUntil.getTime() > now,
        isNew: r.createdAt.getTime() > now - DAY_MS,
        pixels7d: r.pixels7d,
        coins: r.coins,
        activeBombs: r.activeBombs,
        lastSeenAt: r.lastSeenAt?.getTime() ?? null,
        createdAt: r.createdAt.getTime(),
      })),
      total: counts[input.filter],
      counts,
      page: input.page,
      pageSize: PLAYERS_PAGE,
    };
  }

  private filters(now: number, online: number[]): Record<PlayerFilter, SQL | undefined> {
    const at = new Date(now);
    return {
      all: undefined,
      online: online.length > 0 ? inArray(users.id, online) : sql`false`,
      banned: gt(users.bannedUntil, at),
      new: gt(users.createdAt, new Date(now - DAY_MS)),
      muted: gt(users.chatMutedUntil, at),
    };
  }
}
