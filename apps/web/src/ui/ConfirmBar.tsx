import type { GameClient } from "../game/client";
import { useGame } from "../state/game-store";
import { useUi } from "../state/ui-store";
import styles from "./ConfirmBar.module.css";

const ACTION = { paint: "Поставить", detector: "Сканировать", defuser: "Обезвредить" } as const;

/** Touch input: a tapped cell waits here for an explicit confirmation. */
export function ConfirmBar({ client }: { client: GameClient }) {
  const selection = useUi((s) => s.selection);
  const bombMode = useUi((s) => s.bombMode);
  const tool = useUi((s) => s.tool);
  const player = useGame((s) => s.player);
  if (!selection) return null;
  const left = player?.unlimited ? "∞" : (player?.inventory.defuser ?? 0);
  return (
    <div className={styles.bar} role="group" aria-label="Подтверждение клетки">
      <span className={styles.cell}>
        {selection.x}, {selection.y}
        {tool === "paint" && bombMode && (
          <>
            <span aria-hidden="true"> · 💣</span>
            <span className="visually-hidden">, с бомбой</span>
          </>
        )}
        {tool === "detector" && <span> · 🔍</span>}
        {tool === "defuser" && <span> · 🧯 осталось {left}</span>}
      </span>
      <button type="button" className={styles.cancel} onClick={client.cancelSelection}>
        Отмена
      </button>
      <button type="button" className={styles.confirm} onClick={client.confirmSelection}>
        {ACTION[tool]}
      </button>
    </div>
  );
}
