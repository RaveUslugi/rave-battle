export interface Pending {
  reqId: number;
  x: number;
  y: number;
  colorId: number;
  withBomb: boolean;
  at: number;
}

/** How many expired requests still get their late answer matched. */
const LATE_MEMORY = 64;

/** Placements sent to the server and not answered yet. */
export class PendingPlacements {
  private items = new Map<number, Pending>();
  /** Expired entries, oldest first: a late answer may still explain an explosion. */
  private late = new Map<number, Pending>();
  private nextId = 1;

  add(cell: { x: number; y: number }, colorId: number, withBomb: boolean, now: number): Pending {
    // The wire format has a u32 request id.
    const reqId = this.nextId;
    this.nextId = this.nextId >= 0xffff_ffff ? 1 : this.nextId + 1;
    const pending = { reqId, x: cell.x, y: cell.y, colorId, withBomb, at: now };
    this.items.set(reqId, pending);
    return pending;
  }

  resolve(reqId: number): { item: Pending; late: boolean } | undefined {
    const item = this.items.get(reqId);
    if (item) {
      this.items.delete(reqId);
      return { item, late: false };
    }
    const lateItem = this.late.get(reqId);
    if (!lateItem) return undefined;
    this.late.delete(reqId);
    return { item: lateItem, late: true };
  }

  /** Removes and returns entries sent more than `ttlMs` ago; they are remembered for late answers. */
  expire(now: number, ttlMs: number): Pending[] {
    const gone = [...this.items.values()].filter((p) => now - p.at >= ttlMs);
    for (const p of gone) {
      this.items.delete(p.reqId);
      this.late.set(p.reqId, p);
    }
    for (const reqId of this.late.keys()) {
      if (this.late.size <= LATE_MEMORY) break;
      this.late.delete(reqId);
    }
    return gone;
  }

  /** After a disconnect no answer will come, late or not. */
  clear(): void {
    this.items.clear();
    this.late.clear();
  }

  list(): Pending[] {
    return [...this.items.values()];
  }

  get size(): number {
    return this.items.size;
  }

  get bombs(): number {
    return this.list().filter((p) => p.withBomb).length;
  }
}
