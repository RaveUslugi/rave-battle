import { CHAT_DEFAULTS, type GameConfig, type PaletteEntry } from "./schema";

// r/place 2022 palette, black first: id 0 is the empty-canvas background.
const BASE_COLORS = [
  "#000000",
  "#6D001A",
  "#BE0039",
  "#FF4500",
  "#FFA800",
  "#FFD635",
  "#FFF8B8",
  "#00A368",
  "#00CC78",
  "#7EED56",
  "#00756F",
  "#009EAA",
  "#00CCC0",
  "#2450A4",
  "#3690EA",
  "#51E9F4",
  "#493AC1",
  "#6A5CFF",
  "#94B3FF",
  "#811E9F",
  "#B44AC0",
  "#E4ABFF",
  "#DE107F",
  "#FF3881",
  "#FF99AA",
  "#6D482F",
  "#9C6926",
  "#FFB470",
  "#515252",
  "#898D90",
  "#D4D7D9",
  "#FFFFFF",
];

type Name = { ru: string; en: string };

/** Neon extras sold in the shop (slots 32–39). */
const SHOP_COLORS: Array<[base: string, price: number, name: Name]> = [
  ["#FF00E5", 200, { ru: "Неон-розовый", en: "Neon pink" }],
  ["#00FFF0", 200, { ru: "Кислотный циан", en: "Acid cyan" }],
  ["#39FF14", 250, { ru: "Лайм", en: "Lime" }],
  ["#FFF01F", 250, { ru: "Лимон", en: "Lemon" }],
  ["#FF5F1F", 300, { ru: "Неон-оранж", en: "Neon orange" }],
  ["#BC13FE", 350, { ru: "Ультрафиолет", en: "Ultraviolet" }],
  ["#FF073A", 400, { ru: "Алый", en: "Scarlet" }],
  ["#04D9FF", 500, { ru: "Электрик", en: "Electric blue" }],
];

/** Effect colors sold in the shop (slots 40–47). Clients that cannot render effects use `base`. */
const EFFECT_COLORS: Array<Omit<PaletteEntry, "id" | "unlock">> = [
  { type: "animated", base: "#FF3DAE", params: { frames: ["#FF3DAE", "#7A0F52"], periodMs: 1200 }, price: 600, name: { ru: "Пульс", en: "Pulse" } },
  { type: "animated", base: "#3DE8FF", params: { frames: ["#3DE8FF", "#FFFFFF"], periodMs: 400 }, price: 800, name: { ru: "Стробоскоп", en: "Strobe" } },
  { type: "animated", base: "#39FF14", params: { frames: ["#39FF14", "#FFF01F", "#00FFF0"], periodMs: 1800 }, price: 700, name: { ru: "Кислота", en: "Acid" } },
  { type: "animated", base: "#FF073A", params: { frames: ["#FF073A", "#04D9FF"], periodMs: 1000 }, price: 800, name: { ru: "Сирена", en: "Siren" } },
  {
    type: "gradient",
    base: "#FFC83D",
    params: { stops: ["#FFC83D", "#FFF8B8", "#B5821A"], scale: 16, angle: 45, speed: 0.1 },
    price: 900,
    name: { ru: "Золото", en: "Gold" },
  },
  { type: "gradient", base: "#04D9FF", params: { stops: ["#04D9FF", "#E8FDFF"], scale: 24, angle: 90, speed: 0 }, price: 900, name: { ru: "Лёд", en: "Ice" } },
  {
    type: "gradient",
    base: "#FF3881",
    params: { stops: ["#BC13FE", "#FF3881", "#FFA800"], scale: 32, angle: 45, speed: 0.2 },
    price: 1000,
    name: { ru: "Закат", en: "Sunset" },
  },
  {
    type: "gradient",
    base: "#39FF14",
    params: { stops: ["#04D9FF", "#39FF14", "#BC13FE"], scale: 48, angle: 30, speed: 0.3 },
    price: 1200,
    name: { ru: "Аврора", en: "Aurora" },
  },
] as Array<Omit<PaletteEntry, "id" | "unlock">>;

export const defaultConfig: GameConfig = {
  canvas: { width: 512, height: 512 },
  palette: [
    ...BASE_COLORS.map((base, id): PaletteEntry => ({ id, type: "solid", base, params: {}, unlock: "default" })),
    ...SHOP_COLORS.map(
      ([base, price, name], i): PaletteEntry => ({ id: BASE_COLORS.length + i, type: "solid", base, params: {}, unlock: "shop", price, name }),
    ),
    ...EFFECT_COLORS.map((entry, i) => ({ ...entry, id: BASE_COLORS.length + SHOP_COLORS.length + i, unlock: "shop" }) as PaletteEntry),
  ],
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
  chat: { ...CHAT_DEFAULTS },
};
