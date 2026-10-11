import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  CHUNK_SIZE,
  decodeChunkBody,
  decodeChunkDelta,
  decodeOverview,
  encodePlace,
  encodeSubscribe,
  type ChunkDelta,
  type ServerMessage,
} from "@rave/shared";
import type { Server } from "bun";
import { eq } from "drizzle-orm";
import { isAdmin } from "../auth/admin";
import type { DiscordConfig, FetchFn } from "../auth/discord";
import { users as usersTable } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { bootGame } from "../persistence/boot";
import { PERMANENT_BAN_DATE } from "../persistence/codec";
import type { GameRuntime } from "../persistence/runtime";
import { AdminService } from "../admin/service";
import { StatsService } from "../stats/service";
import type { ServerConfig } from "./env";
import { Hub, type HubOptions, type SocketData } from "./hub";
import { KeyedRateLimiter } from "./rate-limit";
import { startServer } from "./server";
import { UserDirectory } from "./user-directory";

const ORIGIN = "http://localhost:5173";
const t = createTestDb();

let runtime: GameRuntime;
let hub: Hub;
let server: Server<SocketData>;
let base = "";
const sockets: WebSocket[] = [];

async function start(
  options: { devLogin?: boolean; hub?: Partial<HubOptions>; discord?: DiscordConfig | null; fetch?: FetchFn; keepDb?: boolean; ipLimiter?: KeyedRateLimiter<string> } = {},
) {
  if (!options.keepDb) await t.reset();
  const users = await UserDirectory.load(t.db);
  let hubRef: Hub | undefined;
  runtime = await bootGame(t.db, { flushIntervalMs: 0, onFatal: () => {}, onCommit: (events) => hubRef?.handleCommit(events) });
  const config: ServerConfig = {
    databaseUrl: "",
    port: 0,
    publicOrigin: ORIGIN,
    allowedOrigins: new Set([ORIGIN]),
    devLogin: options.devLogin ?? true,
    secureCookies: false,
    sessionTtlMs: 86_400_000,
    adminDiscordIds: new Set(),
    discord: options.discord ?? null,
  };
  hub = new Hub({ runtime, users, onlineDebounceMs: 10, isAdmin: (u) => isAdmin(u.discordId, config), ...options.hub });
  hubRef = hub;
  const stats = new StatsService(t.db, runtime, users);
  const admin = new AdminService({ db: t.db, runtime, users, stats, isAdmin: (id) => isAdmin(id, config) });
  server = startServer({ db: t.db, runtime, hub, users, config, stats, admin, fetch: options.fetch, ipLimiter: options.ipLimiter });
  base = `http://localhost:${server.port}`;
}

/**
 * Bun 1.3.6: `server.stop()` never resolves once the server itself has closed a websocket
 * (reproducible with a bare Bun.serve; closes by the client are fine). The listener is shut
 * down synchronously, so we deliberately do not await the promise.
 */
async function shutdown(): Promise<void> {
  for (const ws of sockets.splice(0)) ws.close();
  void server.stop(true);
  hub.stop();
  await runtime.stop().catch(() => {});
}

beforeEach(() => start());
afterEach(shutdown);

