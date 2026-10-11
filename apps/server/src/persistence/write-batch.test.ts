import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { asc, eq, ne } from "drizzle-orm";
import { bombs, chunkSnapshots, inventory, ledger, modLog, pixelEvents, playerState, seasons, statsDaily, unlockedColors } from "../db/schema";
import { createTestDb, insertUser } from "../db/test-db";
import { makeEngine, T0 } from "../engine/test-utils";
import type { EngineEvent } from "../engine/types";
import { snapshotPlayer, type Batch } from "./batch";
import { bytesToOwners } from "./codec";
import { writeBatch } from "./write-batch";

const t = createTestDb();
let seasonId = 0;
let a = 0;
let b = 0;

beforeEach(async () => {
  await t.reset();
  a = await insertUser(t.db, "a");
  b = await insertUser(t.db, "b");
  const [season] = await t.db.insert(seasons).values({ name: "S" }).returning();
  seasonId = season!.id;
});
afterAll(() => t.close());

const write = (batch: Partial<Batch>) =>
  t.db.transaction((tx) =>
    writeBatch(tx, { seasonId, events: [], players: [], newPlayers: [], chunks: [], ...batch }),
  );

/** Engine with players a and b already persisted. */
async function setup() {
  const ctx = makeEngine();
  const pa = ctx.addPlayer(a);
  const pb = ctx.addPlayer(b);
  await write({ newPlayers: [{ player: snapshotPlayer(pa), at: T0 }, { player: snapshotPlayer(pb), at: T0 }] });
  return { ...ctx, pa, pb };
}

