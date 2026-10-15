import { useEffect, useId, useRef } from "react";
import { useGame } from "../state/game-store";
import { uiStore, useUi, type Panel } from "../state/ui-store";
import { DailyTab } from "./DailyTab";
import { LeadersTab } from "./LeadersTab";
import { ModerationTab } from "./ModerationTab";
import { ProfileTab } from "./ProfileTab";
import { ShopTab } from "./ShopTab";
import styles from "./SidePanel.module.css";

const TABS: Array<{ panel: Panel; title: string; needsLogin: boolean }> = [
  { panel: "shop", title: "Магазин", needsLogin: true },
  { panel: "daily", title: "Дейлик", needsLogin: true },
  { panel: "leaders", title: "Рейтинги", needsLogin: false },
  { panel: "profile", title: "Профиль", needsLogin: true },
  // Opened by the admin tools on the canvas; hidden from everyone else.
  { panel: "moderation", title: "Модерация", needsLogin: true },
];

/** Right-hand drawer (bottom sheet on narrow screens) with one tab at a time; the canvas stays live behind it. */
export function SidePanel() {
  const panel = useUi((s) => s.panel);
  const profileUserId = useUi((s) => s.profileUserId);
  const user = useGame((s) => s.user);
  const admin = useGame((s) => s.admin);
  // Visitors may browse the leaderboards and other players' profiles.
  const otherProfile = profileUserId !== null;
  const open = panel !== null && (user !== null || panel === "leaders" || (panel === "profile" && otherProfile)) && (panel !== "moderation" || admin);
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

  // Logging out closes the tabs that belong to the player: shop, daily and their own profile.
  useEffect(() => {
    if (user) return;
    const { panel: current, profileUserId: whose, closePanel } = uiStore.getState();
    if (current === "shop" || current === "daily" || current === "moderation" || (current === "profile" && whose === null)) closePanel();
    // The panel stays open but the tab that had focus may be gone: keep focus in the panel.
    else if (focusInside.current && (document.activeElement === null || document.activeElement === document.body)) asideRef.current?.focus();
  }, [user]);

  // Losing admin rights closes the moderation tab.
  useEffect(() => {
    if (!admin && uiStore.getState().panel === "moderation") uiStore.getState().closePanel();
  }, [admin]);

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
          {TABS.filter((tab) => (user || !tab.needsLogin || (tab.panel === "profile" && otherProfile)) && (tab.panel !== "moderation" || admin)).map((tab) => (
            <button
              key={tab.panel}
              id={`${idPrefix}-${tab.panel}`}
              type="button"
              className={panel === tab.panel ? styles.tabOn : styles.tab}
              aria-pressed={panel === tab.panel}
              // Logged in, the tab means your own profile even while someone else's is open.
              onClick={() => (tab.panel === "profile" && user ? uiStore.getState().openProfile(null) : uiStore.getState().openPanel(tab.panel))}
            >
              {tab.title}
            </button>
          ))}
        </div>
        <button type="button" className={styles.close} aria-label="Закрыть" onClick={() => uiStore.getState().closePanel()}>
          ✕
        </button>
      </header>
      <div className={styles.body}>
        {panel === "shop" ? (
          <ShopTab />
        ) : panel === "daily" ? (
          <DailyTab />
        ) : panel === "leaders" ? (
          <LeadersTab />
        ) : panel === "moderation" ? (
          <ModerationTab />
        ) : (
          <ProfileTab />
        )}
      </div>
    </aside>
  );
}
