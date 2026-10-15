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

const paletteCommon = {
  id: z
    .number()
    .int()
    .min(0)
    .max(MAX_PALETTE_SIZE - 1),
  /** Fallback color: minimap, heatmap and clients that cannot render the effect use it. */
  base: hexColor,
  unlock: z.enum(["default", "shop", "daily", "achievement"]),
  /** Required when `unlock` is "shop". */
  price: positiveInt.optional(),
  /** Shown in the shop and the admin; colors without a name are shown by number. */
  name: z.object({ ru: z.string().trim().min(1).max(32), en: z.string().trim().min(1).max(32) }).optional(),
};

/** The color cycles through `frames` once per `periodMs`, blending between frames. */
export const animatedParamsSchema = z.object({
  frames: z.array(hexColor).min(2).max(8),
  periodMs: z.number().int().min(400).max(10_000),
});

/** The color depends on the cell's world position: `stops` repeat every `scale` cells along `angle`; `speed` > 0 drifts them over time. */
export const gradientParamsSchema = z.object({
  stops: z.array(hexColor).min(2).max(6),
  scale: z.number().int().min(4).max(256),
  angle: z.number().int().min(0).max(359),
  speed: z.number().min(0).max(1),
});

export const paletteEntrySchema = z.discriminatedUnion("type", [
  z.object({ ...paletteCommon, type: z.literal("solid"), params: z.object({}) }),
  z.object({ ...paletteCommon, type: z.literal("animated"), params: animatedParamsSchema }),
  z.object({ ...paletteCommon, type: z.literal("gradient"), params: gradientParamsSchema }),
]);
export type PaletteEntry = z.infer<typeof paletteEntrySchema>;
export type PaletteType = PaletteEntry["type"];

/** Valid starting params for a palette entry of `type` (the admin switches types with them). */
export function defaultPaletteParams(type: PaletteType, base: string): PaletteEntry["params"] {
  if (type === "animated") return { frames: [base, "#FFFFFF"], periodMs: 1200 };
  if (type === "gradient") return { stops: [base, "#FFFFFF"], scale: 32, angle: 45, speed: 0 };
  return {};
}

/**
 * Brings a config stored by an older version up to the current schema before parsing: before effects
 * had a schema, animated and gradient entries could be saved with any params. Only for stored data;
 * new configs from the admin are validated as they are.
 */
export function upgradeStoredConfig(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { palette?: unknown }).palette)) return raw;
  const palette = (raw as { palette: unknown[] }).palette.map((entry) => {
    if (typeof entry !== "object" || entry === null) return entry;
    const e = entry as { type?: unknown; base?: unknown; params?: unknown };
    if ((e.type !== "animated" && e.type !== "gradient") || typeof e.base !== "string") return entry;
    const params = e.type === "animated" ? animatedParamsSchema.safeParse(e.params) : gradientParamsSchema.safeParse(e.params);
    return params.success ? entry : { ...e, params: defaultPaletteParams(e.type, e.base) };
  });
  return { ...raw, palette };
}

export const CHAT_DEFAULTS = { enabled: true, maxLength: 200, cooldownMs: 3000, historySize: 100, retentionDays: 30 };

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
    // Defaulted: config versions saved before the chat existed still parse.
    chat: z
      .object({
        enabled: z.boolean(),
        maxLength: z.number().int().min(1).max(500),
        cooldownMs: nonNegativeInt.max(600_000),
        historySize: z.number().int().min(10).max(500),
        retentionDays: z.number().int().min(1).max(365),
      })
      .default(CHAT_DEFAULTS),
  })
  .superRefine((cfg, ctx) => {
    const seen = new Set<number>();
    cfg.palette.forEach((entry, index) => {
      if (seen.has(entry.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate palette id ${entry.id}`,
          path: ["palette", index, "id"],
          input: entry.id,
          params: { code: "duplicate_palette_id", id: entry.id },
        });
      }
      seen.add(entry.id);
      if (entry.unlock === "shop" && entry.price === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "Shop colors need a price",
          path: ["palette", index, "price"],
          input: entry,
          params: { code: "shop_color_needs_price", id: entry.id },
        });
      }
    });

    for (let id = 0; id < BASE_COLOR_COUNT; id++) {
      const entry = cfg.palette.find((e) => e.id === id);
      if (!entry || entry.unlock !== "default") {
        ctx.addIssue({
          code: "custom",
          message: `Base color ${id} must exist with unlock "default"`,
          path: ["palette"],
          input: cfg.palette,
          params: { code: "base_color_missing", id },
        });
      }
    }

    if (!isValidTimeZone(cfg.daily.timezone)) {
      ctx.addIssue({
        code: "custom",
        message: "Unknown time zone",
        path: ["daily", "timezone"],
        input: cfg.daily.timezone,
        params: { code: "unknown_timezone" },
      });
    }
  });

export type GameConfig = z.infer<typeof gameConfigSchema>;

/** One config problem, as a code the client translates. `path` is dot-joined like "palette.3.price"; "" = the whole config. */
export interface ConfigIssue {
  path: string;
  code: string;
  params?: Record<string, unknown>;
}

/** Zod issues → ConfigIssue: our own checks carry `params.code`; zod's built-in ones become `zod_<code>`. */
export function configIssuesFromZod(issues: ReadonlyArray<z.core.$ZodIssue>): ConfigIssue[] {
  return issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    if (issue.code === "custom") {
      const { code, ...params } = (issue.params ?? {}) as Record<string, unknown>;
      return { path, code: typeof code === "string" ? code : "zod_custom", params };
    }
    const params: Record<string, unknown> = {};
    for (const key of ["minimum", "maximum", "inclusive", "origin", "expected", "format", "divisor", "keys"] as const) {
      if (key in issue) params[key] = (issue as unknown as Record<string, unknown>)[key];
    }
    return { path, code: `zod_${issue.code}`, params };
  });
}
