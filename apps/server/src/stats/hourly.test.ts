import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { seasons, statsHourly } from "../db/schema";
import { createTestDb, insertUser } from "../db/test-db";
import type { EngineEvent } from "../engine/types";
import { HourlyStats, hourStart } from "./hourly";

const t = createTestDb();
const H0 = Date.UTC(2026, 9, 15, 10);
let clock = H0 + 5 * 60_000;
let season: number;
let user: number;

beforeEach(async () => {
  await t.reset();
  clock = H0 + 5 * 60_000;
  const [row] = await t.db.insert(seasons).values({ name: "s" }).returning({ id: seasons.id });
  season = row!.id;
  user = await insertUser(t.db, "ann");
});
afterAll(() => t.close());

const make = () => new HourlyStats(t.db, season, () => clock);
const rows = () => t.db.select().from(statsHourly).where(eq(statsHourly.seasonId, season)).orderBy(statsHourly.hour);

const pixel = (at: number, kind: "place" | "mod_rollback" = "place"): EngineEvent => ({
  type: "pixel",
  kind,
  x: 1,
  y: 1,
  userId: user,
  colorId: 3,
  prevColorId: 0,
  prevUserId: 0,
  at,
});
const ledger = (
  at: number,
  delta: number,
  reason: Extract<EngineEvent, { type: "ledger" }>["reason"],
  ref: Record<string, unknown> = {},
  item: "coins" | "bomb" = "coins",
): EngineEvent => ({
  type: "ledger",
  userId: user,
  item,
  delta,
  balanceAfter: 100,
  reason,
  ref,
  at,
});

describe("HourlyStats", () => {
  test("maps committed events to counters per clock hour", async () => {
    const stats = make();
    stats.record([
      pixel(H0 + 1000),
      pixel(H0 + 2000),
      pixel(H0 + 3000, "mod_rollback"),
      pixel(H0 + 3_600_000),
      { type: "bomb_removed", x: 1, y: 1, ownerId: user, reason: "exploded", removedBy: user, at: H0 },
      { type: "bomb_removed", x: 2, y: 1, ownerId: user, reason: "defused", removedBy: user, at: H0 },
      { type: "bomb_removed", x: 3, y: 1, ownerId: user, reason: "moderated", removedBy: user, at: H0 },
      { type: "stat", userId: user, day: "2026-10-15", stat: "coinsFromPixels", delta: 2 },
      ledger(H0, 30, "daily"),
      ledger(H0, 15, "bomb_bonus"),
      ledger(H0, 20, "defuse"),
      ledger(H0, 5, "admin"),
      ledger(H0, -30, "shop", { product: "bomb" }),
      ledger(H0, -40, "shop", { product: "detector" }),
      ledger(H0, -150, "shop", { product: "defuser" }),
      ledger(H0, -200, "shop", { product: "color", colorId: 32 }),
      ledger(H0, -500, "shop", { product: "chargeCapBoost" }),
      ledger(H0, -10, "explosion"),
      ledger(H0, -7, "admin"),
      ledger(H0, 1, "shop", {}, "bomb"),
    ]);
    await stats.flush();
    const [first, second] = await rows();
    expect(first).toMatchObject({
      hour: new Date(H0),
      pixels: 2,
      explosions: 1,
      defuses: 1,
      mintedPixels: 2,
      mintedDaily: 30,
      mintedBombBonus: 15,
      mintedDefuse: 20,
      mintedAdmin: 5,
      spentBomb: 30,
      spentDetector: 40,
      spentDefuser: 150,
      spentColor: 200,
      spentBoost: 500,
      spentPenalty: 10,
      spentAdmin: 7,
    });
    expect(second).toMatchObject({ hour: new Date(H0 + 3_600_000), pixels: 1 });
  });

  test("flushes add up, the online peak keeps the maximum, and a second instance continues after a restart", async () => {
    const stats = make();
    stats.record([pixel(H0)]);
    stats.observeOnline(5);
    stats.observeOnline(3);
    await stats.flush();
    stats.record([pixel(H0)]);
    await stats.flush();
    const restarted = make();
    restarted.record([pixel(H0)]);
    restarted.observeOnline(4);
    await restarted.flush();
    expect(await rows()).toEqual([expect.objectContaining({ hour: new Date(H0), pixels: 3, onlinePeak: 5 })]);
  });

  test("an empty flush writes nothing", async () => {
    await make().flush();
    expect(await rows()).toEqual([]);
  });

  test("hourStart floors to the hour", () => {
    expect(hourStart(H0 + 59 * 60_000)).toBe(H0);
  });
});
