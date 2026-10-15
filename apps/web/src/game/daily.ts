import { formatNumber, i18n } from "../i18n";
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
  const n = formatNumber(r.amount);
  if (r.item === "coins") return i18n.t("daily.coins", { count: r.amount, n });
  if (r.item === "bomb") return i18n.t("daily.bomb", { count: r.amount, n });
  return i18n.t(r.item === "detector" ? "daily.detector" : "daily.defuser", { n });
}
