import { ITEM_KEYS } from "@rave/shared";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../db/client";
import { bombs, chunkSnapshots, gameConfig, inventory, ledger, modLog, pixelEvents, playerState, statsDaily, unlockedColors } from "../db/schema";
import type { EngineEvent, StatKey } from "../engine/types";
import type { Batch, PlayerSnapshot } from "./batch";
import { ownersToBytes } from "./codec";

/** Max rows per multi-row insert; keeps well under the 65534 bind-parameter limit. */
const INSERT_SLICE = 1000;

type EventOf<T extends EngineEvent["type"]> = Extract<EngineEvent, { type: T }>;

function ofType<T extends EngineEvent["type"]>(events: EngineEvent[], type: T): EventOf<T>[] {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

/** Writes one batch. Must run inside a transaction. Order matters: players first, snapshots last. */
export async function writeBatch(tx: Tx, batch: Batch): Promise<void> {
  assertKnownEvents(batch.events);
  for (const { player, at } of batch.newPlayers) await insertNewPlayer(tx, batch.seasonId, player, at);
  await insertConfigVersions(tx, batch);
  await insertPixels(tx, batch);
  await applyBombEvents(tx, batch);
  await insertLedger(tx, batch);
  await insertModLog(tx, batch);
  await addStats(tx, batch);
  await insertColorUnlocks(tx, batch);
  for (const player of batch.players) await upsertPlayer(tx, batch.seasonId, player);
  if (batch.chunks.length > 0) await insertChunkSnapshots(tx, batch);
}

/** Every event type needs a writer below (`player` is covered by `batch.players`); a new type fails typecheck here. */
function assertKnownEvents(events: EngineEvent[]): void {
  for (const e of events) {
    switch (e.type) {
      case "pixel":
      case "bomb_added":
      case "bomb_removed":
      case "ledger":
      case "stat":
      case "color_unlocked":
      case "mod_log":
      case "config_changed":
      case "player":
        break;
      default: {
        const unknown: never = e;
        throw new Error(`Unknown engine event: ${JSON.stringify(unknown)}`);
      }
    }
  }
}

async function insertNewPlayer(tx: Tx, seasonId: number, p: PlayerSnapshot, at: number): Promise<void> {
  await upsertPlayer(tx, seasonId, p);
  const start = [
    { item: "coins" as const, amount: p.coins },
    ...ITEM_KEYS.map((item) => ({ item, amount: p.inventory[item] })),
  ].filter((s) => s.amount > 0);
  if (start.length === 0) return;
  await tx.insert(ledger).values(
    start.map((s) => ({
      userId: p.userId,
      seasonId,
      item: s.item,
      delta: s.amount,
      balanceAfter: s.amount,
      reason: "start" as const,
      createdAt: new Date(at),
    })),
  );
}

async function upsertPlayer(tx: Tx, seasonId: number, p: PlayerSnapshot): Promise<void> {
  const state = {
    coins: p.coins,
    charges: p.charges,
    chargesUpdatedAt: new Date(p.chargesUpdatedAt),
    frozenUntil: p.frozenUntil > 0 ? new Date(p.frozenUntil) : null,
    chargeCapBonus: p.chargeCapBonus,
    dailyStep: p.dailyStep,
    dailyLastClaim: p.dailyLastClaim,
  };
  await tx
    .insert(playerState)
    .values({ userId: p.userId, seasonId, ...state })
    .onConflictDoUpdate({ target: [playerState.userId, playerState.seasonId], set: state });
  await tx
    .insert(inventory)
    .values(ITEM_KEYS.map((item) => ({ userId: p.userId, seasonId, item, amount: p.inventory[item] })))
    .onConflictDoUpdate({
      target: [inventory.userId, inventory.seasonId, inventory.item],
      set: { amount: sql`excluded.amount` },
    });
}

async function insertConfigVersions(tx: Tx, batch: Batch): Promise<void> {
  const rows = ofType(batch.events, "config_changed");
  if (rows.length === 0) return;
  await tx
    .insert(gameConfig)
    .values(rows.map((e) => ({ version: e.version, data: e.config, createdBy: e.createdBy, comment: e.comment, createdAt: new Date(e.at) })));
  // Explicit versions bypass the serial; move it past them so later default inserts do not collide.
  await tx.execute(sql`select setval(pg_get_serial_sequence('game_config', 'version'), (select max(version) from game_config))`);
}

async function insertPixels(tx: Tx, batch: Batch): Promise<void> {
  const pixels = ofType(batch.events, "pixel");
  for (let i = 0; i < pixels.length; i += INSERT_SLICE) {
    await tx.insert(pixelEvents).values(
      pixels.slice(i, i + INSERT_SLICE).map((e) => ({
        seasonId: batch.seasonId,
        x: e.x,
        y: e.y,
        userId: e.userId || null,
        colorId: e.colorId,
        prevColorId: e.prevColorId,
        prevUserId: e.prevUserId || null,
        kind: "place" as const,
        createdAt: new Date(e.at),
      })),
    );
  }
}

/** Sequential on purpose: a batch may add and then remove a bomb on the same cell. */
async function applyBombEvents(tx: Tx, batch: Batch): Promise<void> {
  for (const e of batch.events) {
    if (e.type === "bomb_added") {
      await tx.insert(bombs).values({ seasonId: batch.seasonId, x: e.x, y: e.y, ownerId: e.ownerId, createdAt: new Date(e.at) });
    } else if (e.type === "bomb_removed") {
      const updated = await tx
        .update(bombs)
        .set({ removedAt: new Date(e.at), removedReason: e.reason, removedBy: e.removedBy })
        .where(and(eq(bombs.seasonId, batch.seasonId), eq(bombs.x, e.x), eq(bombs.y, e.y), isNull(bombs.removedAt)))
        .returning({ id: bombs.id });
      if (updated.length !== 1) {
        throw new Error(`bomb_removed at ${e.x},${e.y} matched ${updated.length} active bombs, expected 1`);
      }
    }
  }
}

async function insertLedger(tx: Tx, batch: Batch): Promise<void> {
  const rows = ofType(batch.events, "ledger");
  for (let i = 0; i < rows.length; i += INSERT_SLICE) {
    await tx.insert(ledger).values(
      rows.slice(i, i + INSERT_SLICE).map((e) => ({
        userId: e.userId,
        seasonId: batch.seasonId,
        item: e.item,
        delta: e.delta,
        balanceAfter: e.balanceAfter,
        reason: e.reason,
        ref: e.ref,
        createdAt: new Date(e.at),
      })),
    );
  }
}

async function insertModLog(tx: Tx, batch: Batch): Promise<void> {
  const rows = ofType(batch.events, "mod_log");
  if (rows.length === 0) return;
  await tx.insert(modLog).values(
    rows.map((e) => ({ adminId: e.adminId, action: e.action, targetUserId: e.targetUserId, params: e.params, createdAt: new Date(e.at) })),
  );
}

async function addStats(tx: Tx, batch: Batch): Promise<void> {
  const totals = new Map<string, { userId: number; day: string; counts: Partial<Record<StatKey, number>> }>();
  for (const e of ofType(batch.events, "stat")) {
    const key = `${e.userId}|${e.day}`;
    const entry = totals.get(key) ?? { userId: e.userId, day: e.day, counts: {} };
    entry.counts[e.stat] = (entry.counts[e.stat] ?? 0) + e.delta;
    totals.set(key, entry);
  }
  for (const { userId, day, counts } of totals.values()) {
    const set: Partial<Record<StatKey, SQL>> = {};
    for (const [stat, delta] of Object.entries(counts) as Array<[StatKey, number]>) {
      set[stat] = sql`${statsDaily[stat]} + ${delta}`;
    }
    await tx
      .insert(statsDaily)
      .values({ userId, seasonId: batch.seasonId, date: day, ...counts })
      .onConflictDoUpdate({ target: [statsDaily.userId, statsDaily.seasonId, statsDaily.date], set });
  }
}

async function insertColorUnlocks(tx: Tx, batch: Batch): Promise<void> {
  const unlocks = ofType(batch.events, "color_unlocked");
  if (unlocks.length === 0) return;
  await tx
    .insert(unlockedColors)
    .values(unlocks.map((e) => ({ userId: e.userId, colorId: e.colorId, source: e.source, createdAt: new Date(e.at) })))
    .onConflictDoNothing();
}

/** Runs after this batch's pixels are inserted, so max(id) covers exactly the copied chunk state. */
async function insertChunkSnapshots(tx: Tx, batch: Batch): Promise<void> {
  const [row] = await tx
    .select({ maxId: sql<number>`coalesce(max(${pixelEvents.id}), 0)`.mapWith(Number) })
    .from(pixelEvents)
    .where(eq(pixelEvents.seasonId, batch.seasonId));
  const lastEventId = row?.maxId ?? 0;
  await tx.insert(chunkSnapshots).values(
    batch.chunks.map((c) => ({
      seasonId: batch.seasonId,
      cx: c.cx,
      cy: c.cy,
      colors: c.colors,
      owners: ownersToBytes(c.owners),
      lastEventId,
    })),
  );
}
