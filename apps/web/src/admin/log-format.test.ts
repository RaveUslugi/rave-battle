import { describe, expect, test } from "bun:test";
import { details, fmt } from "./log-format";

const area = { x1: 0, y1: 0, x2: 9, y2: 4 };
const counts = { cells: 12, skipped: 3, bombs: 2 };

describe("details", () => {
  test("ban: timed and permanent", () => {
    expect(details({ action: "ban", params: { until: 1_700_000_000_000, reason: "спам" } })).toBe(`до ${fmt(1_700_000_000_000)}: спам`);
    expect(details({ action: "ban", params: { until: "permanent", reason: "читы" } })).toBe("навсегда: читы");
  });
  test("unban", () => {
    expect(details({ action: "unban", params: { reason: "ошибка" } })).toBe("ошибка");
  });
  test("player_edit", () => {
    expect(details({ action: "player_edit", params: { changes: { coins: 500, bomb: -2 }, comment: "компенсация" } })).toBe(
      "Монеты +500, Бомбы −2 — компенсация",
    );
  });
  test("config_save and config_rollback", () => {
    expect(details({ action: "config_save", params: { version: 5, comment: "правка" } })).toBe("версия 5 — правка");
    expect(details({ action: "config_rollback", params: { version: 3, fromVersion: 5, comment: "назад" } })).toBe("версия 3 (из 5) — назад");
  });
  test("rollback_player: whole canvas and area", () => {
    const base = { from: 1000, to: 2000, removeBombs: true, ...counts };
    const whole = details({ action: "rollback_player", params: { ...base, area: null } });
    expect(whole).toContain("весь холст");
    expect(whole).toContain("со снятием бомб");
    expect(whole).toEndWith("клеток 12, пропущено 3, бомб 2");
    const part = details({ action: "rollback_player", params: { ...base, removeBombs: false, area } });
    expect(part).toContain("(0, 0) — (9, 4), 10×5 = 50 клеток");
    expect(part).not.toContain("снятием");
  });
  test("clear_area: fill and to_time", () => {
    const fill = details({ action: "clear_area", params: { area, mode: "fill", ...counts } });
    expect(fill).toContain("10×5");
    expect(fill).toContain("очистка");
    expect(fill).toEndWith("клеток 12, пропущено 3, бомб 2");
    const toTime = details({ action: "clear_area", params: { area, mode: "to_time", at: 5000, ...counts } });
    expect(toTime).toContain(`возврат к состоянию на ${fmt(5000)}`);
  });
  test("remove_bombs: by player and by area", () => {
    expect(details({ action: "remove_bombs", params: { userId: 7, ...counts } })).toStartWith("все бомбы игрока #7: клеток 12");
    expect(details({ action: "remove_bombs", params: { area, ...counts } })).toContain("10×5");
  });
  test("missing counts default to zero", () => {
    expect(details({ action: "remove_bombs", params: { userId: 1 } })).toEndWith("клеток 0, пропущено 0, бомб 0");
  });
});
