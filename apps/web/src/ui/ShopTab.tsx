import { useEffect, useState } from "react";
import { rejectText } from "../game/messages";
import { shopOffers, type Offer } from "../game/shop";
import { shopApi } from "../net/api";
import { useGame } from "../state/game-store";
import { uiStore } from "../state/ui-store";
import styles from "./Tabs.module.css";

const ARM_MS = 3_000;

function buy(offer: Offer) {
  if (offer.kind === "item") return shopApi.buyItem(offer.item);
  if (offer.kind === "boost") return shopApi.buyChargeBoost();
  return shopApi.buyColor(offer.colorId);
}

/** Items, the charge boost and colors. New balances arrive over the WebSocket as player updates. */
export function ShopTab() {
  const config = useGame((s) => s.config);
  const player = useGame((s) => s.player);
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(id);
  }, [armed]);

  if (!config || !player) return null;
  const offers = shopOffers(config, player);

  const onBuy = async (offer: Offer) => {
    if (busy) return;
    if (offer.confirm && armed !== offer.key) {
      setArmed(offer.key);
      return;
    }
    setArmed(null);
    setBusy(offer.key);
    const answer = await buy(offer);
    setBusy(null);
    const ui = uiStore.getState();
    if (answer.ok) ui.pushToast("info", `Куплено: ${offer.title}`);
    else ui.pushToast("error", rejectText(answer.code));
  };

  const row = (offer: Offer) => {
    const disabled = busy !== null || offer.owned || (offer.kind === "boost" && offer.maxed) || !offer.affordable;
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
          disabled={disabled}
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
