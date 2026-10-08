import { useEffect, useState } from "react";
import { effectiveAccess } from "../game/access";
import { rejectText } from "../game/messages";
import { offerBlocked, shopOffers, type Offer } from "../game/shop";
import { useServerNow } from "../hooks/useNow";
import { shopApi } from "../net/api";
import { useGame } from "../state/game-store";
import { uiStore } from "../state/ui-store";
import styles from "./Tabs.module.css";

const ARM_MS = 3_000;
/** Fallback in case the player update after a purchase never arrives. */
const WAIT_MS = 3_000;

function buy(offer: Offer) {
  if (offer.kind === "item") return shopApi.buyItem(offer.item);
  if (offer.kind === "boost") return shopApi.buyChargeBoost();
  return shopApi.buyColor(offer.colorId);
}

/** Items, the charge boost and colors. New balances arrive over the WebSocket as player updates. */
export function ShopTab() {
  const config = useGame((s) => s.config);
  const player = useGame((s) => s.player);
  const now = useServerNow(30_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  // After a purchase, until the new player version arrives over the WebSocket: a quick second click would see stale data.
  const [waiting, setWaiting] = useState<string | null>(null);

  useEffect(() => setWaiting(null), [player]);

  useEffect(() => {
    if (!waiting) return;
    const id = setTimeout(() => setWaiting(null), WAIT_MS);
    return () => clearTimeout(id);
  }, [waiting]);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(id);
  }, [armed]);

  if (!config || !player) return null;
  const offers = shopOffers(config, player);
  const access = effectiveAccess(player, now);
  const pending = busy !== null || waiting !== null;

  const onBuy = async (offer: Offer) => {
    if (pending || access !== "ok" || offerBlocked(offer)) return;
    if (offer.confirm && armed !== offer.key) {
      setArmed(offer.key);
      return;
    }
    setArmed(null);
    setBusy(offer.key);
    const answer = await buy(offer);
    setBusy(null);
    const ui = uiStore.getState();
    if (answer.ok) {
      setWaiting(offer.key);
      if (offer.kind === "color") ui.selectColor(offer.colorId);
      ui.pushToast("info", `Куплено: ${offer.title}`);
    } else ui.pushToast("error", rejectText(answer.code));
  };

  const row = (offer: Offer) => {
    // Unavailable rows stay focusable (a real `disabled` would drop keyboard focus); `onBuy` ignores clicks on them.
    const disabled = pending || access !== "ok" || offerBlocked(offer);
    const label = offer.owned
      ? "Есть"
      : offer.kind === "boost" && offer.maxed
        ? "Максимум"
        : armed === offer.key
          ? `Точно? ${offer.price} 🪙`
          : `${offer.price} 🪙`;
    return (
      <li key={offer.key} className={styles.row}>
        {offer.kind === "color" && <span className={styles.swatch} style={{ background: offer.base }} aria-hidden="true" />}
        <span className={styles.name}>{offer.title}</span>
        <button
          type="button"
          className={armed === offer.key ? styles.armed : styles.buy}
          aria-disabled={disabled || undefined}
          aria-busy={busy === offer.key || undefined}
          aria-label={`${offer.title}: ${label}`}
          onClick={() => void onBuy(offer)}
        >
          {busy === offer.key ? "…" : label}
        </button>
      </li>
    );
  };

  const colors = offers.filter((o) => o.kind === "color");
  return (
    <div className={styles.tab}>
      {access !== "ok" && <p className={styles.notice}>{rejectText(access)} — покупки недоступны</p>}
      <p className={styles.balance}>
        Баланс: <strong>{player.coins} 🪙</strong>
      </p>
      <h3 className={styles.section}>Предметы</h3>
      <ul className={styles.list}>{offers.filter((o) => o.kind !== "color").map(row)}</ul>
      {colors.length > 0 && (
        <>
          <h3 className={styles.section}>Цвета</h3>
          <ul className={styles.list}>{colors.map(row)}</ul>
        </>
      )}
    </div>
  );
}
