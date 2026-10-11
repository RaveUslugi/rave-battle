import { dateKey, type GameConfig, type PlayerView, type Reward } from "@rave/shared/client";

/** Whether today's reward is taken and which reward is next. `now` must be server time. */
export function dailyState(
  player: Pick<PlayerView, "dailyStep" | "dailyLastClaim">,
  config: Pick<GameConfig, "daily">,
  now: number,
): { claimedToday: boolean; step: number } {
  return {
    claimedToday: player.dailyLastClaim === dateKey(now, config.daily.timezone),
    // Same wrap as the engine: config edits may shorten the list.
    step: player.dailyStep % config.daily.rewards.length,
  };
}

/** The claim button does nothing when today's reward is taken, a claim is in flight or the player only watches. */
export function claimBlocked(s: { claimedToday: boolean; pending: boolean; watchOnly: boolean }): boolean {
  return s.claimedToday || s.pending || s.watchOnly;
}

export function rewardText(r: Reward): string {
  if (r.item === "coins") return `${r.amount} 🪙`;
  if (r.item === "bomb") return `💣 ×${r.amount}`;
  return `${r.item === "detector" ? "🔍" : "🧯"} +${r.amount}`;
}