async function login(name: string): Promise<string> {
  const res = await fetch(`${base}/auth/dev?name=${name}`, { redirect: "manual" });
  expect(res.status).toBe(302);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

interface Client {
  ws: WebSocket;
  json: ServerMessage[];
  deltas: ChunkDelta[];
  closed: Promise<number>;
}

function connect(cookie?: string): Promise<Client> {
  const ws = new WebSocket(`${base.replace("http", "ws")}/ws`, {
    headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
  });
  ws.binaryType = "arraybuffer";
  sockets.push(ws);
  const client: Client = { ws, json: [], deltas: [], closed: new Promise((resolve) => ws.addEventListener("close", (e) => resolve(e.code))) };
  ws.addEventListener("message", (e) => {
    if (typeof e.data === "string") client.json.push(JSON.parse(e.data));
    else client.deltas.push(decodeChunkDelta(new Uint8Array(e.data as ArrayBuffer))!);
  });
  return waitFor(() => client.json.find((m) => m.type === "hello")).then(() => client);
}

/** Resolves with the client once `hello` arrives, or with null if the connection fails or closes first. */
function tryConnect(cookie?: string): Promise<Client | null> {
  const ws = new WebSocket(`${base.replace("http", "ws")}/ws`, {
    headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
  });
  ws.binaryType = "arraybuffer";
  sockets.push(ws);
  const client: Client = { ws, json: [], deltas: [], closed: new Promise((resolve) => ws.addEventListener("close", (e) => resolve(e.code))) };
  return new Promise((resolve) => {
    ws.addEventListener("message", (e) => {
      if (typeof e.data !== "string") return;
      client.json.push(JSON.parse(e.data));
      if (client.json.some((m) => m.type === "hello")) resolve(client);
    });
    ws.addEventListener("error", () => resolve(null));
    ws.addEventListener("close", () => resolve(null));
  });
}

async function waitFor<T>(probe: () => T | undefined | false, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out");
    await Bun.sleep(5);
  }
}

const hello = (c: Client) => c.json.find((m): m is Extract<ServerMessage, { type: "hello" }> => m.type === "hello")!;

const placed = (c: Client, reqId: number) =>
  waitFor(() => c.json.find((m): m is Extract<ServerMessage, { type: "placed" }> => m.type === "placed" && m.reqId === reqId));

