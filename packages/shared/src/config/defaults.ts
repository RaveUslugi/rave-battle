import type { GameConfig, PaletteEntry } from "./schema";

// r/place 2022 palette, black first: id 0 is the empty-canvas background.
const BASE_COLORS = [
  "#000000", "#6D001A", "#BE0039", "#FF4500", "#FFA800", "#FFD635", "#FFF8B8", "#00A368",
  "#00CC78", "#7EED56", "#00756F", "#009EAA", "#00CCC0", "#2450A4", "#3690EA", "#51E9F4",
  "#493AC1", "#6A5CFF", "#94B3FF", "#811E9F", "#B44AC0", "#E4ABFF", "#DE107F", "#FF3881",
  "#FF99AA", "#6D482F", "#9C6926", "#FFB470", "#515252", "#898D90", "#D4D7D9", "#FFFFFF",
];

export const defaultConfig: GameConfig = {
  canvas: { width: 512, height: 512 },
  palette: BASE_COLORS.map(
    (base, id): PaletteEntry => ({ id, type: "solid", base, params: {}, unlock: "default" }),
  ),
  charges: { max: 10, regenMs: 30_000 },
  coinsPerPixel: 1,
  explosion: {
    freezeMs: 60_000,
    coinPenalty: 10,
    selfFreezeMs: 120_000,
    selfCoinPenalty: 20,
    authorBonus: 15,
  },
  bombs: { maxActivePerPlayer: 20 },
  antiFarm: { maxRatedPerPairPerDay: 3 },
  defuse: { reward: 20 },
  shop: {
    bomb: { price: 30, amount: 1 },
    detector: { price: 40, amount: 5 },
    defuser: { price: 150, amount: 2 },
    chargeCapBoost: { price: 500, amount: 5, maxTotal: 10 },
  },
  starting: { coins: 100, bomb: 3, detector: 5, defuser: 0 },
  daily: {
    timezone: "Europe/Moscow",
    rewards: [
      { item: "coins", amount: 30 },
      { item: "bomb", amount: 1 },
      { item: "detector", amount: 5 },
      { item: "coins", amount: 50 },
      { item: "bomb", amount: 2 },
      { item: "detector", amount: 5 },
      { item: "defuser", amount: 2 },
    ],
  },
  access: { minAccountAgeDays: 30 },
};
