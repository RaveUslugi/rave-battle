import { describe, expect, test } from "bun:test";
import {
  describeAction,
  pluralCells,
  kindText,
  moderationErrorText,
  PERIOD_PRESETS,
  presetRange,
  previewText,
  rectText,
  resultText,
} from "./moderation-format";

describe("moderation-format", () => {
  test("pluralCells", () => {
    const expected: Array<[number, string]> = [
      [1, "1 клетка"],
      [2, "2 клетки"],
      [5, "5 клеток"],
      [11, "11 клеток"],
      [12, "12 клеток"],
      [21, "21 клетка"],
      [22, "22 клетки"],
      [25, "25 клеток"],
      [111, "111 клеток"],
    ];
    for (const [n, text] of expected) expect(pluralCells(n)).toBe(text);
  });

  test("rectText", () => {
    expect(rectText({ x1: 10, y1: 20, x2: 30, y2: 40 })).toBe("(10, 20) — (30, 40), 21×21 = 441 клетка");
    expect(rectText({ x1: 0, y1: 0, x2: 0, y2: 0 })).toBe("(0, 0) — (0, 0), 1×1 = 1 клетка");
  });

  test("kindText", () => {
    expect(kindText("place")).toBe("пиксель");
    expect(kindText("mod_rollback")).toBe("откат");
    expect(kindText("mod_clear")).toBe("очистка");
  });

  test("previewText", () => {
    expect(previewText({ cells: 5, bombs: 2 })).toBe("Изменится: 5 клеток · бомб будет снято: 2");
    expect(previewText({ cells: 0, bombs: 1 })).toBe("Изменится: 0 клеток · бомб будет снято: 1");
    expect(previewText({ cells: 0, bombs: 0 })).toBe("Ничего не изменится");
  });

  test("resultText", () => {
    expect(resultText({ cells: 5, skipped: 1, bombs: 2 })).toBe("Готово: 5 клеток, пропущено 1 (изменились после расчёта), бомб 2");
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
    expect(moderationErrorText("too_many_cells")).toBe("Слишком много клеток — откатите по областям или выберите меньший период");
    expect(moderationErrorText("bad_period")).toBe("Неверный период");
    expect(moderationErrorText("not_found")).toBe("Игрок не найден");
    expect(moderationErrorText("FORBIDDEN")).toBe("Не удалось выполнить действие");
    expect(moderationErrorText(undefined)).toBe("Не удалось выполнить действие");
  });

  test("describeAction", () => {
    const fmt = (ms: number) => `t${ms}`;
    expect(describeAction({ kind: "rollback_player", userId: 3, from: 0, to: 5, removeBombs: true }, { player: "Вася", period: "24 ч", fmt })).toBe(
      "Откат игрока Вася за 24 ч, со снятием бомб",
    );
    expect(describeAction({ kind: "rollback_player", userId: 3, from: 1, to: 5, removeBombs: false }, { fmt })).toBe("Откат игрока #3 за t1 — t5");
    expect(describeAction({ kind: "clear_area", mode: "fill" }, { fmt })).toBe("Очистка: залить фоном");
    expect(describeAction({ kind: "clear_area", mode: "to_time", at: 9 }, { fmt })).toBe("Очистка: откат к t9");
    expect(describeAction({ kind: "remove_bombs" }, { fmt })).toBe("Снятие бомб в области");
    expect(describeAction({ kind: "remove_bombs", userId: 3 }, { player: "Вася", fmt })).toBe("Снятие всех бомб игрока Вася");
    expect(describeAction({ kind: "remove_bombs", userId: 3 }, { fmt })).toBe("Снятие всех бомб игрока #3");
  });
});
