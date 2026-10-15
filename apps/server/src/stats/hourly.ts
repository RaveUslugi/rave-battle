import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { statsHourly } from "../db/schema";
import type { EngineEvent } from "../engine/types";

const HOUR_MS = 3_600_000;

export const HOURLY_COUNTERS = [
  "pixels",
  "explosions",
  "defuses",
  "mintedPixels",
  "mintedDaily",
  "mintedBombBonus",
  "mintedDefuse",
  "mintedAdmin",
  "spentBomb",
  "spentDetector",
  "spentDefuser",
  "spentColor",
  "spentBoost",
  "spentPenalty",
  "spentAdmin",
] as const;
export type HourlyCounter = (typeof HOURLY_COUNTERS)[number];
type Pending = Partial<Record<HourlyCounter | "onlinePeak", number>>;

export const hourStart = (at: number) => Math.floor(at / HOUR_MS) * HOUR_MS;

const SPENT_BY_PRODUCT: Record<string, HourlyCounter> = {
  bomb: "spentBomb",
  detector: "spentDetector",
  defuser: "spentDefuser",
  color: "spentColor",
  chargeCapBoost: "spentBoost",
};

/** Which counter a committed coin movement goes to; null for coins that are neither minted nor spent here. */
function coinCounter(e: Extract<EngineEvent, { type: "ledger" }>): HourlyCounter | null {
  if (e.item !== "coins") return null;
  if (e.delta > 0) {
    if (e.reason === "daily") return "mintedDaily";
    if (e.reason === "bomb_bonus") return "mintedBombBonus";
    if (e.reason === "defuse") return "mintedDefuse";
    if (e.reason === "admin") return "mintedAdmin";
    return null;
  }
  if (e.reason === "shop") return SPENT_BY_PRODUCT[String(e.ref.product)] ?? null;
  if (e.reason === "explosion") return "spentPenalty";
  if (e.reason === "admin") return "spentAdmin";
  return null;
}

/**
 * Accumulates server-wide activity per clock hour from committed engine events and online counts,
 * and adds it to `stats_hourly` on `flush` (sums are added, the online peak keeps the maximum).
 */
export class HourlyStats {
  private pending = new Map<number, Pending>();
  private flushing: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: Db,
    private readonly seasonId: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** `GameRuntime` onCommit hook. */
  record(events: EngineEvent[]): void {
    for (const e of events) {
      if (e.type === "pixel" && e.kind === "place") this.add(e.at, "pixels", 1);
      else if (e.type === "bomb_removed" && e.reason === "exploded") this.add(e.at, "explosions", 1);
      else if (e.type === "bomb_removed" && e.reason === "defused") this.add(e.at, "defuses", 1);
      // Pixel coins are aggregated as a stat, not written to the ledger row by row.
      else if (e.type === "stat" && e.stat === "coinsFromPixels") this.add(this.now(), "mintedPixels", e.delta);
      else if (e.type === "ledger") {
        const counter = coinCounter(e);
        if (counter) this.add(e.at, counter, Math.abs(e.delta));
      }
    }
  }

  observeOnline(count: number): void {
    const bucket = this.bucket(hourStart(this.now()));
    bucket.onlinePeak = Math.max(bucket.onlinePeak ?? 0, count);
  }

  /** Writes what accumulated so far; flushes never overlap. */
  flush(): Promise<void> {
    const next = this.flushing.then(() => this.write());
    this.flushing = next.catch(() => {});
    return next;
  }

  private add(at: number, counter: HourlyCounter, delta: number): void {
    if (delta === 0) return;
    const bucket = this.bucket(hourStart(at));
    bucket[counter] = (bucket[counter] ?? 0) + delta;
  }

  private bucket(hour: number): Pending {
    let bucket = this.pending.get(hour);
    if (!bucket) {
      bucket = {};
      this.pending.set(hour, bucket);
    }
    return bucket;
  }

  private async write(): Promise<void> {
    const taken = this.pending;
    this.pending = new Map();
    if (taken.size === 0) return;
    try {
      // One transaction: either every hour is added or none, so putting everything back on failure cannot double-count.
      await this.db.transaction(async (tx) => {
        for (const [hour, values] of taken) {
          const set: Record<string, unknown> = {};
          for (const key of HOURLY_COUNTERS) if (values[key] !== undefined) set[key] = sql`${statsHourly[key]} + ${values[key]}`;
          if (values.onlinePeak !== undefined) set.onlinePeak = sql`greatest(${statsHourly.onlinePeak}, ${values.onlinePeak})`;
          await tx
            .insert(statsHourly)
            .values({ seasonId: this.seasonId, hour: new Date(hour), ...values })
            .onConflictDoUpdate({ target: [statsHourly.seasonId, statsHourly.hour], set });
        }
      });
    } catch (error) {
      // Put everything back, so a failed flush loses nothing.
      for (const [hour, values] of taken) {
        const bucket = this.bucket(hour);
        for (const key of HOURLY_COUNTERS) if (values[key] !== undefined) bucket[key] = (bucket[key] ?? 0) + values[key];
        if (values.onlinePeak !== undefined) bucket.onlinePeak = Math.max(bucket.onlinePeak ?? 0, values.onlinePeak);
      }
      throw error;
    }
  }
}
