import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { gameConfigSchema } from "@rave/shared";
import { AdminService } from "../admin/service";
import { isAdmin } from "../auth/admin";
import type { SessionUser } from "../auth/session";
import { statsDaily } from "../db/schema";
import { createTestDb, insertUser } from "../db/test-db";
import type { AppDeps } from "../net/deps";
import type { ServerConfig } from "../net/env";
import { Hub } from "../net/hub";
import { UserRateLimiter } from "../net/rate-limit";
import { UserDirectory } from "../net/user-directory";
import { bootGame } from "../persistence/boot";
import type { GameRuntime } from "../persistence/runtime";
import { StatsService } from "../stats/service";
import { createCallerFactory } from "./init";
import { appRouter } from "./router";

const t = createTestDb();
const createCaller = createCallerFactory(appRouter);
const config: ServerConfig = {
  databaseUrl: "",
  port: 0,
  publicOrigin: "http://localhost:5173",
  allowedOrigins: new Set(["http://localhost:5173"]),
  devLogin: true,
  secureCookies: false,
  sessionTtlMs: 86_400_000,
  adminDiscordIds: new Set(["discord-admin"]),
  discord: null,
  trustProxy: false,
};

let runtime: GameRuntime;
let deps: AppDeps;
let alice: SessionUser;
let bob: SessionUser;
let admin: SessionUser;

const sessionUser = (id: number, username: string): SessionUser => ({
  id,
  username,
  discordCreatedAt: Date.UTC(2020, 0, 1),
  bannedUntil: null,
  guildMember: true,
  discordId: `discord-${username}`,
  banReason: null,
  sessionId: `s-${id}`,
});

beforeEach(async () => {
  await t.reset();
  alice = sessionUser(await insertUser(t.db, "alice"), "alice");
  bob = sessionUser(await insertUser(t.db, "bob"), "bob");
  admin = sessionUser(await insertUser(t.db, "admin"), "admin");
  const users = await UserDirectory.load(t.db);
  runtime = await bootGame(t.db, { flushIntervalMs: 0, onFatal: () => {} });
  const stats = new StatsService(t.db, runtime, users);
  const adminService = new AdminService({ db: t.db, runtime, users, stats, isAdmin: (id) => isAdmin(id, config) });
  deps = { db: t.db, runtime, hub: new Hub({ db: t.db, runtime, users }), users, config, stats, admin: adminService };
});
afterEach(() => runtime.stop());
afterAll(() => t.close());

const as = (user: SessionUser | null, limiter = new UserRateLimiter(100, 100)) => createCaller({ deps, user, limiter });

