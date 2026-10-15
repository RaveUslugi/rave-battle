import type { ItemKey, PaletteEntry } from "@rave/shared/client";
import { LoginButton } from "./TopBar";
import { type KeyboardEvent, useEffect, useRef } from "react";
import type { GameClient } from "../../game/client";
import { stepColor } from "../../game/hotkeys";
import { rejectText } from "../../game/messages";
import { formatNumber, i18n, useTranslation } from "../../i18n";
import { useGame } from "../../state/game-store";
import { type ActiveTool, RECENT_COLORS, uiStore, useUi } from "../../state/ui-store";
import { Icon, type IconName, Swatch } from "../kit";
import { nextIndex } from "../kit/keys";
import styles from "./dock.module.css";
import { useDailyReady, usePlayMode } from "./useGameState";

type ToolId = "paint" | "detector" | "defuser";

const TOOLS: Array<{ id: ToolId; icon: IconName; label: "dock.brush" | "dock.detector" | "dock.defuser"; item: ItemKey | null }> = [
  { id: "paint", icon: "brush", label: "dock.brush", item: null },
  { id: "detector", icon: "detector", label: "dock.detector", item: "detector" },
  { id: "defuser", icon: "defuser", label: "dock.defuser", item: "defuser" },
];

/** Inventory count for a tool; null = unlimited (dev account) or nothing to count. */
function useCount(item: ItemKey | null): number | null {
  return useGame((s) => (item === null || !s.player || s.player.unlimited ? null : s.player.inventory[item]));
}

/** A tool with nothing left opens the shop on the item instead. */
export function pickTool(tool: ToolId, count: number | null): void {
  const ui = uiStore.getState();
  if (tool !== "paint" && count === 0) {
    ui.pushToast("info", rejectText(tool === "detector" ? "no_detector" : "no_defuser"), "shop");
    ui.openShop(`item:${tool}`);
    return;
  }
  ui.setTool(tool);
}

/** Bomb mode is a modifier of the brush: switching it on picks the brush. */
export function toggleBomb(bombs: number | null): void {
  const ui = uiStore.getState();
  const on = ui.tool === "paint" && ui.bombMode;
  if (!on && bombs === 0) {
    ui.pushToast("info", i18n.t("dock.noBombs"), "shop");
    ui.openShop("item:bomb");
    return;
  }
  if (ui.tool !== "paint") ui.setTool("paint");
  ui.setBombMode(!on);
}

function ToolButton({
  def,
  active,
  disabled,
  index,
  onKey,
  refs,
}: {
  def: (typeof TOOLS)[number];
  active: boolean;
  disabled: boolean;
  index: number;
  onKey: (e: KeyboardEvent<HTMLButtonElement>, index: number) => void;
  refs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
}) {
  const { t } = useTranslation();
  const count = useCount(def.item);
  const label = t(def.label);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a styled radio in a roving-tabindex radiogroup; a native radio cannot render this
    <button
      ref={(el) => {
        refs.current[index] = el;
      }}
      type="button"
      role="radio"
      aria-checked={active}
      aria-disabled={disabled || undefined}
      aria-label={count === null ? label : t("dock.toolLeft", { tool: label, n: count })}
      tabIndex={active ? 0 : -1}
      className={styles.tool}
      data-tool={def.id}
      onClick={() => !disabled && pickTool(def.id, count)}
      onKeyDown={(e) => onKey(e, index)}
    >
      <Icon name={def.icon} size={20} />
      <span className={styles.toolLabel}>{label}</span>
      {count !== null && (
        <span className={styles.count} data-empty={count === 0 || undefined} aria-hidden="true">
          {count}
        </span>
      )}
    </button>
  );
}

/** Brush, detector, defuser: a radiogroup, arrows move the choice. */
function Tools({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const tool = useUi((s) => s.tool);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const detector = useCount("detector");
  const defuser = useCount("defuser");
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextIndex(e.key, index, TOOLS.length);
    if (next === null) return;
    e.preventDefault();
    const def = TOOLS[next]!;
    refs.current[next]?.focus();
    if (!disabled) pickTool(def.id, def.id === "detector" ? detector : def.id === "defuser" ? defuser : null);
  };
  // Admin tools live in the moderation section; the brush stands for them here.
  const current: ActiveTool = tool === "inspect" || tool === "area" ? "paint" : tool;
  return (
    <div role="radiogroup" aria-label={t("dock.tools")} className={styles.tools}>
      {TOOLS.map((def, i) => (
        <ToolButton key={def.id} def={def} active={current === def.id} disabled={disabled} index={i} onKey={onKey} refs={refs} />
      ))}
    </div>
  );
}

