import type { UserId } from "./types";

/** Limits how many bomb triggers of the same owner→victim pair count toward the rating per day. */
export class AntiFarm {
  private day: string | null = null;
  private counts = new Map<string, number>();

  /** Registers a trigger; returns true if it should count toward the rating. */
  register(day: string, ownerId: UserId, victimId: UserId, limit: number): boolean {
    if (day !== this.day) {
      this.day = day;
      this.counts.clear();
    }
    const key = `${ownerId}:${victimId}`;
    const seen = this.counts.get(key) ?? 0;
    this.counts.set(key, seen + 1);
    return seen < limit;
  }
}
