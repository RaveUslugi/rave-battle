import { useEffect, useRef, type KeyboardEvent } from "react";
import { useGame } from "../state/game-store";
import { uiStore, useUi } from "../state/ui-store";
import styles from "./PaletteBar.module.css";

const NEXT_KEYS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** Bomb-mode toggle and the color picker (a radio group with arrow-key navigation). */
export function PaletteBar() {
  const config = useGame((s) => s.config);
  const player = useGame((s) => s.player);
  const selected = useUi((s) => s.selectedColor);
  const bombMode = useUi((s) => s.bombMode);
  const swatchesRef = useRef<HTMLDivElement>(null);
  const bombs = player?.unlimited ? "∞" : (player?.inventory.bomb ?? 0);

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
      <button
        type="button"
        className={bombMode ? styles.bombOn : styles.bomb}
        aria-pressed={bombMode}
        aria-label={`Режим бомбы, осталось ${bombs}`}
        onClick={() => uiStore.getState().setBombMode(!bombMode)}
      >
        <span aria-hidden="true">💣</span>
        <span aria-hidden="true">{bombs}</span>
      </button>
      <div ref={swatchesRef} className={styles.swatches} role="radiogroup" aria-label="Цвет" onKeyDown={onKeyDown}>
        {config.palette.map((entry) => {
          const locked = isLocked(entry);
          const checked = selected === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              data-color={entry.id}
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              aria-label={`Цвет ${entry.id}${locked ? " (закрыт)" : ""}`}
              className={`${styles.swatch} ${checked ? styles.selected : ""}`}
              style={{ background: entry.base }}
              onClick={() =>
                locked
                  ? uiStore.getState().pushToast("info", "Этот цвет откроется позже")
                  : uiStore.getState().selectColor(entry.id)
              }
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