function BombToggle({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const bombs = useCount("bomb");
  const on = useUi((s) => s.tool === "paint" && s.bombMode);
  const n = bombs === null ? "∞" : formatNumber(bombs);
  return (
    <button
      type="button"
      className={styles.bomb}
      aria-pressed={on}
      aria-disabled={disabled || undefined}
      aria-label={t("dock.bombToggle", { n })}
      data-empty={bombs === 0 || undefined}
      onClick={() => !disabled && toggleBomb(bombs)}
    >
      <span className={styles.bombIcons} aria-hidden="true">
        <Icon name="plus" size={12} />
        <Icon name="bomb" />
      </span>
      <span className={styles.bombText} aria-hidden="true">
        <span className={styles.withBomb}>{t("dock.withBomb")}</span>
        <span className={styles.times}>×{n}</span>
      </span>
    </button>
  );
}

/** Locked colours: on sale ones open the shop on the colour, the others unlock elsewhere. */
function onLocked(entry: PaletteEntry, loggedIn: boolean): void {
  const ui = uiStore.getState();
  if (entry.unlock !== "shop") ui.pushToast("info", i18n.t("dock.colorLater"), "lock");
  else if (!loggedIn) ui.pushToast("error", rejectText("login_required"));
  else ui.openShop(`color:${entry.id}`);
}

/** Colours as a radiogroup; arrows move over the open ones, locked ones are skipped. */
function Palette({ entries, label, size, className }: { entries: PaletteEntry[]; label: string; size: number | null; className?: string }) {
  const config = useGame((s) => s.config);
  const unlocked = useGame((s) => s.player?.unlockedColors);
  const loggedIn = useGame((s) => s.user !== null);
  const selected = useUi((s) => s.selectedColor);
  const ref = useRef<HTMLDivElement>(null);
  const open = new Set(unlocked ?? []);
  const isOpen = (e: PaletteEntry) => e.unlock === "default" || open.has(e.id);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    const edge = event.key === "Home" || event.key === "End";
    if (step === 0 && !edge) return;
    event.preventDefault();
    const choices = entries.filter(isOpen);
    if (choices.length === 0) return;
    const next = event.key === "Home" ? choices[0]!.id : event.key === "End" ? choices.at(-1)!.id : stepColor(entries, isOpen, selected, step as 1 | -1);
    uiStore.getState().selectColor(next);
    ref.current?.querySelector<HTMLButtonElement>(`[data-color="${next}"]`)?.focus();
  };

  if (!config) return null;
  // One tab stop: the selected colour, or the first one when it is not in this list.
  const focusable = entries.some((e) => e.id === selected) ? selected : entries[0]?.id;
  return (
    <div ref={ref} role="radiogroup" aria-label={label} className={className} onKeyDown={onKeyDown}>
      {entries.map((entry) => {
        const locked = !isOpen(entry);
        return (
          <Swatch
            key={entry.id}
            entry={entry}
            size={size}
            selected={entry.id === selected}
            locked={locked}
            tabIndex={entry.id === focusable ? 0 : -1}
            data-color={entry.id}
            className={styles.swatch}
            onSelect={() => {
              if (locked) return onLocked(entry, loggedIn);
              uiStore.getState().selectColor(entry.id);
              uiStore.getState().setPaletteOpen(false);
            }}
          />
        );
      })}
    </div>
  );
}

/** The stored colour may be gone (or hidden) after a config change: fall back to an open default one. */
function usePaletteFallback(): void {
  const config = useGame((s) => s.config);
  const selected = useUi((s) => s.selectedColor);
  useEffect(() => {
    if (config && !config.palette.some((e) => e.id === selected)) {
      const fallback = config.palette.find((e) => e.unlock === "default" && e.id !== 0) ?? config.palette[0];
      if (fallback) uiStore.getState().selectColor(fallback.id);
    }
  }, [config, selected]);
}

const ACTION: Record<ToolId, "confirm.place" | "confirm.detect" | "confirm.defuse"> = {
  paint: "confirm.place",
  detector: "confirm.detect",
  defuser: "confirm.defuse",
};

/** A tapped cell waiting for confirmation: Cancel and one big action button in the tool's (or the paint's) colour. */
export function ConfirmRow({ client, floating = false }: { client: GameClient; floating?: boolean }) {
  const { t } = useTranslation();
  const selection = useUi((s) => s.selection);
  const tool = useUi((s) => s.tool);
  const bombMode = useUi((s) => s.bombMode);
  const colorId = useUi((s) => s.selectedColor);
  const entry = useGame((s) => s.config?.palette.find((e) => e.id === colorId));
  const mode = usePlayMode();
  if (!selection || tool === "inspect" || tool === "area") return null;
  const label = tool === "paint" && bombMode ? t("confirm.placeBomb") : t(ACTION[tool]);
  const blocked = mode !== "play";
  return (
    // biome-ignore lint/a11y/useSemanticElements: a styled group of buttons, not a form fieldset
    <div className={styles.confirm} data-floating={floating || undefined} role="group" aria-label={t("confirm.group")}>
      <div className={styles.confirmRow}>
        <button type="button" className={styles.cancel} onClick={client.cancelSelection}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className={styles.action}
          data-tool={tool}
          aria-disabled={blocked || undefined}
          onClick={() => !blocked && client.confirmSelection()}
        >
          {tool === "paint" && entry && <span className={styles.actionColor} style={{ background: entry.base }} aria-hidden="true" />}
          {tool !== "paint" && <Icon name={tool === "detector" ? "detector" : "defuser"} size={20} />}
          <span className={styles.actionLabel}>{label}</span>
          {tool === "paint" && (
            <span className={styles.actionCost} aria-hidden="true">
              <Icon name="charge" />1
            </span>
          )}
        </button>
      </div>
      <div className={styles.cell}>{t("confirm.cell", { x: selection.x, y: selection.y })}</div>
    </div>
  );
}

