import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import type { SessionUser } from "../auth/session";
import { createTestDb, insertUser } from "../db/test-db";
import type { AppDeps } from "../net/deps";
import type { ServerConfig } from "../net/env";
import { Hub } from "../net/hub";
import { UserRateLimiter } from "../net/rate-limit";
import { UserDirectory } from "../net/user-directory";
import { bootGame } from "../persistence/boot";
import type { GameRuntime } from "../persistence/runtime";
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
  discord: null,
};

let runtime: GameRuntime;
let deps: AppDeps;
let alice: SessionUser;
let bob: SessionUser;

const sessionUser = (id: number, username: string): SessionUser => ({
  id,
  username,
  discordCreatedAt: Date.UTC(2020, 0, 1),
  bannedUntil: null,
  guildMember: true,
  sessionId: `s-${id}`,
});

beforeEach(async () => {
  await t.reset();
  alice = sessionUser(await insertUser(t.db, "alice"), "alice");
  bob = sessionUser(await insertUser(t.db, "bob"), "bob");
  const users = await UserDirectory.load(t.db);
  runtime = await bootGame(t.db, { flushIntervalMs: 0, onFatal: () => {} });
  deps = { db: t.db, runtime, hub: new Hub({ runtime, users }), users, config };
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
});
