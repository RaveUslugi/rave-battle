import type { GameConfig, PlayerView, UserRef } from "@rave/shared";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { ConnectionStatus, HelloMessage } from "../net/socket";

export interface GameState {
  status: ConnectionStatus;
  bootId: string | null;
  user: UserRef | null;
  player: PlayerView | null;
  config: GameConfig | null;
  online: number;
  /** Canvas cell under the pointer, for the status bar. */
  hover: { x: number; y: number } | null;
  /** Server clock minus local clock, from the last player view. */
  clockOffset: number;
  applyHello(message: HelloMessage): void;
  setPlayer(player: PlayerView): void;
  setStatus(status: ConnectionStatus): void;
  setOnline(count: number): void;
  setHover(cell: { x: number; y: number } | null): void;
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
    online: 0,
    hover: null,
    clockOffset: 0,
    applyHello: (m) => set({ bootId: m.bootId, user: m.user, player: m.player, config: m.config, ...offsetOf(m.player) }),
    setPlayer: (player) => set({ player, ...offsetOf(player) }),
    // The count belongs to a connection: drop it when the connection goes away.
    setStatus: (status) => set(status === "open" ? { status } : { status, online: 0 }),
    setOnline: (online) => set({ online }),
    setHover: (hover) => set({ hover }),
  }));
}

/** Vanilla store: readable from the canvas session and socket code outside React. */
export const gameStore = createGameStore();

export function useGame<T>(selector: (state: GameState) => T): T {
  return useStore(gameStore, selector);
}
