import { useGame } from "../state/game-store";
import styles from "./StatusBar.module.css";

const LABELS = { connecting: "подключение…", open: "онлайн", reconnecting: "переподключение…", closed: "отключено" } as const;

export function StatusBar() {
  const status = useGame((s) => s.status);
  const online = useGame((s) => s.online);
  const hover = useGame((s) => s.hover);
  const dotClass = status === "open" ? styles.open : status === "reconnecting" ? styles.reconnecting : "";
  return (
    <div className={styles.bar} role="status">
      <span className={`${styles.dot} ${dotClass}`} />
      <span>{status === "open" && online > 0 ? `${online} онлайн` : LABELS[status]}</span>
      {hover && (
        <span className={styles.coords}>
          {hover.x}, {hover.y}
        </span>
      )}
    </div>
  );
}
