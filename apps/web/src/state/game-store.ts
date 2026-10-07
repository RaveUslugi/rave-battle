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
  applyHello(message: HelloMessage): void;
  setPlayer(player: PlayerView): void;
  setStatus(status: ConnectionStatus): void;
  setOnline(count: number): void;
  setHover(cell: { x: number; y: number } | null): void;
}

/** Vanilla store: readable from the canvas session and socket code outside React. */
export const gameStore = createStore<GameState>()((set) => ({
  status: "connecting",
  bootId: null,
  user: null,
  player: null,
  config: null,
  online: 0,
  hover: null,
  applyHello: (m) => set({ bootId: m.bootId, user: m.user, player: m.player, config: m.config }),
  setPlayer: (player) => set({ player }),
  // The count belongs to a connection: drop it when the connection goes away.
  setStatus: (status) => set(status === "open" ? { status } : { status, online: 0 }),
  setOnline: (online) => set({ online }),
  setHover: (hover) => set({ hover }),
}));

export function useGame<T>(selector: (state: GameState) => T): T {
  return useStore(gameStore, selector);
}
