import { useEffect, useRef, useState } from "react";
import { chargesAt, isFrozen } from "../../game/charges";
import { useServerNow } from "../../hooks/useNow";
import { formatNumber, useTranslation } from "../../i18n";
import { useGame } from "../../state/game-store";
import { Icon } from "../kit";
import styles from "./top.module.css";

/** Above this many charges the segments get too thin: a number and a bar instead. */
const MAX_SEGMENTS = 15;
const DELTA_MS = 1500;

/** "0:18", "12:05". */
export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** One cell per charge: full, the one regenerating next, empty. */
export function segmentStates(charges: number, cap: number, regenerating: boolean): Array<"full" | "next" | "empty"> {
  return Array.from({ length: cap }, (_, i) => (i < charges ? "full" : i === charges && regenerating ? "next" : "empty"));
}

/** Charges as a segmented meter with the count and the time to the next one. */
export function ChargeMeter({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const player = useGame((s) => s.player);
  const config = useGame((s) => s.config);
  const now = useServerNow(250);
  if (!player || !config) return null;
  if (player.unlimited) {
    return (
      <div className={styles.box} data-compact={compact || undefined}>
        <Icon name="charge" size={compact ? 16 : 20} className={styles.cyan} />
        <span className={styles.bigNumber}>∞</span>
        <span className="visually-hidden">{t("top.chargesUnlimited")}</span>
      </div>
    );
  }
  const { charges, nextAt } = chargesAt(player, config.charges.regenMs, now);
  const frozen = isFrozen(player, now);
  const left = nextAt === null || frozen ? null : clock(nextAt - now);
  const cap = player.chargeCap;
  const label = left === null ? t("top.charges", { count: charges, max: cap }) : t("top.chargesNext", { count: charges, max: cap, time: left });
  return (
    <div className={styles.box} data-compact={compact || undefined} data-grow={compact || undefined}>
      <Icon name="charge" size={compact ? 16 : 20} className={styles.cyan} />
      {cap <= MAX_SEGMENTS ? (
        <div className={styles.segments} aria-hidden="true">
          {segmentStates(charges, cap, left !== null).map((state, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: one cell per charge, never reordered
            <span key={i} className={styles.segment} data-state={state} />
          ))}
        </div>
      ) : (
        <div className={styles.bar} aria-hidden="true">
          <span style={{ width: `${(charges / cap) * 100}%` }} />
        </div>
      )}
      <div className={styles.chargeText} aria-hidden="true">
        <span className={styles.bigNumber}>
          {charges}
          <span className={styles.dim}>/{cap}</span>
        </span>
        {left !== null &&
          (compact ? (
            <span className={styles.timer}>{left}</span>
          ) : (
            <span className={styles.next}>
              {t("top.nextIn")} <span className={styles.timer}>{left}</span>
            </span>
          ))}
      </div>
      <span className="visually-hidden">{label}</span>
    </div>
  );
}

/** Balance with a short "+15" / "−30" after every change. */
export function Coins({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const coins = useGame((s) => s.player?.coins ?? null);
  const previous = useRef(coins);
  const [delta, setDelta] = useState<{ value: number; key: number } | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = coins;
    if (before === null || coins === null || before === coins) return;
    setDelta({ value: coins - before, key: Date.now() });
    const id = setTimeout(() => setDelta(null), DELTA_MS);
    return () => clearTimeout(id);
  }, [coins]);

  if (coins === null) return null;
  const tone = delta === null ? undefined : delta.value > 0 ? "up" : "down";
  return (
    <div className={styles.box} data-compact={compact || undefined}>
      <Icon name="coin" size={compact ? 16 : 20} />
      <span className={styles.coins} data-tone={tone} aria-hidden="true">
        {formatNumber(coins)}
      </span>
      {delta && (
        <span key={delta.key} className={styles.delta} data-tone={tone} aria-hidden="true">
          {delta.value > 0 ? "+" : "−"}
          {formatNumber(Math.abs(delta.value))}
        </span>
      )}
      <span className="visually-hidden">{t("top.coins", { n: formatNumber(coins) })}</span>
    </div>
  );
}
