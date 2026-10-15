import type { GameConfig, PlayerView, UserRef } from "@rave/shared/client";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Camera, ScreenSize } from "../canvas/viewport";
import type { ConnectionStatus, HelloMessage } from "../net/socket";

export interface GameState {
  status: ConnectionStatus;
  bootId: string | null;
  user: UserRef | null;
  player: PlayerView | null;
  config: GameConfig | null;
  /** The server says this user may open the admin panel. */
  admin: boolean;
  online: number;
  /** Canvas cell under the pointer, for the status bar. */
  hover: { x: number; y: number } | null;
  /** Server clock minus local clock, from the last player view. */
  clockOffset: number;
  /** Current camera and screen size, published by the canvas session for the minimap. */
  view: { camera: Camera; screen: ScreenSize } | null;
  /** Latest "center the camera here" request; a new object every time. */
  jump: { x: number; y: number } | null;
  applyHello(message: HelloMessage): void;
  setPlayer(player: PlayerView): void;
  setConfig(config: GameConfig): void;
  setStatus(status: ConnectionStatus): void;
  setOnline(count: number): void;
  setHover(cell: { x: number; y: number } | null): void;
  setView(view: { camera: Camera; screen: ScreenSize }): void;
  jumpTo(x: number, y: number): void;
}

/** Server time at local time `now`. Compare server timestamps (freezes, charge timers) with this, never with Date.now(). */
export function serverTime(state: Pick<GameState, "clockOffset">, now = Date.now()): number {
  return now + state.clockOffset;
}

export function createGameStore(clock: () => number = Date.now) {
  const offsetOf = (player: PlayerView | null) => (player ? { clockOffset: player.serverNow - clock() } : {});
  return createStore<GameState>()((set) => ({
    status: "connecting",
    bootId: null,
    user: null,
    player: null,
    config: null,
    admin: false,
    online: 0,
    hover: null,
    clockOffset: 0,
    view: null,
    jump: null,
    applyHello: (m) => set({ bootId: m.bootId, user: m.user, player: m.player, config: m.config, admin: m.admin, ...offsetOf(m.player) }),
    setPlayer: (player) => set({ player, ...offsetOf(player) }),
    setConfig: (config) => set({ config }),
    // The count belongs to a connection: drop it when the connection goes away.
    // "outdated" is final: the tab needs a reload, so late socket statuses must not hide it.
    setStatus: (status) => set((s) => (s.status === "outdated" ? {} : status === "open" ? { status } : { status, online: 0 })),
    setOnline: (online) => set({ online }),
    setHover: (hover) => set({ hover }),
    setView: (view) => set({ view }),
    jumpTo: (x, y) => set({ jump: { x, y } }),
  }));
}

/** Vanilla store: readable from the canvas session and socket code outside React. */
export const gameStore = createGameStore();

export function useGame<T>(selector: (state: GameState) => T): T {
  return useStore(gameStore, selector);
}
