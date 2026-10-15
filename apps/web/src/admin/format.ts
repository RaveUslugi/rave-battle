import { type ModAction, type Rect, rectCells } from "@rave/shared/client";
import { currentLocale, formatNumber, i18n } from "../i18n";

/** Admin texts: moderation actions, previews, log entries. All through i18n (`admin.*`). */

export type PixelKind = "place" | "mod_rollback" | "mod_clear";
export const ITEMS = ["coins", "bomb", "detector", "defuser"] as const;
export type ItemKind = (typeof ITEMS)[number];

const t = i18n.t.bind(i18n);

export const fmt = (ms: number) => new Date(ms).toLocaleString(currentLocale());

export const cellsText = (n: number) => t("admin.mod.cells", { count: n, n: formatNumber(n) });

export function rectText(r: Rect): string {
  return t("admin.mod.rect", { ...r, w: r.x2 - r.x1 + 1, h: r.y2 - r.y1 + 1, cells: cellsText(rectCells(r)) });
}

export const kindText = (kind: PixelKind) => t(`admin.mod.kind.${kind}`);
export const actionLabel = (action: ModAction) => t(`admin.action.${action}`);
export const itemLabel = (item: ItemKind) => t(`admin.item.${item}`);

export function previewText({ cells, bombs }: { cells: number; bombs: number }): string {
  return cells === 0 && bombs === 0 ? t("admin.common.nothingChanges") : t("admin.mod.previewChange", { cells: cellsText(cells), bombs });
}

export function resultText({ cells, skipped, bombs }: { cells: number; skipped: number; bombs: number }): string {
  return t("admin.mod.result", { cells: cellsText(cells), skipped, bombs });
}

const HOUR = 3_600_000;

/** Rollback periods; `ms` is how far back the period starts, null = since the beginning. Labels: `admin.period.<id>`. */
export const PERIOD_PRESETS = [
  { id: "1h", ms: HOUR },
  { id: "24h", ms: 24 * HOUR },
  { id: "7d", ms: 7 * 24 * HOUR },
  { id: "all", ms: null },
] as const;
export type PeriodId = (typeof PERIOD_PRESETS)[number]["id"];

export function presetRange(preset: { ms: number | null }, now: number): { from: number; to: number } {
  return { from: preset.ms === null ? 0 : Math.max(0, now - preset.ms), to: now };
}

/** Ban and chat-mute lengths. Labels: `admin.period.<key>` (`forever` = permanent). */
export const BAN_PRESETS = [
  { key: "1h", ms: HOUR },
  { key: "24h", ms: 24 * HOUR },
  { key: "7d", ms: 7 * 24 * HOUR },
  { key: "30d", ms: 30 * 24 * HOUR },
  { key: "forever", ms: null },
] as const;
export type BanPresetKey = (typeof BAN_PRESETS)[number]["key"];

/** `custom` is a datetime-local value in the admin's time zone. Null means the choice is unusable. */
export function banUntil(choice: { preset: BanPresetKey } | { custom: string }, now: number): number | "permanent" | null {
  if ("preset" in choice) {
    const preset = BAN_PRESETS.find((p) => p.key === choice.preset);
    if (!preset) return null;
    return preset.ms === null ? "permanent" : now + preset.ms;
  }
  if (choice.custom.trim() === "") return null;
  const at = new Date(choice.custom).getTime();
  return Number.isFinite(at) && at > now ? at : null;
}

const MAX_DELTA = 1_000_000;

/** Parses a balance delta such as "+500", "-2" or "0"; an empty field means 0. Null when invalid. */
export function parseDelta(text: string): number | null {
  const s = text.trim().replace("−", "-");
  if (s === "") return 0;
  if (!/^[+-]?\d+$/.test(s)) return null;
  const n = Number(s);
  return Math.abs(n) > MAX_DELTA ? null : n;
}

/** Text for an admin or planner error code; anything else (network, FORBIDDEN) gets the generic failure. */
export function adminErrorText(code: string | undefined): string {
  const key = `admin.error.${code}`;
  return code && i18n.exists(key) ? t(key as "admin.error.self") : t("admin.common.failed");
}

