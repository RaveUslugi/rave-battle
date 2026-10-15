import type { TimelineEntry } from "@rave/shared";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { bombs, chatMessages } from "../db/schema";
import type { UserDirectory } from "../net/user-directory";

/**
 * The timeline a fresh server shows new connections: the latest explosions, defuses and chat
 * messages, oldest first. Moderator bomb removals and deleted messages stay out, as they do live.
 */
export async function loadTimeline(db: Db, seasonId: number, users: UserDirectory, limit: number): Promise<TimelineEntry[]> {
  const feed = await db
    .select({ reason: bombs.removedReason, removedBy: bombs.removedBy, ownerId: bombs.ownerId, at: bombs.removedAt })
    .from(bombs)
    .where(and(eq(bombs.seasonId, seasonId), inArray(bombs.removedReason, ["exploded", "defused"]), isNotNull(bombs.removedBy)))
    .orderBy(desc(bombs.removedAt), desc(bombs.id))
    .limit(limit);
  const chat = await db
    .select({ id: chatMessages.id, userId: chatMessages.userId, text: chatMessages.text, at: chatMessages.createdAt })
    .from(chatMessages)
    .where(and(eq(chatMessages.seasonId, seasonId), isNull(chatMessages.deletedAt)))
    .orderBy(desc(chatMessages.id))
    .limit(limit);
  const entries: TimelineEntry[] = [
    ...feed.map(
      (r): TimelineEntry => ({
        type: "feed",
        kind: r.reason as "exploded" | "defused",
        actor: users.ref(r.removedBy!),
        owner: users.ref(r.ownerId),
        at: r.at!.getTime(),
      }),
    ),
    ...chat.map((r): TimelineEntry => ({ type: "chat", id: r.id, author: users.ref(r.userId), text: r.text, at: r.at.getTime() })),
  ];
  // Stable: within one millisecond, events keep their query order.
  entries.sort((a, b) => a.at - b.at);
  return entries.slice(-limit);
}
