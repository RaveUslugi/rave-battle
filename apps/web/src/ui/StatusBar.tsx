import { useNow } from "../hooks/useNow";
import { useGame } from "../state/game-store";
import { formatAge, readingAt, useReadings } from "../state/readings-store";
import styles from "./StatusBar.module.css";

const LABELS = { connecting: "подключение…", open: "онлайн", reconnecting: "переподключение…", closed: "отключено" } as const;

export function StatusBar() {
  const status = useGame((s) => s.status);
  const online = useGame((s) => s.online);
  const hover = useGame((s) => s.hover);
  const readings = useReadings((s) => s.readings);
  const now = useNow(30_000);
  const reading = hover ? readingAt(readings, hover) : null;
  const dotClass = status === "open" ? styles.open : status === "reconnecting" ? styles.reconnecting : "";
  return (
    <div className={styles.bar}>
      <span role="status" className={styles.connection}>
        <span className={`${styles.dot} ${dotClass}`} />
        <span>{status === "open" && online > 0 ? `${online} онлайн` : LABELS[status]}</span>
      </span>
      {hover && (
        <span className={styles.coords} aria-hidden="true">
          {hover.x}, {hover.y}
          {reading && ` · 🔍 ${reading.count} · ${formatAge(now - reading.at)}`}
        </span>
      )}
    </div>
  );
}
