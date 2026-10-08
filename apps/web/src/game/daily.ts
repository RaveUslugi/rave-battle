import { dateKey, type GameConfig, type PlayerView } from "@rave/shared/client";

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
