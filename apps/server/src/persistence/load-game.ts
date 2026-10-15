import { CHUNK_SIZE, DAY_MS, dateKey, defaultConfig, gameConfigSchema, type GameConfig, upgradeStoredConfig } from "@rave/shared";
import { and, asc, desc, eq, gt, gte, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { bombs, chunkSnapshots, gameConfig, inventory, pixelEvents, playerState, seasons, unlockedColors, users } from "../db/schema";
import { AntiFarm } from "../engine/anti-farm";
import { BombStore } from "../engine/bomb-store";
import { CanvasStore } from "../engine/canvas-store";
import { GameEngine } from "../engine/engine";
import { PlayerRegistry } from "../engine/player";
import type { Inventory } from "../engine/types";
import { banFromDate, bytesToOwners } from "./codec";

export interface LoadedGame {
  engine: GameEngine;
  seasonId: number;
  /** Chunks changed by log replay; the runtime must treat them as dirty. */
  replayedChunks: string[];
}

/** Builds the engine from the database. `now` decides "today" for the anti-farm counters. */
export async function loadGame(db: Db, now: number): Promise<LoadedGame> {
  const seasonId = await ensureSeason(db);
  const { config: cfg, version } = await loadConfig(db);
  const canvas = new CanvasStore(cfg.canvas.width, cfg.canvas.height);
  const replayedChunks = await loadCanvas(db, seasonId, canvas);
  const players = new PlayerRegistry();
  await loadPlayers(db, seasonId, players);
  const bombStore = new BombStore();
  await loadBombs(db, seasonId, bombStore);
  const antiFarm = new AntiFarm();
  await seedAntiFarm(db, seasonId, cfg, antiFarm, now);
  return { engine: new GameEngine(cfg, canvas, bombStore, players, antiFarm, version), seasonId, replayedChunks };
}

export async function ensureSeason(db: Db): Promise<number> {
  const [open] = await db.select({ id: seasons.id }).from(seasons).where(isNull(seasons.endedAt)).orderBy(desc(seasons.id)).limit(1);
  if (open) return open.id;
  const [created] = await db.insert(seasons).values({ name: "Season 1" }).returning({ id: seasons.id });
  return created!.id;
}

export async function loadConfig(db: Db): Promise<{ config: GameConfig; version: number }> {
  const [latest] = await db.select().from(gameConfig).orderBy(desc(gameConfig.version)).limit(1);
  if (latest) return { config: gameConfigSchema.parse(upgradeStoredConfig(latest.data)), version: latest.version };
  const [seeded] = await db.insert(gameConfig).values({ data: defaultConfig, comment: "initial" }).returning({ version: gameConfig.version });
  return { config: gameConfigSchema.parse(defaultConfig), version: seeded!.version };
}

/**
 * Latest snapshot per chunk, then the pixel log after the newest one. Every snapshot round saves all
 * dirty chunks (replayed ones included), so events up to the newest last_event_id are in snapshots.
 * Returns the keys of chunks that got replayed events.
 */
async function loadCanvas(db: Db, seasonId: number, canvas: CanvasStore): Promise<string[]> {
  const snapshots = await db
    .selectDistinctOn([chunkSnapshots.cx, chunkSnapshots.cy])
    .from(chunkSnapshots)
    .where(eq(chunkSnapshots.seasonId, seasonId))
    .orderBy(chunkSnapshots.cx, chunkSnapshots.cy, desc(chunkSnapshots.id));

  const lastIdByChunk = new Map<string, number>();
  for (const s of snapshots) {
    canvas.loadChunk(s.cx, s.cy, { colors: s.colors, owners: bytesToOwners(s.owners) });
    lastIdByChunk.set(`${s.cx}:${s.cy}`, s.lastEventId);
  }

  const fromId = snapshots.length > 0 ? Math.max(...lastIdByChunk.values()) : 0;
  const events = await db
    .select({ id: pixelEvents.id, x: pixelEvents.x, y: pixelEvents.y, userId: pixelEvents.userId, colorId: pixelEvents.colorId })
    .from(pixelEvents)
    .where(and(eq(pixelEvents.seasonId, seasonId), gt(pixelEvents.id, fromId)))
    .orderBy(asc(pixelEvents.id));
  const replayed = new Set<string>();
  for (const e of events) {
    const key = `${Math.floor(e.x / CHUNK_SIZE)}:${Math.floor(e.y / CHUNK_SIZE)}`;
    if (e.id <= (lastIdByChunk.get(key) ?? 0)) continue;
    canvas.set(e.x, e.y, e.colorId, e.userId ?? 0);
    replayed.add(key);
  }
  return [...replayed];
}

async function loadPlayers(db: Db, seasonId: number, registry: PlayerRegistry): Promise<void> {
  const rows = await db
    .select({
      state: playerState,
      discordCreatedAt: users.discordCreatedAt,
      bannedUntil: users.bannedUntil,
      banReason: users.banReason,
      guildMember: users.guildMember,
    })
    .from(playerState)
    .innerJoin(users, eq(users.id, playerState.userId))
    .where(eq(playerState.seasonId, seasonId));

  const inventories = new Map<number, Inventory>();
  for (const row of await db.select().from(inventory).where(eq(inventory.seasonId, seasonId))) {
    const inv = inventories.get(row.userId) ?? { bomb: 0, detector: 0, defuser: 0 };
    inv[row.item] = row.amount;
    inventories.set(row.userId, inv);
  }

  const unlocked = new Map<number, Set<number>>();
  for (const row of await db.select().from(unlockedColors)) {
    const set = unlocked.get(row.userId) ?? new Set<number>();
    set.add(row.colorId);
    unlocked.set(row.userId, set);
  }

  for (const { state, discordCreatedAt, bannedUntil, banReason, guildMember } of rows) {
    registry.add({
      userId: state.userId,
      coins: state.coins,
      charges: state.charges,
      chargesUpdatedAt: state.chargesUpdatedAt.getTime(),
      frozenUntil: state.frozenUntil?.getTime() ?? 0,
      chargeCapBonus: state.chargeCapBonus,
      inventory: inventories.get(state.userId) ?? { bomb: 0, detector: 0, defuser: 0 },
      unlockedColors: unlocked.get(state.userId) ?? new Set(),
      dailyStep: state.dailyStep,
      dailyLastClaim: state.dailyLastClaim,
      bannedUntil: banFromDate(bannedUntil),
      banReason,
      accountCreatedAt: discordCreatedAt.getTime(),
      guildMember,
    });
  }
}

async function loadBombs(db: Db, seasonId: number, store: BombStore): Promise<void> {
  const rows = await db
    .select()
    .from(bombs)
    .where(and(eq(bombs.seasonId, seasonId), isNull(bombs.removedAt)));
  for (const r of rows) store.add({ x: r.x, y: r.y, ownerId: r.ownerId, createdAt: r.createdAt.getTime() });
}

/** Replays today's rated explosions so a restart does not reset the per-pair limit. */
async function seedAntiFarm(db: Db, seasonId: number, cfg: GameConfig, antiFarm: AntiFarm, now: number): Promise<void> {
  const today = dateKey(now, cfg.daily.timezone);
  const rows = await db
    .select({ ownerId: bombs.ownerId, removedBy: bombs.removedBy, removedAt: bombs.removedAt })
    .from(bombs)
    .where(and(eq(bombs.seasonId, seasonId), eq(bombs.removedReason, "exploded"), gte(bombs.removedAt, new Date(now - 2 * DAY_MS))))
    .orderBy(asc(bombs.removedAt), asc(bombs.id));
  for (const r of rows) {
    if (r.removedBy === null || r.removedAt === null || r.removedBy === r.ownerId) continue;
    if (dateKey(r.removedAt.getTime(), cfg.daily.timezone) !== today) continue;
    antiFarm.register(today, r.ownerId, r.removedBy, cfg.antiFarm.maxRatedPerPairPerDay);
  }
}
