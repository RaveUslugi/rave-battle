import { describe, expect, test } from "bun:test";
import { decodeClientMessage, defaultConfig, encodeChunkDelta, encodePlace, type ChunkDelta, type ServerMessage } from "@rave/shared";
import { GameSocket, type Timers, type TransportFactory, type TransportHandlers } from "./socket";

function harness() {
  const transports: Array<{ handlers: TransportHandlers; sent: Uint8Array[]; closed: boolean }> = [];
  const factory: TransportFactory = (_url, handlers) => {
    const transport = { handlers, sent: [] as Uint8Array[], closed: false };
    transports.push(transport);
    return { send: (data) => transport.sent.push(data), close: () => void (transport.closed = true) };
  };
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const fakeTimers: Timers = {
    set: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clear: () => {},
  };
  const log: string[] = [];
  const deltas: ChunkDelta[] = [];
  const messages: ServerMessage[] = [];
  const socket = new GameSocket(
    "ws://test/ws",
    factory,
    {
      hello: (m) => log.push(`hello:${m.bootId}`),
      message: (m) => messages.push(m),
      delta: (d) => deltas.push(d),
      status: (s) => log.push(s),
      closed: (code) => log.push(`closed:${code}`),
    },
    { initialBackoffMs: 100, maxBackoffMs: 400, random: () => 1, timers: fakeTimers },
  );
  return { socket, transports, timers, log, deltas, messages };
}

const hello = (bootId = "b1") =>
  JSON.stringify({ type: "hello", protocol: 1, bootId, user: null, config: defaultConfig, player: null } satisfies ServerMessage);

describe("GameSocket", () => {
  test("reports connecting, then open with hello", () => {
    const h = harness();
    h.socket.connect();
    h.transports[0]!.handlers.message(hello());
    expect(h.log).toEqual(["connecting", "open", "hello:b1"]);
  });

  test("subscriptions are sent only after hello, once per change", () => {
    const h = harness();
    h.socket.subscribe([{ cx: 0, cy: 0 }]);
    h.socket.connect();
    const t = h.transports[0]!;
    expect(t.sent).toHaveLength(0);
    t.handlers.message(hello());
    expect(t.sent.map(decodeClientMessage)).toEqual([{ op: 1, chunks: [{ cx: 0, cy: 0 }] }]);
    h.socket.subscribe([{ cx: 1, cy: 0 }]);
    expect(t.sent).toHaveLength(2);
  });

  test("binary frames become deltas, JSON becomes messages, garbage is ignored", () => {
    const h = harness();
    h.socket.connect();
    const t = h.transports[0]!;
    t.handlers.message(hello());
    const d: ChunkDelta = { cx: 1, cy: 2, fromVersion: 0, toVersion: 1, cells: [{ index: 3, colorId: 4 }] };
    t.handlers.message(encodeChunkDelta(d).buffer as ArrayBuffer);
    t.handlers.message(JSON.stringify({ type: "online", count: 3 }));
    t.handlers.message("{");
    expect(h.deltas).toEqual([d]);
    expect(h.messages).toEqual([{ type: "online", count: 3 }]);
  });

  test("reconnects with capped exponential backoff and resubscribes after hello", () => {
    const h = harness();
    h.socket.subscribe([{ cx: 0, cy: 0 }]);
    h.socket.connect();
    h.transports[0]!.handlers.message(hello());
    for (let i = 0; i < 4; i++) {
      h.transports[i]!.handlers.close(1006);
      h.timers[i]!.fn();
    }
    expect(h.timers.map((t) => t.ms)).toEqual([100, 200, 400, 400]);
    const fresh = h.transports[4]!;
    fresh.handlers.message(hello());
    expect(fresh.sent.map(decodeClientMessage)).toEqual([{ op: 1, chunks: [{ cx: 0, cy: 0 }] }]);
    fresh.handlers.close(1012);
    expect(h.timers[4]!.ms).toBe(100);
    expect(h.log).toContain("closed:1012");
    expect(h.log).toContain("reconnecting");
  });

  test("close() stops reconnecting", () => {
    const h = harness();
    h.socket.connect();
    h.socket.close();
    expect(h.transports[0]!.closed).toBe(true);
    h.transports[0]!.handlers.close(1000);
    expect(h.timers).toHaveLength(0);
    expect(h.log).toContain("closed");
  });

  test("send works only after hello", () => {
    const h = harness();
    expect(h.socket.send(new Uint8Array([1]))).toBe(false);
    h.socket.connect();
    expect(h.socket.send(new Uint8Array([1]))).toBe(false);
    h.transports[0]!.handlers.message(hello());
    const frame = encodePlace({ reqId: 5, x: 1, y: 2, colorId: 3, withBomb: false });
    expect(h.socket.send(frame)).toBe(true);
    expect(decodeClientMessage(h.transports[0]!.sent[0]!)).toMatchObject({ reqId: 5, x: 1, y: 2 });
    h.transports[0]!.handlers.close(1006);
    expect(h.socket.send(frame)).toBe(false);
  });

  test("reconnect delays are jittered between half and the full backoff", () => {
    const delays = [0, 0.5, 1].map((random) => {
      const timers: number[] = [];
      const socket = new GameSocket(
        "ws://test/ws",
        (_url, handlers) => {
          queueMicrotask(() => handlers.close(1006));
          return { send: () => {}, close: () => {} };
        },
        { hello: () => {}, message: () => {}, delta: () => {}, status: () => {} },
        { initialBackoffMs: 1000, maxBackoffMs: 10_000, random: () => random, timers: { set: (_fn, ms) => void timers.push(ms), clear: () => {} } },
      );
      socket.connect();
      return timers;
    });
    return Promise.resolve().then(() => {
      expect(delays).toEqual([[500], [750], [1000]]);
    });
  });
});
