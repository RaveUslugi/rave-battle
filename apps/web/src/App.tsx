import styles from "./App.module.css";
import { CanvasView } from "./canvas/CanvasView";
import { StatusBar } from "./ui/StatusBar";

export function App() {
  return (
    <div className={styles.app}>
      <CanvasView />
      <StatusBar />
    </div>
  );
}
