import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { dateKey, DAY_MS } from "@rave/shared";
import { eq } from "drizzle-orm";
import { statsDaily, users } from "../db/schema";
import { createTestDb, insertUser } from "../db/test-db";
import { UserDirectory } from "../net/user-directory";
import { bootGame } from "../persistence/boot";
import type { GameRuntime } from "../persistence/runtime";
import { Profiles } from "./profiles";

const t = createTestDb();
let runtime: GameRuntime;
let ann: number;
let ben: number;

beforeEach(async () => {
  await t.reset();
  ann = await insertUser(t.db, "ann");
  ben = await insertUser(t.db, "ben");
  runtime = await bootGame(t.db, { flushIntervalMs: 0, onFatal: () => {} });
  for (const id of [ann, ben]) await runtime.addPlayer({ userId: id, accountCreatedAt: Date.UTC(2020, 0, 1), guildMember: true });
});
afterEach(() => runtime.stop());
afterAll(() => t.close());

const profiles = async (now = Date.now) => new Profiles(t.db, runtime, await UserDirectory.load(t.db), now);

describe("Profiles", () => {
  test("totals, territory, active bombs, favorite color and the heatmap", async () => {
    await runtime.run((engine, now) => {
      engine.placePixel(ann, { x: 1, y: 1, colorId: 5, withBomb: false }, now);
      engine.placePixel(ann, { x: 2, y: 1, colorId: 5, withBomb: true }, now);
      engine.placePixel(ann, { x: 300, y: 9, colorId: 7, withBomb: false }, now);
    });
    const tz = runtime.engine.config.daily.timezone;
    await t.db.insert(statsDaily).values({ userId: ann, seasonId: runtime.season, date: dateKey(Date.now() - 2 * DAY_MS, tz), pixels: 4, selfExplosions: 1 });

    const p = (await (await profiles()).profile(ann))!;
    expect(p.user).toEqual({ id: ann, name: "ann" });
    expect(p.totals).toMatchObject({ pixels: 7, selfExplosions: 1, bombsTriggered: 0 });
    expect(p.territory).toBe(3);
    expect(p.activeBombs).toBe(1);
    expect(p.favoriteColor).toBe(5);
    expect(p.banned).toBe(false);
    expect(p.heatmap).toMatchObject({ step: 8, width: 64, height: 64 });
    // (1,1) and (2,1) share block 0; (300,9) is block x=37, y=1.
    expect(p.heatmap.cells.sort((a, b) => a[0] - b[0])).toEqual([
      [0, 2],
      [1 * 64 + 37, 1],
    ]);
  });

  test("a user without activity gets zeros; unknown users get null", async () => {
    const p = (await (await profiles()).profile(ben))!;
    expect(p).toMatchObject({ territory: 0, activeBombs: 0, favoriteColor: null, totals: { pixels: 0 } });
    expect(p.heatmap.cells).toEqual([]);
    expect(await (await profiles()).profile(9999)).toBeNull();
  });

  test("the profile has no extra keys: no bomb coordinates, coins or inventory", async () => {
    const p = (await (await profiles()).profile(ann))!;
    expect(Object.keys(p).sort()).toEqual(["activeBombs", "banned", "favoriteColor", "heatmap", "joinedAt", "territory", "totals", "user"]);
    expect(Object.keys(p.heatmap).sort()).toEqual(["cells", "height", "step", "width"]);
    expect(Object.keys(p.totals).sort()).toEqual(["bombsTriggered", "defused", "explosionsSuffered", "pixels", "selfExplosions"]);
    expect(Object.keys(p.user).sort()).toEqual(["id", "name"]);
  });

  test("the heatmap follows a grown, non-square canvas", async () => {
    const next = structuredClone(runtime.engine.config);
    next.canvas.width = 768;
    next.canvas.height = 512;
    const res = await runtime.run((engine, now) =>
      engine.applyConfig(next, { baseVersion: engine.configVersion, adminId: ann, comment: "grow", action: "config_save" }, now),
    );
    expect(res.ok).toBe(true);
    await runtime.run((engine, now) => {
      engine.placePixel(ann, { x: 700, y: 10, colorId: 4, withBomb: false }, now);
      engine.placePixel(ann, { x: 10, y: 500, colorId: 4, withBomb: false }, now);
    });
    const p = (await (await profiles()).profile(ann))!;
    expect(p.heatmap).toMatchObject({ step: 12, width: 64, height: 43 });
    // (700,10) -> 0*64 + 58; (10,500) -> 41*64 + 0.
    expect(p.heatmap.cells.sort((a, b) => a[0] - b[0])).toEqual([
      [58, 1],
      [2624, 1],
    ]);
  });

  test("the ban comes from the engine when the player is loaded, else from users.banned_until", async () => {
    const service = await profiles();
    await runtime.run((engine) => engine.setAccess(ann, { bannedUntil: Date.now() + DAY_MS }));
    expect((await service.profile(ann))!.banned).toBe(true);
    await runtime.run((engine) => engine.setAccess(ann, { bannedUntil: 0 }));
    await t.db
      .update(users)
      .set({ bannedUntil: new Date(Date.now() + DAY_MS) })
      .where(eq(users.id, ann));
    expect((await service.profile(ann))!.banned).toBe(false);
    const stranger = await insertUser(t.db, "stranger");
    await t.db
      .update(users)
      .set({ bannedUntil: new Date(Date.now() + DAY_MS) })
      .where(eq(users.id, stranger));
    expect((await (await profiles()).profile(stranger))!.banned).toBe(true);
  });

  test("banned users are marked; the pixel aggregates are cached for 5 minutes", async () => {
    let now = Date.now();
    const service = await profiles(() => now);
    await runtime.run((engine) => engine.setAccess(ben, { bannedUntil: now + DAY_MS }));
    expect((await service.profile(ben))!.banned).toBe(true);
    await runtime.run((engine) => engine.setAccess(ben, { bannedUntil: 0 }));
    await runtime.run((engine, at) => engine.placePixel(ben, { x: 0, y: 0, colorId: 9, withBomb: false }, at));
    expect((await service.profile(ben))!.favoriteColor).toBeNull();
    now += 5 * 60_000;
    expect((await service.profile(ben))!.favoriteColor).toBe(9);
  });
});
