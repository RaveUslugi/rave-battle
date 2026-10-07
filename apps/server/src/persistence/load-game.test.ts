import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { defaultConfig } from "@rave/shared";
import { sql } from "drizzle-orm";
import { gameConfig, users } from "../db/schema";
import { createTestDb, insertUser } from "../db/test-db";
import { makeEngine, T0 } from "../engine/test-utils";
import { snapshotPlayer } from "./batch";
import { PERMANENT_BAN_DATE } from "./codec";
import { loadGame } from "./load-game";
import { writeBatch } from "./write-batch";

const t = createTestDb();
beforeEach(() => t.reset());
afterAll(() => t.close());

const count = async (table: "seasons" | "game_config") => {
  const rows = (await t.db.execute(sql`select count(*)::int as n from ${sql.identifier(table)}`)) as unknown as Array<{ n: number }>;
  return rows[0]?.n;
};

describe("loadGame", () => {
  test("first start creates a season and the default config", async () => {
    const { engine, seasonId } = await loadGame(t.db, T0);
    expect(seasonId).toBe(1);
    expect(engine.config).toEqual(defaultConfig);
    expect(engine.canvas.width).toBe(512);
    expect(await count("seasons")).toBe(1);
    expect(await count("game_config")).toBe(1);
  });

  test("later starts reuse the open season and the latest config version", async () => {
    await loadGame(t.db, T0);
    const changed = structuredClone(defaultConfig);
    changed.coinsPerPixel = 2;
    await t.db.insert(gameConfig).values({ data: changed, comment: "v2" });
    const { engine, seasonId } = await loadGame(t.db, T0);
    expect(seasonId).toBe(1);
    expect(engine.config.coinsPerPixel).toBe(2);
    expect(await count("seasons")).toBe(1);
  });

  test("an invalid stored config fails the start", async () => {
    await t.db.insert(gameConfig).values({ data: { nope: true } });
    await expect(loadGame(t.db, T0)).rejects.toThrow();
  });

  test("restores canvas, players, bombs and bans from written batches", async () => {
    const a = await insertUser(t.db, "a", new Date(T0 - 400 * 86_400_000));
    const b = await insertUser(t.db, "b");
    const { seasonId } = await loadGame(t.db, T0);

    const { engine, addPlayer } = makeEngine();
    const pa = addPlayer(a);
    const pb = addPlayer(b);
    engine.placePixel(a, { x: 5, y: 5, colorId: 3, withBomb: true }, T0);
    engine.placePixel(b, { x: 300, y: 10, colorId: 4, withBomb: false }, T0);
    engine.claimDaily(a, T0);
    await t.db.transaction((tx) =>
      writeBatch(tx, {
        seasonId,
        events: engine.drainEvents(),
        players: [snapshotPlayer(pa), snapshotPlayer(pb)],
        newPlayers: [{ player: snapshotPlayer(pa), at: T0 }, { player: snapshotPlayer(pb), at: T0 }],
        chunks: [],
      }),
    );
    await t.db.update(users).set({ bannedUntil: PERMANENT_BAN_DATE }).where(sql`${users.id} = ${b}`);

    const loaded = (await loadGame(t.db, T0)).engine;
    expect(loaded.canvas.get(5, 5)).toEqual({ colorId: 3, ownerId: a });
    expect(loaded.canvas.get(300, 10)).toEqual({ colorId: 4, ownerId: b });
    expect(loaded.canvas.territoryOf(a)).toBe(1);
    expect(loaded.bombs.get(5, 5)?.ownerId).toBe(a);

    const la = loaded.players.get(a);
    expect(la).toMatchObject({
      coins: pa.coins,
      charges: pa.charges,
      chargesUpdatedAt: pa.chargesUpdatedAt,
      frozenUntil: 0,
      inventory: pa.inventory,
      dailyStep: 1,
      dailyLastClaim: "2026-10-07",
      bannedUntil: null,
      accountCreatedAt: T0 - 400 * 86_400_000,
      guildMember: true,
    });
    expect(loaded.players.get(b).bannedUntil).toBe(Number.POSITIVE_INFINITY);
  });
});
