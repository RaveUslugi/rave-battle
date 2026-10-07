import { DAY_MS, defaultConfig, type GameConfig } from "@rave/shared";
import { AntiFarm } from "./anti-farm";
import { BombStore } from "./bomb-store";
import { CanvasStore } from "./canvas-store";
import { GameEngine } from "./engine";
import { createPlayer, PlayerRegistry } from "./player";
import type { EngineEvent, PlayerState } from "./types";

/** 2026-10-07 12:00 UTC = 15:00 Moscow. */
export const T0 = Date.UTC(2026, 9, 7, 12, 0, 0);
export { DAY_MS };

export function makeEngine(configure?: (cfg: GameConfig) => void) {
  const cfg = structuredClone(defaultConfig);
  configure?.(cfg);
  const canvas = new CanvasStore(cfg.canvas.width, cfg.canvas.height);
  const bombs = new BombStore();
  const players = new PlayerRegistry();
  const engine = new GameEngine(cfg, canvas, bombs, players, new AntiFarm());

  const addPlayer = (userId: number): PlayerState => {
    const p = createPlayer({ userId, accountCreatedAt: T0 - 365 * DAY_MS, guildMember: true, now: T0 }, cfg);
    players.add(p);
    return p;
  };

  return { cfg, canvas, bombs, players, engine, addPlayer };
}

export function eventsOf<T extends EngineEvent["type"]>(events: EngineEvent[], type: T) {
  return events.filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type);
}
