import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ChatMessage, TimelineEntry } from "@rave/shared";
import { eq } from "drizzle-orm";
import type { SessionUser } from "../auth/session";
import { bombs, chatMessages, modLog, users } from "../db/schema";
import { createTestDb, insertUser } from "../db/test-db";
import { UserDirectory } from "../net/user-directory";
import { bootGame } from "../persistence/boot";
import type { GameRuntime } from "../persistence/runtime";
import { ChatService, normalizeChatText } from "./service";
import { loadTimeline } from "./timeline";

const t = createTestDb();
const T0 = Date.UTC(2026, 9, 15, 12);
let clock = T0;
let runtime: GameRuntime;
let dir: UserDirectory;
let hub: { published: ChatMessage[]; deleted: number[][]; refreshed: number[] };
let chat: ChatService;
let ann: SessionUser;
let bob: SessionUser;
let admin: SessionUser;

const sessionUser = (id: number, name: string): SessionUser => ({
  id,
  username: name,
  discordCreatedAt: Date.UTC(2015, 0, 1),
  bannedUntil: null,
  guildMember: true,
  discordId: `discord-${name}`,
  banReason: null,
  locale: null,
  sessionId: `s-${name}`,
});

async function join(name: string): Promise<SessionUser> {
  const id = await insertUser(t.db, name);
  dir.set(id, name);
  await runtime.addPlayer({ userId: id, accountCreatedAt: Date.UTC(2015, 0, 1), guildMember: true });
  return sessionUser(id, name);
}

const makeChat = () =>
  ChatService.load({
    db: t.db,
    runtime,
    users: dir,
    isAdmin: (discordId) => discordId === "discord-admin",
    now: () => clock,
    hub: {
      publishChat: (m) => hub.published.push(m),
      publishChatDeleted: (ids) => hub.deleted.push(ids),
      refreshPlayer: (id) => hub.refreshed.push(id),
    },
  });

beforeEach(async () => {
  await t.reset();
  clock = T0;
  runtime = await bootGame(t.db, { flushIntervalMs: 0, onFatal: () => {}, now: () => clock });
  dir = new UserDirectory();
  hub = { published: [], deleted: [], refreshed: [] };
  ann = await join("ann");
  bob = await join("bob");
  admin = await join("admin");
  chat = await makeChat();
});
afterEach(() => runtime.stop());
afterAll(() => t.close());

const later = (ms: number) => {
  clock += ms;
};

describe("normalizeChatText", () => {
  test("one line, no control characters, trimmed", () => {
    expect(normalizeChatText("  hi\nthere\r\n\tall \u0007 ")).toBe("hi there all");
  });
});

describe("send", () => {
  test("stores, broadcasts and returns the id", async () => {
    const res = await chat.send(ann, "  привет  ");
    expect(res.ok).toBe(true);
    const [row] = await t.db.select().from(chatMessages);
    expect(row).toMatchObject({ userId: ann.id, text: "привет", createdAt: new Date(T0) });
    expect(hub.published).toEqual([{ type: "chat", id: row!.id, author: { id: ann.id, name: "ann" }, text: "привет", at: T0 }]);
  });

  test("rejects empty, too long and disabled", async () => {
    expect(await chat.send(ann, " \n ")).toEqual({ ok: false, code: "empty" });
    // Length counts characters, not UTF-16 units: 200 emoji fit, 201 do not.
    expect((await chat.send(ann, "🙂".repeat(200))).ok).toBe(true);
    later(10_000);
    expect(await chat.send(ann, "🙂".repeat(201))).toEqual({ ok: false, code: "too_long" });
    runtime.engine.config.chat.enabled = false;
    expect(await chat.send(ann, "hi")).toEqual({ ok: false, code: "chat_disabled" });
  });

  test("players who may only watch cannot write", async () => {
    await runtime.run((engine) => engine.setAccess(ann.id, { bannedUntil: T0 + 60_000, banReason: "x" }));
    expect(await chat.send(ann, "hi")).toEqual({ ok: false, code: "no_access" });
    expect(await chat.send(sessionUser(9999, "ghost"), "hi")).toEqual({ ok: false, code: "no_access" });
  });

  test("cooldown between messages", async () => {
    expect((await chat.send(ann, "one")).ok).toBe(true);
    later(1000);
    expect(await chat.send(ann, "two")).toEqual({ ok: false, code: "cooldown", retryAt: T0 + 3000 });
    expect((await chat.send(bob, "other user is fine")).ok).toBe(true);
    later(2000);
    expect((await chat.send(ann, "three")).ok).toBe(true);
  });
});

