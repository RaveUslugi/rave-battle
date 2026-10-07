import type { Db } from "../db/client";
import { loadGame } from "./load-game";
import { GameRuntime, type RuntimeOptions } from "./runtime";

export type BootOptions = Omit<RuntimeOptions, "seasonId" | "dirtyChunks">;

/** The only supported way to start the game: loads state and seeds the runtime with replayed chunks. */
export async function bootGame(db: Db, options: BootOptions = {}): Promise<GameRuntime> {
  const now = options.now ?? Date.now;
  const loaded = await loadGame(db, now());
  return new GameRuntime(loaded.engine, db, {
    ...options,
    now,
    seasonId: loaded.seasonId,
    dirtyChunks: loaded.replayedChunks,
  });
}
