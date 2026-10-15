import { normalizeRect, type Rect, type ServerMessage } from "@rave/shared/client";
import type { StoreApi } from "zustand/vanilla";
import type { Timers } from "../net/socket";
import type { GameState } from "../state/game-store";
import type { ReadingsState } from "../state/readings-store";
import type { UiState } from "../state/ui-store";
import { rejectText } from "./messages";
import { PendingPlacements } from "./pending";
import { tapCorner } from "./area";
import { planPlacement } from "./placement";
import { SapperTools, type Tool, type ToolsApi } from "./tools";

type Cell = { x: number; y: number };
type PlacedMessage = Extract<ServerMessage, { type: "placed" }>;

/** What the game logic needs from the canvas; implemented by `CanvasSession`. */
export interface CanvasPort {
  /** False when the frame cannot be sent right now (not connected). */
  sendPlace(message: { reqId: number; x: number; y: number; colorId: number; withBomb: boolean }): boolean;
  setPending(cells: Array<{ x: number; y: number; colorId: number }>): void;
  setSelection(cell: Cell | null): void;
  /** Moderation frame around an inclusive rectangle; null hides it. */
  setArea(rect: Rect | null): void;
  flash(cell: Cell): void;
}

export interface ClientDeps {
  game: StoreApi<GameState>;
  ui: StoreApi<UiState>;
  now?: () => number;
  timers?: Timers;
  pendingTtlMs?: number;
  /** Monotonic clock for the pending timeout; defaults to performance.now. */
  monotonic?: () => number;
  /** Both are needed for the sapper tools; without them tool taps say the server is unavailable. */
  readings?: StoreApi<ReadingsState>;
  tools?: ToolsApi;
}

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** The rectangle to frame: the area, else the inspected cell, else the first touch corner. */
export function moderationFrame(m: UiState["moderation"]): Rect | null {
  if (m.area) return m.area;
  const cell = m.cell ?? m.corner;
  return cell ? normalizeRect(cell, cell) : null;
}

/** Turns taps into placements and server answers into UI feedback. */
export class GameClient {
  private port: CanvasPort | null = null;
  private readonly pending = new PendingPlacements();
  private readonly expiryTimers = new Set<unknown>();
  private unsubscribe: Array<() => void> = [];
  private readonly now: () => number;
  private readonly monotonic: () => number;
  private readonly timers: Timers;
  private readonly ttlMs: number;
  private readonly sapper: SapperTools | null;

  constructor(private readonly deps: ClientDeps) {
    this.now = deps.now ?? Date.now;
    this.monotonic = deps.monotonic ?? (() => performance.now());
    this.timers = deps.timers ?? defaultTimers;
    this.ttlMs = deps.pendingTtlMs ?? 10_000;
    this.sapper =
      deps.tools && deps.readings ? new SapperTools({ game: deps.game, ui: deps.ui, readings: deps.readings, api: deps.tools, now: this.now }) : null;
  }