describe("writeBatch", () => {
  test("mod_log events are written with action, target and params", async () => {
    const { engine, pa } = await setup();
    engine.adminAdjust(a, { coins: 5 }, T0, { adminId: b, comment: "c" });
    await write({ events: engine.drainEvents(), players: [snapshotPlayer(pa)] });
    const rows = await t.db.select().from(modLog);
    expect(rows.map((r) => [r.adminId, r.action, r.targetUserId, r.params])).toEqual([
      [b, "player_edit", a, { changes: { coins: 5 }, comment: "c" }],
    ]);
    expect(rows[0]!.createdAt.getTime()).toBe(T0);
    const admin = await t.db.select().from(ledger).where(eq(ledger.reason, "admin"));
    expect(admin).toHaveLength(1);
  });

  test("new players get state, inventory and starting ledger rows", async () => {
    await setup();
    const [state] = await t.db.select().from(playerState).where(eq(playerState.userId, a));
    expect(state).toMatchObject({ coins: 100, charges: 10, chargeCapBonus: 0, dailyStep: 0, dailyLastClaim: null, frozenUntil: null });
    expect(state!.chargesUpdatedAt.getTime()).toBe(T0);

    const items = await t.db.select().from(inventory).where(eq(inventory.userId, a)).orderBy(asc(inventory.item));
    expect(items.map((i) => [i.item, i.amount])).toEqual([["bomb", 3], ["defuser", 0], ["detector", 5]]);

    const start = await t.db.select().from(ledger).where(eq(ledger.userId, a)).orderBy(asc(ledger.id));
    expect(start.map((r) => [r.item, r.delta, r.balanceAfter, r.reason])).toEqual([
      ["coins", 100, 100, "start"],
      ["bomb", 3, 3, "start"],
      ["detector", 5, 5, "start"],
    ]);
  });

  test("pixels, bombs, explosion ledger, stats and player state", async () => {
    const { engine, pa, pb } = await setup();
    engine.placePixel(a, { x: 5, y: 5, colorId: 3, withBomb: true }, T0);
    engine.placePixel(a, { x: 6, y: 5, colorId: 4, withBomb: false }, T0);
    engine.placePixel(b, { x: 5, y: 5, colorId: 9, withBomb: false }, T0 + 1000);
    await write({ events: engine.drainEvents(), players: [snapshotPlayer(pa), snapshotPlayer(pb)] });

    const pixels = await t.db.select().from(pixelEvents).orderBy(asc(pixelEvents.id));
    expect(pixels.map((p) => [p.x, p.y, p.userId, p.colorId, p.prevColorId, p.prevUserId, p.kind])).toEqual([
      [5, 5, a, 3, 0, null, "place"],
      [6, 5, a, 4, 0, null, "place"],
    ]);

    const [bomb] = await t.db.select().from(bombs);
    expect(bomb).toMatchObject({ x: 5, y: 5, ownerId: a, removedReason: "exploded", removedBy: b });
    expect(bomb!.removedAt?.getTime()).toBe(T0 + 1000);

    const rows = await t.db.select().from(ledger).where(ne(ledger.reason, "start")).orderBy(asc(ledger.id));
    expect(rows.map((r) => [r.userId, r.item, r.delta, r.reason])).toEqual([
      [a, "bomb", -1, "use"],
      [b, "coins", -10, "explosion"],
      [a, "coins", 15, "bomb_bonus"],
    ]);

    const stats = await t.db.select().from(statsDaily).orderBy(asc(statsDaily.userId));
    expect(stats.map((s) => [s.userId, s.date, s.pixels, s.coinsFromPixels, s.bombsTriggered, s.explosionsSuffered])).toEqual([
      [a, "2026-10-07", 2, 2, 1, 0],
      [b, "2026-10-07", 0, 0, 0, 1],
    ]);

    const states = await t.db.select().from(playerState).orderBy(asc(playerState.userId));
    expect(states.map((s) => [s.userId, s.coins, s.charges])).toEqual([
      [a, 117, 8],
      [b, 90, 9],
    ]);
    expect(states[1]!.frozenUntil?.getTime()).toBe(T0 + 61_000);
    const [aBombs] = await t.db.select().from(inventory).where(eq(inventory.userId, a)).orderBy(asc(inventory.item));
    expect(aBombs).toMatchObject({ item: "bomb", amount: 2 });
  });

  test("stats accumulate across batches", async () => {
    const { engine } = await setup();
    engine.placePixel(a, { x: 1, y: 1, colorId: 3, withBomb: false }, T0);
    await write({ events: engine.drainEvents() });
    engine.placePixel(a, { x: 2, y: 1, colorId: 3, withBomb: false }, T0);
    await write({ events: engine.drainEvents() });
    const [stats] = await t.db.select().from(statsDaily);
    expect(stats).toMatchObject({ pixels: 2, coinsFromPixels: 2 });
  });

  test("a defused bomb is closed with reason defused", async () => {
    const { engine, pb } = await setup();
    pb.inventory.defuser = 1;
    engine.placePixel(a, { x: 5, y: 5, colorId: 3, withBomb: true }, T0);
    engine.defuse(b, { x: 5, y: 5 }, T0 + 5);
    await write({ events: engine.drainEvents() });
    const [bomb] = await t.db.select().from(bombs);
    expect(bomb).toMatchObject({ removedReason: "defused", removedBy: b });
  });

  test("color unlocks are written once", async () => {
    await setup();
    const unlock = { type: "color_unlocked" as const, userId: a, colorId: 32, source: "shop" as const, at: T0 };
    await write({ events: [unlock] });
    await write({ events: [unlock] });
    const rows = await t.db.select().from(unlockedColors);
    expect(rows.map((r) => [r.userId, r.colorId, r.source])).toEqual([[a, 32, "shop"]]);
  });

  test("chunk snapshots store bytes and the last pixel event id", async () => {
    const { engine, canvas } = await setup();
    engine.placePixel(a, { x: 1, y: 1, colorId: 3, withBomb: false }, T0);
    engine.placePixel(a, { x: 2, y: 1, colorId: 4, withBomb: false }, T0);
    const chunk = canvas.getChunk(0, 0)!;
    await write({ events: engine.drainEvents(), chunks: [{ cx: 0, cy: 0, colors: chunk.colors.slice(), owners: chunk.owners.slice() }] });

    const [snap] = await t.db.select().from(chunkSnapshots);
    expect(snap).toMatchObject({ seasonId, cx: 0, cy: 0, lastEventId: 2 });
    expect(snap!.colors[256 + 2]).toBe(4);
    expect(bytesToOwners(snap!.owners)[256 + 1]).toBe(a);
  });

  test("removing a bomb that is not active in the database fails the batch", async () => {
    await setup();
    const removed: EngineEvent = { type: "bomb_removed", x: 5, y: 5, ownerId: a, reason: "exploded", removedBy: b, at: T0 };
    await expect(write({ events: [removed] })).rejects.toThrow();
  });

  test("large batches are written in slices", async () => {
    await setup();
    const n = 8000;
    const events: EngineEvent[] = [];
    for (let i = 0; i < n; i++) {
      const at = T0 + i;
      events.push({ type: "pixel", x: i % 512, y: Math.floor(i / 512), userId: a, colorId: 3, prevColorId: 0, prevUserId: 0, at });
      events.push({ type: "ledger", userId: a, item: "coins", delta: 1, balanceAfter: 101 + i, reason: "daily", ref: {}, at });
    }
    await write({ events });
    expect(await t.db.$count(pixelEvents)).toBe(n);
    expect(await t.db.$count(ledger, ne(ledger.reason, "start"))).toBe(n);
  });
});
