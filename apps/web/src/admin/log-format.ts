import type { ModAction } from "@rave/shared/client";
import { rectText } from "../ui/moderation-format";
import { ITEM_LABEL } from "./labels";

const ITEM_KEYS = Object.keys(ITEM_LABEL) as Array<keyof typeof ITEM_LABEL>;

export const fmt = (ms: number) => new Date(ms).toLocaleString("ru-RU");

interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const isRect = (v: unknown): v is Rect =>
  typeof v === "object" && v !== null && (["x1", "y1", "x2", "y2"] as const).every((k) => Number.isFinite((v as Record<string, unknown>)[k]));

const area = (v: unknown) => (isRect(v) ? rectText(v) : "область неизвестна");

/** "клеток N, пропущено K, бомб M" from the counts the engine adds to every moderation entry. */
function counts(p: Record<string, unknown>): string {
  return `клеток ${Number(p.cells ?? 0)}, пропущено ${Number(p.skipped ?? 0)}, бомб ${Number(p.bombs ?? 0)}`;
}

/** One-line description of a mod_log entry's params, shared by the log table and the player card history. */
export function details(entry: { action: ModAction; params: Record<string, unknown> }): string {
  const p = entry.params;
  const comment = String(p.comment ?? "");
  switch (entry.action) {
    case "ban":
      return p.until === "permanent" ? `навсегда: ${String(p.reason ?? "")}` : `до ${fmt(Number(p.until))}: ${String(p.reason ?? "")}`;
    case "unban":
      return String(p.reason ?? "");
    case "player_edit": {
      const changes = (p.changes ?? {}) as Record<string, number | undefined>;
      const parts = ITEM_KEYS.flatMap((k) => {
        const d = changes[k];
        return d ? [`${ITEM_LABEL[k]} ${d > 0 ? "+" : "−"}${Math.abs(d)}`] : [];
      });
      return `${parts.join(", ")} — ${comment}`;
    }
    case "config_save":
      return `версия ${String(p.version)} — ${comment}`;
    case "config_rollback":
      return `версия ${String(p.version)} (из ${String(p.fromVersion)}) — ${comment}`;
    case "rollback_player": {
      const where = isRect(p.area) ? rectText(p.area) : "весь холст";
      return `с ${fmt(Number(p.from))} по ${fmt(Number(p.to))}, ${where}${p.removeBombs ? ", со снятием бомб" : ""}: ${counts(p)}`;
    }
    case "clear_area":
      return p.mode === "to_time" ? `${area(p.area)}, возврат к состоянию на ${fmt(Number(p.at))}: ${counts(p)}` : `${area(p.area)}, очистка: ${counts(p)}`;
    case "remove_bombs":
      return `${p.userId !== undefined ? `все бомбы игрока #${String(p.userId)}` : area(p.area)}: ${counts(p)}`;
  }
}
