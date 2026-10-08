import type { GameConfig, PlayerView, UserRef } from "@rave/shared/client";
import { chargesAt, isFrozen } from "./charges";

export interface PlacementInput {
  user: UserRef | null;
  player: PlayerView | null;
  config: GameConfig;
  colorId: number;
  withBomb: boolean;
  /** Placements sent but not yet answered; they will consume charges and bombs. */
  pendingCount: number;
  pendingBombs: number;
  now: number;
}

export type PlacementPlan = { ok: true } | { ok: false; code: string };

/** Client-side pre-check so obviously doomed requests are not sent. The server stays the authority. */
export function planPlacement(i: PlacementInput): PlacementPlan {
  if (!i.user) return { ok: false, code: "unauthorized" };
  const p = i.player;
  if (!p) return { ok: false, code: "unavailable" };
  if (p.access !== "ok") return { ok: false, code: p.access };
  if (p.bannedUntil === "permanent" || (p.bannedUntil !== null && p.bannedUntil > i.now)) return { ok: false, code: "banned" };
  if (isFrozen(p, i.now)) return { ok: false, code: "frozen" };
  const entry = i.config.palette.find((e) => e.id === i.colorId);
  if (!entry) return { ok: false, code: "invalid_color" };
  if (entry.unlock !== "default" && !p.unlockedColors.includes(i.colorId)) return { ok: false, code: "color_locked" };
  if (!p.unlimited && chargesAt(p, i.config.charges.regenMs, i.now).charges - i.pendingCount < 1) return { ok: false, code: "no_charges" };
  if (!p.unlimited && i.withBomb && p.inventory.bomb - i.pendingBombs < 1) return { ok: false, code: "no_bombs" };
  return { ok: true };
}
