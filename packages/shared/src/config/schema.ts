import { z } from "zod";
import { BASE_COLOR_COUNT, CHUNK_SIZE, MAX_PALETTE_SIZE } from "../constants";

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const positiveInt = z.number().int().positive();
/** 64 chunks per side: chunk coordinates are u16 on the wire, this keeps memory bounded. */
const MAX_CANVAS_SIZE = 16_384;
const nonNegativeInt = z.number().int().nonnegative();

export const ITEM_KEYS = ["bomb", "detector", "defuser"] as const;
export const itemKeySchema = z.enum(ITEM_KEYS);
export type ItemKey = z.infer<typeof itemKeySchema>;

export const paletteEntrySchema = z.object({
  id: z
    .number()
    .int()
    .min(0)
    .max(MAX_PALETTE_SIZE - 1),
  type: z.enum(["solid", "animated", "gradient"]),
  /** Fallback color: clients that do not know `type` render the entry with it. */
  base: hexColor,
  params: z.record(z.string(), z.unknown()),
  unlock: z.enum(["default", "shop", "daily", "achievement"]),
  /** Required when `unlock` is "shop". */
  price: positiveInt.optional(),
});
export type PaletteEntry = z.infer<typeof paletteEntrySchema>;

export const rewardSchema = z.object({
  item: z.enum(["coins", "bomb", "detector", "defuser"]),
  amount: positiveInt,
});
export type Reward = z.infer<typeof rewardSchema>;

const shopItemSchema = z.object({
  price: positiveInt,
  /** Units (bombs) or uses (detector, defuser) granted per purchase. */
  amount: positiveInt,
});

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const gameConfigSchema = z
  .object({
    canvas: z.object({
      width: positiveInt.multipleOf(CHUNK_SIZE).max(MAX_CANVAS_SIZE),
      height: positiveInt.multipleOf(CHUNK_SIZE).max(MAX_CANVAS_SIZE),
    }),
    palette: z.array(paletteEntrySchema).min(BASE_COLOR_COUNT).max(MAX_PALETTE_SIZE),
    charges: z.object({ max: positiveInt, regenMs: positiveInt }),
    coinsPerPixel: nonNegativeInt,
    explosion: z.object({
      freezeMs: nonNegativeInt,
      coinPenalty: nonNegativeInt,
      selfFreezeMs: nonNegativeInt,
      selfCoinPenalty: nonNegativeInt,
      authorBonus: nonNegativeInt,
    }),
    bombs: z.object({ maxActivePerPlayer: positiveInt }),
    antiFarm: z.object({ maxRatedPerPairPerDay: nonNegativeInt }),
    defuse: z.object({ reward: nonNegativeInt }),
    shop: z.object({
      bomb: shopItemSchema,
      detector: shopItemSchema,
      defuser: shopItemSchema,
      chargeCapBoost: z.object({ price: positiveInt, amount: positiveInt, maxTotal: positiveInt }),
    }),
    starting: z.object({
      coins: nonNegativeInt,
      bomb: nonNegativeInt,
      detector: nonNegativeInt,
      defuser: nonNegativeInt,
    }),
    daily: z.object({
      timezone: z.string().min(1),
      rewards: z.array(rewardSchema).min(1),
    }),
    access: z.object({ minAccountAgeDays: nonNegativeInt }),
  })
  .superRefine((cfg, ctx) => {
    const seen = new Set<number>();
    cfg.palette.forEach((entry, index) => {
      if (seen.has(entry.id)) {
        ctx.addIssue({ code: "custom", message: `Duplicate palette id ${entry.id}`, path: ["palette", index, "id"], input: entry.id });
      }
      seen.add(entry.id);
      if (entry.unlock === "shop" && entry.price === undefined) {
        ctx.addIssue({ code: "custom", message: "Shop colors need a price", path: ["palette", index, "price"], input: entry });
      }
    });

    for (let id = 0; id < BASE_COLOR_COUNT; id++) {
      const entry = cfg.palette.find((e) => e.id === id);
      if (!entry || entry.unlock !== "default") {
        ctx.addIssue({ code: "custom", message: `Base color ${id} must exist with unlock "default"`, path: ["palette"], input: cfg.palette });
      }
    }

    if (!isValidTimeZone(cfg.daily.timezone)) {
      ctx.addIssue({ code: "custom", message: "Unknown time zone", path: ["daily", "timezone"], input: cfg.daily.timezone });
    }
  });

export type GameConfig = z.infer<typeof gameConfigSchema>;