/** Desktop dock: tools · "+ bomb" · every colour. */
export function DesktopDock({ client }: { client: GameClient }) {
  const { t } = useTranslation();
  const config = useGame((s) => s.config);
  const mode = usePlayMode();
  usePaletteFallback();
  // Guests cannot draw: the login button in the top bar is all they need.
  if (!config || mode === "guest") return null;
  const disabled = mode !== "play";
  return (
    <div className={styles.desktopArea}>
      <ConfirmRow client={client} floating />
      <div className={styles.dock}>
        <Tools disabled={disabled} />
        <BombToggle disabled={disabled} />
        <span className={styles.divider} aria-hidden="true" />
        <Palette entries={config.palette} label={t("dock.palette")} size={22} className={styles.grid} />
      </div>
    </div>
  );
}

/**
 * The phone's quick row: the current and recent colours, topped up from the palette so the row is
 * always full (a new player has no history yet).
 */
export function quickColors(palette: PaletteEntry[], recent: number[], isOpen: (e: PaletteEntry) => boolean): PaletteEntry[] {
  const picked = recent.map((id) => palette.find((e) => e.id === id)).filter((e): e is PaletteEntry => e !== undefined && isOpen(e));
  for (const e of palette) {
    if (picked.length >= RECENT_COLORS) break;
    if (isOpen(e) && !picked.includes(e)) picked.push(e);
  }
  return picked.slice(0, RECENT_COLORS);
}

/** Phone dock: tools · "+ bomb" · sections; recent colours · "All", or the confirmation for a tapped cell. */
export function MobileDock({ client }: { client: GameClient }) {
  const { t } = useTranslation();
  const config = useGame((s) => s.config);
  const recent = useUi((s) => s.recentColors);
  const selection = useUi((s) => s.selection);
  const paletteOpen = useUi((s) => s.paletteOpen);
  const unlocked = useGame((s) => s.player?.unlockedColors);
  const mode = usePlayMode();
  const dailyReady = useDailyReady();
  usePaletteFallback();
  if (!config) return null;
  const disabled = mode !== "play";
  const open = new Set(unlocked ?? []);
  const recentEntries = quickColors(config.palette, recent, (e) => e.unlock === "default" || open.has(e.id));
  return (
    <div className={styles.mobileArea}>
      {paletteOpen && !selection && mode !== "guest" && (
        <div className={styles.allColors}>
          <div className={styles.allHead}>
            <span className={styles.allTitle}>{t("dock.allColors")}</span>
            <button type="button" className={styles.smallButton} aria-label={t("dock.closeColors")} onClick={() => uiStore.getState().setPaletteOpen(false)}>
              <Icon name="close" />
            </button>
          </div>
          <Palette entries={config.palette} label={t("dock.palette")} size={null} className={styles.mobileGrid} />
        </div>
      )}
      <div className={styles.mobileDock}>
        <div className={styles.mobileRow}>
          {mode === "guest" ? (
            // The phone's only login button: at the thumb, where the palette is once logged in.
            <div className={styles.guest}>
              <LoginButton wide />
            </div>
          ) : (
            <>
              <Tools disabled={disabled} />
              <BombToggle disabled={disabled} />
            </>
          )}
          <button
            type="button"
            className={styles.sections}
            aria-label={dailyReady ? `${t("sections.open")}. ${t("sections.dailyReady")}` : t("sections.open")}
            onClick={() => uiStore.getState().openPanel("shop")}
          >
            <Icon name="menu" size={20} />
            {dailyReady && <span className={styles.badge} aria-hidden="true" />}
          </button>
        </div>
        {mode === "guest" ? null : selection ? (
          <ConfirmRow client={client} />
        ) : (
          <div className={styles.mobileRow}>
            <Palette entries={recentEntries} label={t("dock.recent")} size={null} className={styles.recent} />
            <button type="button" className={styles.allButton} aria-expanded={paletteOpen} onClick={() => uiStore.getState().setPaletteOpen(!paletteOpen)}>
              {t("dock.all")}
              <span className={styles.allCount}>{config.palette.length}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
