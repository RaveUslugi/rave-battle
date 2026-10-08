import { useEffect, useId, useRef } from "react";
import { useGame } from "../state/game-store";
import { uiStore, useUi, type Panel } from "../state/ui-store";
import { DailyTab } from "./DailyTab";
import { ShopTab } from "./ShopTab";
import styles from "./SidePanel.module.css";

const TABS: Array<{ panel: Panel; title: string }> = [
  { panel: "shop", title: "Магазин" },
  { panel: "daily", title: "Дейлик" },
];

/** Right-hand drawer (bottom sheet on narrow screens) with one tab at a time; the canvas stays live behind it. */
export function SidePanel() {
  const panel = useUi((s) => s.panel);
  const user = useGame((s) => s.user);
  const open = panel !== null && user !== null;
  const idPrefix = useId();
  const asideRef = useRef<HTMLElement>(null);
  /** Whether focus is in the panel; stays set when the panel is removed with focus inside. */
  const focusInside = useRef(false);

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (e.key === "Escape") uiStore.getState().closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel]);

  // Logging out closes the panel: everything in it belongs to a player.
  useEffect(() => {
    if (!user) uiStore.getState().closePanel();
  }, [user]);

  // Opening moves focus into the panel; closing returns it to whatever opened it (usually the menu button).
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    asideRef.current?.focus();
    return () => {
      const lost = document.activeElement === null || document.activeElement === document.body;
      if (focusInside.current && lost && opener?.isConnected) opener.focus();
      focusInside.current = false;
    };
  }, [open]);

  if (!open) return null;
  return (
    <aside
      ref={asideRef}
      className={styles.panel}
      aria-labelledby={`${idPrefix}-${panel}`}
      tabIndex={-1}
      onFocus={() => {
        focusInside.current = true;
      }}
      onBlur={(e) => {
        // A null target means focus went nowhere (removal, window switch): keep the flag for the restore.
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) focusInside.current = false;
      }}
    >
      <header className={styles.header}>
        <div className={styles.tabs}>
          {TABS.map((tab) => (
            <button
              key={tab.panel}
              id={`${idPrefix}-${tab.panel}`}
              type="button"
              className={panel === tab.panel ? styles.tabOn : styles.tab}
              aria-pressed={panel === tab.panel}
              onClick={() => uiStore.getState().openPanel(tab.panel)}
            >
              {tab.title}
            </button>
          ))}
        </div>
        <button type="button" className={styles.close} aria-label="Закрыть" onClick={() => uiStore.getState().closePanel()}>
          ✕
        </button>
      </header>
      <div className={styles.body}>{panel === "shop" ? <ShopTab /> : <DailyTab />}</div>
    </aside>
  );
}
