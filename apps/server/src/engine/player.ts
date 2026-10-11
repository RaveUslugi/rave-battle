import type { GameConfig } from "@rave/shared";
import type { PlayerState, UserId } from "./types";

export interface NewPlayer {
  userId: UserId;
  accountCreatedAt: number;
  guildMember: boolean;
  /** Ban already stored for the user; defaults to null. */
  bannedUntil?: number | null;
  banReason?: string | null;
  now: number;
}

export function createPlayer(init: NewPlayer, cfg: GameConfig): PlayerState {
  return {
    userId: init.userId,
    coins: cfg.starting.coins,
    charges: cfg.charges.max,
    chargesUpdatedAt: init.now,
    frozenUntil: 0,
    chargeCapBonus: 0,
    inventory: {
      bomb: cfg.starting.bomb,
      detector: cfg.starting.detector,
      defuser: cfg.starting.defuser,
    },
    unlockedColors: new Set(),
    dailyStep: 0,
    dailyLastClaim: null,
    bannedUntil: init.bannedUntil ?? null,
    banReason: init.banReason ?? null,
    accountCreatedAt: init.accountCreatedAt,
    guildMember: init.guildMember,
  };
}

/** All players of the season, online or not. */
export class PlayerRegistry {
  private players = new Map<UserId, PlayerState>();

  add(p: PlayerState): void {
    this.players.set(p.userId, p);
  }

  has(userId: UserId): boolean {
    return this.players.has(userId);
  }

  get(userId: UserId): PlayerState {
    const p = this.players.get(userId);
    if (!p) throw new Error(`Player ${userId} is not loaded`);
    return p;
  }
}
