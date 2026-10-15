import { chargesAt, isFrozen } from "../game/charges";
import { useServerNow } from "../hooks/useNow";
import { useGame } from "../state/game-store";
import styles from "./Hud.module.css";

/** Charges with the regeneration timer, coins and bombs; hidden for anonymous visitors. */
export function Hud() {
  const player = useGame((s) => s.player);
  const config = useGame((s) => s.config);
  const now = useServerNow(250);
  if (!player || !config) return null;
  const { charges, nextAt } = chargesAt(player, config.charges.regenMs, now);
  const frozen = isFrozen(player, now);
  const seconds = nextAt === null ? null : Math.max(0, Math.ceil((nextAt - now) / 1000));
  return (
    <div className={styles.hud}>
      <div className={styles.charges}>
        {player.unlimited ? (
          <span className={styles.chargeText}>
            <span className="visually-hidden">Заряды: </span>∞
          </span>
        ) : (
          <>
            <div className={styles.pips} aria-hidden="true">
              {Array.from({ length: player.chargeCap }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static list, items never reorder
                <span key={i} className={i < charges ? styles.pipOn : styles.pip} />
              ))}
            </div>
            <span className={styles.chargeText}>
              <span className="visually-hidden">Заряды: </span>
              {charges}/{player.chargeCap}
              {seconds !== null && !frozen ? ` · +1 через ${seconds} с` : ""}
            </span>
          </>
        )}
      </div>
      <div className={styles.stat}>
        <span aria-hidden="true">🪙 </span>
        <span className="visually-hidden">Монеты: </span>
        {player.coins}
      </div>
      <div className={styles.stat}>
        <span aria-hidden="true">💣 </span>
        <span className="visually-hidden">Бомбы: </span>
        {player.unlimited ? "∞" : player.inventory.bomb}
      </div>
    </div>
  );
}
