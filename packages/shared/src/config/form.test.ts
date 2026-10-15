import { describe, expect, test } from "bun:test";
import { defaultConfig } from "./defaults";
import { CONFIG_FORM, CONFIG_SECTIONS, configWarnings, fieldMeta, sectionOf, toShown, toStored } from "./form";

/** Every leaf path of a config object; arrays (palette, rewards) count as one field. */
function leaves(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value) || typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

describe("config form metadata", () => {
  test("covers every field of the config, and nothing else", () => {
    const schemaPaths = leaves(defaultConfig)
      .filter((p) => p !== "palette")
      .sort();
    const formPaths = Object.values(CONFIG_FORM)
      .flat()
      .map((f) => f.path)
      .sort();
    expect(formPaths).toEqual(schemaPaths);
  });

  test("every config section has a form section, in the same order as the config", () => {
    expect([...CONFIG_SECTIONS].sort() as string[]).toEqual(Object.keys(defaultConfig).sort());
    for (const [section, fields] of Object.entries(CONFIG_FORM)) for (const f of fields) expect(sectionOf(f.path)).toBe(section as "canvas");
    expect(sectionOf("palette.3.price")).toBe("palette");
    expect(sectionOf("")).toBeNull();
  });

  test("units round-trip", () => {
    const meta = (path: string) => fieldMeta(path) as { scale?: number };
    const regen = meta("charges.regenMs");
    expect(toShown(30_000, regen)).toBe(30);
    expect(toStored(1.5, regen)).toBe(1500);
    expect(toStored(toShown(defaultConfig.chat.cooldownMs, meta("chat.cooldownMs")), meta("chat.cooldownMs"))).toBe(defaultConfig.chat.cooldownMs);
    expect(toStored(7, meta("charges.max"))).toBe(7);
  });

  test("warnings sit under the fields they are about", () => {
    const cheap = { ...defaultConfig, explosion: { ...defaultConfig.explosion, authorBonus: defaultConfig.shop.bomb.price } };
    expect(configWarnings(cheap).get("explosion.authorBonus")).toContain("bonusVsBomb");
    expect(configWarnings(defaultConfig).has("explosion.authorBonus")).toBe(false);
  });
});
