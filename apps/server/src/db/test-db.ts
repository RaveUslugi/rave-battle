import { sql } from "drizzle-orm";
import { createDb, type Db } from "./client";
import { runMigrations } from "./migrate";
import { users } from "./schema";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://rave:rave@localhost:54329/rave_test";

/** Test database handle. `reset()` recreates the schema from migrations (serial ids restart at 1). */
export function createTestDb() {
  const { db, close } = createDb(TEST_DATABASE_URL);
  const reset = async () => {
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema if exists public cascade`);
    await db.execute(sql`create schema public`);
    await runMigrations(db);
  };
  return { db, reset, close };
}

export async function insertUser(
  db: Db,
  name: string,
  discordCreatedAt = new Date("2020-01-01T00:00:00Z"),
): Promise<number> {
  const [row] = await db
    .insert(users)
    .values({ discordId: `discord-${name}`, username: name, discordCreatedAt })
    .returning({ id: users.id });
  return row!.id;
}