describe("appRouter", () => {
  test("me is null for anonymous visitors and describes the player otherwise", async () => {
    expect(await as(null).me()).toBeNull();
    await as(alice).daily.claim();
    const me = await as(alice).me();
    expect(me?.user).toEqual({ id: alice.id, name: "alice" });
    expect(me?.player?.coins).toBe(130);
  });

  test("admin.whoami reports admin rights from the server config", async () => {
    expect(await as(null).admin.whoami()).toEqual({ admin: false });
    expect(await as(alice).admin.whoami()).toEqual({ admin: false });
    expect(await as(sessionUser(99, "admin")).admin.whoami()).toEqual({ admin: true });
  });

  test("player actions require a session", async () => {
    await expect(as(null).daily.claim()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  test("shop purchases return engine results", async () => {
    expect(await as(alice).shop.buyItem({ item: "bomb" })).toEqual({ ok: true });
    expect(runtime.engine.players.get(alice.id).inventory.bomb).toBe(4);
    expect(await as(alice).shop.buyColor({ colorId: 3 })).toEqual({ ok: false, code: "not_for_sale" });
    expect(await as(alice).shop.buyChargeBoost()).toEqual({ ok: false, code: "insufficient_coins" });
  });

  test("daily can be claimed once per day", async () => {
    expect(await as(alice).daily.claim()).toEqual({ ok: true, reward: { item: "coins", amount: 30 } });
    expect(await as(alice).daily.claim()).toEqual({ ok: false, code: "already_claimed" });
  });

  test("detector counts and defuser removes another player's bomb", async () => {
    await runtime.addPlayer({ userId: bob.id, accountCreatedAt: Date.UTC(2020, 0, 1), guildMember: true });
    await runtime.run((engine, now) => engine.placePixel(bob.id, { x: 5, y: 5, colorId: 3, withBomb: true }, now));
    expect(await as(alice).tools.detect({ x: 4, y: 4 })).toEqual({ ok: true, count: 1 });
    expect(await as(alice).tools.defuse({ x: 5, y: 5 })).toEqual({ ok: false, code: "no_defuser" });
    await runtime.run((engine) => {
      engine.players.get(alice.id).inventory.defuser = 1;
    });
    expect(await as(alice).tools.defuse({ x: 5, y: 5 })).toEqual({ ok: true, found: true, reward: 20 });
    expect(runtime.engine.bombs.get(5, 5)).toBeUndefined();
  });

  test("invalid input is rejected before reaching the engine", async () => {
    await expect(as(alice).tools.detect({ x: -1, y: 0 })).rejects.toBeInstanceOf(TRPCError);
    await expect(as(alice).shop.buyColor({ colorId: 256 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("calls are rate limited per user", async () => {
    const limiter = new UserRateLimiter(2, 0.001);
    await as(alice, limiter).daily.claim();
    await as(alice, limiter).daily.claim();
    await expect(as(alice, limiter).daily.claim()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(await as(bob, limiter).daily.claim()).toMatchObject({ ok: true });
  });

  test("leaderboards return the top and the caller's place; anonymous callers get no place", async () => {
    await runtime.addPlayer({ userId: alice.id, accountCreatedAt: Date.UTC(2020, 0, 1), guildMember: true });
    await runtime.run((engine, now) => engine.placePixel(alice.id, { x: 1, y: 1, colorId: 3, withBomb: false }, now));
    const board = await as(alice).stats.leaderboard({ board: "artists", period: "all" });
    expect(board.top).toEqual([{ rank: 1, user: { id: alice.id, name: "alice" }, value: 1 }]);
    expect(board.me).toEqual({ rank: 1, value: 1 });
    expect((await as(bob).stats.leaderboard({ board: "artists", period: "all" })).me).toBeNull();
    expect((await as(null).stats.leaderboard({ board: "territory", period: "day" })).top[0]?.value).toBe(1);
  });

  test("the top is capped at 50 and a caller outside it still gets a place", async () => {
    const date = new Date().toISOString().slice(0, 10);
    const rows = [];
    for (let i = 0; i < 55; i++) {
      const userId = await insertUser(t.db, `p${i}`);
      rows.push({ userId, seasonId: runtime.season, date, pixels: 100 - i });
    }
    rows.push({ userId: alice.id, seasonId: runtime.season, date, pixels: 1 });
    await t.db.insert(statsDaily).values(rows);
    const board = await as(alice).stats.leaderboard({ board: "artists", period: "all" });
    expect(board.top).toHaveLength(50);
    expect(board.top[0]?.value).toBe(100);
    expect(board.top.some((r) => r.user.id === alice.id)).toBe(false);
    expect(board.me).toEqual({ rank: 56, value: 1 });
    expect((await as(null).stats.leaderboard({ board: "artists", period: "all" })).me).toBeNull();
  });

  test("profiles are public and unknown ids are NOT_FOUND", async () => {
    expect((await as(null).stats.profile({ userId: alice.id })).user.name).toBe("alice");
    await expect(as(null).stats.profile({ userId: 99999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(as(null).stats.profile({ userId: 3e9 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(as(null).stats.leaderboard({ board: "nope" as never, period: "all" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("admin procedures: anonymous is UNAUTHORIZED, a regular player FORBIDDEN", async () => {
    await expect(as(null).admin.players.search({ q: "a" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(as(alice).admin.players.search({ q: "a" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as(alice).admin.config.save({ baseVersion: 1, config: {}, comment: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("an admin bans bob and bob's own view shows the block and the reason", async () => {
    await as(bob).daily.claim();
    expect(await as(admin).admin.players.ban({ userId: bob.id, until: "permanent", reason: "spam" })).toEqual({ ok: true });
    const me = await as(bob).me();
    expect(me?.player?.blocks).toEqual(["banned"]);
    expect(me?.player?.banReason).toBe("spam");
    expect(await as(admin).admin.players.search({ q: "bob" })).toEqual([
      { id: bob.id, name: "bob", discordId: "discord-bob", banned: true },
    ]);
    await expect(as(admin).admin.players.get({ userId: 99999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("moderation actions with mixed variant fields are rejected", async () => {
    const area = { x1: 0, y1: 0, x2: 1, y2: 1 };
    await expect(as(admin).admin.moderation.preview({ action: { kind: "remove_bombs", userId: bob.id, area } as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("admin inputs are validated: integer deltas, ban reason, user id", async () => {
    await expect(as(admin).admin.players.adjust({ userId: bob.id, changes: { coins: 1.5 }, comment: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(as(admin).admin.players.ban({ userId: bob.id, until: "permanent", reason: "  " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(as(admin).admin.players.ban({ userId: bob.id, until: 1e300, reason: "r" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(as(admin).admin.players.get({ userId: 3e9 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("config.current is a valid config and the mod log is paged by cursor", async () => {
    const { version, config: current } = await as(admin).admin.config.current();
    expect(version).toBe(1);
    expect(() => gameConfigSchema.parse(current)).not.toThrow();
    await as(admin).admin.players.ban({ userId: bob.id, until: "permanent", reason: "r" });
    const log = await as(admin).admin.modLog({ cursor: null });
    expect(log.entries.map((e) => e.action)).toEqual(["ban"]);
    expect(log.next).toBeNull();
  });

  test("canvas and moderation procedures are admin-only; bad areas are rejected with a code", async () => {
    const action = { kind: "clear_area", area: { x1: 0, y1: 0, x2: 1, y2: 1 }, mode: "fill" } as const;
    await expect(as(alice).admin.canvas.inspect({ cell: { x: 0, y: 0 } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as(alice).admin.moderation.execute({ action })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as(admin).admin.canvas.inspect({ cell: { x: 1_000_000, y: 0 } })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await as(admin).admin.canvas.inspect({ cell: { x: 0, y: 0 } })).toMatchObject({ owner: null, bomb: null, history: [] });
    const wide = { kind: "clear_area", area: { x1: 0, y1: 0, x2: 256, y2: 255 }, mode: "fill" } as const;
    expect(await as(admin).admin.moderation.preview({ action: wide })).toEqual({ ok: false, code: "area_too_large" });
    expect(await as(admin).admin.moderation.execute({ action: wide })).toEqual({ ok: false, code: "area_too_large" });
    expect(await as(admin).admin.moderation.preview({ action: { kind: "remove_bombs", userId: alice.id } })).toEqual({ ok: true, cells: 0, bombs: 0, bbox: null });
  });
});
