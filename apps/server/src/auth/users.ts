import type { Db } from "../db/client";
import { users } from "../db/schema";

export interface UserProfile {
  discordId: string;
  username: string;
  avatar: string | null;
  discordCreatedAt: Date;
  /** Defaults to true (no guild configured, dev users). */
  guildMember?: boolean;
  /** Discord UI language; left as is when undefined (dev login). */
  discordLocale?: string | null;
}

/** Creates or refreshes a user by Discord id; returns the internal id. */
export async function upsertUser(db: Db, profile: UserProfile): Promise<number> {
  const guildMember = profile.guildMember ?? true;
  const [row] = await db
    .insert(users)
    .values({ ...profile, guildMember })
    .onConflictDoUpdate({
      target: users.discordId,
      set: {
        username: profile.username,
        avatar: profile.avatar,
        guildMember,
        lastSeenAt: new Date(),
        ...(profile.discordLocale !== undefined ? { discordLocale: profile.discordLocale } : {}),
      },
    })
    .returning({ id: users.id });
  return row!.id;
}
