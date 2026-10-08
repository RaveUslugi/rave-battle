import type { GameClient } from "../game/client";
import { useUi } from "../state/ui-store";
import styles from "./ConfirmBar.module.css";

/** Touch input: a tapped cell waits here for an explicit "place". */
export function ConfirmBar({ client }: { client: GameClient }) {
  const selection = useUi((s) => s.selection);
  const bombMode = useUi((s) => s.bombMode);
  if (!selection) return null;
  return (
    <div className={styles.bar} role="group" aria-label="Подтверждение клетки">
      <span className={styles.cell}>
        {selection.x}, {selection.y}
        {bombMode && (
          <>
            <span aria-hidden="true"> · 💣</span>
            <span className="visually-hidden">, с бомбой</span>
          </>
        )}
      </span>
      <button type="button" className={styles.cancel} onClick={client.cancelSelection}>
        Отмена
      </button>
      <button type="button" className={styles.confirm} onClick={client.confirmSelection}>
        Поставить
      </button>
    </div>
  );
}
