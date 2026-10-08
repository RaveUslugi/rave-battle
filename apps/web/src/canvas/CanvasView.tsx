import { useEffect, useRef } from "react";
import type { GameClient } from "../game/client";
import styles from "./CanvasView.module.css";
import { CanvasSession } from "./session";

/** Mounts one CanvasSession wired to the game client; everything inside is imperative. */
export function CanvasView({ client }: { client: GameClient }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const session = new CanvasSession(host, { onCellTap: client.onCellTap, onPlaced: client.onPlaced });
    client.attach(session);
    return () => {
      client.detach();
      session.dispose();
    };
  }, [client]);

  return <div ref={hostRef} className={styles.host} />;
}
