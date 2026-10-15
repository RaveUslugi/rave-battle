import { describe, expect, test } from "bun:test";
import type { ChunkDelta } from "@rave/shared";
import { ChunkSync, type SyncAction } from "./chunk-sync";

/**
 * Randomized event simulation of one client against a server: server-side versions, HTTP bodies
 * that are read at one moment and delivered later (or fail and get retried), a FIFO websocket
 * with subscription acks, reconnects and track/untrack churn. Every chunk must end up equal to
 * the server's state once writes stop. Deterministic: fixed seeds, inline PRNG.
 */

const CELLS = 8;
const CHUNKS = 3;
const END = 20_000;

/** xorshift32 in [0, 1). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 2 ** 32;
  };
}

function simulate(seed: number, writeGap: number): string[] {
  const r = rng(seed);
  const queue: Array<{ t: number; fn: () => void }> = [];
  let now = 0;
  // Stable insertion: events at the same time run in scheduling order.
  const at = (t: number, fn: () => void) => {
    let lo = 0;
    let hi = queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (queue[mid]!.t <= t) lo = mid + 1;
      else hi = mid;
    }
    queue.splice(lo, 0, { t, fn });
  };

  const server = Array.from({ length: CHUNKS }, () => ({ version: 0, colors: new Uint8Array(CELLS) }));
  let connection = 0;
  let serverSubs = new Set<number>();
  let downFree = 0;
  let upFree = 0;
  const wsSend = (fn: () => void) => {
    const c = connection;
    downFree = Math.max(downFree, now) + r() * 30;
    at(downFree, () => {
      if (c === connection) fn();
    });
  };

  const sync = new ChunkSync();
  const local = Array.from({ length: CHUNKS }, () => new Uint8Array(CELLS));
  const tracked = new Set<number>();
  let connected = true;
  let flushScheduled = false;

  const run = (actions: SyncAction[]) => {
    for (const a of actions) {
      const c = a.cx;
      if (a.type === "replace") local[c]!.set(a.colors);
      else if (a.type === "apply") for (const cell of a.cells) local[c]![cell.index] = cell.colorId;
      else {
        const id = a.requestId;
        at(now + r() * 200, () => {
          if (r() < 0.2) {
            at(now + r() * 100 + 50, () => run(sync.retry(c, 0, id)));
            return;
          }
          const version = server[c]!.version;
          const colors = server[c]!.colors.slice();
          at(now + r() * 300, () => run(sync.onLoaded(c, 0, id, version, colors)));
        });
      }
    }
  };

  const flush = () => {
    flushScheduled = false;
    if (!connected) return;
    const want = new Set(tracked);
    const c = connection;
    upFree = Math.max(upFree, now) + r() * 30;
    at(upFree, () => {
      if (c !== connection) return;
      const added: Array<{ cx: number; version: number }> = [];
      for (const cx of want) if (!serverSubs.has(cx)) added.push({ cx, version: server[cx]!.version });
      serverSubs = want;
      if (added.length) wsSend(() => added.forEach((a) => run(sync.onAck(a.cx, 0, a.version))));
    });
  };
  const scheduleFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;
    at(now + 150 * r(), flush);
  };
  const track = (c: number) => {
    tracked.add(c);
    run(sync.track(c, 0));
    scheduleFlush();
  };
  const untrack = (c: number) => {
    tracked.delete(c);
    sync.untrack(c, 0);
    scheduleFlush();
  };

  for (let t = 0; t < END; t += r() * writeGap) {
    at(t, () => {
      const c = Math.floor(r() * CHUNKS);
      const index = Math.floor(r() * CELLS);
      const colorId = 1 + Math.floor(r() * 200);
      server[c]!.colors[index] = colorId;
      const fromVersion = server[c]!.version++;
      const d: ChunkDelta = { cx: c, cy: 0, fromVersion, toVersion: fromVersion + 1, cells: [{ index, colorId }] };
      if (serverSubs.has(c)) wsSend(() => run(sync.onDelta(d)));
    });
  }
  for (let c = 0; c < CHUNKS; c++) at(r() * 100, () => track(c));
  for (let t = 500; t < END; t += 300 + r() * 1500) {
    at(t, () => {
      const c = Math.floor(r() * CHUNKS);
      if (!tracked.has(c)) return track(c);
      untrack(c);
      at(now + r() * 400, () => track(c));
    });
  }
  for (let t = 1000; t < END; t += 1000 + r() * 4000) {
    at(t, () => {
      connection++;
      connected = false;
      serverSubs = new Set();
      at(now + 100 + r() * 1000, () => {
        connected = true;
        scheduleFlush();
      });
    });
  }
  at(END + 1, () => {
    for (let c = 0; c < CHUNKS; c++) if (!tracked.has(c)) track(c);
  });

  while (queue.length > 0) {
    const e = queue.shift()!;
    now = Math.max(now, e.t);
    e.fn();
  }

  const bad: string[] = [];
  for (let c = 0; c < CHUNKS; c++) {
    const { version, colors } = server[c]!;
    if (!local[c]!.every((v, i) => v === colors[i])) bad.push(`seed ${seed} gap ${writeGap}: chunk ${c} colors differ`);
    // A ready chunk at the server's version applies the next delta directly.
    const next = sync.onDelta({ cx: c, cy: 0, fromVersion: version, toVersion: version + 1, cells: [] });
    if (next.length !== 1 || next[0]!.type !== "apply") bad.push(`seed ${seed} gap ${writeGap}: chunk ${c} not ready at v${version}`);
  }
  return bad;
}

describe("ChunkSync simulation", () => {
  // 3 000 simulations: ~6 s on a 4-vCPU container, more on shared CI runners. Slow, not flaky.
  test("every chunk converges to the server under reconnects, load failures and churn", () => {
    const bad: string[] = [];
    for (const writeGap of [10, 40, 200]) for (let seed = 1; seed <= 1000; seed++) bad.push(...simulate(seed, writeGap));
    expect(bad).toEqual([]);
  }, 30_000);
});
