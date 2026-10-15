import type { ChunkDelta } from "@rave/shared/client";

export type SyncAction =
  | { type: "load"; cx: number; cy: number; requestId: number }
  | { type: "replace"; cx: number; cy: number; colors: Uint8Array }
  | { type: "apply"; cx: number; cy: number; cells: ChunkDelta["cells"] };

type Entry = { status: "loading"; requestId: number; buffered: ChunkDelta[]; minVersion: number } | { status: "ready"; version: number };

const key = (cx: number, cy: number) => `${cx}:${cy}`;

/**
 * Per-chunk version bookkeeping. Deltas carry absolute cell values and a `from → to` version pair;
 * the HTTP chunk body carries the version it reflects. Pure: returns actions for the caller to run.
 */
export class ChunkSync {
  private entries = new Map<string, Entry>();
  private nextRequestId = 1;

  track(cx: number, cy: number): SyncAction[] {
    if (this.entries.has(key(cx, cy))) return [];
    return this.startLoad(cx, cy, []);
  }

  untrack(cx: number, cy: number): void {
    this.entries.delete(key(cx, cy));
  }

  reset(): void {
    this.entries.clear();
  }

  onLoaded(cx: number, cy: number, requestId: number, version: number, colors: Uint8Array): SyncAction[] {
    const entry = this.entries.get(key(cx, cy));
    if (!entry || entry.status !== "loading" || entry.requestId !== requestId) return [];
    const actions: SyncAction[] = [{ type: "replace", cx, cy, colors }];
    let current = version;
    // Deltas of one chunk arrive in version order on a single socket.
    for (const d of entry.buffered) {
      if (d.toVersion <= current) continue;
      if (d.fromVersion !== current) return [...actions, ...this.startLoad(cx, cy, [], entry.minVersion)];
      actions.push({ type: "apply", cx, cy, cells: d.cells });
      current = d.toVersion;
    }
    // An ack received during the load proves the server is newer than this body.
    if (current < entry.minVersion) return [...actions, ...this.startLoad(cx, cy, [], entry.minVersion)];
    this.entries.set(key(cx, cy), { status: "ready", version: current });
    return actions;
  }

  onDelta(d: ChunkDelta): SyncAction[] {
    const entry = this.entries.get(key(d.cx, d.cy));
    if (!entry) return [];
    if (entry.status === "loading") {
      entry.buffered.push(d);
      return [];
    }
    if (d.toVersion <= entry.version) return [];
    if (d.fromVersion === entry.version) {
      entry.version = d.toVersion;
      return [{ type: "apply", cx: d.cx, cy: d.cy, cells: d.cells }];
    }
    // Missed something: reload, keeping this delta in case the body is older than it.
    return this.startLoad(d.cx, d.cy, [d]);
  }

  /** Subscription acknowledgement: the server's current version of a newly subscribed chunk. */
  onAck(cx: number, cy: number, version: number): SyncAction[] {
    const entry = this.entries.get(key(cx, cy));
    if (!entry) return [];
    if (entry.status === "loading") {
      // The body in flight may predate the ack; checked in onLoaded.
      entry.minVersion = Math.max(entry.minVersion, version);
      return [];
    }
    if (version <= entry.version) return [];
    return this.startLoad(cx, cy, [], version);
  }

  /** Re-requests a load that failed, unless it was superseded meanwhile. */
  retry(cx: number, cy: number, requestId: number): SyncAction[] {
    const entry = this.entries.get(key(cx, cy));
    if (!entry || entry.status !== "loading" || entry.requestId !== requestId) return [];
    return this.startLoad(cx, cy, entry.buffered, entry.minVersion);
  }

  private startLoad(cx: number, cy: number, buffered: ChunkDelta[], minVersion = 0): SyncAction[] {
    const requestId = this.nextRequestId++;
    this.entries.set(key(cx, cy), { status: "loading", requestId, buffered, minVersion });
    return [{ type: "load", cx, cy, requestId }];
  }
}
