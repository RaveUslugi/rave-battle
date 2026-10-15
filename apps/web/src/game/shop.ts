import type { GameConfig, ItemKey, PlayerView } from "@rave/shared/client";
import { currentLocale, i18n } from "../i18n";

/** Purchases from this price up ask for a second click. */
export const CONFIRM_FROM = 100;

export type Offer =
  | ({ kind: "item"; item: ItemKey } & OfferBase)
  | ({ kind: "boost"; maxed: boolean; bonus: number; maxTotal: number } & OfferBase)
  | ({ kind: "color"; colorId: number; base: string } & OfferBase);

interface OfferBase {
  key: string;
  title: string;
  price: number;
  affordable: boolean;
  confirm: boolean;
  owned: boolean;
}

/** Everything on sale for this player, in display order. */
export function shopOffers(config: GameConfig, player: Pick<PlayerView, "coins" | "chargeCap" | "unlockedColors">): Offer[] {
  const base = (key: string, title: string, price: number, owned = false): OfferBase => ({
    key,
    title,
    price,
    affordable: player.coins >= price,
    confirm: price >= CONFIRM_FROM,
    owned,
  });
  const items = (["bomb", "detector", "defuser"] as const).map(
    (item): Offer => ({ kind: "item", item, ...base(`item:${item}`, i18n.t(`shop.${item}`, { n: config.shop[item].amount }), config.shop[item].price) }),
  );
  const boostCfg = config.shop.chargeCapBoost;
  // The view carries only the total cap, which the server builds as `charges.max + bonus`.
  const bonus = Math.max(0, player.chargeCap - config.charges.max);
  const boost: Offer = {
    kind: "boost",
    // Same check as the engine.
    maxed: bonus + boostCfg.amount > boostCfg.maxTotal,
    bonus,
    maxTotal: boostCfg.maxTotal,
    ...base("boost", i18n.t("shop.boost", { n: boostCfg.amount }), boostCfg.price),
  };
  const unlocked = new Set(player.unlockedColors);
  const colors = config.palette
    .filter((e) => e.unlock === "shop" && e.price !== undefined)
    .map(
      (e): Offer => ({
        kind: "color",
        colorId: e.id,
        base: e.base,
        ...base(`color:${e.id}`, e.name?.[currentLocale()] ?? i18n.t("kit.colorN", { id: e.id }), e.price!, unlocked.has(e.id)),
      }),
    );
  return [...items, boost, ...colors];
}

/** Owned, maxed or too expensive: the server would refuse it. */
export function offerBlocked(o: Offer): boolean {
  return o.owned || (o.kind === "boost" && o.maxed) || !o.affordable;
}
