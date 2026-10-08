import { lazy, Suspense, useEffect, useMemo } from "react";
import styles from "./App.module.css";
import { GameClient } from "./game/client";
import { toolsApi } from "./net/api";
import { gameStore } from "./state/game-store";
import { bindReadings, readingsStore } from "./state/readings-store";
import { uiStore } from "./state/ui-store";
import { AuthPanel } from "./ui/AuthPanel";
import { ConfirmBar } from "./ui/ConfirmBar";
import { ExplosionFlash } from "./ui/ExplosionFlash";
import { FreezeBanner } from "./ui/FreezeBanner";
import { Hud } from "./ui/Hud";
import { PaletteBar } from "./ui/PaletteBar";
import { StatusBar } from "./ui/StatusBar";
import { Toasts } from "./ui/Toasts";

const CanvasView = lazy(() => import("./canvas/CanvasView").then((m) => ({ default: m.CanvasView })));
const Minimap = lazy(() => import("./ui/Minimap"));

const LOGIN_ERRORS: Record<string, string> = {
  denied: "Вход отменён",
  discord: "Не удалось войти через Discord, попробуйте ещё раз",
  state: "Сессия входа устарела, попробуйте ещё раз",
};

export function App() {
  const client = useMemo(() => new GameClient({ game: gameStore, ui: uiStore, readings: readingsStore, tools: toolsApi }), []);

  useEffect(() => bindReadings(gameStore, readingsStore), []);

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
      <Suspense fallback={null}>
        <CanvasView client={client} />
      </Suspense>
      <ExplosionFlash />
      <div className={styles.top}>
        <div className={styles.topLeft}>
          <StatusBar />
          <Hud />
        </div>
        <div className={styles.topCenter}>
          <FreezeBanner />
          <Toasts />
        </div>
        <div className={styles.topRight}>
          <AuthPanel />
          <Suspense fallback={null}>
            <Minimap />
          </Suspense>
        </div>
      </div>
      <div className={styles.bottom}>
        <ConfirmBar client={client} />
        <PaletteBar />
      </div>
    </div>
  );
}