describe("http", () => {
  test("overview returns the sampled canvas", async () => {
    const alice = await connect(await login("alice"));
    alice.ws.send(encodePlace({ reqId: 1, x: 2, y: 2, colorId: 5, withBomb: false }));
    await placed(alice, 1);
    const res = await fetch(`${base}/overview`);
    expect(res.headers.get("cache-control")).toBe("public, max-age=5");
    const o = decodeOverview(new Uint8Array(await res.arrayBuffer()))!;
    expect(o).toMatchObject({ step: 2, width: 256, height: 256 });
    expect(o.colors[1 * 256 + 1]).toBe(5);
  });

  test("health", async () => {
    expect(await (await fetch(`${base}/health`)).text()).toBe("ok");
  });

  test("chunk endpoint returns version and colors; out-of-range is 404", async () => {
    const alice = await connect(await login("alice"));
    alice.ws.send(encodePlace({ reqId: 1, x: 3, y: 4, colorId: 5, withBomb: false }));
    await placed(alice, 1);
    const res = await fetch(`${base}/chunk/0/0`);
    const body = decodeChunkBody(new Uint8Array(await res.arrayBuffer()))!;
    expect(body.version).toBe(1);
    expect(body.colors[4 * CHUNK_SIZE + 3]).toBe(5);
    expect((await fetch(`${base}/chunk/2/0`)).status).toBe(404);
  });

  test("dev login is 404 when disabled", async () => {
    await shutdown();
    await start({ devLogin: false });
    expect((await fetch(`${base}/auth/dev?name=x`, { redirect: "manual" })).status).toBe(404);
  });

  test("websocket upgrades from foreign origins are refused", async () => {
    const res = await fetch(`${base}/ws`, {
      headers: { Origin: "http://evil.test", Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13" },
    });
    expect(res.status).toBe(403);
  });
});

describe("websocket", () => {
  test("a committed config change reaches everyone, and online players get a fresh view", async () => {
    const anon = await connect();
    const alice = await connect(await login("alice"));
    const before = runtime.engine.config.shop.bomb.price;
    const next = structuredClone(runtime.engine.config);
    next.shop.bomb.price = before + 7;
    const res = await runtime.run((engine) =>
      engine.applyConfig(next, { baseVersion: engine.configVersion, adminId: 1, comment: "pricier bombs", action: "config_save" }, Date.now()),
    );
    expect(res.ok).toBe(true);
    for (const c of [anon, alice]) {
      const msg = await waitFor(() => c.json.find((m): m is Extract<ServerMessage, { type: "config" }> => m.type === "config"));
      expect(msg.config.shop.bomb.price).toBe(before + 7);
    }
    await waitFor(() => alice.json.filter((m) => m.type === "player").length >= 1);
    expect(anon.json.some((m) => m.type === "player")).toBe(false);
  });

  test("dev login as admin places without charges", async () => {
    const admin = await connect(await login("admin"));
    expect(hello(admin).player?.unlimited).toBe(true);
    const cap = hello(admin).player!.chargeCap;
    for (let i = 1; i <= cap + 2; i++) admin.ws.send(encodePlace({ reqId: i, x: i, y: 0, colorId: 3, withBomb: true }));
    for (let i = 1; i <= cap + 2; i++) expect((await placed(admin, i)).result).toEqual({ ok: true, outcome: "placed" });
    const bob = await connect(await login("bob"));
    expect(hello(bob).player?.unlimited).toBe(false);
    expect(hello(admin).admin).toBe(true);
    expect(hello(bob).admin).toBe(false);
    expect(hello(await connect()).admin).toBe(false);
  });

  test("logout closes the sockets of that session only", async () => {
    const first = await login("alice");
    const second = await login("alice");
    const a = await connect(first);
    const b = await connect(second);
    await fetch(`${base}/auth/logout`, { method: "POST", headers: { Origin: ORIGIN, Cookie: first } });
    expect(await a.closed).toBe(4001);
    b.ws.send(encodePlace({ reqId: 1, x: 1, y: 1, colorId: 3, withBomb: false }));
    expect((await placed(b, 1)).result).toEqual({ ok: true, outcome: "placed" });
  });

  test("users outside the guild can watch but not place", async () => {
    const cookie = await login("outsider");
    await t.db.update(usersTable).set({ guildMember: false }).where(eq(usersTable.username, "outsider"));
    const c = await connect(cookie);
    c.ws.send(encodePlace({ reqId: 1, x: 1, y: 1, colorId: 3, withBomb: false }));
    expect((await placed(c, 1)).result).toEqual({ ok: false, code: "not_guild_member" });
  });

  test("anonymous viewers get config but cannot place", async () => {
    const viewer = await connect();
    expect(hello(viewer).user).toBeNull();
    expect(hello(viewer).player).toBeNull();
    expect(hello(viewer).config.canvas.width).toBe(512);
    viewer.ws.send(encodePlace({ reqId: 9, x: 1, y: 1, colorId: 3, withBomb: false }));
    expect((await placed(viewer, 9)).result).toEqual({ ok: false, code: "unauthorized" });
  });

  test("a placed pixel is acknowledged, broadcast to chunk subscribers and updates the player", async () => {
    const alice = await connect(await login("alice"));
    expect(hello(alice).user?.name).toBe("alice");
    expect(hello(alice).player?.coins).toBe(100);

    const viewer = await connect();
    viewer.ws.send(encodeSubscribe([{ cx: 0, cy: 0 }]));
    await Bun.sleep(20);

    alice.ws.send(encodePlace({ reqId: 1, x: 3, y: 4, colorId: 5, withBomb: false }));
    expect((await placed(alice, 1)).result).toEqual({ ok: true, outcome: "placed" });
    const delta = await waitFor(() => viewer.deltas[0]);
    expect(delta).toEqual({ cx: 0, cy: 0, fromVersion: 0, toVersion: 1, cells: [{ index: 4 * CHUNK_SIZE + 3, colorId: 5 }] });
    const update = await waitFor(() => alice.json.find((m): m is Extract<ServerMessage, { type: "player" }> => m.type === "player"));
    expect(update.player.coins).toBe(101);
  });

  test("bombs never leak: explosions produce a feed entry without coordinates and no chunk delta", async () => {
    const alice = await connect(await login("alice"));
    const bob = await connect(await login("bob"));
    const viewer = await connect();
    viewer.ws.send(encodeSubscribe([{ cx: 0, cy: 0 }]));
    await Bun.sleep(20);

    alice.ws.send(encodePlace({ reqId: 1, x: 5, y: 5, colorId: 3, withBomb: true }));
    await placed(alice, 1);
    const armed = await waitFor(() => viewer.deltas[0]);
    expect(armed.cells).toEqual([{ index: 5 * CHUNK_SIZE + 5, colorId: 3 }]);

    bob.ws.send(encodePlace({ reqId: 2, x: 5, y: 5, colorId: 9, withBomb: false }));
    const boom = await placed(bob, 2);
    expect(boom.result).toMatchObject({ ok: true, outcome: "exploded", self: false, bombOwner: { name: "alice" } });

    const feed = await waitFor(() => viewer.json.find((m) => m.type === "feed"));
    expect(Object.keys(feed).sort()).toEqual(["actor", "at", "kind", "owner", "type"]);

    alice.ws.send(encodePlace({ reqId: 3, x: 6, y: 6, colorId: 4, withBomb: false }));
    await placed(alice, 3);
    const next = await waitFor(() => viewer.deltas[1]);
    expect(next).toEqual({ cx: 0, cy: 0, fromVersion: 1, toVersion: 2, cells: [{ index: 6 * CHUNK_SIZE + 6, colorId: 4 }] });
    expect(viewer.deltas).toHaveLength(2);
  });

  test("moderation edits reach chunk subscribers as a delta without a feed entry", async () => {
    const alice = await connect(await login("alice"));
    const adminId = hello(alice).user!.id;
    const viewer = await connect();
    viewer.ws.send(encodeSubscribe([{ cx: 0, cy: 0 }]));
    await Bun.sleep(20);

    alice.ws.send(encodePlace({ reqId: 1, x: 3, y: 4, colorId: 5, withBomb: true }));
    await placed(alice, 1);
    await waitFor(() => viewer.deltas[0]);

    await runtime.run((e, now) =>
      e.applyModeration(
        {
          kind: "mod_clear",
          writes: [{ x: 3, y: 4, expect: { colorId: 5, ownerId: adminId }, colorId: 0, ownerId: 0 }],
          bombs: [{ x: 3, y: 4 }],
        },
        { adminId, action: "clear_area", targetUserId: null, params: {} },
        now,
      ),
    );
    const delta = await waitFor(() => viewer.deltas[1]);
    expect(delta).toEqual({ cx: 0, cy: 0, fromVersion: 1, toVersion: 2, cells: [{ index: 4 * CHUNK_SIZE + 3, colorId: 0 }] });
    await Bun.sleep(50);
    expect(viewer.json.some((m) => m.type === "feed")).toBe(false);
  });

  test("new connections get the recent feed right after hello", async () => {
    const alice = await connect(await login("alice"));
    const bob = await connect(await login("bob"));
    alice.ws.send(encodePlace({ reqId: 1, x: 5, y: 5, colorId: 3, withBomb: true }));
    await placed(alice, 1);
    bob.ws.send(encodePlace({ reqId: 2, x: 5, y: 5, colorId: 9, withBomb: false }));
    await placed(bob, 2);
    await waitFor(() => bob.json.find((m) => m.type === "feed"));

    const late = await connect();
    const history = await waitFor(() => late.json.find((m): m is Extract<ServerMessage, { type: "feed_history" }> => m.type === "feed_history"));
    expect(late.json[0]?.type).toBe("hello");
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]).toMatchObject({ type: "feed", kind: "exploded", actor: { name: "bob" }, owner: { name: "alice" } });
    expect(Object.keys(history.entries[0]!).sort()).toEqual(["actor", "at", "kind", "owner", "type"]);
  });

  test("the feed history keeps the latest 20 entries", async () => {
    const owner = await connect(await login("owner"));
    const victim = await connect(await login("victim"));
    for (let i = 0; i < 22; i++) {
      await runtime.run((engine) => {
        const o = engine.players.get(hello(owner).user!.id);
        const v = engine.players.get(hello(victim).user!.id);
        o.inventory.bomb = 1;
        o.charges = 10;
        v.charges = 10;
        v.frozenUntil = 0;
      });
      owner.ws.send(encodePlace({ reqId: 100 + i * 2, x: i, y: 10, colorId: 3, withBomb: true }));
      await placed(owner, 100 + i * 2);
      victim.ws.send(encodePlace({ reqId: 101 + i * 2, x: i, y: 10, colorId: 4, withBomb: false }));
      await placed(victim, 101 + i * 2);
      // Distinct timestamps, so the comparison below tells entries apart.
      await Bun.sleep(2);
    }
    const live = await waitFor(() => {
      const feed = owner.json.filter((m) => m.type === "feed");
      return feed.length === 22 && feed;
    });
    expect(new Set(live.map((m) => m.at)).size).toBe(22);
    const late = await connect();
    const history = await waitFor(() => late.json.find((m): m is Extract<ServerMessage, { type: "feed_history" }> => m.type === "feed_history"));
    expect(history.entries).toHaveLength(20);
    expect(history.entries).toEqual(live.slice(-20));
  });

  test("subscriptions are acknowledged with current chunk versions", async () => {
    type Subscribed = Extract<ServerMessage, { type: "subscribed" }>;
    const acks = (c: Client) => c.json.filter((m): m is Subscribed => m.type === "subscribed");
    const alice = await connect(await login("alice"));
    alice.ws.send(encodeSubscribe([{ cx: 0, cy: 0 }]));
    expect((await waitFor(() => acks(alice)[0])).chunks).toEqual([{ cx: 0, cy: 0, version: 0 }]);

    alice.ws.send(encodePlace({ reqId: 1, x: 3, y: 4, colorId: 5, withBomb: false }));
    await placed(alice, 1);
    alice.ws.send(encodeSubscribe([]));
    alice.ws.send(encodeSubscribe([{ cx: 0, cy: 0 }, { cx: 0, cy: 0 }]));
    expect((await waitFor(() => acks(alice)[1])).chunks).toEqual([{ cx: 0, cy: 0, version: 1 }]);
    await Bun.sleep(20);
    expect(acks(alice)).toHaveLength(2);
  });

  test("malformed and text frames close the socket with 1003", async () => {
    const a = await connect();
    a.ws.send(new Uint8Array([99]));
    expect(await a.closed).toBe(1003);
    const b = await connect();
    b.ws.send("hello");
    expect(await b.closed).toBe(1003);
  });

  test("oversized frames close the socket before they are parsed", async () => {
    const c = await connect();
    c.ws.send(new Uint8Array(5000));
    // Bun 1.3.6 drops the connection (client sees 1006); a parsed frame would give 1003.
    expect([1006, 1009]).toContain(await c.closed);
  });

  test("flooding closes the socket with 1008", async () => {
    await shutdown();
    await start({ hub: { messageRate: { capacity: 3, perSecond: 0.001 } } });
    const c = await connect();
    for (let i = 0; i < 5; i++) c.ws.send(encodeSubscribe([]));
    expect(await c.closed).toBe(1008);
  });

  test("a ban stored in users applies to a newly created player", async () => {
    const cookie = await login("alice");
    await t.db.update(usersTable).set({ bannedUntil: PERMANENT_BAN_DATE }).where(eq(usersTable.username, "alice"));
    const alice = await connect(cookie);
    expect(hello(alice).player?.bannedUntil).toBe("permanent");
    alice.ws.send(encodePlace({ reqId: 1, x: 1, y: 1, colorId: 3, withBomb: false }));
    expect((await placed(alice, 1)).result).toEqual({ ok: false, code: "banned" });
  });

  test("hello is the first message even when a frame arrives before it", async () => {
    const cookie = await login("alice");
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws`, { headers: { Origin: ORIGIN, Cookie: cookie } });
    sockets.push(ws);
    const types: string[] = [];
    ws.addEventListener("message", (e) => {
      if (typeof e.data === "string") types.push((JSON.parse(e.data) as ServerMessage).type);
    });
    ws.addEventListener("open", () => ws.send(encodePlace({ reqId: 1, x: 1, y: 1, colorId: 3, withBomb: false })));
    await waitFor(() => types.includes("placed") && types.includes("online"));
    expect(types[0]).toBe("hello");
    expect(types.indexOf("hello")).toBeLessThan(types.indexOf("placed"));
  });

  test("more than 16 frames before hello close the socket with 1008", async () => {
    const cookie = await login("alice");
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws`, { headers: { Origin: ORIGIN, Cookie: cookie } });
    sockets.push(ws);
    const closed = new Promise<number>((resolve) => ws.addEventListener("close", (e) => resolve(e.code)));
    ws.addEventListener("open", () => {
      for (let i = 0; i < 17; i++) ws.send(encodeSubscribe([]));
    });
    expect(await closed).toBe(1008);
  });

  test("logout clears the session", async () => {
    const cookie = await login("alice");
    const res = await fetch(`${base}/auth/logout`, { method: "POST", headers: { Origin: ORIGIN, Cookie: cookie } });
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    const after = await connect(cookie);
    expect(hello(after).user).toBeNull();
  });

  test("logout without an allowed origin is forbidden and keeps the session", async () => {
    const cookie = await login("alice");
    const noOrigin = await fetch(`${base}/auth/logout`, { method: "POST", headers: { Cookie: cookie } });
    expect(noOrigin.status).toBe(403);
    const evil = await fetch(`${base}/auth/logout`, { method: "POST", headers: { Origin: "http://evil.test", Cookie: cookie } });
    expect(evil.status).toBe(403);
    expect(hello(await connect(cookie)).user).not.toBeNull();
  });

  test("the per-ip limit holds for parallel upgrades and is released on close", async () => {
    await shutdown();
    await start({ hub: { maxConnectionsPerIp: 3 } });
    const results = await Promise.all(Array.from({ length: 6 }, () => tryConnect("rb_session=garbage")));
    const accepted = results.filter((c): c is Client => c !== null);
    expect(accepted).toHaveLength(3);
    accepted[0]!.ws.close();
    await accepted[0]!.closed;
    await Bun.sleep(20);
    expect(await tryConnect()).not.toBeNull();
  });

  test("hello carries a boot id that is stable per server start and changes on restart", async () => {
    const a = await connect();
    const b = await connect();
    const bootId = hello(a).bootId;
    expect(bootId).not.toBe("");
    expect(hello(b).bootId).toBe(bootId);
    await shutdown();
    await start();
    const c = await connect();
    expect(hello(c).bootId).not.toBe("");
    expect(hello(c).bootId).not.toBe(bootId);
  });

  test("closeAll closes open sockets with the given code", async () => {
    const a = await connect();
    hub.closeAll(1012, "server restart");
    expect(await a.closed).toBe(1012);
  });

  test("online count is broadcast", async () => {
    const a = await connect();
    await connect();
    const online = await waitFor(() => a.json.find((m) => m.type === "online" && m.count === 2));
    expect(online).toEqual({ type: "online", count: 2 });
  });
});

