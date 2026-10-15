import { useEffect, useRef } from "react";
import { useTranslation } from "../../i18n";
import { useGame } from "../../state/game-store";
import { type Panel, uiStore, useUi } from "../../state/ui-store";
import { Icon, IconButton, type IconName, Sheet } from "../kit";
import { ChatSection } from "./chat/Chat";
import { DailySection } from "./sections/DailySection";
import { LeadersSection } from "./sections/LeadersSection";
import { ProfileSection } from "./sections/ProfileSection";
import { ShopSection } from "./sections/ShopSection";
import styles from "./layout.module.css";
import { useDailyReady } from "./useGameState";

type TitleKey = "sections.chat" | "sections.shop" | "sections.dailyTitle" | "sections.leadersTitle" | "sections.profile";
type LabelKey = "sections.chat" | "sections.shop" | "sections.daily" | "sections.leaders" | "sections.profile";

interface SectionDef {
  panel: Panel;
  icon: IconName;
  label: LabelKey;
  title: TitleKey;
  /** Guests may open it (rankings; other players' profiles are allowed separately). */
  guest: boolean;
}

const SECTIONS: SectionDef[] = [
  { panel: "chat", icon: "chat", label: "sections.chat", title: "sections.chat", guest: true },
  { panel: "shop", icon: "shop", label: "sections.shop", title: "sections.shop", guest: false },
  { panel: "daily", icon: "daily", label: "sections.daily", title: "sections.dailyTitle", guest: false },
  { panel: "leaders", icon: "trophy", label: "sections.leaders", title: "sections.leadersTitle", guest: true },
  { panel: "profile", icon: "user", label: "sections.profile", title: "sections.profile", guest: false },
];

/** Whether this viewer may see a section right now. */
export function sectionAllowed(panel: Panel, s: { loggedIn: boolean; otherProfile: boolean }): boolean {
  if (panel === "profile") return s.loggedIn || s.otherProfile;
  const def = SECTIONS.find((d) => d.panel === panel);
  return def !== undefined && (def.guest || s.loggedIn);
}

/** The open section if this viewer may see it; null otherwise. */
export function useOpenSection(): Panel | null {
  const panel = useUi((s) => s.panel);
  const otherProfile = useUi((s) => s.profileUserId !== null);
  const loggedIn = useGame((s) => s.user !== null);
  return panel !== null && sectionAllowed(panel, { loggedIn, otherProfile }) ? panel : null;
}

/**
 * Logging out closes what belonged to the player (shop, daily, own profile).
 */
export function usePanelRules(): void {
  const loggedIn = useGame((s) => s.user !== null);
  useEffect(() => {
    const { panel, profileUserId, closePanel } = uiStore.getState();
    if (panel !== null && !sectionAllowed(panel, { loggedIn, otherProfile: profileUserId !== null })) closePanel();
  }, [loggedIn]);
}

export function SectionContent({ panel }: { panel: Panel }) {
  if (panel === "chat") return <ChatSection />;
  if (panel === "shop") return <ShopSection />;
  if (panel === "daily") return <DailySection />;
  if (panel === "leaders") return <LeadersSection />;
  return <ProfileSection />;
}

/** The admin canvas centred where the camera is now. */
export function adminCanvasHref(view: { camera: { x: number; y: number } } | null): string {
  return view ? `/admin?tab=canvas&x=${Math.floor(view.camera.x)}&y=${Math.floor(view.camera.y)}` : "/admin?tab=canvas";
}

