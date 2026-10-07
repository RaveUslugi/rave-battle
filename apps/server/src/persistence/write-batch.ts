import { ITEM_KEYS } from "@rave/shared";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../db/client";
import { bombs, chunkSnapshots, inventory, ledger, pixelEvents, playerState, statsDaily, unlockedColors } from "../db/schema";
import type { EngineEvent, LedgerItem, StatKey } from "../engine/types";
import type { Batch, PlayerSnapshot } from "./batch";
import { ownersToBytes } from "./codec";

type EventOf<T extends EngineEvent["type"]> = Extract<EngineEvent, { type: T }>;

function ofType<T extends EngineEvent["type"]>(events: EngineEvent[], type: T): EventOf<T>[] {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

/** Writes one batch. Must run inside a transaction. Order matters: players first, snapshots last. */
export async function writeBatch(tx: Tx, batch: Batch): Promise<void> {
  for (const { player, at } of batch.newPlayers) await insertNewPlayer(tx, batch.seasonId, player, at);
  await insertPixels(tx, batch);
  await applyBombEvents(tx, batch);
  await insertLedger(tx, batch);
  await addStats(tx, batch);
  await insertColorUnlocks(tx, batch);
  for (const player of batch.players) await upsertPlayer(tx, batch.seasonId, player);
  if (batch.chunks.length > 0) await insertChunkSnapshots(tx, batch);
}

async function insertNewPlayer(tx: Tx, seasonId: number, p: PlayerSnapshot, at: number): Promise<void> {
  await upsertPlayer(tx, seasonId, p);
  const start = [
    { item: "coins", amount: p.coins },
    ...ITEM_KEYS.map((item) => ({ item, amount: p.inventory[item] })),
  ].filter((s): s is { item: LedgerItem; amount: number } => s.amount > 0);
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

async function insertPixels(tx: Tx, batch: Batch): Promise<void> {
  const pixels = ofType(batch.events, "pixel");
  if (pixels.length === 0) return;
  await tx.insert(pixelEvents).values(
    pixels.map((e) => ({
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

/** Sequential on purpose: a batch may add and then remove a bomb on the same cell. */
async function applyBombEvents(tx: Tx, batch: Batch): Promise<void> {
  for (const e of batch.events) {
    if (e.type === "bomb_added") {
      await tx.insert(bombs).values({ seasonId: batch.seasonId, x: e.x, y: e.y, ownerId: e.ownerId, createdAt: new Date(e.at) });
    } else if (e.type === "bomb_removed") {
      await tx
        .update(bombs)
        .set({ removedAt: new Date(e.at), removedReason: e.reason, removedBy: e.removedBy })
        .where(and(eq(bombs.seasonId, batch.seasonId), eq(bombs.x, e.x), eq(bombs.y, e.y), isNull(bombs.removedAt)));
    }
  }
}

async function insertLedger(tx: Tx, batch: Batch): Promise<void> {
  const rows = ofType(batch.events, "ledger");
  if (rows.length === 0) return;
  await tx.insert(ledger).values(
    rows.map((e) => ({
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
