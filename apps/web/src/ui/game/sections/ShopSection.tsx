import type { ItemKey } from "@rave/shared/client";
import { useEffect, useRef, useState } from "react";
import { effectiveAccess } from "../../../game/access";
import { rejectText } from "../../../game/messages";
import { type Offer, offerBlocked, shopOffers } from "../../../game/shop";
import { useServerNow } from "../../../hooks/useNow";
import { formatNumber, useTranslation } from "../../../i18n";
import { shopApi } from "../../../net/api";
import { gameStore, useGame } from "../../../state/game-store";
import { uiStore, useUi } from "../../../state/ui-store";
import { ColorPreview, Icon, type IconName } from "../../kit";
import styles from "./sections.module.css";

const ARM_MS = 3_000;
/** Fallback in case the player update after a purchase never arrives. */
const WAIT_MS = 3_000;
const FOCUS_MS = 2_000;

const ITEM_ICON: Record<ItemKey, IconName> = { bomb: "bomb", detector: "detector", defuser: "defuser" };
const ITEM_TONE: Record<ItemKey, string> = { bomb: "pink", detector: "cyan", defuser: "lime" };

function buy(offer: Offer) {
  if (offer.kind === "item") return shopApi.buyItem(offer.item);
  if (offer.kind === "boost") return shopApi.buyChargeBoost();
  return shopApi.buyColor(offer.colorId);
}

/** Gear as cards, colours as a grid with names and live previews. New balances arrive over the WebSocket. */
export function ShopSection() {
  const { t } = useTranslation();
  const config = useGame((s) => s.config);
  const player = useGame((s) => s.player);
  const focus = useUi((s) => s.shopFocus);
  const now = useServerNow(30_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  // After a purchase, until the new player version arrives: a quick second click would see stale data.
  const [waiting, setWaiting] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the deps are the triggers; the effect resets state when they change
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

  // Opened on an offer (a tool with nothing left, a locked colour): scroll to it and light it up briefly.
  useEffect(() => {
    if (!focus) return;
    root.current?.querySelector(`[data-offer="${focus}"]`)?.scrollIntoView({ block: "center" });
    setHighlight(focus);
    const id = setTimeout(() => setHighlight(null), FOCUS_MS);
    return () => clearTimeout(id);
  }, [focus]);

  if (!config || !player) return <p className={styles.hint}>{t("reject.login_required")}</p>;
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
    const before = gameStore.getState().player;
    const answer = await buy(offer);
    setBusy(null);
    const ui = uiStore.getState();
    if (answer.ok) {
      // The server sends the player update before answering; wait only if it has not arrived yet.
      if (gameStore.getState().player === before) setWaiting(offer.key);
      if (offer.kind === "color") ui.selectColor(offer.colorId);
      ui.pushToast("success", t("toast.bought", { title: offer.title }), "check");
    } else ui.pushToast("error", rejectText(answer.code));
  };

  /** Price button, or why there is none: owned, maxed, not enough coins. */
  const priceButton = (offer: Offer) => {
    const disabled = pending || access !== "ok" || offerBlocked(offer);
    const price = formatNumber(offer.price);
    if (offer.owned)
      return (
        <span className={styles.owned}>
          <Icon name="check" />
          {t("shop.have")}
        </span>
      );
    if (offer.kind === "boost" && offer.maxed) return <span className={styles.short}>{t("shop.max")}</span>;
    if (!offer.affordable)
      return (
        <span className={styles.short}>
          <span className={styles.shortPrice}>{price}</span>
          {t("shop.short", { n: formatNumber(offer.price - player.coins) })}
        </span>
      );
    return (
      // Unavailable buttons stay focusable (a real `disabled` would drop keyboard focus); `onBuy` ignores clicks on them.
      <button
        type="button"
        className={styles.price}
        data-armed={armed === offer.key || undefined}
        aria-disabled={disabled || undefined}
        aria-busy={busy === offer.key || undefined}
        aria-label={armed === offer.key ? t("shop.sure", { n: price }) : t("shop.price", { title: offer.title, n: price })}
        onClick={() => void onBuy(offer)}
      >
        <Icon name="coin" />
        {busy === offer.key ? "…" : armed === offer.key ? t("shop.sure", { n: price }) : price}
      </button>
    );
  };

  const gear = offers.filter((o) => o.kind !== "color");
  const colors = offers.filter((o) => o.kind === "color");
  return (
    <div ref={root} className={styles.stack}>
      {access !== "ok" && <p className={styles.notice}>{t("shop.blocked", { reason: rejectText(access) })}</p>}
      <div className={styles.balance}>
        {t("shop.balance")} <Icon name="coin" />
        <span className={styles.gold}>{formatNumber(player.coins)}</span>
      </div>
      <section className={styles.group}>
        <h3 className={styles.groupTitle}>{t("shop.gear")}</h3>
        {gear.map((offer) => {
          const item = offer.kind === "item" ? offer.item : null;
          const owned = item === null ? null : player.unlimited ? "∞" : formatNumber(player.inventory[item]);
          return (
            <div key={offer.key} className={styles.card} data-offer={offer.key} data-focus={highlight === offer.key || undefined}>
              <span className={styles.plate} data-tone={item ? ITEM_TONE[item] : "cyan"} aria-hidden="true">
                <Icon name={item ? ITEM_ICON[item] : "charge"} size={24} />
              </span>
              <div className={styles.cardText}>
                <div className={styles.cardTitle}>{offer.title}</div>
                <div className={styles.cardAbout}>
                  {item
                    ? t(`shop.${item}About`)
                    : t("shop.boostAbout", { bonus: offer.kind === "boost" ? offer.bonus : 0, max: offer.kind === "boost" ? offer.maxTotal : 0 })}
                  {owned !== null && <> · {t("shop.youHave", { n: owned })}</>}
                </div>
              </div>
              {priceButton(offer)}
            </div>
          );
        })}
      </section>
      {colors.length > 0 && (
        <section className={styles.group}>
          <h3 className={styles.groupTitle}>{t("shop.colors")}</h3>
          <div className={styles.colors}>
            {colors.map((offer) => {
              const entry = offer.kind === "color" ? config.palette.find((e) => e.id === offer.colorId) : undefined;
              return (
                <div key={offer.key} className={styles.colorCard} data-offer={offer.key} data-focus={highlight === offer.key || undefined}>
                  {entry && <ColorPreview entry={entry} className={styles.colorPreview} />}
                  <span className={styles.colorName}>{offer.title}</span>
                  {priceButton(offer)}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
