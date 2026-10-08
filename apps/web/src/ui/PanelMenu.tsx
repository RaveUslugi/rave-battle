import { effectiveAccess } from "../game/access";
import { dailyState } from "../game/daily";
import { useServerNow } from "../hooks/useNow";
import { useGame } from "../state/game-store";
import { uiStore, useUi, type Panel } from "../state/ui-store";
import styles from "./PanelMenu.module.css";

const ITEMS: Array<{ panel: Panel; icon: string; label: string; needsLogin: boolean }> = [
  { panel: "shop", icon: "🛒", label: "Магазин", needsLogin: true },
  { panel: "daily", icon: "📅", label: "Дейлик", needsLogin: true },
  { panel: "leaders", icon: "🏆", label: "Рейтинги", needsLogin: false },
  { panel: "profile", icon: "👤", label: "Мой профиль", needsLogin: true },
];

export function PanelMenu() {
  const player = useGame((s) => s.player);
  const config = useGame((s) => s.config);
  const panel = useUi((s) => s.panel);
  const profileUserId = useUi((s) => s.profileUserId);
  const now = useServerNow(30_000);
  if (!config) return null;
  const dailyReady = player !== null && effectiveAccess(player, now) === "ok" && !dailyState(player, config, now).claimedToday;
  // 👤 is your own profile; someone else's profile in the panel doesn't light it up.
  const isOn = (item: Panel) => panel === item && (item !== "profile" || profileUserId === null);
  return (
    <nav className={styles.menu} aria-label="Разделы">
      {ITEMS.filter((item) => player || !item.needsLogin).map((item) => (
        <button
          key={item.panel}
          type="button"
          className={isOn(item.panel) ? styles.on : styles.button}
          aria-pressed={isOn(item.panel)}
          aria-label={item.panel === "daily" && dailyReady ? `${item.label}: награда ждёт` : item.label}
          onClick={() => {
            const ui = uiStore.getState();
            if (item.panel !== "profile") ui.togglePanel(item.panel);
            else if (isOn("profile")) ui.closePanel();
            else ui.openProfile(null);
          }}
        >
          <span aria-hidden="true">{item.icon}</span>
          {item.panel === "daily" && dailyReady && <span className={styles.badge} aria-hidden="true">!</span>}
        </button>
      ))}
    </nav>
  );
}
