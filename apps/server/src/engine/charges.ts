import type { GameConfig } from "@rave/shared";
import type { PlayerState } from "./types";

export function chargeCap(p: PlayerState, cfg: GameConfig): number {
  return cfg.charges.max + p.chargeCapBonus;
}

/**
 * Brings `p.charges` up to date at `now`. Regeneration is paused while frozen:
 * it counts from max(chargesUpdatedAt, frozenUntil).
 */
export function settleCharges(p: PlayerState, cfg: GameConfig, now: number): void {
  const cap = chargeCap(p, cfg);
  if (p.charges >= cap) {
    p.charges = cap;
    p.chargesUpdatedAt = now;
    return;
  }
  const from = Math.max(p.chargesUpdatedAt, p.frozenUntil);
  if (now <= from) return;
  const gained = Math.floor((now - from) / cfg.charges.regenMs);
  if (gained === 0) return;
  p.charges = Math.min(cap, p.charges + gained);
  p.chargesUpdatedAt = p.charges >= cap ? now : from + gained * cfg.charges.regenMs;
}
