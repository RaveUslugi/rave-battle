import { afterAll, beforeEach, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { bombs, seasons } from "./schema";
import { createTestDb, insertUser } from "./test-db";

const t = createTestDb();
beforeEach(() => t.reset());
afterAll(() => t.close());

test("migrations create every table of the spec", async () => {
  const rows = (await t.db.execute(
    sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
  )) as unknown as Array<{ table_name: string }>;
  expect(rows.map((r) => r.table_name)).toEqual([
    "bombs",
    "chat_messages",
    "chunk_snapshots",
    "game_config",
    "inventory",
    "ledger",
    "mod_log",
    "pixel_events",
    "player_state",
    "seasons",
    "sessions",
    "stats_daily",
    "unlocked_colors",
    "users",
  ]);
});

test("a cell has at most one active bomb", async () => {
  const ownerId = await insertUser(t.db, "owner");
  const [season] = await t.db.insert(seasons).values({ name: "S" }).returning();
  const bomb = { seasonId: season!.id, x: 1, y: 1, ownerId, createdAt: new Date() };

  await t.db.insert(bombs).values(bomb);
  await expect(t.db.insert(bombs).values(bomb).execute()).rejects.toThrow();

  await t.db.update(bombs).set({ removedAt: new Date(), removedReason: "defused" });
  await t.db.insert(bombs).values(bomb);
  const count = (await t.db.execute(sql`select count(*)::int as n from bombs`)) as unknown as Array<{ n: number }>;
  expect(count[0]?.n).toBe(2);
});
