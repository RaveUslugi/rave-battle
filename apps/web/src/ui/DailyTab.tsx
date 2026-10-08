import { useState } from "react";
import { dailyState, rewardText } from "../game/daily";
import { rejectText } from "../game/messages";
import { useServerNow } from "../hooks/useNow";
import { dailyApi } from "../net/api";
import { useGame } from "../state/game-store";
import { uiStore } from "../state/ui-store";
import styles from "./Tabs.module.css";

/** Seven-day calendar on a loop: skipping a day does not reset it, one reward per calendar day. */
export function DailyTab() {
  const config = useGame((s) => s.config);
  const player = useGame((s) => s.player);
  const now = useServerNow(30_000);
  const [busy, setBusy] = useState(false);
  if (!config || !player) return null;
  const { claimedToday, step } = dailyState(player, config, now);

  const claim = async () => {
    setBusy(true);
    const answer = await dailyApi.claim();
    setBusy(false);
    const ui = uiStore.getState();
    if (answer.ok) ui.pushToast("info", `📅 Награда: ${rewardText(answer.reward)}`);
    else ui.pushToast("error", rejectText(answer.code));
  };

  return (
    <div className={styles.tab}>
      <ol className={styles.calendar}>
        {config.daily.rewards.map((reward, i) => {
          // The next reward is `step`; once today's is taken, the one before it is today's.
          const today = claimedToday ? (step + config.daily.rewards.length - 1) % config.daily.rewards.length : step;
          const state = i === today ? (claimedToday ? styles.dayTaken : styles.dayNext) : styles.day;
          return (
            <li key={i} className={state} aria-current={i === today ? "date" : undefined}>
              <span className={styles.dayNumber}>День {i + 1}</span>
              <span>{rewardText(reward)}</span>
            </li>
          );
        })}
      </ol>
      <button type="button" className={styles.claim} disabled={claimedToday || busy} onClick={() => void claim()}>
        {claimedToday ? "Сегодня уже получено — приходите завтра" : busy ? "…" : "Забрать награду"}
      </button>
    </div>
  );
}