export type DescribableAction =
  | { kind: "rollback_player"; userId: number; from: number; to: number; removeBombs: boolean }
  | { kind: "clear_area"; mode: "fill" }
  | { kind: "clear_area"; mode: "to_time"; at: number }
  | { kind: "remove_bombs"; userId?: number };

/** One line saying what a previewed action will do. `period` is its label ("24 hours"). */
export function describeAction(action: DescribableAction, ctx: { player?: string; period?: string }): string {
  switch (action.kind) {
    case "rollback_player":
      return t("admin.mod.rollbackPlayer", {
        player: ctx.player ?? `#${action.userId}`,
        period: ctx.period ?? `${fmt(action.from)} — ${fmt(action.to)}`,
        bombs: action.removeBombs ? t("admin.details.withBombs") : "",
      });
    case "clear_area":
      return action.mode === "fill" ? t("admin.mod.clearFill") : t("admin.mod.clearToTime", { at: fmt(action.at) });
    case "remove_bombs":
      return action.userId === undefined ? t("admin.mod.removeAreaBombs") : t("admin.mod.removePlayerBombs", { player: ctx.player ?? `#${action.userId}` });
  }
}

const isRect = (v: unknown): v is Rect =>
  typeof v === "object" && v !== null && (["x1", "y1", "x2", "y2"] as const).every((k) => Number.isFinite((v as Record<string, unknown>)[k]));

const areaText = (v: unknown) => (isRect(v) ? rectText(v) : t("admin.details.areaUnknown"));
const counts = (p: Record<string, unknown>) =>
  t("admin.details.counts", { cells: Number(p.cells ?? 0), skipped: Number(p.skipped ?? 0), bombs: Number(p.bombs ?? 0) });
const untilText = (until: unknown) => (until === "permanent" ? t("admin.common.forever") : t("admin.common.until", { at: fmt(Number(until)) }));

/** One-line description of a mod_log entry's params, shared by the log and the player card history. */
export function details(entry: { action: ModAction; params: Record<string, unknown> }): string {
  const p = entry.params;
  const comment = String(p.comment ?? "");
  switch (entry.action) {
    case "ban":
    case "chat_mute":
      return t("admin.details.banned", { until: untilText(p.until), reason: String(p.reason ?? "") });
    case "unban":
    case "chat_unmute":
      return String(p.reason ?? "");
    case "player_edit": {
      const changes = (p.changes ?? {}) as Record<string, number | undefined>;
      const parts = ITEMS.flatMap((k) => {
        const d = changes[k];
        return d ? [`${itemLabel(k)} ${d > 0 ? "+" : "−"}${Math.abs(d)}`] : [];
      });
      return t("admin.details.edit", { changes: parts.join(", "), comment });
    }
    case "config_save":
      return t("admin.details.version", { version: String(p.version), comment });
    case "config_rollback":
      return t("admin.details.rollbackVersion", { version: String(p.version), from: String(p.fromVersion), comment });
    case "rollback_player":
      return t("admin.details.rollbackPlayer", {
        from: fmt(Number(p.from)),
        to: fmt(Number(p.to)),
        where: isRect(p.area) ? rectText(p.area) : t("admin.details.wholeCanvas"),
        bombs: p.removeBombs ? t("admin.details.withBombs") : "",
        counts: counts(p),
      });
    case "clear_area":
      return p.mode === "to_time"
        ? t("admin.details.clearToTime", { area: areaText(p.area), at: fmt(Number(p.at)), counts: counts(p) })
        : t("admin.details.clearFill", { area: areaText(p.area), counts: counts(p) });
    case "remove_bombs":
      return p.userId !== undefined
        ? t("admin.details.playerBombs", { id: String(p.userId), counts: counts(p) })
        : t("admin.details.areaBombs", { area: areaText(p.area), counts: counts(p) });
    case "chat_delete": {
      const n = Array.isArray(p.ids) ? p.ids.length : 0;
      return p.periodMs !== undefined
        ? t("admin.details.messagesFor", { n, hours: Math.round(Number(p.periodMs) / HOUR) })
        : t("admin.details.messages", { n });
    }
  }
}

/** The area an entry worked on, for "open on the canvas". */
export function entryArea(entry: { params: Record<string, unknown> }): Rect | null {
  return isRect(entry.params.area) ? entry.params.area : null;
}
