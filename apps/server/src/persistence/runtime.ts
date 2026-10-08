import { CHUNK_SIZE } from "@rave/shared";
import type { Db } from "../db/client";
import type { GameEngine } from "../engine/engine";
import { createPlayer, type NewPlayer } from "../engine/player";
import type { EngineEvent, PlayerState, UserId } from "../engine/types";
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
  /** Called after each successful commit with its events, before the commands resolve. */
  onCommit?: (events: EngineEvent[]) => void;
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
  private stopping = false;
  private lastSnapshotAt: number;
  private readonly seasonId: number;
  private readonly flushIntervalMs: number;
  private readonly snapshotIntervalMs: number;
  private readonly now: () => number;
  private readonly onFatal: (error: unknown) => void;
  private readonly onCommit: ((events: EngineEvent[]) => void) | undefined;

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
    this.onCommit = options.onCommit;
    this.lastSnapshotAt = this.now();
    this.dirtyChunks = new Set(options.dirtyChunks);
  }

  /** Season all game state belongs to. */
  get season(): number {
    return this.seasonId;
  }

  /** Executes `command` right away; resolves with its result once its effects are committed. */
  run<T>(command: (engine: GameEngine, now: number) => T): Promise<T> {
    const unavailable = this.unavailableError();
    if (unavailable) return Promise.reject(unavailable);
    let result: T;
    try {
      result = command(this.engine, this.now());
    } catch (error) {
      return Promise.reject(error);
    }
    return this.afterCommit().then(() => result);
  }

  /**
   * Returns the existing player, or creates one; always resolves only once the player is persisted.
   * Access flags of an existing player are not touched; use engine.setAccess.
   */
  addPlayer(init: Omit<NewPlayer, "now">): Promise<PlayerState> {
    const unavailable = this.unavailableError();
    if (unavailable) return Promise.reject(unavailable);
    if (this.engine.players.has(init.userId)) {
      const existing = this.engine.players.get(init.userId);
      const pending = this.newPlayers.some((entry) => entry.player.userId === init.userId);
      return pending ? this.afterCommit().then(() => existing) : Promise.resolve(existing);
    }
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

  /** Graceful shutdown: rejects new commands, commits everything pending and snapshots dirty chunks. */
  stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.flush({ snapshot: true });
  }

  private stoppedError(): Error {
    return new Error("Game runtime stopped after a persistence failure");
  }

  private unavailableError(): Error | null {
    if (this.failed) return this.stoppedError();
    if (this.stopping) return new Error("Game runtime is shutting down");
    return null;
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
    let events: EngineEvent[] = [];
    try {
      const batch = this.takeBatch(forceSnapshot);
      if (batch) {
        events = batch.events;
        await this.db.transaction((tx) => writeBatch(tx, batch));
      }
    } catch (error) {
      this.failed = true;
      for (const w of waiters) w.reject(error);
      this.onFatal(error);
      throw error;
    }
    this.notifyCommitted(events);
    for (const w of waiters) w.resolve();
  }

  private notifyCommitted(events: EngineEvent[]): void {
    if (!this.onCommit || events.length === 0) return;
    try {
      this.onCommit(events);
    } catch (error) {
      console.error("onCommit handler failed", error);
    }
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
