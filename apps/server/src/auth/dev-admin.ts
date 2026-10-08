import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import type { GameEngine } from "../engine/engine";

/** Only dev login can create this id: real Discord ids are numeric. */
export const DEV_ADMIN_DISCORD_ID = "dev:admin";

/** Sessions outlive restarts, so the grant is restored at boot. Call only when dev login is enabled. */
export async function restoreDevAdmin(db: Db, engine: GameEngine): Promise<void> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.discordId, DEV_ADMIN_DISCORD_ID)).limit(1);
  if (row) engine.grantUnlimited(row.id);
}
