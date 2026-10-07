export interface Pending {
  reqId: number;
  x: number;
  y: number;
  colorId: number;
  withBomb: boolean;
  at: number;
}

/** Placements sent to the server and not answered yet. */
export class PendingPlacements {
  private items = new Map<number, Pending>();
  private nextId = 1;

  add(cell: { x: number; y: number }, colorId: number, withBomb: boolean, now: number): Pending {
    // The wire format has a u32 request id.
    const reqId = this.nextId;
    this.nextId = this.nextId >= 0xffff_ffff ? 1 : this.nextId + 1;
    const pending = { reqId, x: cell.x, y: cell.y, colorId, withBomb, at: now };
    this.items.set(reqId, pending);
    return pending;
  }

  resolve(reqId: number): Pending | undefined {
    const pending = this.items.get(reqId);
    this.items.delete(reqId);
    return pending;
  }

  /** Removes and returns entries sent more than `ttlMs` ago. */
  expire(now: number, ttlMs: number): Pending[] {
    const gone = [...this.items.values()].filter((p) => now - p.at >= ttlMs);
    for (const p of gone) this.items.delete(p.reqId);
    return gone;
  }

  clear(): void {
    this.items.clear();
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
