import { describe, expect, test } from "bun:test";
import { kindText, moderationErrorText, PERIOD_PRESETS, presetRange, previewText, rectText, resultText } from "./moderation-format";

describe("moderation-format", () => {
  test("rectText", () => {
    expect(rectText({ x1: 10, y1: 20, x2: 30, y2: 40 })).toBe("(10, 20) — (30, 40), 21×21 = 441 клеток");
    expect(rectText({ x1: 0, y1: 0, x2: 0, y2: 0 })).toBe("(0, 0) — (0, 0), 1×1 = 1 клеток");
  });

  test("kindText", () => {
    expect(kindText("place")).toBe("пиксель");
    expect(kindText("mod_rollback")).toBe("откат");
    expect(kindText("mod_clear")).toBe("очистка");
  });

  test("previewText", () => {
    expect(previewText({ cells: 5, bombs: 2 })).toBe("Изменится клеток: 5 · бомб будет снято: 2");
    expect(previewText({ cells: 0, bombs: 1 })).toBe("Изменится клеток: 0 · бомб будет снято: 1");
    expect(previewText({ cells: 0, bombs: 0 })).toBe("Ничего не изменится");
  });

  test("resultText", () => {
    expect(resultText({ cells: 5, skipped: 1, bombs: 2 })).toBe("Готово: клеток 5, пропущено 1 (изменились после расчёта), бомб 2");
  });

  test("period presets", () => {
    expect(PERIOD_PRESETS.map((p) => p.label)).toEqual(["1 ч", "24 ч", "7 д", "всё время"]);
    const [hour, , week, all] = PERIOD_PRESETS;
    expect(presetRange(hour!, 10_000_000)).toEqual({ from: 10_000_000 - 3_600_000, to: 10_000_000 });
    expect(presetRange(week!, 1000)).toEqual({ from: 0, to: 1000 });
    expect(presetRange(all!, 10_000_000)).toEqual({ from: 0, to: 10_000_000 });
  });

  test("moderationErrorText", () => {
    expect(moderationErrorText("bad_area")).toBe("Область вне холста");
    expect(moderationErrorText("area_too_large")).toBe("Слишком большая область");
    expect(moderationErrorText("bad_period")).toBe("Неверный период");
    expect(moderationErrorText("not_found")).toBe("Игрок не найден");
    expect(moderationErrorText("FORBIDDEN")).toBe("Не удалось выполнить действие");
    expect(moderationErrorText(undefined)).toBe("Не удалось выполнить действие");
  });
});
