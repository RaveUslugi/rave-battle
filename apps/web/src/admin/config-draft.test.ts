import { describe, expect, test } from "bun:test";
import { defaultConfig, type GameConfig } from "@rave/shared";
import { checkDraft, configDiff, draftFrom, issueText, serverIssues } from "./config-draft";

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
        { path: "canvas.width", code: "canvas_shrink", params: { current: 512 } },
        { path: "palette", code: "color_in_use_type_changed", params: { id: 7 } },
        { path: "palette.3.price", code: "zod_too_small", params: { minimum: 0, inclusive: false, origin: "number" } },
      ]),
    ).toEqual({
      canvas: ["width: Холст может только расти (сейчас 512)"],
      palette: ["Цвет 7 есть на холсте — менять его тип нельзя", "palette[3].price: Больше 0"],
    });
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
    next.palette.push({ id: 60, type: "solid", base: "#123456", params: {}, unlock: "shop", price: 300 });
    next.palette.find((e) => e.id === 33)!.base = "#000001";
    const diff = configDiff(defaultConfig, next);
    expect(diff).toContainEqual({ path: "palette#33.base", before: '"#00FFF0"', after: '"#000001"' });
    expect(diff.find((d) => d.path === "palette#60")).toMatchObject({ before: "—" });
    expect(diff.find((d) => d.path === "palette#39")).toMatchObject({ after: "—" });
    expect(diff).toHaveLength(3);
  });
});

describe("unknown server paths", () => {
  test("a path outside the sections goes to the general group", () => {
    const issues = serverIssues([
      { path: "mystery.field", code: "something_new" },
      { path: "", code: "unknown_timezone" },
    ]);
    expect(issues.general).toEqual(["mystery.field: Некорректное значение", "Неизвестный часовой пояс"]);
    expect(issues.canvas).toBeUndefined();
  });
});

describe("issueText", () => {
  test("every code the server and the shared schema produce has its own text", () => {
    const codes = [
      "canvas_shrink",
      "color_in_use_removed",
      "color_in_use_type_changed",
      "duplicate_palette_id",
      "shop_color_needs_price",
      "base_color_missing",
      "unknown_timezone",
      "zod_too_small",
      "zod_too_big",
      "zod_not_multiple_of",
      "zod_invalid_type",
      "zod_invalid_format",
      "zod_unrecognized_keys",
      "zod_invalid_union",
      "zod_invalid_value",
    ];
    for (const code of codes) expect(issueText({ path: "", code })).not.toBe("Некорректное значение");
  });

  test("bounds read naturally for numbers, arrays and strings", () => {
    expect(issueText({ path: "", code: "zod_too_big", params: { maximum: 10, inclusive: true, origin: "number" } })).toBe("Не больше 10");
    expect(issueText({ path: "", code: "zod_too_small", params: { minimum: 2, inclusive: true, origin: "array" } })).toBe("Минимум 2 элем.");
  });
});
