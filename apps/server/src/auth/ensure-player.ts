import { eq } from "drizzle-orm";
import { users } from "../db/schema";
import type { AppDeps } from "../net/deps";
import { banFromDate } from "../persistence/codec";
import type { SessionUser } from "./session";

/**
 * Makes sure the user's player is in the engine, with the freshest access flags.
 * The session was resolved before this call, so a ban committed in between would be lost for a player
 * created here. Re-reading the row after creation closes that window; a ban committed after the re-read
 * is applied by AdminService (same per-user access queue), which sees the player in the engine by then.
 */
export function ensurePlayer(deps: Pick<AppDeps, "db" | "runtime" | "accessQueue">, user: SessionUser): Promise<void> {
  // The whole join holds the user's slot, so a concurrent join or ban/unban sees the finished re-read.
  // Nothing inside re-enters the queue for this user.
  return deps.accessQueue.run(user.id, async () => {
    const { player, created } = await deps.runtime.addPlayer({
      userId: user.id,
      accountCreatedAt: user.discordCreatedAt,
      guildMember: user.guildMember,
      bannedUntil: user.bannedUntil,
      banReason: user.banReason,
    });
    if (!created) return;
    const [row] = await deps.db
      .select({ bannedUntil: users.bannedUntil, banReason: users.banReason, guildMember: users.guildMember })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    if (!row) return;
    const access = { bannedUntil: banFromDate(row.bannedUntil), banReason: row.banReason, guildMember: row.guildMember };
    if (access.bannedUntil === user.bannedUntil && access.banReason === user.banReason && access.guildMember === user.guildMember) return;
    await deps.runtime.run((engine) => engine.setAccess(player.userId, access));
  });
}
