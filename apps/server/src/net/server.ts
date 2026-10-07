import { CHUNK_SIZE, encodeChunkBody } from "@rave/shared";
import type { Server } from "bun";
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  readSessionToken,
  resolveSession,
  sessionCookie,
} from "../auth/session";
import { upsertUser } from "../auth/users";
import type { Db } from "../db/client";
import type { GameRuntime } from "../persistence/runtime";
import type { ServerConfig } from "./env";
import type { Hub, SocketData } from "./hub";
import type { UserDirectory } from "./user-directory";

export interface AppDeps {
  db: Db;
  runtime: GameRuntime;
  hub: Hub;
  users: UserDirectory;
  config: ServerConfig;
}

/** Dev accounts look old enough to pass the account-age check. */
const DEV_ACCOUNT_CREATED_AT = new Date(Date.UTC(2015, 0, 1));
const CHUNK_PATH = /^\/chunk\/(\d+)\/(\d+)$/;

export function startServer(deps: AppDeps): Server<SocketData> {
  const server = Bun.serve({
    port: deps.config.port,
    fetch: (req, srv) => route(req, srv, deps),
    websocket: deps.hub.websocket,
  });
  deps.hub.attach(server);
  return server;
}

async function route(req: Request, server: Server<SocketData>, deps: AppDeps): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (url.pathname === "/ws") return upgrade(req, server, deps);
  if (req.method === "GET" && url.pathname === "/health") return new Response("ok");
  const chunk = req.method === "GET" ? CHUNK_PATH.exec(url.pathname) : null;
  if (chunk) return chunkResponse(deps, Number(chunk[1]), Number(chunk[2]));
  if (req.method === "GET" && url.pathname === "/auth/dev" && deps.config.devLogin) return devLogin(url, deps);
  if (req.method === "POST" && url.pathname === "/auth/logout") return logout(req, deps);
  return new Response("Not found", { status: 404 });
}

async function upgrade(req: Request, server: Server<SocketData>, deps: AppDeps): Promise<Response | undefined> {
  const origin = req.headers.get("origin");
  if (!origin || !deps.config.allowedOrigins.has(origin)) return new Response("Forbidden origin", { status: 403 });
  const ip = server.requestIP(req)?.address ?? "unknown";
  if (!deps.hub.canConnect(ip)) return new Response("Too many connections", { status: 429 });
  const token = readSessionToken(req, deps.config.secureCookies);
  const user = token ? await resolveSession(deps.db, token, Date.now()) : null;
  if (server.upgrade(req, { data: deps.hub.socketData(user, ip) })) return undefined;
  return new Response("WebSocket upgrade required", { status: 426 });
}

function chunkResponse(deps: AppDeps, cx: number, cy: number): Response {
  const canvas = deps.runtime.engine.canvas;
  if (cx * CHUNK_SIZE >= canvas.width || cy * CHUNK_SIZE >= canvas.height) return new Response("Not found", { status: 404 });
  const colors = canvas.getChunk(cx, cy)?.colors ?? new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  const body = Bun.gzipSync(encodeChunkBody(deps.hub.versions.get(cx, cy), colors) as Uint8Array<ArrayBuffer>);
  return new Response(body, {
    headers: { "Content-Type": "application/octet-stream", "Content-Encoding": "gzip", "Cache-Control": "no-store" },
  });
}

async function devLogin(url: URL, deps: AppDeps): Promise<Response> {
  const name = url.searchParams.get("name") ?? "";
  if (!/^[a-z0-9_]{1,32}$/i.test(name)) return new Response("Bad name", { status: 400 });
  const id = await upsertUser(deps.db, { discordId: `dev:${name}`, username: name, avatar: null, discordCreatedAt: DEV_ACCOUNT_CREATED_AT });
  deps.users.set(id, name);
  const { token, expiresAt } = await createSession(deps.db, id, deps.config.sessionTtlMs, Date.now());
  return new Response(null, {
    status: 302,
    headers: { Location: "/", "Set-Cookie": sessionCookie(token, expiresAt, deps.config.secureCookies) },
  });
}

async function logout(req: Request, deps: AppDeps): Promise<Response> {
  const token = readSessionToken(req, deps.config.secureCookies);
  if (token) await deleteSession(deps.db, token);
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearSessionCookie(deps.config.secureCookies) } });
}
