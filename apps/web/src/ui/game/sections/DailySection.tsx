import type { Reward } from "@rave/shared/client";
import { useEffect, useState } from "react";
import { effectiveAccess } from "../../../game/access";
import { claimBlocked, dailyState, rewardText } from "../../../game/daily";
import { rejectText } from "../../../game/messages";
import { useServerNow } from "../../../hooks/useNow";
import { useIsDesktop } from "../../../hooks/useViewport";
import { useTranslation } from "../../../i18n";
import { dailyApi } from "../../../net/api";
import { gameStore, useGame } from "../../../state/game-store";
import { uiStore } from "../../../state/ui-store";
import { Button, Icon, type IconName } from "../../kit";
import styles from "./sections.module.css";

/** Fallback in case the player update after a claim never arrives. */
const WAIT_MS = 3_000;

const REWARD_ICON: Record<Reward["item"], IconName> = { coins: "coin", bomb: "bomb", detector: "detector", defuser: "defuser" };
const REWARD_TONE: Record<Reward["item"], string> = { coins: "gold", bomb: "pink", detector: "cyan", defuser: "lime" };

export type DayState = "done" | "today" | "future";

/**
 * Where each day of the loop stands. The next reward is `step`; once today's is taken, the one before
 * it is today's. Days before today in the loop are taken (skipping a day does not reset progress).
 */
export function dayStates(count: number, step: number, claimedToday: boolean): DayState[] {
  const today = claimedToday ? (step + count - 1) % count : step;
  return Array.from({ length: count }, (_, i) => (i === today ? "today" : i < today ? "done" : "future"));
}

/** Seven-day loop: a list on the desktop, a big "today" card over a strip of seven on the phone. */
export function DailySection() {
  const { t } = useTranslation();
  const desktop = useIsDesktop();
  const config = useGame((s) => s.config);
  const player = useGame((s) => s.player);
  const now = useServerNow(30_000);
  const [busy, setBusy] = useState(false);
  // After a claim, until the new player version arrives: until then the button would look claimable.
  const [waiting, setWaiting] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the deps are the triggers; the effect resets state when they change
  useEffect(() => setWaiting(false), [player]);

  useEffect(() => {
    if (!waiting) return;
    const id = setTimeout(() => setWaiting(false), WAIT_MS);
    return () => clearTimeout(id);
  }, [waiting]);

  if (!config || !player) return <p className={styles.hint}>{t("reject.login_required")}</p>;
  const rewards = config.daily.rewards;
  const { claimedToday, step } = dailyState(player, config, now);
  const states = dayStates(rewards.length, step, claimedToday);
  const todayIndex = states.indexOf("today");
  const access = effectiveAccess(player, now);
  const pending = busy || waiting;
  // `aria-disabled` instead of `disabled`: the pressed button keeps keyboard focus.
  const blocked = claimBlocked({ claimedToday, pending, watchOnly: access !== "ok" });

  const claim = async () => {
    if (blocked) return;
    setBusy(true);
    const before = gameStore.getState().player;
    const answer = await dailyApi.claim();
    setBusy(false);
    const ui = uiStore.getState();
    if (answer.ok) {
      // The server sends the player update before answering; wait only if it has not arrived yet.
      if (gameStore.getState().player === before) setWaiting(true);
      ui.pushToast("success", t("toast.claimed", { reward: rewardText(answer.reward) }), REWARD_ICON[answer.reward.item]);
    } else ui.pushToast("error", rejectText(answer.code));
  };

  const claimButton = (
    <Button variant="primary" size="lg" wide aria-disabled={blocked || undefined} aria-busy={pending || undefined} onClick={() => void claim()}>
      {claimedToday ? t("daily.claimedToday") : pending ? "…" : t("daily.claim")}
    </Button>
  );
  const notes = (
    <>
      {access !== "ok" && <p className={styles.notice}>{t("daily.blocked", { reason: rejectText(access) })}</p>}
      <p className={styles.hint}>
        {t("daily.intro")} {t("daily.next", { tz: config.daily.timezone })}
      </p>
    </>
  );

  if (desktop) {
    return (
      <div className={styles.stack}>
        {notes}
        <ol className={styles.days}>
          {rewards.map((reward, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the days are positions in a fixed loop
            <li key={i} className={styles.day} data-state={states[i]} aria-current={states[i] === "today" ? "date" : undefined}>
              <span className={styles.dayNumber}>{t("daily.day", { n: i + 1 })}</span>
              <span className={styles.dayIcon} data-tone={REWARD_TONE[reward.item]} aria-hidden="true">
                <Icon name={REWARD_ICON[reward.item]} size={20} />
              </span>
              <span className={styles.dayReward}>{rewardText(reward)}</span>
              {states[i] === "done" && (
                <span className={styles.dayDone}>
                  <Icon name="check" />
                  {t("daily.received")}
                </span>
              )}
              {states[i] === "today" && <span className={styles.dayToday}>{claimedToday ? t("daily.received") : t("daily.today")}</span>}
            </li>
          ))}
        </ol>
        {claimButton}
      </div>
    );
  }

  const today = rewards[todayIndex];
  return (
    <div className={styles.stack}>
      {today && (
        <div className={styles.todayCard}>
          <span className={styles.todayLabel}>
            {t("daily.day", { n: todayIndex + 1 })} · {t("daily.today")}
          </span>
          <span className={styles.todayIcon} data-tone={REWARD_TONE[today.item]} aria-hidden="true">
            <Icon name={REWARD_ICON[today.item]} size={40} />
          </span>
          <span className={styles.todayReward}>{rewardText(today)}</span>
          {claimButton}
        </div>
      )}
      <ol className={styles.strip} aria-label={t("daily.calendar")}>
        {rewards.map((reward, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the days are positions in a fixed loop
          <li key={i} className={styles.stripDay} data-state={states[i]} aria-current={states[i] === "today" ? "date" : undefined}>
            <span className={styles.stripNumber}>{i + 1}</span>
            <span data-tone={REWARD_TONE[reward.item]} className={styles.toneText}>
              <Icon name={REWARD_ICON[reward.item]} />
            </span>
            {states[i] === "done" && <Icon name="check" size={12} className={styles.lime} />}
            <span className="visually-hidden">{rewardText(reward)}</span>
          </li>
        ))}
      </ol>
      {notes}
    </div>
  );
}
