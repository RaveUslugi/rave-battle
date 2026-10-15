import { beforeEach, describe, expect, test } from "bun:test";
import { defaultConfig, type GameConfig } from "@rave/shared";
import { applyLocale } from "../../i18n";
import { changedSections, checkConfig, configDiff, getAt, issuesByPath, issuesUnder, issueText, sectionsWithIssues, setAt } from "./draft";

const clone = (): GameConfig => structuredClone(defaultConfig);

beforeEach(() => applyLocale("ru"));

describe("config draft", () => {
  test("the default config passes; schema problems land on their field paths", () => {
    expect(checkConfig(clone()).issues.size).toBe(0);
    const bad = setAt(setAt(clone(), "charges.max", 0), "shop.bomb.price", Number.NaN);
    const { config, issues } = checkConfig(bad);
    expect(config).toBeNull();
    expect(issues.get("charges.max")).toEqual(["Больше 0"]);
    expect(issues.get("shop.bomb.price")).toEqual(["Нужно число"]);
    expect([...sectionsWithIssues(issues)].sort()).toEqual(["charges", "shop"]);
  });

  test("palette and reward problems are found under their list", () => {
    const draft = clone();
    draft.palette[40] = { ...draft.palette[40]!, id: 39 };
    draft.daily.rewards[1] = { item: "coins", amount: 0 };
    const { issues } = checkConfig(draft);
    expect(issuesUnder(issues, "palette").join()).toContain("Цвет 39 встречается дважды");
    expect(issuesUnder(issues, "daily.rewards")).toEqual(["Больше 0"]);
  });

  test("setAt copies only the path; getAt reads it", () => {
    const base = clone();
    const next = setAt(base, "shop.bomb.price", 99);
    expect(getAt(next, "shop.bomb.price")).toBe(99);
    expect(base.shop.bomb.price).toBe(30);
    expect(next.palette).toBe(base.palette);
    expect(getAt(setAt(base, "daily.rewards.0.amount", 5), "daily.rewards.0.amount")).toBe(5);
    expect(Array.isArray(setAt(base, "daily.rewards.0.amount", 5).daily.rewards)).toBe(true);
  });

  test("changed sections and the diff", () => {
    const next = setAt(clone(), "shop.bomb.price", 99);
    expect([...changedSections(defaultConfig, next)]).toEqual(["shop"]);
    expect(configDiff(defaultConfig, next)).toEqual([{ path: "shop.bomb.price", before: "30", after: "99" }]);
    const colors = clone();
    colors.palette = colors.palette.filter((e) => e.id !== 33);
    expect(configDiff(defaultConfig, colors)[0]).toMatchObject({ path: "palette#33", after: "—" });
  });

  test("server issues and every code have their own text", () => {
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
    expect(issueText({ path: "", code: "zod_too_small", params: { minimum: 2, origin: "array" } })).toBe("Минимум 2 элем.");
    expect(issuesByPath([{ path: "canvas.width", code: "canvas_shrink", params: { current: 512 } }]).get("canvas.width")).toEqual([
      "Холст может только расти (сейчас 512)",
    ]);
  });
});
