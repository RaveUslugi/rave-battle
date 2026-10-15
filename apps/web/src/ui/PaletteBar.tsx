import type { PaletteEntry } from "@rave/shared/client";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { rejectText } from "../game/messages";
import { useGame } from "../state/game-store";
import { uiStore, useUi } from "../state/ui-store";
import styles from "./PaletteBar.module.css";

const NEXT_KEYS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** Tool buttons (bomb mode, detector, defuser) and the color picker (a radio group with arrow-key navigation). */
export function PaletteBar() {
  const config = useGame((s) => s.config);
  const player = useGame((s) => s.player);
  const selected = useUi((s) => s.selectedColor);
  const bombMode = useUi((s) => s.bombMode);
  const swatchesRef = useRef<HTMLDivElement>(null);
  const tool = useUi((s) => s.tool);
  const count = (item: "bomb" | "detector" | "defuser") => (player?.unlimited ? "∞" : (player?.inventory[item] ?? 0));
  const bombs = count("bomb");
  const admin = useGame((s) => s.admin);
  const pickTool = (next: "detector" | "defuser" | "inspect" | "area") => uiStore.getState().setTool(tool === next ? "paint" : next);

  // The stored color may not exist (or be hidden) after a config change.
  useEffect(() => {
    if (config && !config.palette.some((e) => e.id === selected)) {
      const fallback = config.palette.find((e) => e.unlock === "default" && e.id !== 0) ?? config.palette[0];
      if (fallback) uiStore.getState().selectColor(fallback.id);
    }
  }, [config, selected]);

  if (!config) return null;
  const unlocked = new Set(player?.unlockedColors ?? []);
  const isLocked = (entry: { id: number; unlock: string }) => entry.unlock !== "default" && !unlocked.has(entry.id);

  // A locked color on sale opens the shop; the others unlock elsewhere.
  const onLocked = (entry: PaletteEntry) => {
    const ui = uiStore.getState();
    if (entry.unlock !== "shop") return ui.pushToast("info", "Этот цвет откроется позже");
    if (!player) return ui.pushToast("error", rejectText("login_required"));
    ui.openPanel("shop");
  };

  // Arrow keys move the checked color over the open ones (locked colors are skipped), Home/End jump to the ends, like native radios.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = NEXT_KEYS[event.key];
    const edge = event.key === "Home" || event.key === "End";
    if (step === undefined && !edge) return;
    event.preventDefault();
    const open = config.palette.filter((e) => !isLocked(e));
    if (open.length === 0) return;
    const at = open.findIndex((e) => e.id === selected);
    const next = event.key === "Home" ? open[0] : event.key === "End" ? open.at(-1) : open[(at + (step ?? 0) + open.length) % open.length];
    if (!next) return;
    uiStore.getState().selectColor(next.id);
    swatchesRef.current?.querySelector<HTMLButtonElement>(`[data-color="${next.id}"]`)?.focus();
  };

  return (
    <div className={styles.bar}>
      {/* biome-ignore lint/a11y/useSemanticElements: a styled group of buttons, not a form fieldset */}
      <div className={styles.tools} role="group" aria-label="Инструменты">
        <button
          type="button"
          className={tool === "paint" && bombMode ? styles.toolOn : styles.tool}
          aria-pressed={tool === "paint" && bombMode}
          aria-label={`Режим бомбы, осталось ${bombs}`}
          onClick={() => {
            const ui = uiStore.getState();
            const on = !(tool === "paint" && bombMode);
            if (tool !== "paint") ui.setTool("paint");
            ui.setBombMode(on);
          }}
        >
          <span aria-hidden="true">💣</span>
          <span aria-hidden="true">{bombs}</span>
        </button>
        <button
          type="button"
          className={tool === "detector" ? styles.toolOn : styles.tool}
          aria-pressed={tool === "detector"}
          aria-label={`Детектор, осталось ${count("detector")}`}
          onClick={() => pickTool("detector")}
        >
          <span aria-hidden="true">🔍</span>
          <span aria-hidden="true">{count("detector")}</span>
        </button>
        <button
          type="button"
          className={tool === "defuser" ? styles.toolOn : styles.tool}
          aria-pressed={tool === "defuser"}
          aria-label={`Дефьюзер, осталось ${count("defuser")}`}
          onClick={() => pickTool("defuser")}
        >
          <span aria-hidden="true">🧯</span>
          <span aria-hidden="true">{count("defuser")}</span>
        </button>
        {admin && (
          <div className={styles.adminTools}>
            <button
              type="button"
              className={tool === "inspect" ? styles.toolOn : styles.tool}
              aria-pressed={tool === "inspect"}
              aria-label="Инспектор клетки"
              onClick={() => pickTool("inspect")}
            >
              <span aria-hidden="true">🔎</span>
            </button>
            <button
              type="button"
              className={tool === "area" ? styles.toolOn : styles.tool}
              aria-pressed={tool === "area"}
              aria-label="Выделить область"
              onClick={() => pickTool("area")}
            >
              <span aria-hidden="true">▭</span>
            </button>
          </div>
        )}
      </div>
      <div ref={swatchesRef} className={styles.swatches} role="radiogroup" aria-label="Цвет" onKeyDown={onKeyDown}>
        {config.palette.map((entry) => {
          const locked = isLocked(entry);
          const checked = selected === entry.id;
          return (
            // biome-ignore lint/a11y/useSemanticElements: a swatch button acting as a radio; a native input cannot show the color
            <button
              key={entry.id}
              type="button"
              role="radio"
              data-color={entry.id}
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              aria-label={`Цвет ${entry.id}${!locked ? "" : entry.unlock === "shop" ? ` (купить за ${entry.price})` : " (закрыт)"}`}
              className={`${styles.swatch} ${checked ? styles.selected : ""}`}
              style={{ background: entry.base }}
              onClick={() => (locked ? onLocked(entry) : uiStore.getState().selectColor(entry.id))}
            >
              {locked && (
                <span className={styles.lock} aria-hidden="true">
                  🔒
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
