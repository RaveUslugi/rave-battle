import type { PlayerView } from "@rave/shared/client";

type ChargeState = Pick<PlayerView, "charges" | "chargesUpdatedAt" | "chargeCap" | "frozenUntil">;

/**
 * Charges at `now`, using the engine's rule: regeneration is paused while frozen and counts from
 * max(chargesUpdatedAt, frozenUntil). `nextAt` is when the next charge arrives (null when full).
 */
export function chargesAt(p: ChargeState, regenMs: number, now: number): { charges: number; nextAt: number | null } {
  if (p.charges >= p.chargeCap) return { charges: p.chargeCap, nextAt: null };
  const from = Math.max(p.chargesUpdatedAt, p.frozenUntil);
  const gained = now > from ? Math.floor((now - from) / regenMs) : 0;
  const charges = Math.min(p.chargeCap, p.charges + gained);
  if (charges >= p.chargeCap) return { charges, nextAt: null };
  return { charges, nextAt: from + (gained + 1) * regenMs };
}

/** Unlimited (dev) players ignore freezes. */
export function isFrozen(p: Pick<PlayerView, "frozenUntil" | "unlimited">, now: number): boolean {
  return !p.unlimited && p.frozenUntil > now;
}
