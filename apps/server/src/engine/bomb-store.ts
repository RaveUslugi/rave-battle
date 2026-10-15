import type { Rect } from "@rave/shared";
import type { UserId } from "./types";

export interface Bomb {
  x: number;
  y: number;
  ownerId: UserId;
  createdAt: number;
}

const cellKey = (x: number, y: number) => `${x}:${y}`;

/** Active bombs. Never serialized to clients. */
export class BombStore {
  private byCell = new Map<string, Bomb>();
  private perOwner = new Map<UserId, number>();

  /** Active bombs on the whole canvas. */
  get size(): number {
    return this.byCell.size;
  }

  get(x: number, y: number): Bomb | undefined {
    return this.byCell.get(cellKey(x, y));
  }

  add(bomb: Bomb): void {
    const key = cellKey(bomb.x, bomb.y);
    if (this.byCell.has(key)) throw new Error(`Cell ${key} already has a bomb`);
    this.byCell.set(key, bomb);
    this.perOwner.set(bomb.ownerId, this.activeCount(bomb.ownerId) + 1);
  }

  remove(x: number, y: number): Bomb | undefined {
    const key = cellKey(x, y);
    const bomb = this.byCell.get(key);
    if (!bomb) return undefined;
    this.byCell.delete(key);
    const left = this.activeCount(bomb.ownerId) - 1;
    if (left === 0) this.perOwner.delete(bomb.ownerId);
    else this.perOwner.set(bomb.ownerId, left);
    return bomb;
  }

  ownedBy(ownerId: UserId): Bomb[] {
    return [...this.byCell.values()].filter((b) => b.ownerId === ownerId);
  }

  /** Bombs inside the rectangle, bounds inclusive. */
  inRect(r: Rect): Bomb[] {
    return [...this.byCell.values()].filter((b) => b.x >= r.x1 && b.x <= r.x2 && b.y >= r.y1 && b.y <= r.y2);
  }

  activeCount(ownerId: UserId): number {
    return this.perOwner.get(ownerId) ?? 0;
  }

  /** Number of bombs in the 3x3 square centered on (x, y). */
  countAround(x: number, y: number): number {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (this.byCell.has(cellKey(x + dx, y + dy))) count++;
      }
    }
    return count;
  }
}