/** Desktop: the column of section buttons, the minimap switch and, for admins, a link to the admin canvas here. */
export function Rail() {
  const { t } = useTranslation();
  const open = useOpenSection();
  const ownProfile = useUi((s) => s.profileUserId === null);
  const minimap = useUi((s) => s.minimapOpen);
  const loggedIn = useGame((s) => s.user !== null);
  const admin = useGame((s) => s.admin);
  const dailyReady = useDailyReady();
  const view = useGame((s) => s.view);
  const items = SECTIONS.filter((d) => d.panel !== "chat" && (d.guest || loggedIn));
  // The profile button means your own profile; someone else's profile in the panel doesn't light it up.
  const isOn = (panel: Panel) => open === panel && (panel !== "profile" || ownProfile);
  const toggle = (panel: Panel) => {
    const ui = uiStore.getState();
    if (isOn(panel)) ui.closePanel();
    else if (panel === "profile") ui.openProfile(null);
    else ui.openPanel(panel);
  };
  return (
    <nav className={styles.rail} aria-label={t("sections.label")}>
      {items.map((d) => (
        <IconButton
          key={d.panel}
          icon={d.icon}
          size={52}
          label={d.panel === "daily" && dailyReady ? t("sections.dailyReady") : t(d.title)}
          pressed={isOn(d.panel)}
          badge={d.panel === "daily" && dailyReady}
          onClick={() => toggle(d.panel)}
        />
      ))}
      <span className={styles.railSep} aria-hidden="true" />
      <IconButton icon="map" size={52} label={t("sections.minimap")} pressed={minimap} onClick={() => uiStore.getState().setMinimapOpen(!minimap)} />
      {admin && (
        <a className={styles.modButton} href={adminCanvasHref(view)} aria-label={t("sections.moderation")}>
          <Icon name="eye" size={24} />
        </a>
      )}
    </nav>
  );
}

/** Desktop: the open section next to the rail. Opening moves focus in; closing returns it to the opener. */
export function SidePanel() {
  const { t } = useTranslation();
  const panel = useOpenSection();
  const ref = useRef<HTMLElement>(null);
  const titleId = "side-panel-title";

  useEffect(() => {
    if (!panel) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    return () => {
      const lost = document.activeElement === null || document.activeElement === document.body || ref.current?.contains(document.activeElement);
      if (lost && opener?.isConnected) opener.focus();
    };
  }, [panel]);

  // The chat has its own block on the desktop.
  if (!panel || panel === "chat") return null;
  const def = SECTIONS.find((d) => d.panel === panel)!;
  return (
    <aside ref={ref} className={styles.panel} aria-labelledby={titleId} tabIndex={-1}>
      <header className={styles.panelHead}>
        <h2 id={titleId} className={styles.panelTitle}>
          {t(def.title)}
        </h2>
        <IconButton icon="close" size={36} label={t("common.close")} onClick={() => uiStore.getState().closePanel()} />
      </header>
      <div className={styles.panelBody}>
        <SectionContent panel={panel} />
      </div>
    </aside>
  );
}

/** Phone: the sections in a bottom sheet with a row of tabs; the chat is one of them. */
export function SectionsSheet() {
  const { t } = useTranslation();
  const panel = useOpenSection();
  const height = useUi((s) => s.sheetHeight);
  const ownProfile = useUi((s) => s.profileUserId === null);
  const loggedIn = useGame((s) => s.user !== null);
  const dailyReady = useDailyReady();
  const tabs = SECTIONS.filter((d) => d.guest || loggedIn);
  const def = SECTIONS.find((d) => d.panel === panel);
  return (
    <Sheet
      open={panel !== null}
      height={panel === "chat" && height === "peek" ? "half" : height}
      onHeightChange={(h) => uiStore.getState().setSheetHeight(h)}
      onClose={() => uiStore.getState().closePanel()}
      label={def ? t(def.title) : t("sections.label")}
    >
      <div className={styles.sheet}>
        <div className={styles.sheetTabs}>
          <nav className={styles.tabRow} aria-label={t("sections.label")}>
            {tabs.map((d) => {
              const on = panel === d.panel && (d.panel !== "profile" || ownProfile);
              return (
                <button
                  key={d.panel}
                  type="button"
                  className={styles.sheetTab}
                  aria-pressed={on}
                  onClick={() => (d.panel === "profile" ? uiStore.getState().openProfile(null) : uiStore.getState().openPanel(d.panel))}
                >
                  <Icon name={d.icon} size={20} />
                  {t(d.label)}
                  {d.panel === "daily" && dailyReady && <span className={styles.tabBadge} aria-hidden="true" />}
                </button>
              );
            })}
          </nav>
          <IconButton icon="close" label={t("common.close")} onClick={() => uiStore.getState().closePanel()} />
        </div>
        <div className={panel === "chat" ? styles.sheetChat : styles.sheetBody}>{panel && <SectionContent panel={panel} />}</div>
      </div>
    </Sheet>
  );
}
