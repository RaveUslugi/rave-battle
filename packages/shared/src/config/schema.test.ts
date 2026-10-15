import { describe, expect, test } from "bun:test";
import { defaultConfig } from "./defaults";
import { CHAT_DEFAULTS, configIssuesFromZod, defaultPaletteParams, gameConfigSchema, type GameConfig, upgradeStoredConfig } from "./schema";

const clone = (): GameConfig => structuredClone(defaultConfig);

function issuePaths(cfg: unknown): string[] {
  const result = gameConfigSchema.safeParse(cfg);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join("."));
}

describe("gameConfigSchema", () => {
  test("default config is valid", () => {
    expect(gameConfigSchema.safeParse(defaultConfig).success).toBe(true);
  });

  test("default config has 32 base colors, 8 solid and 8 effect shop colors and a 512x512 canvas", () => {
    expect(defaultConfig.palette).toHaveLength(48);
    const shop = defaultConfig.palette.filter((e) => e.unlock === "shop");
    expect(shop.map((e) => e.id)).toEqual([32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47]);
    expect(shop.every((e) => e.price !== undefined && e.name !== undefined)).toBe(true);
    expect(shop.filter((e) => e.type === "solid").map((e) => e.id)).toEqual([32, 33, 34, 35, 36, 37, 38, 39]);
    expect(defaultConfig.canvas).toEqual({ width: 512, height: 512 });
  });

  test("rejects canvas size that is not a multiple of the chunk size", () => {
    const cfg = clone();
    cfg.canvas.width = 500;
    expect(issuePaths(cfg)).toContain("canvas.width");
  });

  test("bounds the canvas size", () => {
    const cfg = clone();
    cfg.canvas.width = 16_640;
    expect(issuePaths(cfg)).toContain("canvas.width");
    cfg.canvas.width = 16_384;
    expect(issuePaths(cfg)).not.toContain("canvas.width");
  });

  test("rejects duplicate palette ids", () => {
    const cfg = clone();
    cfg.palette.push({ id: 5, type: "solid", base: "#123456", params: {}, unlock: "daily" });
    expect(issuePaths(cfg)).toContain("palette.48.id");
  });

  test("rejects missing base color", () => {
    const cfg = clone();
    cfg.palette = cfg.palette.filter((entry) => entry.id !== 7);
    cfg.palette.push({ id: 60, type: "solid", base: "#123456", params: {}, unlock: "daily" });
    expect(issuePaths(cfg)).toContain("palette");
  });

  test("rejects base color that is not unlocked by default", () => {
    const cfg = clone();
    cfg.palette[3]!.unlock = "shop";
    cfg.palette[3]!.price = 10;
    expect(issuePaths(cfg)).toContain("palette");
  });

  test("rejects shop color without price", () => {
    const cfg = clone();
    cfg.palette.push({ id: 60, type: "solid", base: "#FF00FF", params: {}, unlock: "shop" });
    expect(issuePaths(cfg)).toContain("palette.48.price");
  });

  test("rejects unknown time zone", () => {
    const cfg = clone();
    cfg.daily.timezone = "Mars/Olympus";
    expect(issuePaths(cfg)).toContain("daily.timezone");
  });

  test("rejects empty daily rewards", () => {
    const cfg = clone();
    cfg.daily.rewards = [];
    expect(issuePaths(cfg)).toContain("daily.rewards");
  });
});

describe("palette effects", () => {
  const withEntry = (entry: unknown) => {
    const cfg = clone() as unknown as { palette: unknown[] };
    cfg.palette.push(entry);
    return cfg;
  };

  test("animated and gradient entries need their params", () => {
    expect(issuePaths(withEntry({ id: 60, type: "animated", base: "#FF00FF", params: {}, unlock: "daily" }))).toContain("palette.48.params.frames");
    expect(issuePaths(withEntry({ id: 60, type: "gradient", base: "#FF00FF", params: { stops: ["#FFFFFF"] }, unlock: "daily" }))).toContain(
      "palette.48.params.stops",
    );
    for (const type of ["solid", "animated", "gradient"] as const) {
      const params = defaultPaletteParams(type, "#FF00FF");
      expect(issuePaths(withEntry({ id: 60, type, base: "#FF00FF", params, unlock: "daily" }))).toEqual([]);
    }
  });

  test("bounds effect params", () => {
    const tooFast = { id: 60, type: "animated", base: "#FF00FF", params: { frames: ["#FF00FF", "#000000"], periodMs: 100 }, unlock: "daily" };
    expect(issuePaths(withEntry(tooFast))).toContain("palette.48.params.periodMs");
    const wide = { id: 60, type: "gradient", base: "#FF00FF", params: { stops: ["#FF00FF", "#000000"], scale: 32, angle: 360, speed: 0 }, unlock: "daily" };
    expect(issuePaths(withEntry(wide))).toContain("palette.48.params.angle");
  });
});

describe("chat section", () => {
  test("a config without it gets the defaults", () => {
    const { chat: _chat, ...old } = clone();
    const parsed = gameConfigSchema.parse(old);
    expect(parsed.chat).toEqual(CHAT_DEFAULTS);
  });

  test("bounds the message length", () => {
    const cfg = clone();
    cfg.chat.maxLength = 501;
    expect(issuePaths(cfg)).toContain("chat.maxLength");
  });
});

describe("configIssuesFromZod", () => {
  const issuesOf = (cfg: unknown) => {
    const result = gameConfigSchema.safeParse(cfg);
    return result.success ? [] : configIssuesFromZod(result.error.issues);
  };

  test("our own checks carry their code and params", () => {
    const cfg = clone();
    cfg.daily.timezone = "Mars/Olympus";
    cfg.palette.push({ id: 5, type: "solid", base: "#123456", params: {}, unlock: "daily" });
    expect(issuesOf(cfg)).toEqual([
      { path: "palette.48.id", code: "duplicate_palette_id", params: { id: 5 } },
      { path: "daily.timezone", code: "unknown_timezone", params: {} },
    ]);
  });

  test("zod checks become zod_<code> with their bounds", () => {
    const cfg = clone();
    cfg.charges.max = 0;
    expect(issuesOf(cfg)).toEqual([{ path: "charges.max", code: "zod_too_small", params: { minimum: 0, inclusive: false, origin: "number" } }]);
  });
});

describe("upgradeStoredConfig", () => {
  test("gives stored effect entries without valid params the defaults and keeps valid ones", () => {
    const cfg = clone() as unknown as { palette: unknown[] };
    cfg.palette.push({ id: 60, type: "animated", base: "#FF00FF", params: {}, unlock: "daily" });
    cfg.palette.push({ id: 61, type: "gradient", base: "#00FF00", params: { colors: 3 }, unlock: "daily" });
    expect(gameConfigSchema.safeParse(cfg).success).toBe(false);
    const upgraded = gameConfigSchema.parse(upgradeStoredConfig(cfg));
    expect(upgraded.palette.find((e) => e.id === 60)?.params).toEqual(defaultPaletteParams("animated", "#FF00FF"));
    expect(upgraded.palette.find((e) => e.id === 61)?.params).toEqual(defaultPaletteParams("gradient", "#00FF00"));
    expect(upgraded.palette.find((e) => e.id === 40)).toEqual(defaultConfig.palette.find((e) => e.id === 40));
  });

  test("leaves anything that is not a config alone", () => {
    expect(upgradeStoredConfig(null)).toBeNull();
    expect(upgradeStoredConfig({ palette: "x" })).toEqual({ palette: "x" });
  });
});
