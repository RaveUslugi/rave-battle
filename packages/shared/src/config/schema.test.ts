import { describe, expect, test } from "bun:test";
import { defaultConfig } from "./defaults";
import { gameConfigSchema, type GameConfig } from "./schema";

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

  test("default config has 32 base colors and 512x512 canvas", () => {
    expect(defaultConfig.palette).toHaveLength(40);
    const shop = defaultConfig.palette.filter((e) => e.unlock === "shop");
    expect(shop.map((e) => e.id)).toEqual([32, 33, 34, 35, 36, 37, 38, 39]);
    expect(shop.every((e) => e.price !== undefined && e.price >= 200 && e.price <= 500)).toBe(true);
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
    expect(issuePaths(cfg)).toContain("palette.40.id");
  });

  test("rejects missing base color", () => {
    const cfg = clone();
    cfg.palette = cfg.palette.filter((entry) => entry.id !== 7);
    cfg.palette.push({ id: 41, type: "solid", base: "#123456", params: {}, unlock: "daily" });
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
    cfg.palette.push({ id: 40, type: "animated", base: "#FF00FF", params: {}, unlock: "shop" });
    expect(issuePaths(cfg)).toContain("palette.40.price");
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
