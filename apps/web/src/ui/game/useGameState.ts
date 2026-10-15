import { effectiveAccess } from "../../game/access";
import { isFrozen } from "../../game/charges";
import { dailyState } from "../../game/daily";
import { useServerNow } from "../../hooks/useNow";
import { useGame } from "../../state/game-store";

/** What the player can do right now: everything, nothing yet (guest), or only watch, and why. */
export type PlayMode = "guest" | "offline" | "watch" | "frozen" | "play";

export function usePlayMode(): PlayMode {
  const user = useGame((s) => s.user);
  const player = useGame((s) => s.player);
  const status = useGame((s) => s.status);
  const now = useServerNow(1000);
  if (!user) return "guest";
  if (status !== "open") return "offline";
  if (!player || effectiveAccess(player, now) !== "ok") return "watch";
  if (isFrozen(player, now)) return "frozen";
  return "play";
}

/** Today's reward is waiting for a player who may claim it. */
export function useDailyReady(): boolean {
  const player = useGame((s) => s.player);
  const config = useGame((s) => s.config);
  const now = useServerNow(30_000);
  return player !== null && config !== null && effectiveAccess(player, now) === "ok" && !dailyState(player, config, now).claimedToday;
}
