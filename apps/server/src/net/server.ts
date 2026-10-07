import { CHUNK_SIZE, encodeChunkBody } from "@rave/shared";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { Server } from "bun";
import { finishDiscordLogin, startDiscordLogin } from "../auth/discord-routes";
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  readSessionToken,
  resolveSession,
  sessionCookie,
  sessionIdOf,
} from "../auth/session";
import { upsertUser } from "../auth/users";
import { appRouter } from "../trpc/router";
import type { AppDeps } from "./deps";
import type { Hub, SocketData } from "./hub";
import { UserRateLimiter } from "./rate-limit";

/** Dev accounts look old enough to pass the account-age check. */
const DEV_ACCOUNT_CREATED_AT = new Date(Date.UTC(2015, 0, 1));
const CHUNK_PATH = /^\/chunk\/(\d+)\/(\d+)$/;

export function startServer(deps: AppDeps): Server<SocketData> {
  const limiter = deps.limiter ?? new UserRateLimiter(20, 5);
  const server = Bun.serve({
    port: deps.config.port,
    fetch: (req, srv) => route(req, srv, deps, limiter),
    websocket: deps.hub.websocket,
  });
  deps.hub.attach(server);
  return server;
}

async function route(
  req: Request,
  server: Server<SocketData>,
  deps: AppDeps,
  limiter: UserRateLimiter,
): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (url.pathname === "/ws") return upgrade(req, server, deps);
  if (req.method === "GET" && url.pathname === "/health") return new Response("ok");
  const chunk = req.method === "GET" ? CHUNK_PATH.exec(url.pathname) : null;
  if (chunk) return chunkResponse(deps, Number(chunk[1]), Number(chunk[2]));
  if (req.method === "GET" && url.pathname === "/auth/discord" && deps.config.discord) return startDiscordLogin(deps);
  if (req.method === "GET" && url.pathname === "/auth/discord/callback" && deps.config.discord) return finishDiscordLogin(req, deps);
  if (req.method === "GET" && url.pathname === "/auth/dev" && deps.config.devLogin) return devLogin(url, deps);
  if (req.method === "POST" && url.pathname === "/auth/logout") return logout(req, deps);
  if (url.pathname.startsWith("/trpc/")) return trpc(req, deps, limiter);
  return new Response("Not found", { status: 404 });
}

function originAllowed(req: Request, deps: AppDeps): boolean {
  const origin = req.headers.get("origin");
  return origin !== null && deps.config.allowedOrigins.has(origin);
}

async function upgrade(req: Request, server: Server<SocketData>, deps: AppDeps): Promise<Response | undefined> {
  if (!originAllowed(req, deps)) return new Response("Forbidden origin", { status: 403 });
  const ip = server.requestIP(req)?.address ?? "unknown";
  if (!deps.hub.reserveConnection(ip)) return new Response("Too many connections", { status: 429 });
  try {
    const token = readSessionToken(req, deps.config.secureCookies);
    const user = token ? await resolveSession(deps.db, token, Date.now()) : null;
    if (server.upgrade(req, { data: deps.hub.socketData(user, ip) })) return undefined;
  } catch (error) {
    deps.hub.releaseConnection(ip);
    throw error;
  }
  deps.hub.releaseConnection(ip);
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

/** Application close code: the session behind this socket ended. */
const CLOSE_LOGGED_OUT = 4001;

async function logout(req: Request, deps: AppDeps): Promise<Response> {
  if (!originAllowed(req, deps)) return new Response("Forbidden origin", { status: 403 });
  const token = readSessionToken(req, deps.config.secureCookies);
  if (token) {
    await deleteSession(deps.db, token);
    deps.hub.disconnectSession(sessionIdOf(token), CLOSE_LOGGED_OUT, "logged out");
  }
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearSessionCookie(deps.config.secureCookies) } });
}

async function trpc(req: Request, deps: AppDeps, limiter: UserRateLimiter): Promise<Response> {
  // Cookie auth: state-changing calls must come from our own pages, like the WebSocket.
  if (req.method !== "GET" && !originAllowed(req, deps)) return new Response("Forbidden origin", { status: 403 });
  const token = readSessionToken(req, deps.config.secureCookies);
  const user = token ? await resolveSession(deps.db, token, Date.now()) : null;
  return fetchRequestHandler({
    endpoint: "/trpc",
    req,
    router: appRouter,
    createContext: () => ({ deps, user, limiter }),
    onError: ({ error, path }) => {
      if (error.code === "INTERNAL_SERVER_ERROR") console.error("tRPC error", path, error);
    },
  });
}
