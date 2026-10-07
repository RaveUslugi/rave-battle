import { useEffect, useRef } from "react";
import styles from "./CanvasView.module.css";
import { CanvasSession, type SessionCallbacks } from "./session";

/** Mounts one CanvasSession; everything inside is imperative. */
export function CanvasView(props: SessionCallbacks) {
  const hostRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props);
  useEffect(() => {
    callbacks.current = props;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const session = new CanvasSession(host, { onCellTap: (cell) => callbacks.current.onCellTap?.(cell) });
    return () => session.dispose();
  }, []);

  return <div ref={hostRef} className={styles.host} />;
}
