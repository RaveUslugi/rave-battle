import type { ServerMessage } from "@rave/shared";
import type { StoreApi } from "zustand/vanilla";
import type { Timers } from "../net/socket";
import type { GameState } from "../state/game-store";
import type { UiState } from "../state/ui-store";
import { rejectText } from "./messages";
import { PendingPlacements } from "./pending";
import { planPlacement } from "./placement";

type Cell = { x: number; y: number };
type PlacedMessage = Extract<ServerMessage, { type: "placed" }>;

/** What the game logic needs from the canvas; implemented by `CanvasSession`. */
export interface CanvasPort {
  /** False when the frame cannot be sent right now (not connected). */
  sendPlace(message: { reqId: number; x: number; y: number; colorId: number; withBomb: boolean }): boolean;
  setPending(cells: Array<{ x: number; y: number; colorId: number }>): void;
  setSelection(cell: Cell | null): void;
  flash(cell: Cell): void;
}

export interface ClientDeps {
  game: StoreApi<GameState>;
  ui: StoreApi<UiState>;
  now?: () => number;
  timers?: Timers;
  pendingTtlMs?: number;
}

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Turns taps into placements and server answers into UI feedback. */
export class GameClient {
  private port: CanvasPort | null = null;
  private readonly pending = new PendingPlacements();
  private readonly expiryTimers = new Set<unknown>();
  private unsubscribe: Array<() => void> = [];
  private readonly now: () => number;
  private readonly timers: Timers;
  private readonly ttlMs: number;

  constructor(private readonly deps: ClientDeps) {
    this.now = deps.now ?? Date.now;
    this.timers = deps.timers ?? defaultTimers;
    this.ttlMs = deps.pendingTtlMs ?? 10_000;
  }

  attach(port: CanvasPort): void {
    this.detach();
    this.port = port;
    this.unsubscribe = [
      this.deps.game.subscribe((state, prev) => {
        // Answers sent before a disconnect will never arrive.
        const disconnected = prev.status === "open" && state.status !== "open";
        if (disconnected) this.dropPending();
        if (disconnected || (prev.user && !state.user)) this.deps.ui.getState().select(null);
      }),
      this.deps.ui.subscribe((state, prev) => {
        if (state.selection !== prev.selection) this.port?.setSelection(state.selection);
      }),
    ];
  }

  detach(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    for (const handle of this.expiryTimers) this.timers.clear(handle);
    this.expiryTimers.clear();
    this.pending.clear();
    this.port = null;
  }

  readonly onCellTap = (cell: Cell, pointerType: string): void => {
    if (!this.deps.game.getState().user) {
      this.toast("unauthorized");
      return;
    }
    if (pointerType === "touch") {
      this.deps.ui.getState().select(cell);
      return;
    }
    this.place(cell);
  };

  readonly confirmSelection = (): void => {
    const selection = this.deps.ui.getState().selection;
    if (!selection) return;
    if (this.place(selection)) this.deps.ui.getState().select(null);
  };

  readonly cancelSelection = (): void => {
    this.deps.ui.getState().select(null);
  };

  readonly onPlaced = (message: PlacedMessage): void => {
    const placed = this.pending.resolve(message.reqId);
    if (!placed) return;
    this.port?.setPending(this.pending.list());
    const result = message.result;
    if (!result.ok) {
      this.toast(result.code);
      return;
    }
    if (result.outcome === "placed") return;
    this.port?.flash({ x: placed.x, y: placed.y });
    this.deps.ui.getState().setExplosion({
      self: result.self,
      coinsLost: result.coinsLost,
      frozenUntil: result.frozenUntil,
      bombOwner: result.bombOwner.name,
      at: this.now(),
    });
    const text = result.self
      ? `Вы подорвались на собственной бомбе! −${result.coinsLost} монет, заморозка`
      : `💥 Бомба игрока ${result.bombOwner.name}! −${result.coinsLost} монет, заморозка`;
    this.deps.ui.getState().pushToast("error", text);
  };

  /** True when the placement was sent. */
  private place(cell: Cell): boolean {
    const game = this.deps.game.getState();
    const ui = this.deps.ui.getState();
    if (!game.config) return false;
    const now = this.now();
    const plan = planPlacement({
      user: game.user,
      player: game.player,
      config: game.config,
      colorId: ui.selectedColor,
      withBomb: ui.bombMode,
      pendingCount: this.pending.size,
      pendingBombs: this.pending.bombs,
      now,
    });
    if (!plan.ok) {
      this.toast(plan.code);
      return false;
    }
    const placement = this.pending.add(cell, ui.selectedColor, ui.bombMode, now);
    const sent = this.port?.sendPlace({
      reqId: placement.reqId,
      x: placement.x,
      y: placement.y,
      colorId: placement.colorId,
      withBomb: placement.withBomb,
    });
    if (!sent) {
      this.pending.resolve(placement.reqId);
      this.toast("unavailable");
      return false;
    }
    this.port?.setPending(this.pending.list());
    const handle = this.timers.set(() => {
      this.expiryTimers.delete(handle);
      this.expire();
    }, this.ttlMs + 50);
    this.expiryTimers.add(handle);
    return true;
  }

  private expire(): void {
    if (this.pending.expire(this.now(), this.ttlMs).length === 0) return;
    this.port?.setPending(this.pending.list());
    this.toast("timeout");
  }

  private dropPending(): void {
    if (this.pending.size === 0) return;
    this.pending.clear();
    this.port?.setPending([]);
  }

  private toast(code: string): void {
    this.deps.ui.getState().pushToast("error", rejectText(code));
  }
}
