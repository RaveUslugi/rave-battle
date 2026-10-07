import { dateKey, type GameConfig } from "@rave/shared";
import { accessError } from "./access";
import type { AntiFarm } from "./anti-farm";
import type { BombStore } from "./bomb-store";
import type { CanvasStore } from "./canvas-store";
import { settleCharges } from "./charges";
import type { PlayerRegistry } from "./player";
import type {
  EngineEvent,
  LedgerItem,
  LedgerReason,
  PlaceCommand,
  PlaceResult,
  PlayerState,
  RejectCode,
  Rejected,
  StatKey,
  UserId,
} from "./types";

const reject = (code: RejectCode): Rejected => ({ ok: false, code });

/**
 * Single writer of game state. Pure: no I/O, time comes from `now`.
 * Every successful command appends events to the outbox; rejected commands change nothing.
 */
export class GameEngine {
  private outbox: EngineEvent[] = [];

  constructor(
    private cfg: GameConfig,
    readonly canvas: CanvasStore,
    readonly bombs: BombStore,
    readonly players: PlayerRegistry,
    private antiFarm: AntiFarm,
  ) {}

  get config(): GameConfig {
    return this.cfg;
  }

  drainEvents(): EngineEvent[] {
    const events = this.outbox;
    this.outbox = [];
    return events;
  }

  placePixel(userId: UserId, cmd: PlaceCommand, now: number): PlaceResult {
    const p = this.players.get(userId);
    const denied = this.actionError(p, now);
    if (denied) return reject(denied);
    if (!this.canvas.inBounds(cmd.x, cmd.y)) return reject("out_of_bounds");
    const colorDenied = this.colorError(p, cmd.colorId);
    if (colorDenied) return reject(colorDenied);
    settleCharges(p, this.cfg, now);
    if (p.charges < 1) return reject("no_charges");

    p.charges -= 1;
    const day = dateKey(now, this.cfg.daily.timezone);

    const prev = this.canvas.set(cmd.x, cmd.y, cmd.colorId, userId);
    this.emit({ type: "pixel", x: cmd.x, y: cmd.y, userId, colorId: cmd.colorId, prevColorId: prev.colorId, prevUserId: prev.ownerId, at: now });
    p.coins += this.cfg.coinsPerPixel;
    this.stat(userId, day, "pixels", 1);
    this.stat(userId, day, "coinsFromPixels", this.cfg.coinsPerPixel);
    this.emit({ type: "player", userId });
    return { ok: true, outcome: "placed" };
  }

  /** Access problems plus freeze: blocks pixels and sapper tools. */
  private actionError(p: PlayerState, now: number): RejectCode | null {
    return accessError(p, this.cfg, now) ?? (p.frozenUntil > now ? "frozen" : null);
  }

  private colorError(p: PlayerState, colorId: number): RejectCode | null {
    const entry = this.cfg.palette.find((e) => e.id === colorId);
    if (!entry) return "invalid_color";
    if (entry.unlock !== "default" && !p.unlockedColors.has(colorId)) return "color_locked";
    return null;
  }

  private emit(event: EngineEvent): void {
    this.outbox.push(event);
  }

  private stat(userId: UserId, day: string, stat: StatKey, delta: number): void {
    if (delta !== 0) this.emit({ type: "stat", userId, day, stat, delta });
  }

  /** Call after mutating the balance: records the new balance. */
  private ledger(p: PlayerState, item: LedgerItem, delta: number, reason: LedgerReason, now: number, ref: Record<string, unknown> = {}): void {
    if (delta === 0) return;
    const balanceAfter = item === "coins" ? p.coins : p.inventory[item];
    this.emit({ type: "ledger", userId: p.userId, item, delta, balanceAfter, reason, ref, at: now });
  }
}
