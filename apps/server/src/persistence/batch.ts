import type { EngineEvent, Inventory, PlayerState, UserId } from "../engine/types";

/** The part of PlayerState stored in player_state + inventory. */
export interface PlayerSnapshot {
  userId: UserId;
  coins: number;
  charges: number;
  chargesUpdatedAt: number;
  frozenUntil: number;
  chargeCapBonus: number;
  dailyStep: number;
  dailyLastClaim: string | null;
  inventory: Inventory;
}

export interface ChunkSnapshot {
  cx: number;
  cy: number;
  colors: Uint8Array;
  owners: Int32Array;
}

/** One transaction: a consistent cut of everything the engine did since the previous batch. */
export interface Batch {
  seasonId: number;
  events: EngineEvent[];
  /** Latest state of every player touched by `events`. */
  players: PlayerSnapshot[];
  /** Players created since the previous batch, with their creation time. */
  newPlayers: Array<{ player: PlayerSnapshot; at: number }>;
  /** Copies of chunks taken at the same moment as `events` were drained. */
  chunks: ChunkSnapshot[];
}

export function snapshotPlayer(p: PlayerState): PlayerSnapshot {
  return {
    userId: p.userId,
    coins: p.coins,
    charges: p.charges,
    chargesUpdatedAt: p.chargesUpdatedAt,
    frozenUntil: p.frozenUntil,
    chargeCapBonus: p.chargeCapBonus,
    dailyStep: p.dailyStep,
    dailyLastClaim: p.dailyLastClaim,
    inventory: { ...p.inventory },
  };
}
