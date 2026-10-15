import { CHUNK_SIZE } from "../constants";
import type { GameConfig } from "./schema";

/**
 * Metadata of the admin config form: which fields each section shows, in what unit, and the balance
 * warnings. Labels and hints live in the client dictionaries under the field's path
 * (`admin.field.<path>`, `admin.fieldHint.<path>`); this file stays language-free.
 */

export type FieldUnit = "seconds" | "minutes" | "days" | "coins" | "count" | "cells" | "chars";

export type FieldMeta =
  /** `scale`: the stored value is the shown one times `scale` (milliseconds shown as seconds: 1000). */
  | { path: string; kind: "number"; unit: FieldUnit; scale?: number; step?: number }
  | { path: string; kind: "boolean" }
  | { path: string; kind: "timezone" }
  /** The daily reward list: edited as rows (item, amount). */
  | { path: string; kind: "rewards" };

export const CONFIG_SECTIONS = [
  "canvas",
  "charges",
  "coinsPerPixel",
  "explosion",
  "bombs",
  "antiFarm",
  "defuse",
  "shop",
  "starting",
  "daily",
  "access",
  "chat",
  "palette",
] as const;
export type ConfigSectionId = (typeof CONFIG_SECTIONS)[number];

const num = (path: string, unit: FieldUnit, extra: { scale?: number; step?: number } = {}): FieldMeta => ({ path, kind: "number", unit, ...extra });
const SECONDS = { scale: 1000 };

/** Fields of every section except the palette, which has its own editor. */
export const CONFIG_FORM: Record<Exclude<ConfigSectionId, "palette">, FieldMeta[]> = {
  canvas: [num("canvas.width", "cells", { step: CHUNK_SIZE }), num("canvas.height", "cells", { step: CHUNK_SIZE })],
  charges: [num("charges.max", "count"), num("charges.regenMs", "seconds", SECONDS)],
  coinsPerPixel: [num("coinsPerPixel", "coins")],
  explosion: [
    num("explosion.freezeMs", "seconds", SECONDS),
    num("explosion.coinPenalty", "coins"),
    num("explosion.selfFreezeMs", "seconds", SECONDS),
    num("explosion.selfCoinPenalty", "coins"),
    num("explosion.authorBonus", "coins"),
  ],
  bombs: [num("bombs.maxActivePerPlayer", "count")],
  antiFarm: [num("antiFarm.maxRatedPerPairPerDay", "count")],
  defuse: [num("defuse.reward", "coins")],
  shop: [
    num("shop.bomb.price", "coins"),
    num("shop.bomb.amount", "count"),
    num("shop.detector.price", "coins"),
    num("shop.detector.amount", "count"),
    num("shop.defuser.price", "coins"),
    num("shop.defuser.amount", "count"),
    num("shop.chargeCapBoost.price", "coins"),
    num("shop.chargeCapBoost.amount", "count"),
    num("shop.chargeCapBoost.maxTotal", "count"),
  ],
  starting: [num("starting.coins", "coins"), num("starting.bomb", "count"), num("starting.detector", "count"), num("starting.defuser", "count")],
  daily: [
    { path: "daily.timezone", kind: "timezone" },
    { path: "daily.rewards", kind: "rewards" },
  ],
  access: [num("access.minAccountAgeDays", "days")],
  chat: [
    { path: "chat.enabled", kind: "boolean" },
    num("chat.maxLength", "chars"),
    num("chat.cooldownMs", "seconds", SECONDS),
    num("chat.historySize", "count"),
    num("chat.retentionDays", "days"),
  ],
};

/** The section a config path belongs to ("shop.bomb.price" → "shop", "palette.3.price" → "palette"). */
export function sectionOf(path: string): ConfigSectionId | null {
  const head = path.split(".")[0];
  return (CONFIG_SECTIONS as readonly string[]).includes(head ?? "") ? (head as ConfigSectionId) : null;
}

export function fieldMeta(path: string): FieldMeta | undefined {
  for (const fields of Object.values(CONFIG_FORM)) {
    const meta = fields.find((f) => f.path === path);
    if (meta) return meta;
  }
  return undefined;
}

/** Stored value → the number the form shows (milliseconds → seconds). */
export function toShown(value: number, meta: { scale?: number }): number {
  return value / (meta.scale ?? 1);
}

/** The number the admin typed → the stored value; whole units only. */
export function toStored(shown: number, meta: { scale?: number }): number {
  return Math.round(shown * (meta.scale ?? 1));
}

/** Balance warnings: allowed, but probably not intended. `paths` are the fields the warning sits under. */
export const CONFIG_WARNINGS: Array<{ code: string; paths: string[]; test: (c: GameConfig) => boolean }> = [
  { code: "bonusVsBomb", paths: ["explosion.authorBonus", "shop.bomb.price"], test: (c) => c.explosion.authorBonus * 2 > c.shop.bomb.price },
  { code: "defuseVsDefuser", paths: ["defuse.reward", "shop.defuser.price"], test: (c) => c.defuse.reward >= c.shop.defuser.price },
  {
    code: "penaltyZero",
    paths: ["explosion.coinPenalty", "explosion.freezeMs"],
    test: (c) => c.explosion.coinPenalty === 0 && c.explosion.freezeMs === 0,
  },
  { code: "regenFast", paths: ["charges.regenMs"], test: (c) => c.charges.regenMs < 5000 },
];

/** Warnings that hold for `config`, by field path. */
export function configWarnings(config: GameConfig): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const w of CONFIG_WARNINGS) {
    if (!w.test(config)) continue;
    for (const path of w.paths) out.set(path, [...(out.get(path) ?? []), w.code]);
  }
  return out;
}
