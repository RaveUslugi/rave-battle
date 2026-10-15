import type { ChatMessage } from "@rave/shared";
import { and, eq, gte, isNotNull, isNull, lt } from "drizzle-orm";
import type { SessionUser } from "../auth/session";
import type { Db } from "../db/client";
import { chatMessages, modLog, users } from "../db/schema";
import { accessBlocks } from "../engine/access";
import type { Hub } from "../net/hub";
import type { Metrics } from "../net/metrics";
import type { UserDirectory } from "../net/user-directory";
import type { ChatMute } from "../net/views";
import { banFromDate, banToDate } from "../persistence/codec";
import type { GameRuntime } from "../persistence/runtime";

const DAY_MS = 86_400_000;

export type ChatSendResult =
  | { ok: true; id: number }
  | { ok: false; code: "chat_disabled" | "empty" | "too_long" | "no_access" }
  | { ok: false; code: "muted"; until: number | "permanent" }
  | { ok: false; code: "cooldown"; retryAt: number };

export type ChatModResult = { ok: true; deleted?: number } | { ok: false; code: "not_found" | "self" | "target_is_admin" | "bad_until" | "not_muted" };

export interface ChatServiceDeps {
  db: Db;
  runtime: GameRuntime;
  hub: Pick<Hub, "publishChat" | "publishChatDeleted" | "refreshPlayer">;
  users: UserDirectory;
  isAdmin: (discordId: string) => boolean;
  metrics?: Metrics;
  now?: () => number;
}

/** One line of plain text: line breaks and tabs become spaces, other control characters go, ends are trimmed. */
export function normalizeChatText(raw: string): string {
  return raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\p{Cc}/gu, "")
    .trim();
}

const toView = (until: number) => (Number.isFinite(until) ? until : ("permanent" as const));

/** Text chat: sending with its checks, mutes and moderator deletions. Not game state, so it bypasses the engine. */
export class ChatService {
  private readonly now: () => number;
  private readonly mutes = new Map<number, ChatMute>();
  private readonly lastSent = new Map<number, number>();

