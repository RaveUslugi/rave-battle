import { effectiveAccess } from "../game/access";
import { dailyState } from "../game/daily";
import { useServerNow } from "../hooks/useNow";
import { useGame } from "../state/game-store";
import { uiStore, useUi, type Panel } from "../state/ui-store";
import styles from "./PanelMenu.module.css";

const ITEMS: Array<{ panel: Panel; icon: string; label: string }> = [
  { panel: "shop", icon: "🛒", label: "Магазин" },
  { panel: "daily", icon: "📅", label: "Дейлик" },
];

export function PanelMenu() {
  const player = useGame((s) => s.player);
  const config = useGame((s) => s.config);
  const panel = useUi((s) => s.panel);
  const now = useServerNow(30_000);
  if (!player || !config) return null;
  const dailyReady = effectiveAccess(player, now) === "ok" && !dailyState(player, config, now).claimedToday;
  return (
    <nav className={styles.menu} aria-label="Разделы">
      {ITEMS.map((item) => (
        <button
          key={item.panel}
          type="button"
          className={panel === item.panel ? styles.on : styles.button}
          aria-pressed={panel === item.panel}
          aria-label={item.panel === "daily" && dailyReady ? `${item.label}: награда ждёт` : item.label}
          onClick={() => uiStore.getState().togglePanel(item.panel)}
        >
          <span aria-hidden="true">{item.icon}</span>
          {item.panel === "daily" && dailyReady && <span className={styles.badge} aria-hidden="true">!</span>}
        </button>
      ))}
    </nav>
  );
}