describe("discord login", () => {
  const discord: DiscordConfig = { clientId: "cid", clientSecret: "sec", redirectUri: `${ORIGIN}/auth/discord/callback`, guildId: "42" };

  /** Fake Discord: `guilds` decides membership, `fail` breaks the token endpoint. */
  function fakeDiscord(options: { guilds?: string[]; fail?: boolean; name?: string } = {}): FetchFn {
    return async (url) => {
      if (url === "https://discord.com/api/oauth2/token") {
        return options.fail ? new Response("{}", { status: 400 }) : Response.json({ access_token: "tok" });
      }
      if (url.endsWith("/users/@me")) {
        return Response.json({ id: "175928847299117063", username: "neko", global_name: options.name ?? "Neko", avatar: null });
      }
      if (url.includes("/users/@me/guilds")) return Response.json((options.guilds ?? ["42"]).map((id) => ({ id })));
      return new Response("unexpected", { status: 500 });
    };
  }

  async function restartWith(fetchFn: FetchFn) {
    await shutdown();
    await start({ discord, fetch: fetchFn });
  }

  /** Runs the redirect dance and returns the session cookie (or the final response when it fails). */
  async function discordLogin(): Promise<{ res: Response; cookie: string | null }> {
    const begin = await fetch(`${base}/auth/discord`, { redirect: "manual" });
    expect(begin.status).toBe(302);
    const state = new URL(begin.headers.get("location")!).searchParams.get("state")!;
    const stateCookie = begin.headers.get("set-cookie")!.split(";")[0]!;
    const res = await fetch(`${base}/auth/discord/callback?code=c0de&state=${state}`, { redirect: "manual", headers: { Cookie: stateCookie } });
    const session = res.headers.getSetCookie().find((c) => c.startsWith("rb_session="));
    return { res, cookie: session ? session.split(";")[0]! : null };
  }

  test("is 404 when discord is not configured", async () => {
    expect((await fetch(`${base}/auth/discord`, { redirect: "manual" })).status).toBe(404);
  });

  test("a guild member logs in and can play under their display name", async () => {
    await restartWith(fakeDiscord({ name: "Neko Raver" }));
    const { res, cookie } = await discordLogin();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const c = await connect(cookie!);
    expect(hello(c).user?.name).toBe("Neko Raver");
    c.ws.send(encodePlace({ reqId: 1, x: 1, y: 1, colorId: 3, withBomb: false }));
    expect((await placed(c, 1)).result).toEqual({ ok: true, outcome: "placed" });
  });

  test("leaving the guild takes effect on the next login for an existing player", async () => {
    await restartWith(fakeDiscord());
    const first = await connect((await discordLogin()).cookie!);
    first.ws.send(encodePlace({ reqId: 1, x: 1, y: 1, colorId: 3, withBomb: false }));
    await placed(first, 1);

    // Same database: the player is loaded as a member, the new login must revoke it via setAccess.
    await shutdown();
    await start({ discord, fetch: fakeDiscord({ guilds: ["7"] }), keepDb: true });
    const second = await connect((await discordLogin()).cookie!);
    second.ws.send(encodePlace({ reqId: 2, x: 2, y: 2, colorId: 3, withBomb: false }));
    expect((await placed(second, 2)).result).toEqual({ ok: false, code: "not_guild_member" });
  });

  function expectStateError(res: Response): void {
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?login_error=state");
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("rb_oauth_state=;") && c.includes("Max-Age=0"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("rb_session="))).toBe(false);
  }

  test("a mismatched state redirects with login_error=state", async () => {
    await restartWith(fakeDiscord());
    await fetch(`${base}/auth/discord`, { redirect: "manual" });
    const res = await fetch(`${base}/auth/discord/callback?code=c&state=forged`, { redirect: "manual", headers: { Cookie: "rb_oauth_state=real" } });
    expectStateError(res);
  });

  test("a cancelled authorization redirects with login_error=denied and no session", async () => {
    await restartWith(fakeDiscord());
    const begin = await fetch(`${base}/auth/discord`, { redirect: "manual" });
    const state = new URL(begin.headers.get("location")!).searchParams.get("state")!;
    const stateCookie = begin.headers.get("set-cookie")!.split(";")[0]!;
    const res = await fetch(`${base}/auth/discord/callback?error=access_denied&state=${state}`, { redirect: "manual", headers: { Cookie: stateCookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?login_error=denied");
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("rb_oauth_state=;") && c.includes("Max-Age=0"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("rb_session="))).toBe(false);
  });

  test("a callback without the state cookie redirects with login_error=state", async () => {
    await restartWith(fakeDiscord());
    const res = await fetch(`${base}/auth/discord/callback?code=c0de&state=anything`, { redirect: "manual" });
    expectStateError(res);
  });

  test("a callback with a valid state but no code and no error redirects with login_error=state", async () => {
    await restartWith(fakeDiscord());
    const begin = await fetch(`${base}/auth/discord`, { redirect: "manual" });
    const state = new URL(begin.headers.get("location")!).searchParams.get("state")!;
    const stateCookie = begin.headers.get("set-cookie")!.split(";")[0]!;
    const res = await fetch(`${base}/auth/discord/callback?state=${state}`, { redirect: "manual", headers: { Cookie: stateCookie } });
    expectStateError(res);
  });

  test("discord failures redirect with an error and create no session", async () => {
    await restartWith(fakeDiscord({ fail: true }));
    const { res, cookie } = await discordLogin();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?login_error=discord");
    expect(cookie).toBeNull();
  });
});

describe("trpc over http", () => {
  const post = (path: string, body: unknown, headers: Record<string, string>) =>
    fetch(`${base}/trpc/${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  // Response.json() is `unknown` under this TS version.
  const data = async (res: Response) => ((await res.json()) as { result: { data: any } }).result.data;

  test("queries work with the session cookie", async () => {
    const cookie = await login("alice");
    const res = await fetch(`${base}/trpc/me`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect((await data(res)).user.name).toBe("alice");
  });

  test("a batch is capped at 10 calls", async () => {
    const batch = (n: number) => fetch(`${base}/trpc/${Array(n).fill("me").join(",")}?batch=1`);
    expect((await batch(10)).status).toBe(200);
    expect((await batch(11)).status).toBe(400);
  });

  test("requests are limited per ip before any session lookup", async () => {
    await shutdown();
    await start({ ipLimiter: new KeyedRateLimiter<string>(3, 0.001) });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await fetch(`${base}/trpc/me`)).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  test("mutations require an allowed origin", async () => {
    const cookie = await login("alice");
    expect((await post("tools.detect", { x: 1, y: 1 }, { Cookie: cookie })).status).toBe(403);
    expect((await post("tools.detect", { x: 1, y: 1 }, { Cookie: cookie, Origin: "http://evil.test" })).status).toBe(403);
    const ok = await post("tools.detect", { x: 1, y: 1 }, { Cookie: cookie, Origin: ORIGIN });
    expect(ok.status).toBe(200);
    expect(await data(ok)).toEqual({ ok: true, count: 0 });
  });

  test("a defuse through trpc reaches websocket clients as a feed entry", async () => {
    const bobCookie = await login("bob");
    const bob = await connect(bobCookie);
    bob.ws.send(encodePlace({ reqId: 1, x: 5, y: 5, colorId: 3, withBomb: true }));
    await placed(bob, 1);
    const aliceCookie = await login("alice");
    const viewer = await connect();
    const aliceId = (await data(await fetch(`${base}/trpc/me`, { headers: { Cookie: aliceCookie } }))).user.id;
    await runtime.addPlayer({ userId: aliceId, accountCreatedAt: Date.UTC(2015, 0, 1), guildMember: true });
    await runtime.run((engine) => {
      engine.players.get(aliceId).inventory.defuser = 1;
    });
    const res = await post("tools.defuse", { x: 5, y: 5 }, { Cookie: aliceCookie, Origin: ORIGIN });
    expect(await data(res)).toEqual({ ok: true, found: true, reward: 20 });
    const feed = await waitFor(() => viewer.json.find((m) => m.type === "feed"));
    expect(feed).toMatchObject({ kind: "defused", actor: { name: "alice" }, owner: { name: "bob" } });
  });
});
