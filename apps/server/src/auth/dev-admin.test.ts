import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { users } from "../db/schema";
import { createTestDb, insertUser } from "../db/test-db";
import { makeEngine } from "../engine/test-utils";
import { DEV_ADMIN_DISCORD_ID, restoreDevAdmin } from "./dev-admin";

const t = createTestDb();
beforeEach(() => t.reset());
afterAll(() => t.close());

describe("restoreDevAdmin", () => {
  test("grants the stored dev admin", async () => {
    const other = await insertUser(t.db, "someone");
    const [row] = await t.db
      .insert(users)
      .values({ discordId: DEV_ADMIN_DISCORD_ID, username: "admin", discordCreatedAt: new Date("2015-01-01T00:00:00Z") })
      .returning({ id: users.id });
    const { engine } = makeEngine();
    await restoreDevAdmin(t.db, engine);
    expect(engine.isUnlimited(row!.id)).toBe(true);
    expect(engine.isUnlimited(other)).toBe(false);
  });

  test("a Discord user named admin gets nothing", async () => {
    const id = await insertUser(t.db, "admin");
    const { engine } = makeEngine();
    await restoreDevAdmin(t.db, engine);
    expect(engine.isUnlimited(id)).toBe(false);
  });
});
