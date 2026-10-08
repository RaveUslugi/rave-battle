import { useEffect, useMemo } from "react";
import styles from "./App.module.css";
import { CanvasView } from "./canvas/CanvasView";
import { GameClient } from "./game/client";
import { gameStore } from "./state/game-store";
import { uiStore } from "./state/ui-store";
import { AuthPanel } from "./ui/AuthPanel";
import { ConfirmBar } from "./ui/ConfirmBar";
import { ExplosionFlash } from "./ui/ExplosionFlash";
import { FreezeBanner } from "./ui/FreezeBanner";
import { Hud } from "./ui/Hud";
import { PaletteBar } from "./ui/PaletteBar";
import { StatusBar } from "./ui/StatusBar";
import { Toasts } from "./ui/Toasts";

const LOGIN_ERRORS: Record<string, string> = {
  denied: "Вход отменён",
  discord: "Не удалось войти через Discord, попробуйте ещё раз",
  state: "Сессия входа устарела, попробуйте ещё раз",
};

export function App() {
  const client = useMemo(() => new GameClient({ game: gameStore, ui: uiStore }), []);

  // The auth redirect reports failures in the query string: show it once and clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("login_error");
    if (error === null) return;
    uiStore.getState().pushToast("error", LOGIN_ERRORS[error] ?? "Не удалось войти");
    params.delete("login_error");
    const search = params.size > 0 ? `?${params.toString()}` : "";
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${search}${window.location.hash}`);
  }, []);

  return (
    <div className={styles.app}>
      <CanvasView client={client} />
      <ExplosionFlash />
      <div className={styles.topLeft}>
        <StatusBar />
        <Hud />
      </div>
      <div className={styles.topRight}>
        <AuthPanel />
      </div>
      <div className={styles.topCenter}>
        <FreezeBanner />
        <Toasts />
      </div>
      <div className={styles.bottom}>
        <ConfirmBar client={client} />
        <PaletteBar />
      </div>
    </div>
  );
}
