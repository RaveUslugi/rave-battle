import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  CHUNK_SIZE,
  decodeChunkBody,
  decodeChunkDelta,
  encodePlace,
  encodeSubscribe,
  type ChunkDelta,
  type ServerMessage,
} from "@rave/shared";
import type { Server } from "bun";
import { eq } from "drizzle-orm";
import { users as usersTable } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { bootGame } from "../persistence/boot";
import { PERMANENT_BAN_DATE } from "../persistence/codec";
import type { GameRuntime } from "../persistence/runtime";
import type { ServerConfig } from "./env";
import { Hub, type HubOptions, type SocketData } from "./hub";
import { startServer } from "./server";
import { UserDirectory } from "./user-directory";

const ORIGIN = "http://localhost:5173";
const t = createTestDb();

let runtime: GameRuntime;
let hub: Hub;
let server: Server<SocketData>;
let base = "";
const sockets: WebSocket[] = [];

async function start(options: { devLogin?: boolean; hub?: Partial<HubOptions> } = {}) {
  await t.reset();
  const users = await UserDirectory.load(t.db);
  let hubRef: Hub | undefined;
  runtime = await bootGame(t.db, { flushIntervalMs: 0, onFatal: () => {}, onCommit: (events) => hubRef?.handleCommit(events) });
  hub = new Hub({ runtime, users, onlineDebounceMs: 10, ...options.hub });
  hubRef = hub;
  const config: ServerConfig = {
    databaseUrl: "",
    port: 0,
    publicOrigin: ORIGIN,
    allowedOrigins: new Set([ORIGIN]),
    devLogin: options.devLogin ?? true,
    secureCookies: false,
    sessionTtlMs: 86_400_000,
  };
  server = startServer({ db: t.db, runtime, hub, users, config });
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
    const res = await fetch(`${base}/auth/logout`, { method: "POST", headers: { Cookie: cookie } });
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    const after = await connect(cookie);
    expect(hello(after).user).toBeNull();
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

  test("online count is broadcast", async () => {
    const a = await connect();
    await connect();
    const online = await waitFor(() => a.json.find((m) => m.type === "online" && m.count === 2));
    expect(online).toEqual({ type: "online", count: 2 });
  });
});
