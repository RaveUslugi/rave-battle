import { beforeEach, describe, expect, test } from "bun:test";
import { applyLocale, formatNumber } from "../i18n";
import {
  adminErrorText,
  BAN_PRESETS,
  banUntil,
  cellsText,
  describeAction,
  details,
  entryArea,
  fmt,
  kindText,
  PERIOD_PRESETS,
  parseDelta,
  presetRange,
  previewText,
  rectText,
  resultText,
} from "./format";

const area = { x1: 0, y1: 0, x2: 9, y2: 4 };
const counts = { cells: 12, skipped: 3, bombs: 2 };

beforeEach(() => applyLocale("ru"));

describe("moderation texts", () => {
  test("cells follow Russian plural rules; English has its own", () => {
    const expected: Array<[number, string]> = [
      [1, "1 клетка"],
      [2, "2 клетки"],
      [5, "5 клеток"],
      [11, "11 клеток"],
      [21, "21 клетка"],
      [22, "22 клетки"],
      [1500, `${formatNumber(1500, "ru")} клеток`],
    ];
    for (const [n, text] of expected) expect(cellsText(n)).toBe(text);
    applyLocale("en");
    expect(cellsText(1)).toBe("1 cell");
    expect(cellsText(1500)).toBe("1,500 cells");
  });

  test("rectangles, kinds, previews, results", () => {
    expect(rectText({ x1: 10, y1: 20, x2: 30, y2: 40 })).toBe("(10, 20) — (30, 40), 21×21 = 441 клетка");
    expect(kindText("mod_rollback")).toBe("откат");
    expect(previewText({ cells: 5, bombs: 2 })).toBe("Изменится: 5 клеток · бомб будет снято: 2");
    expect(previewText({ cells: 0, bombs: 0 })).toBe("Ничего не изменится");
    expect(resultText({ cells: 5, skipped: 1, bombs: 2 })).toBe("Готово: 5 клеток, пропущено 1 (изменились после расчёта), бомб 2");
  });

  test("periods and errors", () => {
    const [hour, , week, all] = PERIOD_PRESETS;
    expect(presetRange(hour, 10_000_000)).toEqual({ from: 10_000_000 - 3_600_000, to: 10_000_000 });
    expect(presetRange(week, 1000)).toEqual({ from: 0, to: 1000 });
    expect(presetRange(all, 10_000_000)).toEqual({ from: 0, to: 10_000_000 });
    expect(adminErrorText("too_many_cells")).toBe("Слишком много клеток — откатите по областям или выберите меньший период");
    expect(adminErrorText("FORBIDDEN")).toBe("Не удалось выполнить действие");
    expect(adminErrorText(undefined)).toBe("Не удалось выполнить действие");
  });

  test("describeAction", () => {
    expect(describeAction({ kind: "rollback_player", userId: 3, from: 0, to: 5, removeBombs: true }, { player: "Вася", period: "24 часа" })).toBe(
      "Откат игрока Вася за 24 часа, со снятием бомб",
    );
    expect(describeAction({ kind: "clear_area", mode: "fill" }, {})).toBe("Очистка: залить фоном");
    expect(describeAction({ kind: "remove_bombs", userId: 3 }, {})).toBe("Снятие всех бомб игрока #3");
  });
});

describe("log details", () => {
  test("ban, edit, config", () => {
    expect(details({ action: "ban", params: { until: 1_700_000_000_000, reason: "спам" } })).toBe(`до ${fmt(1_700_000_000_000)}: спам`);
    expect(details({ action: "chat_mute", params: { until: "permanent", reason: "флуд" } })).toBe("навсегда: флуд");
    expect(details({ action: "player_edit", params: { changes: { coins: 500, bomb: -2 }, comment: "компенсация" } })).toBe(
      "Монеты +500, Бомбы −2 — компенсация",
    );
    expect(details({ action: "config_rollback", params: { version: 3, fromVersion: 5, comment: "назад" } })).toBe("версия 3 (из 5) — назад");
  });

  test("area actions name the area and the counts", () => {
    const whole = details({ action: "rollback_player", params: { from: 1, to: 2, removeBombs: true, area: null, ...counts } });
    expect(whole).toContain("весь холст");
    expect(whole).toEndWith("клеток 12, пропущено 3, бомб 2");
    expect(details({ action: "clear_area", params: { area, mode: "fill", ...counts } })).toContain("10×5 = 50 клеток, очистка");
    expect(details({ action: "remove_bombs", params: { userId: 7, ...counts } })).toStartWith("все бомбы игрока #7");
    expect(details({ action: "chat_delete", params: { ids: [1, 2], periodMs: 86_400_000 } })).toBe("сообщений: 2 за 24 ч");
    expect(entryArea({ params: { area } })).toEqual(area);
    expect(entryArea({ params: {} })).toBeNull();
  });
});

describe("ban and balance input", () => {
  test("presets and custom dates", () => {
    expect(BAN_PRESETS.map((p) => p.key)).toEqual(["1h", "24h", "7d", "30d", "forever"]);
    expect(banUntil({ preset: "1h" }, 1000)).toBe(1000 + 3_600_000);
    expect(banUntil({ preset: "forever" }, 1000)).toBe("permanent");
    expect(banUntil({ custom: "" }, 1000)).toBeNull();
    expect(banUntil({ custom: "2000-01-01T00:00" }, Date.now())).toBeNull();
  });

  test("deltas", () => {
    expect(parseDelta("")).toBe(0);
    expect(parseDelta("+500")).toBe(500);
    expect(parseDelta("−2")).toBe(-2);
    expect(parseDelta("1.5")).toBeNull();
    expect(parseDelta("2000000")).toBeNull();
  });
});
