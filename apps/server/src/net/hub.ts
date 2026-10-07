import {
  CHUNK_SIZE,
  ClientOp,
  decodeClientMessage,
  encodeChunkDelta,
  PROTOCOL_VERSION,
  type PlaceMessage,
  type PlayerView,
  type ServerMessage,
} from "@rave/shared";
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import type { SessionUser } from "../auth/session";
import type { EngineEvent } from "../engine/types";
import type { GameRuntime } from "../persistence/runtime";
import { TokenBucket } from "./rate-limit";
import type { UserDirectory } from "./user-directory";
import { buildChunkDeltas, buildFeed, ChunkVersions, toPlaceResultView, toPlayerView } from "./views";

export const GLOBAL_TOPIC = "global";
const chunkTopic = (key: string) => `chunk:${key}`;
const userTopic = (userId: number) => `user:${userId}`;

export interface SocketData {
  user: SessionUser | null;
  ip: string;
  chunks: Set<string>;
  bucket: TokenBucket;
}

export interface HubOptions {
  runtime: GameRuntime;
  users: UserDirectory;
  now?: () => number;
  messageRate?: { capacity: number; perSecond: number };
  maxConnectionsPerIp?: number;
  onlineDebounceMs?: number;
}

type Socket = ServerWebSocket<SocketData>;

const send = (ws: Socket, message: ServerMessage) => ws.send(JSON.stringify(message));

/** WebSocket handling plus broadcasting of committed engine events. */
export class Hub {
  readonly versions = new ChunkVersions();
  private server: Server<SocketData> | null = null;
  private connectionsByIp = new Map<string, number>();
  private onlineTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;
  private readonly messageRate: { capacity: number; perSecond: number };
  private readonly maxConnectionsPerIp: number;
  private readonly onlineDebounceMs: number;

  constructor(private readonly options: HubOptions) {
    this.now = options.now ?? Date.now;
    this.messageRate = options.messageRate ?? { capacity: 40, perSecond: 20 };
    this.maxConnectionsPerIp = options.maxConnectionsPerIp ?? 10;
    this.onlineDebounceMs = options.onlineDebounceMs ?? 1000;
  }

  attach(server: Server<SocketData>): void {
    this.server = server;
  }

  stop(): void {
    if (this.onlineTimer) clearTimeout(this.onlineTimer);
    this.onlineTimer = null;
  }

  /** Synchronously takes a connection slot for `ip`; call before any `await` in the upgrade path. */
  reserveConnection(ip: string): boolean {
    const count = this.connectionsByIp.get(ip) ?? 0;
    if (count >= this.maxConnectionsPerIp) return false;
    this.connectionsByIp.set(ip, count + 1);
    return true;
  }

  releaseConnection(ip: string): void {
    const left = (this.connectionsByIp.get(ip) ?? 1) - 1;
    if (left <= 0) this.connectionsByIp.delete(ip);
    else this.connectionsByIp.set(ip, left);
  }

  socketData(user: SessionUser | null, ip: string): SocketData {
    const { capacity, perSecond } = this.messageRate;
    return { user, ip, chunks: new Set(), bucket: new TokenBucket(capacity, perSecond, this.now()) };
  }

  /** `GameRuntime` onCommit hook: clients only ever see committed state. */
  handleCommit(events: EngineEvent[]): void {
    const server = this.server;
    if (!server) return;
    for (const delta of buildChunkDeltas(events, this.versions)) {
      server.publish(chunkTopic(`${delta.cx}:${delta.cy}`), encodeChunkDelta(delta));
    }
    for (const entry of buildFeed(events, this.options.users)) server.publish(GLOBAL_TOPIC, JSON.stringify(entry));
    const touched = new Set<number>();
    for (const e of events) if (e.type === "player") touched.add(e.userId);
    for (const userId of touched) {
      server.publish(userTopic(userId), JSON.stringify({ type: "player", player: this.playerView(userId) } satisfies ServerMessage));
    }
  }

  readonly websocket: WebSocketHandler<SocketData> = {
    data: {} as SocketData,
    open: (ws) => this.open(ws),
    message: (ws, message) => this.message(ws, message),
    close: (ws) => this.close(ws),
  };

  private playerView(userId: number): PlayerView {
    const engine = this.options.runtime.engine;
    return toPlayerView(engine.players.get(userId), engine.config, this.now());
  }

  private async open(ws: Socket): Promise<void> {
    const { user } = ws.data;
    ws.subscribe(GLOBAL_TOPIC);
    this.scheduleOnline();

    let player: PlayerView | null = null;
    if (user) {
      ws.subscribe(userTopic(user.id));
      try {
        // Guild membership is checked at Discord login (Plan 2c); dev users are always members.
        await this.options.runtime.addPlayer({
          userId: user.id,
          accountCreatedAt: user.discordCreatedAt,
          guildMember: true,
          bannedUntil: user.bannedUntil,
        });
        player = this.playerView(user.id);
      } catch {
        ws.close(1011, "unavailable");
        return;
      }
    }
    send(ws, {
      type: "hello",
      protocol: PROTOCOL_VERSION,
      user: user ? this.options.users.ref(user.id) : null,
      config: this.options.runtime.engine.config,
      player,
    });
  }

  private async message(ws: Socket, message: string | Buffer): Promise<void> {
    if (!ws.data.bucket.take(this.now())) {
      ws.close(1008, "rate limited");
      return;
    }
    if (typeof message === "string") {
      ws.close(1003, "binary frames only");
      return;
    }
    const msg = decodeClientMessage(message);
    if (!msg) {
      ws.close(1003, "malformed frame");
      return;
    }
    if (msg.op === ClientOp.Subscribe) this.subscribe(ws, msg.chunks);
    else await this.place(ws, msg);
  }

  private subscribe(ws: Socket, chunks: Array<{ cx: number; cy: number }>): void {
    const canvas = this.options.runtime.engine.canvas;
    const next = new Set(
      chunks
        .filter((c) => c.cx * CHUNK_SIZE < canvas.width && c.cy * CHUNK_SIZE < canvas.height)
        .map((c) => `${c.cx}:${c.cy}`),
    );
    for (const key of ws.data.chunks) if (!next.has(key)) ws.unsubscribe(chunkTopic(key));
    for (const key of next) if (!ws.data.chunks.has(key)) ws.subscribe(chunkTopic(key));
    ws.data.chunks = next;
  }

  private async place(ws: Socket, msg: PlaceMessage): Promise<void> {
    const user = ws.data.user;
    if (!user) {
      send(ws, { type: "placed", reqId: msg.reqId, result: { ok: false, code: "unauthorized" } });
      return;
    }
    try {
      const result = await this.options.runtime.run((engine, now) =>
        engine.placePixel(user.id, { x: msg.x, y: msg.y, colorId: msg.colorId, withBomb: msg.withBomb }, now),
      );
      send(ws, { type: "placed", reqId: msg.reqId, result: toPlaceResultView(result, this.options.users) });
    } catch {
      send(ws, { type: "placed", reqId: msg.reqId, result: { ok: false, code: "unavailable" } });
    }
  }

  private close(ws: Socket): void {
    this.releaseConnection(ws.data.ip);
    this.scheduleOnline();
  }

  private scheduleOnline(): void {
    if (this.onlineTimer) return;
    this.onlineTimer = setTimeout(() => {
      this.onlineTimer = null;
      const server = this.server;
      if (!server) return;
      const count = server.subscriberCount(GLOBAL_TOPIC);
      server.publish(GLOBAL_TOPIC, JSON.stringify({ type: "online", count } satisfies ServerMessage));
    }, this.onlineDebounceMs);
  }
}
