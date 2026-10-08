import { isFrozen } from "../game/charges";
import { useServerNow } from "../hooks/useNow";
import { useGame } from "../state/game-store";
import styles from "./FreezeBanner.module.css";

/** Freeze countdown. Only "Заморожен" is announced: a live region with a ticking timer would speak every second. */
export function FreezeBanner() {
  const player = useGame((s) => s.player);
  const now = useServerNow(250);
  if (!player || !isFrozen(player, now)) return null;
  const left = Math.ceil((player.frozenUntil - now) / 1000);
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");
  return (
    <div className={styles.banner} role="status">
      <span aria-hidden="true">❄ </span>
      Заморожен
      <span aria-hidden="true">
        {" "}
        · {mm}:{ss}
      </span>
    </div>
  );
}
