import { useMemo } from "react";
import styles from "./App.module.css";
import { CanvasView } from "./canvas/CanvasView";
import { GameClient } from "./game/client";
import { gameStore } from "./state/game-store";
import { uiStore } from "./state/ui-store";
import { StatusBar } from "./ui/StatusBar";

export function App() {
  const client = useMemo(() => new GameClient({ game: gameStore, ui: uiStore }), []);
  return (
    <div className={styles.app}>
      <CanvasView client={client} />
      <StatusBar />
    </div>
  );
}
