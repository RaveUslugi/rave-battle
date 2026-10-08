import { DAY_MS, type GameConfig } from "@rave/shared";
import type { PlayerState } from "./types";

/** Why the player may not play at all right now, or null. Freeze is checked separately. */
export function accessError(p: PlayerState, cfg: GameConfig, now: number): "banned" | "not_guild_member" | "account_too_new" | null {
  if (p.bannedUntil !== null && p.bannedUntil > now) return "banned";
  if (!p.guildMember) return "not_guild_member";
  if (now - p.accountCreatedAt < cfg.access.minAccountAgeDays * DAY_MS) return "account_too_new";
  return null;
}
