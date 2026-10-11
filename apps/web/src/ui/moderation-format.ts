import { rectCells, type Rect } from "@rave/shared/client";

export type PixelKind = "place" | "mod_rollback" | "mod_clear";

export function rectText(r: Rect): string {
  const cells = rectCells(r);
  return `(${r.x1}, ${r.y1}) — (${r.x2}, ${r.y2}), ${r.x2 - r.x1 + 1}×${r.y2 - r.y1 + 1} = ${cells} клеток`;
}

export function kindText(kind: PixelKind): string {
  return kind === "place" ? "пиксель" : kind === "mod_rollback" ? "откат" : "очистка";
}

export function previewText({ cells, bombs }: { cells: number; bombs: number }): string {
  return cells === 0 && bombs === 0 ? "Ничего не изменится" : `Изменится клеток: ${cells} · бомб будет снято: ${bombs}`;
}

export function resultText({ cells, skipped, bombs }: { cells: number; skipped: number; bombs: number }): string {
  return `Готово: клеток ${cells}, пропущено ${skipped} (изменились после расчёта), бомб ${bombs}`;
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
};

const FAILED = "Не удалось выполнить действие";

/** Text for a planner error code; anything else (network, FORBIDDEN) gets the generic failure. */
export function moderationErrorText(code: string | undefined): string {
  return (code && ERROR_TEXTS[code]) || FAILED;
}
