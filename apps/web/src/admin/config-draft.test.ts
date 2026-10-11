import { describe, expect, test } from "bun:test";
import { defaultConfig, type GameConfig } from "@rave/shared";
import { checkDraft, configDiff, draftFrom, serverIssues } from "./config-draft";

const clone = (): GameConfig => structuredClone(defaultConfig);

describe("checkDraft", () => {
  test("default config round-trips with no issues", () => {
    const res = checkDraft(draftFrom(defaultConfig));
    expect(res.issues).toEqual({});
    expect(res.config).toEqual(defaultConfig);
  });

  test("broken JSON is reported only in its section", () => {
    const draft = draftFrom(defaultConfig);
    draft.texts.shop = "{ nope";
    const res = checkDraft(draft);
    expect(res.config).toBeNull();
    expect(Object.keys(res.issues)).toEqual(["shop"]);
    expect(res.issues.shop?.[0]).toStartWith("Ошибка JSON:");
  });

  test("schema errors land in their section", () => {
    const draft = draftFrom(defaultConfig);
    draft.texts.charges = JSON.stringify({ max: 0, regenMs: 30000 });
    const res = checkDraft(draft);
    expect(res.config).toBeNull();
    expect(Object.keys(res.issues)).toEqual(["charges"]);
    expect(res.issues.charges?.[0]).toStartWith("max: ");
  });

  test("nested shop paths drop the section prefix", () => {
    const draft = draftFrom(defaultConfig);
    draft.texts.shop = JSON.stringify({ ...defaultConfig.shop, bomb: { price: 0, amount: 1 } });
    expect(checkDraft(draft).issues.shop?.[0]).toStartWith("bomb.price: ");
  });

  test("duplicate palette id is a palette error", () => {
    const draft = draftFrom(defaultConfig);
    draft.palette[33] = { ...draft.palette[33]!, id: 32 };
    const res = checkDraft(draft);
    expect(res.config).toBeNull();
    expect(Object.keys(res.issues)).toEqual(["palette"]);
    expect(res.issues.palette?.some((m) => m.startsWith("palette[33].id: "))).toBe(true);
  });
});

describe("serverIssues", () => {
  test("groups dotted server paths by section", () => {
    expect(
      serverIssues([
        { path: "canvas.width", message: "x" },
        { path: "palette", message: "y" },
        { path: "palette.3.price", message: "z" },
      ]),
    ).toEqual({ canvas: ["width: x"], palette: ["y", "palette[3].price: z"] });
  });
});

describe("configDiff", () => {
  test("identical configs have an empty diff", () => {
    expect(configDiff(defaultConfig, clone())).toEqual([]);
  });

  test("bomb price change", () => {
    const next = clone();
    next.shop.bomb.price = 99;
    expect(configDiff(defaultConfig, next)).toEqual([{ path: "shop.bomb.price", before: "30", after: "99" }]);
  });

  test("added and removed colors, changed base", () => {
    const next = clone();
    next.palette = next.palette.filter((e) => e.id !== 39);
    next.palette.push({ id: 40, type: "solid", base: "#123456", params: {}, unlock: "shop", price: 300 });
    next.palette.find((e) => e.id === 33)!.base = "#000001";
    const diff = configDiff(defaultConfig, next);
    expect(diff).toContainEqual({ path: "palette#33.base", before: '"#00FFF0"', after: '"#000001"' });
    expect(diff.find((d) => d.path === "palette#40")).toMatchObject({ before: "—" });
    expect(diff.find((d) => d.path === "palette#39")).toMatchObject({ after: "—" });
    expect(diff).toHaveLength(3);
  });
});
