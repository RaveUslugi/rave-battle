import { useUi } from "../state/ui-store";
import styles from "./ExplosionFlash.module.css";

/** Full-screen flash, replayed for every new explosion (the key restarts the animation). */
export function ExplosionFlash() {
  const explosion = useUi((s) => s.explosion);
  if (!explosion) return null;
  return <div key={explosion.id} className={styles.flash} aria-hidden="true" />;
}
