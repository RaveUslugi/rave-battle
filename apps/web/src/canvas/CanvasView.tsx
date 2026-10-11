import { useEffect, useRef } from "react";
import { normalizeRect } from "@rave/shared/client";
import { moderationFrame, type GameClient } from "../game/client";
import { uiStore } from "../state/ui-store";
import styles from "./CanvasView.module.css";
import { CanvasSession } from "./session";

/** Mounts one CanvasSession wired to the game client; everything inside is imperative. */
export function CanvasView({ client }: { client: GameClient }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const session: CanvasSession = new CanvasSession(host, {
      onCellTap: client.onCellTap,
      onPlaced: client.onPlaced,
      areaDrag: (pointerType) => pointerType === "mouse" && uiStore.getState().tool === "area",
      onAreaDrag: (a, b, done) => {
        if (done) uiStore.getState().setArea(normalizeRect(a, b));
        else session.setArea(normalizeRect(a, b));
      },
      onAreaDragEnd: () => session.setArea(moderationFrame(uiStore.getState().moderation)),
    });
    client.attach(session);
    return () => {
      client.detach();
      session.dispose();
    };
  }, [client]);

  return <div ref={hostRef} className={styles.host} />;
}
