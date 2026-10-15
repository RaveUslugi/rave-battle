import type { UserRef } from "@rave/shared";
import { and, count, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { pixelEvents, statsDaily, users } from "../db/schema";
import type { UserDirectory } from "../net/user-directory";
import type { GameRuntime } from "../persistence/runtime";

/** Longest heatmap side in blocks. */
export const HEATMAP_MAX_SIDE = 64;
const PIXEL_CACHE_MS = 5 * 60_000;
const PIXEL_CACHE_SIZE = 1_000;

export interface Heatmap {
  /** Canvas cells per block side. */
  step: number;
  width: number;
  height: number;
  /** Sparse [blockIndex, placedPixels]; blockIndex = by * width + bx. */
  cells: Array<[number, number]>;
}

export interface Profile {
  user: UserRef;
  joinedAt: number;
  banned: boolean;
  totals: { pixels: number; bombsTriggered: number; defused: number; explosionsSuffered: number; selfExplosions: number };
  territory: number;
  activeBombs: number;
  favoriteColor: number | null;
  heatmap: Heatmap;
}

type PixelAggregates = Pick<Profile, "favoriteColor" | "heatmap">;

/** Public player profiles. Never exposes coins, inventory or bomb positions. */
export class Profiles {
  private pixelCache = new Map<number, { at: number; data: Promise<PixelAggregates> }>();

  constructor(
    private readonly db: Db,
    private readonly runtime: GameRuntime,
    private readonly users: UserDirectory,
    private readonly now: () => number = Date.now,
  ) {}

  async profile(userId: number): Promise<Profile | null> {
    const [user] = await this.db.select({ createdAt: users.createdAt, bannedUntil: users.bannedUntil }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return null;
    const season = this.runtime.season;
    const [totals] = await this.db
      .select({
        pixels: sql<number>`coalesce(sum(${statsDaily.pixels}), 0)::int`,
        bombsTriggered: sql<number>`coalesce(sum(${statsDaily.bombsTriggered}), 0)::int`,
        defused: sql<number>`coalesce(sum(${statsDaily.defused}), 0)::int`,
        explosionsSuffered: sql<number>`coalesce(sum(${statsDaily.explosionsSuffered}), 0)::int`,
        selfExplosions: sql<number>`coalesce(sum(${statsDaily.selfExplosions}), 0)::int`,
      })
      .from(statsDaily)
      .where(and(eq(statsDaily.userId, userId), eq(statsDaily.seasonId, season)));
    const engine = this.runtime.engine;
    return {
      user: this.users.ref(userId),
      joinedAt: user.createdAt.getTime(),
      banned: this.isBanned(userId, user.bannedUntil),
      totals: totals!,
      territory: engine.canvas.territoryOf(userId),
      activeBombs: engine.bombs.activeCount(userId),
      ...(await this.pixels(userId)),
    };
  }

  /** The engine is the ban source when the player is loaded there; users.banned_until is the fallback. */
  private isBanned(userId: number, dbBannedUntil: Date | null): boolean {
    const players = this.runtime.engine.players;
    const until = players.has(userId) ? (players.get(userId).bannedUntil ?? 0) : (dbBannedUntil?.getTime() ?? 0);
    return until > this.now();
  }

  private pixels(userId: number): Promise<PixelAggregates> {
    const now = this.now();
    const hit = this.pixelCache.get(userId);
    if (hit && now - hit.at < PIXEL_CACHE_MS) return hit.data;
    const data = this.loadPixels(userId);
    data.catch(() => {
      if (this.pixelCache.get(userId)?.data === data) this.pixelCache.delete(userId);
    });
    this.pixelCache.delete(userId);
    this.pixelCache.set(userId, { at: now, data });
    // Map keeps insertion order: drop the oldest entries beyond the cap.
    for (const key of this.pixelCache.keys()) {
      if (this.pixelCache.size <= PIXEL_CACHE_SIZE) break;
      this.pixelCache.delete(key);
    }
    return data;
  }

  /** Both aggregates use the (season_id, user_id, created_at) index. */
  private async loadPixels(userId: number): Promise<PixelAggregates> {
    const { width: cw, height: ch } = this.runtime.engine.canvas;
    const step = Math.max(1, Math.ceil(Math.max(cw, ch) / HEATMAP_MAX_SIDE));
    const width = Math.ceil(cw / step);
    const height = Math.ceil(ch / step);
    const own = and(eq(pixelEvents.seasonId, this.runtime.season), eq(pixelEvents.userId, userId), eq(pixelEvents.kind, "place"));

    const [favorite] = await this.db
      .select({ colorId: pixelEvents.colorId, n: count() })
      .from(pixelEvents)
      .where(own)
      .groupBy(pixelEvents.colorId)
      .orderBy(desc(count()), pixelEvents.colorId)
      .limit(1);

    // Literals, not bind parameters: Postgres matches GROUP BY to the select expression textually.
    const [stepSql, widthSql] = [sql.raw(String(step)), sql.raw(String(width))];
    const block = sql<number>`(${pixelEvents.y} / ${stepSql}) * ${widthSql} + (${pixelEvents.x} / ${stepSql})`;
    const blocks = await this.db.select({ block, n: count() }).from(pixelEvents).where(own).groupBy(block);

    return {
      favoriteColor: favorite?.colorId ?? null,
      heatmap: { step, width, height, cells: blocks.map((b) => [Number(b.block), b.n] as [number, number]) },
    };
  }
}
