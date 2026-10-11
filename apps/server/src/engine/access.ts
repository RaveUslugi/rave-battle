import { DAY_MS, type GameConfig } from "@rave/shared";
import type { PlayerState } from "./types";

export type AccessBlock = "banned" | "not_guild_member" | "account_too_new";

/** Every reason the player may only watch right now, most important first. Freeze is checked separately. */
export function accessBlocks(p: PlayerState, cfg: GameConfig, now: number): AccessBlock[] {
  const blocks: AccessBlock[] = [];
  if (p.bannedUntil !== null && p.bannedUntil > now) blocks.push("banned");
  if (!p.guildMember) blocks.push("not_guild_member");
  if (now - p.accountCreatedAt < cfg.access.minAccountAgeDays * DAY_MS) blocks.push("account_too_new");
  return blocks;
}

export function accessError(p: PlayerState, cfg: GameConfig, now: number): AccessBlock | null {
  return accessBlocks(p, cfg, now)[0] ?? null;
}