  private constructor(private readonly deps: ChatServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  static async load(deps: ChatServiceDeps): Promise<ChatService> {
    const service = new ChatService(deps);
    const rows = await deps.db
      .select({ id: users.id, until: users.chatMutedUntil, reason: users.chatMuteReason })
      .from(users)
      .where(isNotNull(users.chatMutedUntil));
    for (const r of rows) service.mutes.set(r.id, { until: banFromDate(r.until)!, reason: r.reason });
    return service;
  }

  /** The user's mute, or null when they may write. */
  muteOf(userId: number): ChatMute | null {
    const mute = this.mutes.get(userId);
    if (!mute) return null;
    if (mute.until > this.now()) return mute;
    this.mutes.delete(userId);
    return null;
  }

  async send(user: SessionUser, raw: string): Promise<ChatSendResult> {
    const { engine, season } = this.deps.runtime;
    const cfg = engine.config.chat;
    const now = this.now();
    if (!cfg.enabled) return { ok: false, code: "chat_disabled" };
    const text = normalizeChatText(raw);
    if (text === "") return { ok: false, code: "empty" };
    if ([...text].length > cfg.maxLength) return { ok: false, code: "too_long" };
    if (!engine.players.has(user.id) || accessBlocks(engine.players.get(user.id), engine.config, now).length > 0) return { ok: false, code: "no_access" };
    const mute = this.muteOf(user.id);
    if (mute) return { ok: false, code: "muted", until: toView(mute.until) };
    const last = this.lastSent.get(user.id);
    if (last !== undefined && now - last < cfg.cooldownMs) return { ok: false, code: "cooldown", retryAt: last + cfg.cooldownMs };
    // Taken before the insert, so two requests in flight cannot both pass the cooldown.
    this.lastSent.set(user.id, now);
    const [row] = await this.deps.db
      .insert(chatMessages)
      .values({ seasonId: season, userId: user.id, text, createdAt: new Date(now) })
      .returning({ id: chatMessages.id });
    const message: ChatMessage = { type: "chat", id: row!.id, author: this.deps.users.ref(user.id), text, at: now };
    this.deps.hub.publishChat(message);
    this.deps.metrics?.chatMessages.inc();
    return { ok: true, id: message.id };
  }

  async mute(admin: SessionUser, input: { userId: number; until: number | "permanent"; reason: string }): Promise<ChatModResult> {
    const [target] = await this.deps.db.select({ discordId: users.discordId }).from(users).where(eq(users.id, input.userId)).limit(1);
    if (!target) return { ok: false, code: "not_found" };
    if (input.userId === admin.id) return { ok: false, code: "self" };
    if (this.deps.isAdmin(target.discordId)) return { ok: false, code: "target_is_admin" };
    const until = input.until === "permanent" ? Number.POSITIVE_INFINITY : input.until;
    if (until <= this.now()) return { ok: false, code: "bad_until" };
    await this.writeMute(admin, input.userId, { until, reason: input.reason }, "chat_mute", { until: input.until, reason: input.reason });
    return { ok: true };
  }

  async unmute(admin: SessionUser, input: { userId: number; reason: string }): Promise<ChatModResult> {
    if (!this.muteOf(input.userId)) return { ok: false, code: "not_muted" };
    await this.writeMute(admin, input.userId, null, "chat_unmute", { reason: input.reason });
    return { ok: true };
  }

  async deleteMessage(admin: SessionUser, id: number): Promise<ChatModResult> {
    const deleted = await this.deps.db.transaction(async (tx) => {
      const rows = await tx
        .update(chatMessages)
        .set({ deletedAt: new Date(this.now()), deletedBy: admin.id })
        .where(and(eq(chatMessages.id, id), isNull(chatMessages.deletedAt)))
        .returning({ id: chatMessages.id, userId: chatMessages.userId });
      const row = rows[0];
      if (row) await tx.insert(modLog).values({ adminId: admin.id, action: "chat_delete", targetUserId: row.userId, params: { ids: [row.id] } });
      return rows;
    });
    if (deleted.length === 0) return { ok: false, code: "not_found" };
    this.deps.hub.publishChatDeleted([id]);
    return { ok: true, deleted: 1 };
  }

  /** Removes everything the user wrote in the last `periodMs`. */
  async deleteRecent(admin: SessionUser, input: { userId: number; periodMs: number }): Promise<ChatModResult> {
    const since = new Date(this.now() - input.periodMs);
    const ids = await this.deps.db.transaction(async (tx) => {
      const rows = await tx
        .update(chatMessages)
        .set({ deletedAt: new Date(this.now()), deletedBy: admin.id })
        .where(and(eq(chatMessages.userId, input.userId), gte(chatMessages.createdAt, since), isNull(chatMessages.deletedAt)))
        .returning({ id: chatMessages.id });
      const deleted = rows.map((r) => r.id);
      if (deleted.length > 0) {
        await tx
          .insert(modLog)
          .values({ adminId: admin.id, action: "chat_delete", targetUserId: input.userId, params: { ids: deleted, periodMs: input.periodMs } });
      }
      return deleted;
    });
    this.deps.hub.publishChatDeleted(ids);
    return { ok: true, deleted: ids.length };
  }

  /** Deletes messages older than the configured retention; returns how many. */
  async purge(): Promise<number> {
    const days = this.deps.runtime.engine.config.chat.retentionDays;
    const removed = await this.deps.db
      .delete(chatMessages)
      .where(lt(chatMessages.createdAt, new Date(this.now() - days * DAY_MS)))
      .returning({ id: chatMessages.id });
    return removed.length;
  }

  private async writeMute(
    admin: SessionUser,
    userId: number,
    mute: ChatMute | null,
    action: "chat_mute" | "chat_unmute",
    params: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ chatMutedUntil: banToDate(mute?.until ?? null), chatMuteReason: mute?.reason ?? null })
        .where(eq(users.id, userId));
      await tx.insert(modLog).values({ adminId: admin.id, action, targetUserId: userId, params });
    });
    if (mute) this.mutes.set(userId, mute);
    else this.mutes.delete(userId);
    this.lastSent.delete(userId);
    this.deps.hub.refreshPlayer(userId);
  }
}
