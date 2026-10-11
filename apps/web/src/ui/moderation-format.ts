import { rectCells, type Rect } from "@rave/shared/client";

export type PixelKind = "place" | "mod_rollback" | "mod_clear";

/** "1 клетка", "2 клетки", "5 клеток" (Russian plural rules). */
export function pluralCells(n: number): string {
  const last = n % 10;
  const tail = n % 100;
  const word = last === 1 && tail !== 11 ? "клетка" : last >= 2 && last <= 4 && (tail < 12 || tail > 14) ? "клетки" : "клеток";
  return `${n} ${word}`;
}

export function rectText(r: Rect): string {
  const cells = rectCells(r);
  return `(${r.x1}, ${r.y1}) — (${r.x2}, ${r.y2}), ${r.x2 - r.x1 + 1}×${r.y2 - r.y1 + 1} = ${pluralCells(cells)}`;
}

export function kindText(kind: PixelKind): string {
  return kind === "place" ? "пиксель" : kind === "mod_rollback" ? "откат" : "очистка";
}

export function previewText({ cells, bombs }: { cells: number; bombs: number }): string {
  return cells === 0 && bombs === 0 ? "Ничего не изменится" : `Изменится: ${pluralCells(cells)} · бомб будет снято: ${bombs}`;
}

export function resultText({ cells, skipped, bombs }: { cells: number; skipped: number; bombs: number }): string {
  return `Готово: ${pluralCells(cells)}, пропущено ${skipped} (изменились после расчёта), бомб ${bombs}`;
}

const HOUR = 3_600_000;

/** `ms` is how far back the period starts; null = since the beginning (`from = 0`). */
export const PERIOD_PRESETS: ReadonlyArray<{ id: string; label: string; ms: number | null }> = [
  { id: "1h", label: "1 ч", ms: HOUR },
  { id: "24h", label: "24 ч", ms: 24 * HOUR },
  { id: "7d", label: "7 д", ms: 7 * 24 * HOUR },
  { id: "all", label: "всё время", ms: null },
];

export function presetRange(preset: { ms: number | null }, now: number): { from: number; to: number } {
  return { from: preset.ms === null ? 0 : Math.max(0, now - preset.ms), to: now };
}

const ERROR_TEXTS: Record<string, string> = {
  bad_area: "Область вне холста",
  area_too_large: "Слишком большая область",
  bad_period: "Неверный период",
  not_found: "Игрок не найден",
  too_many_cells: "Слишком много клеток — откатите по областям или выберите меньший период",
};

const FAILED = "Не удалось выполнить действие";

/** Text for a planner error code; anything else (network, FORBIDDEN) gets the generic failure. */
export function moderationErrorText(code: string | undefined): string {
  return (code && ERROR_TEXTS[code]) || FAILED;
}

export type DescribableAction =
  | { kind: "rollback_player"; userId: number; from: number; to: number; removeBombs: boolean }
  | { kind: "clear_area"; mode: "fill" }
  | { kind: "clear_area"; mode: "to_time"; at: number }
  | { kind: "remove_bombs"; userId?: number };

/** One line saying what a previewed action will do. `period` is its label ("24 ч"), `fmt` formats a timestamp. */
export function describeAction(action: DescribableAction, ctx: { player?: string; period?: string; fmt: (ms: number) => string }): string {
  switch (action.kind) {
    case "rollback_player": {
      const bombs = action.removeBombs ? ", со снятием бомб" : "";
      const period = ctx.period ?? `${ctx.fmt(action.from)} — ${ctx.fmt(action.to)}`;
      return `Откат игрока ${ctx.player ?? `#${action.userId}`} за ${period}${bombs}`;
    }
    case "clear_area":
      return action.mode === "fill" ? "Очистка: залить фоном" : `Очистка: откат к ${ctx.fmt(action.at)}`;
    case "remove_bombs":
      return action.userId === undefined ? "Снятие бомб в области" : `Снятие всех бомб игрока ${ctx.player ?? `#${action.userId}`}`;
  }
}
