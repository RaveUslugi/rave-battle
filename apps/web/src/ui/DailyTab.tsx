import { useEffect, useState } from "react";
import { effectiveAccess } from "../game/access";
import { claimBlocked, dailyState, rewardText } from "../game/daily";
import { rejectText } from "../game/messages";
import { useServerNow } from "../hooks/useNow";
import { dailyApi } from "../net/api";
import { useGame } from "../state/game-store";
import { uiStore } from "../state/ui-store";
import styles from "./Tabs.module.css";

/** Fallback in case the player update after a claim never arrives. */
const WAIT_MS = 3_000;

/** Seven-day calendar on a loop: skipping a day does not reset it, one reward per calendar day. */
export function DailyTab() {
  const config = useGame((s) => s.config);
  const player = useGame((s) => s.player);
  const now = useServerNow(30_000);
  const [busy, setBusy] = useState(false);
  // After a claim, until the new player version arrives over the WebSocket: until then the button would look claimable.
  const [waiting, setWaiting] = useState(false);

  useEffect(() => setWaiting(false), [player]);

  useEffect(() => {
    if (!waiting) return;
    const id = setTimeout(() => setWaiting(false), WAIT_MS);
    return () => clearTimeout(id);
  }, [waiting]);

  if (!config || !player) return null;
  const { claimedToday, step } = dailyState(player, config, now);
  const access = effectiveAccess(player, now);
  const pending = busy || waiting;
  // `aria-disabled` instead of `disabled`: the pressed button keeps keyboard focus.
  const blocked = claimBlocked({ claimedToday, pending, watchOnly: access !== "ok" });

  const claim = async () => {
    if (blocked) return;
    setBusy(true);
    const answer = await dailyApi.claim();
    setBusy(false);
    const ui = uiStore.getState();
    if (answer.ok) {
      setWaiting(true);
      ui.pushToast("info", `📅 Награда: ${rewardText(answer.reward)}`);
    } else ui.pushToast("error", rejectText(answer.code));
  };

  return (
    <div className={styles.tab}>
      {access !== "ok" && <p className={styles.notice}>{rejectText(access)} — награды недоступны</p>}
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
      <button
        type="button"
        className={styles.claim}
        aria-disabled={blocked || undefined}
        aria-busy={pending || undefined}
        onClick={() => void claim()}
      >
        {claimedToday ? "Сегодня уже получено — приходите завтра" : pending ? "…" : "Забрать награду"}
      </button>
    </div>
  );
}
