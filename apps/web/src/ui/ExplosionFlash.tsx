import { useEffect } from "react";
import { useUi } from "../state/ui-store";
import styles from "./ExplosionFlash.module.css";

const VIBRATE_MS = 200;

/** Full-screen flash and a short vibration, replayed for every new explosion (the key restarts the animation). */
export function ExplosionFlash() {
  const explosion = useUi((s) => s.explosion);
  useEffect(() => {
    if (explosion) navigator.vibrate?.(VIBRATE_MS);
  }, [explosion]);
  if (!explosion) return null;
  return <div key={explosion.id} className={styles.flash} aria-hidden="true" />;
}