  attach(port: CanvasPort): void {
    this.detach();
    this.port = port;
    this.unsubscribe = [
      this.deps.game.subscribe((state, prev) => {
        // Answers sent before a disconnect will never arrive.
        const disconnected = prev.status === "open" && state.status !== "open";
        if (disconnected) this.dropPending();
        if (state.user?.id !== prev.user?.id) {
          // A tool picked by the previous user must not fire for the next one.
          this.deps.ui.getState().setTool("paint");
        }
        if (disconnected || (prev.user && !state.user)) this.deps.ui.getState().select(null);
        const p = state.player;
        if (p !== prev.player && p && !p.unlimited && p.inventory.bomb === 0 && this.deps.ui.getState().bombMode) {
          this.deps.ui.getState().setBombMode(false);
        }
      }),
      this.deps.ui.subscribe((state, prev) => {
        if (state.selection !== prev.selection) this.port?.setSelection(state.selection);
        if (state.moderation !== prev.moderation) this.port?.setArea(moderationFrame(state.moderation));
      }),
    ];
    // A port that attaches late (remount) must show the current frame at once.
    port.setArea(moderationFrame(this.deps.ui.getState().moderation));
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
    const ui = this.deps.ui.getState();
    if (!this.deps.game.getState().user) {
      this.toast("unauthorized");
      return;
    }
    // Admin tools act on the tap itself: they only read or select, and the server checks the rights.
    if (ui.tool === "inspect") {
      ui.inspectCell(cell);
      return;
    }
    if (ui.tool === "area") {
      if (pointerType === "mouse") ui.setArea(normalizeRect(cell, cell));
      else {
        const next = tapCorner(ui.moderation.corner, cell);
        if (next.area) ui.setArea(next.area);
        else ui.setCorner(next.corner);
      }
      return;
    }
    // Touch always confirms; the defuser is expensive, so it confirms for every pointer.
    if (pointerType === "touch" || ui.tool === "defuser") {
      ui.select(cell);
      return;
    }
    // A mouse click while a touch selection is open acts on the click, not on the old selection.
    if (ui.selection) ui.select(null);
    if (ui.tool === "paint") this.place(cell);
    else this.applyTool(ui.tool, cell);
  };

  readonly confirmSelection = (): void => {
    const ui = this.deps.ui.getState();
    const selection = ui.selection;
    if (!selection) return;
    if (ui.tool === "inspect" || ui.tool === "area") return;
    const done = ui.tool === "paint" ? this.place(selection) : this.applyTool(ui.tool, selection);
    if (done) this.deps.ui.getState().select(null);
  };

  /** True when the request was sent. The detector stays picked for scanning an area; the costly defuser hands back the brush. */
  private applyTool(tool: Tool, cell: Cell): boolean {
    if (!this.sapper) {
      this.toast("unavailable");
      return false;
    }
    if (!this.sapper.use(tool, cell)) return false;
    if (tool === "defuser") this.deps.ui.getState().setTool("paint");
    return true;
  }

  readonly cancelSelection = (): void => {
    this.deps.ui.getState().select(null);
  };

  readonly onPlaced = (message: PlacedMessage): void => {
    const resolved = this.pending.resolve(message.reqId);
    if (!resolved) return;
    const { item: placed, late } = resolved;
    if (!late) this.port?.setPending(this.pending.list());
    const result = message.result;
    if (!result.ok) {
      // A late reject changes nothing the player can see: the timeout toast already covered it.
      if (!late) this.toast(result.code);
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
    const freeze = result.frozenUntil > 0 ? ", заморозка" : "";
    const text = result.self
      ? `Вы подорвались на собственной бомбе! −${result.coinsLost} монет${freeze}`
      : `💥 Бомба игрока ${result.bombOwner.name}! −${result.coinsLost} монет${freeze}`;
    this.deps.ui.getState().pushToast("error", text);
  };

  /** True when the placement was sent. */
  private place(cell: Cell): boolean {
    const game = this.deps.game.getState();
    const ui = this.deps.ui.getState();
    if (!game.config) return false;
    const plan = planPlacement({
      user: game.user,
      player: game.player,
      config: game.config,
      colorId: ui.selectedColor,
      withBomb: ui.bombMode,
      pendingCount: this.pending.size,
      pendingBombs: this.pending.bombs,
      now: this.now() + game.clockOffset,
    });
    if (!plan.ok) {
      this.toast(plan.code);
      return false;
    }
    const placement = this.pending.add(cell, ui.selectedColor, ui.bombMode, this.monotonic());
    let sent = false;
    try {
      sent =
        this.port?.sendPlace({
          reqId: placement.reqId,
          x: placement.x,
          y: placement.y,
          colorId: placement.colorId,
          withBomb: placement.withBomb,
        }) ?? false;
    } catch {
      sent = false;
    }
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
    if (this.pending.expire(this.monotonic(), this.ttlMs).length === 0) return;
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
