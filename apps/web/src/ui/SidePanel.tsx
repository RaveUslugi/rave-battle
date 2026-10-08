import { useEffect } from "react";
import { useGame } from "../state/game-store";
import { uiStore, useUi } from "../state/ui-store";
import { DailyTab } from "./DailyTab";
import { ShopTab } from "./ShopTab";
import styles from "./SidePanel.module.css";

const TITLES = { shop: "Магазин", daily: "Дейлик" } as const;

/** Right-hand drawer (bottom sheet on narrow screens) with one tab at a time; the canvas stays live behind it. */
export function SidePanel() {
  const panel = useUi((s) => s.panel);
  const user = useGame((s) => s.user);

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") uiStore.getState().closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel]);

  // Logging out closes the panel: everything in it belongs to a player.
  useEffect(() => {
    if (!user) uiStore.getState().closePanel();
  }, [user]);

  if (!panel || !user) return null;
  return (
    <aside className={styles.panel} aria-label={TITLES[panel]}>
      <header className={styles.header}>
        <h2 className={styles.title}>{TITLES[panel]}</h2>
        <button type="button" className={styles.close} aria-label="Закрыть" onClick={() => uiStore.getState().closePanel()}>
          ✕
        </button>
      </header>
      <div className={styles.body}>{panel === "shop" ? <ShopTab /> : <DailyTab />}</div>
    </aside>
  );
}
