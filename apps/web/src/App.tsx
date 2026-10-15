import { useEffect, useMemo } from "react";
import { GameClient } from "./game/client";
import { i18n } from "./i18n";
import { toolsApi } from "./net/api";
import { queryClient, useTRPC } from "./net/trpc";
import { gameStore } from "./state/game-store";
import { bindReadings, readingsStore } from "./state/readings-store";
import { uiStore } from "./state/ui-store";
import { GameLayout } from "./ui/game/GameLayout";

const LOGIN_ERRORS = ["denied", "discord", "state"] as const;

export function App() {
  const client = useMemo(() => new GameClient({ game: gameStore, ui: uiStore, readings: readingsStore, tools: toolsApi }), []);

  useEffect(() => bindReadings(gameStore, readingsStore), []);

  // Rankings and profiles say who "you" are: drop them when the logged-in player changes.
  const trpc = useTRPC();
  useEffect(() => {
    let last = gameStore.getState().user?.id ?? null;
    return gameStore.subscribe((s) => {
      const id = s.user?.id ?? null;
      if (id === last) return;
      last = id;
      void queryClient.resetQueries({ queryKey: trpc.stats.pathKey() });
    });
  }, [trpc]);

  // The auth redirect reports failures in the query string: show it once and clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("login_error");
    if (error === null) return;
    const known = LOGIN_ERRORS.find((e) => e === error);
    uiStore.getState().pushToast("error", i18n.t(known ? `login.${known}` : "login.fallback"));
    params.delete("login_error");
    const search = params.size > 0 ? `?${params.toString()}` : "";
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${search}${window.location.hash}`);
  }, []);

  return <GameLayout client={client} />;
}