describe("mute", () => {
  test("blocks writing until it ends, is logged and refreshes the player", async () => {
    expect(await chat.mute(admin, { userId: ann.id, until: T0 + 60_000, reason: "spam" })).toEqual({ ok: true });
    expect(await chat.send(ann, "hi")).toEqual({ ok: false, code: "muted", until: T0 + 60_000 });
    expect(chat.muteOf(ann.id)).toEqual({ until: T0 + 60_000, reason: "spam" });
    expect(hub.refreshed).toEqual([ann.id]);
    const [row] = await t.db.select().from(users).where(eq(users.id, ann.id));
    expect(row).toMatchObject({ chatMutedUntil: new Date(T0 + 60_000), chatMuteReason: "spam" });
    expect((await t.db.select().from(modLog)).map((r) => r.action)).toEqual(["chat_mute"]);
    later(60_000);
    expect(chat.muteOf(ann.id)).toBeNull();
    expect((await chat.send(ann, "back")).ok).toBe(true);
  });

  test("permanent mutes survive a restart; unmute lifts them", async () => {
    await chat.mute(admin, { userId: ann.id, until: "permanent", reason: "x" });
    const reloaded = await makeChat();
    expect(reloaded.muteOf(ann.id)?.until).toBe(Number.POSITIVE_INFINITY);
    expect(await reloaded.send(ann, "hi")).toEqual({ ok: false, code: "muted", until: "permanent" });
    expect(await reloaded.unmute(admin, { userId: ann.id, reason: "ok" })).toEqual({ ok: true });
    expect((await reloaded.send(ann, "hi")).ok).toBe(true);
    expect(await reloaded.unmute(admin, { userId: ann.id, reason: "ok" })).toEqual({ ok: false, code: "not_muted" });
  });

  test("refuses self, admins, the past and unknown users", async () => {
    expect(await chat.mute(admin, { userId: admin.id, until: T0 + 1, reason: "x" })).toEqual({ ok: false, code: "self" });
    const other = await join("other");
    const asOther = { ...other, discordId: "discord-other" };
    expect(await chat.mute(asOther, { userId: admin.id, until: T0 + 1, reason: "x" })).toEqual({ ok: false, code: "target_is_admin" });
    expect(await chat.mute(admin, { userId: ann.id, until: T0, reason: "x" })).toEqual({ ok: false, code: "bad_until" });
    expect(await chat.mute(admin, { userId: 9999, until: T0 + 1, reason: "x" })).toEqual({ ok: false, code: "not_found" });
  });
});

describe("delete", () => {
  test("one message: hidden, broadcast and logged once", async () => {
    const sent = await chat.send(ann, "bad");
    const id = sent.ok ? sent.id : 0;
    expect(await chat.deleteMessage(admin, id)).toEqual({ ok: true, deleted: 1 });
    expect(hub.deleted).toEqual([[id]]);
    expect(await chat.deleteMessage(admin, id)).toEqual({ ok: false, code: "not_found" });
    const [log] = await t.db.select().from(modLog);
    expect(log).toMatchObject({ action: "chat_delete", targetUserId: ann.id, params: { ids: [id] } });
  });

  test("recent messages of one user within the period", async () => {
    await chat.send(ann, "old");
    later(2 * 3_600_000);
    const recent = await chat.send(ann, "new");
    await chat.send(bob, "bob's");
    expect(await chat.deleteRecent(admin, { userId: ann.id, periodMs: 3_600_000 })).toEqual({ ok: true, deleted: 1 });
    expect(hub.deleted).toEqual([[recent.ok ? recent.id : 0]]);
    const left = await t.db.select({ text: chatMessages.text, deletedAt: chatMessages.deletedAt }).from(chatMessages).orderBy(chatMessages.id);
    expect(left.map((r) => [r.text, r.deletedAt !== null])).toEqual([
      ["old", false],
      ["new", true],
      ["bob's", false],
    ]);
  });
});

test("purge removes messages older than the retention", async () => {
  await chat.send(ann, "ancient");
  later(31 * 86_400_000);
  await chat.send(ann, "fresh");
  expect(await chat.purge()).toBe(1);
  expect((await t.db.select({ text: chatMessages.text }).from(chatMessages)).map((r) => r.text)).toEqual(["fresh"]);
});

describe("loadTimeline", () => {
  test("merges explosions, defuses and live messages by time, newest last, within the limit", async () => {
    const season = runtime.season;
    const bomb = (x: number, at: number, reason: "exploded" | "defused" | "moderated") => ({
      seasonId: season,
      x,
      y: 0,
      ownerId: ann.id,
      createdAt: new Date(at - 1000),
      removedAt: new Date(at),
      removedReason: reason,
      removedBy: bob.id,
    });
    await t.db.insert(bombs).values([bomb(1, T0 + 1000, "exploded"), bomb(2, T0 + 3000, "defused"), bomb(3, T0 + 4000, "moderated")]);
    await t.db.insert(chatMessages).values([
      { seasonId: season, userId: ann.id, text: "a", createdAt: new Date(T0 + 2000) },
      { seasonId: season, userId: bob.id, text: "deleted", createdAt: new Date(T0 + 2500), deletedAt: new Date(T0 + 2600) },
      { seasonId: season, userId: bob.id, text: "b", createdAt: new Date(T0 + 5000) },
    ]);
    const kinds = (entries: TimelineEntry[]) => entries.map((e) => (e.type === "chat" ? e.text : e.kind));
    expect(kinds(await loadTimeline(t.db, season, dir, 10))).toEqual(["exploded", "a", "defused", "b"]);
    expect(kinds(await loadTimeline(t.db, season, dir, 2))).toEqual(["defused", "b"]);
  });
});
