import { CHUNK_SIZE, type ChunkDelta, type GameConfig, type PlaceResultView, type PlayerView, type ServerMessage } from "@rave/shared";
import { accessError } from "../engine/access";
import { chargeCap, settleCharges } from "../engine/charges";
import type { EngineEvent, PlaceResult, PlayerState } from "../engine/types";
import type { UserDirectory } from "./user-directory";

export function toPlayerView(p: PlayerState, cfg: GameConfig, now: number, unlimited: boolean): PlayerView {
  const settled = { ...p };
  settleCharges(settled, cfg, now);
  return {
    coins: p.coins,
    charges: settled.charges,
    chargesUpdatedAt: settled.chargesUpdatedAt,
    chargeCap: chargeCap(p, cfg),
    frozenUntil: p.frozenUntil,
    inventory: { ...p.inventory },
    unlockedColors: [...p.unlockedColors].sort((a, b) => a - b),
    dailyStep: p.dailyStep,
    dailyLastClaim: p.dailyLastClaim,
    bannedUntil: p.bannedUntil === null ? null : Number.isFinite(p.bannedUntil) ? p.bannedUntil : "permanent",
    access: (accessError(p, cfg, now) ?? "ok") as PlayerView["access"],
    unlimited,
    serverNow: now,
  };
}

export function toPlaceResultView(result: PlaceResult, users: UserDirectory): PlaceResultView {
  if (!result.ok) return { ok: false, code: result.code };
  if (result.outcome === "placed") return { ok: true, outcome: "placed" };
  return {
    ok: true,
    outcome: "exploded",
    self: result.self,
    frozenUntil: result.frozenUntil,
    coinsLost: result.coinsLost,
    bombOwner: users.ref(result.bombOwnerId),
  };
}

/** Per-chunk counter of broadcast deltas since server start. */
export class ChunkVersions {
  private versions = new Map<string, number>();

  get(cx: number, cy: number): number {
    return this.versions.get(`${cx}:${cy}`) ?? 0;
  }

  bump(cx: number, cy: number): { fromVersion: number; toVersion: number } {
    const fromVersion = this.get(cx, cy);
    this.versions.set(`${cx}:${cy}`, fromVersion + 1);
    return { fromVersion, toVersion: fromVersion + 1 };
  }
}

export function buildChunkDeltas(events: EngineEvent[], versions: ChunkVersions): ChunkDelta[] {
  const byChunk = new Map<string, { cx: number; cy: number; cells: Map<number, number> }>();
  for (const e of events) {
    if (e.type !== "pixel") continue;
    const cx = Math.floor(e.x / CHUNK_SIZE);
    const cy = Math.floor(e.y / CHUNK_SIZE);
    const key = `${cx}:${cy}`;
    const entry = byChunk.get(key) ?? { cx, cy, cells: new Map<number, number>() };
    entry.cells.set((e.y % CHUNK_SIZE) * CHUNK_SIZE + (e.x % CHUNK_SIZE), e.colorId);
    byChunk.set(key, entry);
  }
  return [...byChunk.values()].map(({ cx, cy, cells }) => ({
    cx,
    cy,
    ...versions.bump(cx, cy),
    cells: [...cells].map(([index, colorId]) => ({ index, colorId })),
  }));
}

type FeedMessage = Extract<ServerMessage, { type: "feed" }>;

/** Feed entries carry who and whose bomb — never where. */
export function buildFeed(events: EngineEvent[], users: UserDirectory): FeedMessage[] {
  const feed: FeedMessage[] = [];
  for (const e of events) {
    if (e.type !== "bomb_removed") continue;
    feed.push({ type: "feed", kind: e.reason, actor: users.ref(e.removedBy), owner: users.ref(e.ownerId), at: e.at });
  }
  return feed;
}
