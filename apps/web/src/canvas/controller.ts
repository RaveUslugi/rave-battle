import type { ChunkDelta, GameConfig } from "@rave/shared";
import type { Timers } from "../net/socket";
import { ChunkSync, type SyncAction } from "./chunk-sync";
import { buildPaletteLut } from "./palette";

export interface Renderer {
  setPalette(lut: Uint8Array): void;
  setCanvasSize(width: number, height: number): void;
  replaceChunk(cx: number, cy: number, colors: Uint8Array): void;
  applyCells(cx: number, cy: number, cells: ChunkDelta["cells"]): void;
  dropChunk(cx: number, cy: number): void;
  dropAll(): void;
}

export type ChunkLoader = (cx: number, cy: number) => Promise<{ version: number; colors: Uint8Array }>;

export interface ChunkSubscriber {
  subscribe(chunks: Array<{ cx: number; cy: number }>): void;
}

export interface ControllerDeps {
  renderer: Renderer;
  loadChunk: ChunkLoader;
  socket: ChunkSubscriber;
  retryMs?: number;
  /** A load that has not settled by then counts as failed (a hanging fetch must not pin a chunk). */
  loadTimeoutMs?: number;
  timers?: Timers;
}

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Glue between visible chunks, HTTP loads, deltas and the renderer. */
export class CanvasController {
  private sync = new ChunkSync();
  private bootId: string | null = null;
  private visible = new Set<string>();
  private readonly retryMs: number;
  private readonly loadTimeoutMs: number;
  private readonly timers: Timers;

  constructor(private readonly deps: ControllerDeps) {
    this.retryMs = deps.retryMs ?? 2000;
    this.loadTimeoutMs = deps.loadTimeoutMs ?? 15_000;
    this.timers = deps.timers ?? defaultTimers;
  }

  onHello(message: { bootId: string; config: GameConfig }): void {
    if (this.bootId !== null && this.bootId !== message.bootId) {
      // Versions from another server boot are meaningless: start over.
      this.sync.reset();
      this.deps.renderer.dropAll();
      this.visible.clear();
    }
    this.bootId = message.bootId;
    this.deps.renderer.setPalette(buildPaletteLut(message.config.palette));
    this.deps.renderer.setCanvasSize(message.config.canvas.width, message.config.canvas.height);
  }

  setVisible(chunks: Array<{ cx: number; cy: number }>): void {
    const next = new Set(chunks.map((c) => `${c.cx}:${c.cy}`));
    const changed = next.size !== this.visible.size || [...next].some((k) => !this.visible.has(k));
    if (!changed) return;
    for (const k of this.visible) {
      if (next.has(k)) continue;
      const [cx, cy] = k.split(":").map(Number) as [number, number];
      this.sync.untrack(cx, cy);
      this.deps.renderer.dropChunk(cx, cy);
    }
    for (const c of chunks) if (!this.visible.has(`${c.cx}:${c.cy}`)) this.run(this.sync.track(c.cx, c.cy));
    this.visible = next;
    this.deps.socket.subscribe(chunks);
  }

  onDelta(delta: ChunkDelta): void {
    this.run(this.sync.onDelta(delta));
  }

  onAck(chunks: Array<{ cx: number; cy: number; version: number }>): void {
    for (const c of chunks) this.run(this.sync.onAck(c.cx, c.cy, c.version));
  }

  private run(actions: SyncAction[]): void {
    for (const action of actions) {
      if (action.type === "load") this.load(action.cx, action.cy, action.requestId);
      else if (action.type === "replace") this.deps.renderer.replaceChunk(action.cx, action.cy, action.colors);
      else this.deps.renderer.applyCells(action.cx, action.cy, action.cells);
    }
  }

  private load(cx: number, cy: number, requestId: number): void {
    let failed = false;
    const fail = () => {
      if (failed) return;
      failed = true;
      this.timers.clear(timeout);
      this.timers.set(() => this.run(this.sync.retry(cx, cy, requestId)), this.retryMs);
    };
    const timeout = this.timers.set(fail, this.loadTimeoutMs);
    this.deps.loadChunk(cx, cy).then(
      ({ version, colors }) => {
        this.timers.clear(timeout);
        // A result that arrives after a timeout is still fine if nothing superseded it; ChunkSync decides.
        this.run(this.sync.onLoaded(cx, cy, requestId, version, colors));
      },
      fail,
    );
  }
}
