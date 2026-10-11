import { decodeChunkDelta, encodeSubscribe, PROTOCOL_VERSION, type ChunkDelta, type ServerMessage } from "@rave/shared/client";

export type HelloMessage = Extract<ServerMessage, { type: "hello" }>;
export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed" | "outdated";

export interface TransportHandlers {
  message(data: string | ArrayBuffer): void;
  close(code: number): void;
}

export interface Transport {
  send(data: Uint8Array): void;
  close(): void;
}

export type TransportFactory = (url: string, handlers: TransportHandlers) => Transport;

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface GameSocketEvents {
  hello(message: HelloMessage): void;
  /** Every JSON message except `hello`. */
  message(message: ServerMessage): void;
  delta(delta: ChunkDelta): void;
  status(status: ConnectionStatus): void;
  closed?(code: number): void;
  /** The server speaks another protocol version; the socket has stopped for good and will not reconnect. */
  outdated?(): void;
}

export interface GameSocketOptions {
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  timers?: Timers;
  /** Jitter source, 0..1. Injectable for tests. */
  random?: () => number;
}

const browserTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const browserTransport: TransportFactory = (url, handlers) => {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onmessage = (event) => handlers.message(event.data as string | ArrayBuffer);
  ws.onclose = (event) => handlers.close(event.code);
  return { send: (data) => ws.send(data as Uint8Array<ArrayBuffer>), close: () => ws.close() };
};

/** Same-origin WebSocket URL (the Vite proxy forwards it in development). */
export function socketUrl(location: Location): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

/** Keeps one connection alive, re-subscribes after every `hello`, decodes frames. */
export class GameSocket {
  private transport: Transport | null = null;
  private ready = false;
  private chunks: Array<{ cx: number; cy: number }> = [];
  private attempt = 0;
  private timer: unknown = null;
  private stopped = false;
  private readonly timers: Timers;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly random: () => number;

  constructor(
    private readonly url: string,
    private readonly factory: TransportFactory,
    private readonly events: GameSocketEvents,
    options: GameSocketOptions = {},
  ) {
    this.timers = options.timers ?? browserTimers;
    this.initialBackoffMs = options.initialBackoffMs ?? 500;
    this.maxBackoffMs = options.maxBackoffMs ?? 10_000;
    this.random = options.random ?? Math.random;
  }

  connect(): void {
    if (this.transport || this.stopped) return;
    this.events.status(this.attempt === 0 ? "connecting" : "reconnecting");
    this.transport = this.factory(this.url, {
      message: (data) => this.receive(data),
      close: (code) => this.handleClose(code),
    });
  }

  /** Replaces the subscription set; sent now if the server already said hello, otherwise after it. */
  subscribe(chunks: Array<{ cx: number; cy: number }>): void {
    this.chunks = chunks;
    if (this.ready) this.transport?.send(encodeSubscribe(chunks));
  }

  /** Sends a binary frame if the server already said hello; returns false when it cannot be sent now. */
  send(data: Uint8Array): boolean {
    if (!this.ready || !this.transport) return false;
    this.transport.send(data);
    return true;
  }

  close(): void {
    this.stopped = true;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    this.transport?.close();
    this.transport = null;
    this.ready = false;
    this.events.status("closed");
  }

  private receive(data: string | ArrayBuffer): void {
    if (typeof data !== "string") {
      const delta = decodeChunkDelta(new Uint8Array(data));
      if (delta) this.events.delta(delta);
      return;
    }
    let message: ServerMessage;
    try {
      message = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }
    if (message.type !== "hello") {
      this.events.message(message);
      return;
    }
    if (message.protocol !== PROTOCOL_VERSION) {
      // An old bundle cannot talk to this server; reconnecting would only repeat the mismatch.
      this.stopped = true;
      this.transport?.close();
      this.transport = null;
      this.ready = false;
      this.events.outdated?.();
      return;
    }
    this.attempt = 0;
    this.events.status("open");
    // The hello handler may call subscribe(); it only records the set until we are ready.
    this.events.hello(message);
    this.ready = true;
    if (this.chunks.length > 0) this.transport?.send(encodeSubscribe(this.chunks));
  }

  private handleClose(code: number): void {
    this.transport = null;
    this.ready = false;
    this.events.closed?.(code);
    if (this.stopped) return;
    this.events.status("reconnecting");
    const backoff = Math.min(this.maxBackoffMs, this.initialBackoffMs * 2 ** this.attempt);
    // Jitter spreads reconnects so a restarted server is not hit by every client at once.
    const delay = Math.round(backoff * (0.5 + 0.5 * this.random()));
    this.attempt++;
    this.timer = this.timers.set(() => {
      this.timer = null;
      this.connect();
    }, delay);
  }
}
