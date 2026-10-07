import { CHUNK_SIZE } from "@rave/shared";
import type { Db } from "../db/client";
import type { GameEngine } from "../engine/engine";
import { createPlayer, type NewPlayer } from "../engine/player";
import type { PlayerState, UserId } from "../engine/types";
import { snapshotPlayer, type Batch, type ChunkSnapshot } from "./batch";
import { writeBatch } from "./write-batch";

export interface RuntimeOptions {
  seasonId: number;
  /** Group-commit window. Default 100 ms. */
  flushIntervalMs?: number;
  /** How often dirty chunks are snapshotted. Default 5 min. */
  snapshotIntervalMs?: number;
  now?: () => number;
  /** Chunks to treat as dirty from the start (`LoadedGame.replayedChunks`). */
  dirtyChunks?: Iterable<string>;
  /** Called once when a commit fails. Default: log and exit (fail-fast, Docker restarts us). */
  onFatal?: (error: unknown) => void;
}

interface Waiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

function exitProcess(error: unknown): void {
  console.error("Fatal: failed to persist game state", error);
  process.exit(1);
}

/**
 * Runs engine commands and persists their effects with group commit.
 * A command's promise resolves only after the batch containing its effects is committed.
 */
export class GameRuntime {
  private waiters: Waiter[] = [];
  private newPlayers: Batch["newPlayers"] = [];
  private dirtyChunks: Set<string>;
  private queue: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failed = false;
  private lastSnapshotAt: number;
  private readonly seasonId: number;
  private readonly flushIntervalMs: number;
  private readonly snapshotIntervalMs: number;
  private readonly now: () => number;
  private readonly onFatal: (error: unknown) => void;

  constructor(
    readonly engine: GameEngine,
    private db: Db,
    options: RuntimeOptions,
  ) {
    this.seasonId = options.seasonId;
    this.flushIntervalMs = options.flushIntervalMs ?? 100;
    this.snapshotIntervalMs = options.snapshotIntervalMs ?? 300_000;
    this.now = options.now ?? Date.now;
    this.onFatal = options.onFatal ?? exitProcess;
    this.lastSnapshotAt = this.now();
    this.dirtyChunks = new Set(options.dirtyChunks);
  }

  /** Executes `command` right away; resolves with its result once its effects are committed. */
  run<T>(command: (engine: GameEngine, now: number) => T): Promise<T> {
    if (this.failed) return Promise.reject(this.stoppedError());
    let result: T;
    try {
      result = command(this.engine, this.now());
    } catch (error) {
      return Promise.reject(error);
    }
    return this.afterCommit().then(() => result);
  }

  /** Creates a player (caller checks it does not exist yet); resolves once it is persisted. */
  addPlayer(init: Omit<NewPlayer, "now">): Promise<PlayerState> {
    if (this.failed) return Promise.reject(this.stoppedError());
    const now = this.now();
    const player = createPlayer({ ...init, now }, this.engine.config);
    this.engine.players.add(player);
    this.newPlayers.push({ player: snapshotPlayer(player), at: now });
    return this.afterCommit().then(() => player);
  }

  /**
   * Commits everything produced so far. `snapshot: true` also snapshots dirty chunks (shutdown, tests).
   * Rejects if this or an earlier commit failed.
   */
  flush(options: { snapshot?: boolean } = {}): Promise<void> {
    const committed = this.queue.then(() => this.commit(options.snapshot ?? false));
    this.queue = committed.catch(() => {});
    return committed;
  }

  private stoppedError(): Error {
    return new Error("Game runtime stopped after a persistence failure");
  }

  private afterCommit(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.scheduleFlush();
    });
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(() => {});
    }, this.flushIntervalMs);
  }

  private async commit(forceSnapshot: boolean): Promise<void> {
    const waiters = this.waiters;
    this.waiters = [];
    if (this.failed) {
      const error = this.stoppedError();
      for (const w of waiters) w.reject(error);
      throw error;
    }
    const batch = this.takeBatch(forceSnapshot);
    if (batch) {
      try {
        await this.db.transaction((tx) => writeBatch(tx, batch));
      } catch (error) {
        this.failed = true;
        for (const w of waiters) w.reject(error);
        this.onFatal(error);
        throw error;
      }
    }
    for (const w of waiters) w.resolve();
  }

  /** Drains everything synchronously, so events, player snapshots and chunk copies are one consistent cut. */
  private takeBatch(forceSnapshot: boolean): Batch | null {
    const events = this.engine.drainEvents();
    const newPlayers = this.newPlayers;
    this.newPlayers = [];

    const touched = new Set<UserId>();
    for (const e of events) {
      if (e.type === "player") touched.add(e.userId);
      else if (e.type === "pixel") this.dirtyChunks.add(`${Math.floor(e.x / CHUNK_SIZE)}:${Math.floor(e.y / CHUNK_SIZE)}`);
    }

    const now = this.now();
    const snapshotDue = forceSnapshot || now - this.lastSnapshotAt >= this.snapshotIntervalMs;
    const chunks = snapshotDue ? this.takeDirtyChunks() : [];
    if (snapshotDue) this.lastSnapshotAt = now;

    if (events.length === 0 && newPlayers.length === 0 && chunks.length === 0) return null;
    const players = [...touched].map((id) => snapshotPlayer(this.engine.players.get(id)));
    return { seasonId: this.seasonId, events, players, newPlayers, chunks };
  }

  private takeDirtyChunks(): ChunkSnapshot[] {
    const chunks: ChunkSnapshot[] = [];
    for (const key of this.dirtyChunks) {
      const [cx, cy] = key.split(":").map(Number) as [number, number];
      const chunk = this.engine.canvas.getChunk(cx, cy);
      if (chunk) chunks.push({ cx, cy, colors: chunk.colors.slice(), owners: chunk.owners.slice() });
    }
    this.dirtyChunks.clear();
    return chunks;
  }
}
