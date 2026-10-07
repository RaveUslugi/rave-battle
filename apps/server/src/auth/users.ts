import type { Db } from "../db/client";
import { users } from "../db/schema";

export interface UserProfile {
  discordId: string;
  username: string;
  avatar: string | null;
  discordCreatedAt: Date;
}

/** Creates or refreshes a user by Discord id; returns the internal id. */
export async function upsertUser(db: Db, profile: UserProfile): Promise<number> {
  const [row] = await db
    .insert(users)
    .values(profile)
    .onConflictDoUpdate({
      target: users.discordId,
      set: { username: profile.username, avatar: profile.avatar, lastSeenAt: new Date() },
    })
    .returning({ id: users.id });
  return row!.id;
}
