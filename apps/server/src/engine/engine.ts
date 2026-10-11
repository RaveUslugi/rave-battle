import { dateKey, type GameConfig, type ItemKey } from "@rave/shared";
import { accessError } from "./access";
import type { AntiFarm } from "./anti-farm";
import type { Bomb, BombStore } from "./bomb-store";
import type { CanvasStore } from "./canvas-store";
import { settleCharges } from "./charges";
import { configChangeIssues } from "./config-change";
import type { PlayerRegistry } from "./player";
import type {
  AdjustResult,
  BuyResult,
  ConfigResult,
  DailyResult,
  DefuseResult,
  DetectResult,
  EngineEvent,
  LedgerItem,
  LedgerReason,
  ModerationMeta,
  ModerationPlan,
  ModerationResult,
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
  /** Dev accounts that spend nothing and cannot be frozen. Runtime-only, never persisted. */
  private unlimited = new Set<UserId>();

  constructor(
    private cfg: GameConfig,
    readonly canvas: CanvasStore,
    readonly bombs: BombStore,
    readonly players: PlayerRegistry,
    private antiFarm: AntiFarm,
    private _configVersion = 1,
  ) {}

  get config(): GameConfig {
    return this.cfg;
  }

  get configVersion(): number {
    return this._configVersion;
  }

  /**
   * Swaps the live config. `next` must already pass gameConfigSchema; this adds the rules that depend on
   * the running game, and rejects saves based on an outdated version. Persisted with the same batch as pixels.
   */
  applyConfig(
    next: GameConfig,
    change: { baseVersion: number; adminId: UserId; comment: string; action: "config_save" | "config_rollback"; fromVersion?: number },
    now: number,
  ): ConfigResult {
    if (change.baseVersion !== this._configVersion) return { ok: false, code: "stale", currentVersion: this._configVersion };
    const issues = configChangeIssues(this.cfg, next, this.canvas);
    if (issues.length > 0) return { ok: false, code: "invalid", issues };
    // Settle charges under the old config so new regen/max settings only affect the future.
    for (const p of this.players.all()) {
      const { charges, chargesUpdatedAt } = p;
      settleCharges(p, this.cfg, now);
      if (p.charges !== charges || p.chargesUpdatedAt !== chargesUpdatedAt) this.emit({ type: "player", userId: p.userId });
    }
    this.canvas.resize(next.canvas.width, next.canvas.height);
    this.cfg = next;
    const version = ++this._configVersion;
    this.emit({ type: "config_changed", version, config: next, createdBy: change.adminId, comment: change.comment, at: now });
    this.emit({
      type: "mod_log",
      adminId: change.adminId,
      action: change.action,
      targetUserId: null,
      params: { version, comment: change.comment, ...(change.fromVersion !== undefined ? { fromVersion: change.fromVersion } : {}) },
      at: now,
    });
    return { ok: true, version };
  }

  drainEvents(): EngineEvent[] {
    const events = this.outbox;
    this.outbox = [];
    return events;
  }

  grantUnlimited(userId: UserId): void {
    this.unlimited.add(userId);
  }

  isUnlimited(userId: UserId): boolean {
    return this.unlimited.has(userId);
  }

  placePixel(userId: UserId, cmd: PlaceCommand, now: number): PlaceResult {
    const p = this.players.get(userId);
    const denied = this.actionError(p, now);
    if (denied) return reject(denied);
    if (!this.canvas.inBounds(cmd.x, cmd.y)) return reject("out_of_bounds");
    const colorDenied = this.colorError(p, cmd.colorId);
    if (colorDenied) return reject(colorDenied);
    const unlimited = this.unlimited.has(userId);
    settleCharges(p, this.cfg, now);
    if (!unlimited && p.charges < 1) return reject("no_charges");
    if (cmd.withBomb && !unlimited) {
      if (p.inventory.bomb < 1) return reject("no_bombs");
      if (this.bombs.activeCount(userId) >= this.cfg.bombs.maxActivePerPlayer) return reject("bomb_limit");
    }

    const bomb = this.bombs.get(cmd.x, cmd.y);
    const bombOwner = bomb && bomb.ownerId !== userId ? this.players.get(bomb.ownerId) : undefined;

    if (!unlimited) p.charges -= 1;
    const day = dateKey(now, this.cfg.daily.timezone);

    if (bomb) return this.explode(p, bomb, bombOwner, day, now);

    const prev = this.canvas.set(cmd.x, cmd.y, cmd.colorId, userId);
    this.emit({ type: "pixel", kind: "place", x: cmd.x, y: cmd.y, userId, colorId: cmd.colorId, prevColorId: prev.colorId, prevUserId: prev.ownerId, at: now });
    p.coins += this.cfg.coinsPerPixel;
    this.stat(userId, day, "pixels", 1);
    this.stat(userId, day, "coinsFromPixels", this.cfg.coinsPerPixel);

    if (cmd.withBomb) {
      this.bombs.add({ x: cmd.x, y: cmd.y, ownerId: userId, createdAt: now });
      this.emit({ type: "bomb_added", x: cmd.x, y: cmd.y, ownerId: userId, at: now });
      if (!unlimited) {
        p.inventory.bomb -= 1;
        this.ledger(p, "bomb", -1, "use", now);
      }
    }

    this.emit({ type: "player", userId });
    return { ok: true, outcome: "placed" };
  }

  detect(userId: UserId, cell: { x: number; y: number }, now: number): DetectResult {
    const p = this.players.get(userId);
    const denied = this.actionError(p, now);
    if (denied) return reject(denied);
    if (!this.canvas.inBounds(cell.x, cell.y)) return reject("out_of_bounds");
    const unlimited = this.unlimited.has(userId);
    if (!unlimited && p.inventory.detector < 1) return reject("no_detector");

    if (!unlimited) {
      p.inventory.detector -= 1;
      this.ledger(p, "detector", -1, "use", now);
    }
    this.emit({ type: "player", userId });
    return { ok: true, count: this.bombs.countAround(cell.x, cell.y) };
  }

  defuse(userId: UserId, cell: { x: number; y: number }, now: number): DefuseResult {
    const p = this.players.get(userId);
    const denied = this.actionError(p, now);
    if (denied) return reject(denied);
    if (!this.canvas.inBounds(cell.x, cell.y)) return reject("out_of_bounds");
    const unlimited = this.unlimited.has(userId);
    if (!unlimited && p.inventory.defuser < 1) return reject("no_defuser");

    if (!unlimited) {
      p.inventory.defuser -= 1;
      this.ledger(p, "defuser", -1, "use", now);
    }
    this.emit({ type: "player", userId });

    const bomb = this.bombs.remove(cell.x, cell.y);
    if (!bomb) return { ok: true, found: false, reward: 0 };
    this.emit({ type: "bomb_removed", x: bomb.x, y: bomb.y, ownerId: bomb.ownerId, reason: "defused", removedBy: userId, at: now });
    if (bomb.ownerId === userId) return { ok: true, found: true, reward: 0 };

    const reward = this.cfg.defuse.reward;
    p.coins += reward;
    this.ledger(p, "coins", reward, "defuse", now, { bombOwnerId: bomb.ownerId });
    this.stat(userId, dateKey(now, this.cfg.daily.timezone), "defused", 1);
    return { ok: true, found: true, reward };
  }

  buyItem(userId: UserId, item: ItemKey, now: number): BuyResult {
    const p = this.players.get(userId);
    const denied = accessError(p, this.cfg, now);
    if (denied) return reject(denied);
    const offer = this.cfg.shop[item];
    const short = this.spend(p, offer.price, now, { product: item });
    if (short) return reject(short);

    p.inventory[item] += offer.amount;
    this.ledger(p, item, offer.amount, "shop", now);
    this.emit({ type: "player", userId });
    return { ok: true };
  }

  buyChargeBoost(userId: UserId, now: number): BuyResult {
    const p = this.players.get(userId);
    const denied = accessError(p, this.cfg, now);
    if (denied) return reject(denied);
    const offer = this.cfg.shop.chargeCapBoost;
    if (p.chargeCapBonus + offer.amount > offer.maxTotal) return reject("boost_limit");
    const short = this.spend(p, offer.price, now, { product: "chargeCapBoost" });
    if (short) return reject(short);

    // Settle at the old cap so the regen timer stays consistent.
    settleCharges(p, this.cfg, now);
    p.chargeCapBonus += offer.amount;
    this.emit({ type: "player", userId });
    return { ok: true };
  }

  buyColor(userId: UserId, colorId: number, now: number): BuyResult {
    const p = this.players.get(userId);
    const denied = accessError(p, this.cfg, now);
    if (denied) return reject(denied);
    const entry = this.cfg.palette.find((e) => e.id === colorId);
    if (!entry) return reject("invalid_color");
    if (entry.unlock !== "shop" || entry.price === undefined) return reject("not_for_sale");
    if (p.unlockedColors.has(colorId)) return reject("already_unlocked");
    const short = this.spend(p, entry.price, now, { product: "color", colorId });
    if (short) return reject(short);

    p.unlockedColors.add(colorId);
    this.emit({ type: "color_unlocked", userId, colorId, source: "shop", at: now });
    this.emit({ type: "player", userId });
    return { ok: true };
  }

  /** Login and moderation update access flags. Flags live in `users`; the `player` event only pushes the new view (the persister upserts unchanged state). */
  setAccess(userId: UserId, access: { guildMember?: boolean; bannedUntil?: number | null; banReason?: string | null }): void {
    const p = this.players.get(userId);
    if (access.guildMember !== undefined) p.guildMember = access.guildMember;
    if (access.bannedUntil !== undefined) p.bannedUntil = access.bannedUntil;
    if (access.banReason !== undefined) p.banReason = access.banReason;
    this.emit({ type: "player", userId });
  }

  claimDaily(userId: UserId, now: number): DailyResult {
    const p = this.players.get(userId);
    const denied = accessError(p, this.cfg, now);
    if (denied) return reject(denied);
    const day = dateKey(now, this.cfg.daily.timezone);
    if (p.dailyLastClaim === day) return reject("already_claimed");

    const rewards = this.cfg.daily.rewards;
    // Config edits may shorten the list; wrap the stored step into range.
    const reward = rewards[p.dailyStep % rewards.length]!;
    if (reward.item === "coins") p.coins += reward.amount;
    else p.inventory[reward.item] += reward.amount;
    this.ledger(p, reward.item, reward.amount, "daily", now);

    p.dailyStep = (p.dailyStep + 1) % rewards.length;
    p.dailyLastClaim = day;
    this.emit({ type: "player", userId });
    return { ok: true, reward };
  }

  /** The pixel is not placed; the victim's own bomb (if any) is not spent. */
  private explode(victim: PlayerState, bomb: Bomb, owner: PlayerState | undefined, day: string, now: number): PlaceResult {
    const self = bomb.ownerId === victim.userId;
    const ex = this.cfg.explosion;

    this.bombs.remove(bomb.x, bomb.y);
    this.emit({ type: "bomb_removed", x: bomb.x, y: bomb.y, ownerId: bomb.ownerId, reason: "exploded", removedBy: victim.userId, at: now });

    const immune = this.unlimited.has(victim.userId);
    if (!immune) victim.frozenUntil = now + (self ? ex.selfFreezeMs : ex.freezeMs);
    const coinsLost = immune ? 0 : Math.min(victim.coins, self ? ex.selfCoinPenalty : ex.coinPenalty);
    victim.coins -= coinsLost;
    this.ledger(victim, "coins", -coinsLost, "explosion", now, { bombOwnerId: bomb.ownerId });

    if (!owner) {
      this.stat(victim.userId, day, "selfExplosions", 1);
    } else {
      this.stat(victim.userId, day, "explosionsSuffered", 1);
      owner.coins += ex.authorBonus;
      this.ledger(owner, "coins", ex.authorBonus, "bomb_bonus", now, { victimId: victim.userId });
      if (this.antiFarm.register(day, owner.userId, victim.userId, this.cfg.antiFarm.maxRatedPerPairPerDay)) {
        this.stat(owner.userId, day, "bombsTriggered", 1);
      }
      this.emit({ type: "player", userId: owner.userId });
    }

    this.emit({ type: "player", userId: victim.userId });
    return { ok: true, outcome: "exploded", self, frozenUntil: immune ? 0 : victim.frozenUntil, coinsLost, bombOwnerId: bomb.ownerId };
  }

  /** Access problems plus freeze: blocks pixels and sapper tools. Unlimited players ignore freezes. */
  private actionError(p: PlayerState, now: number): RejectCode | null {
    return accessError(p, this.cfg, now) ?? (p.frozenUntil > now && !this.unlimited.has(p.userId) ? "frozen" : null);
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

  /** Moderator balance change. All deltas apply or none; balances never go below zero. */
  adminAdjust(userId: UserId, changes: Partial<Record<LedgerItem, number>>, now: number, meta: { adminId: UserId; comment: string }): AdjustResult {
    const p = this.players.get(userId);
    const entries = (Object.entries(changes) as Array<[LedgerItem, number]>).filter(([, delta]) => delta !== 0);
    if (entries.length === 0) return { ok: false, code: "nothing_to_change" };
    const balance = (item: LedgerItem) => (item === "coins" ? p.coins : p.inventory[item]);
    if (entries.some(([item, delta]) => balance(item) + delta < 0)) return { ok: false, code: "negative_balance" };
    for (const [item, delta] of entries) {
      if (item === "coins") p.coins += delta;
      else p.inventory[item] += delta;
      this.ledger(p, item, delta, "admin", now, { adminId: meta.adminId, comment: meta.comment });
    }
    this.emit({ type: "mod_log", adminId: meta.adminId, action: "player_edit", targetUserId: userId, params: { changes: Object.fromEntries(entries), comment: meta.comment }, at: now });
    this.emit({ type: "player", userId });
    return { ok: true };
  }

  /** Moderator canvas edit: guarded cell writes, bomb removal and one mod_log entry. Stats and coins are untouched. */
  applyModeration(plan: ModerationPlan, meta: ModerationMeta, now: number): ModerationResult {
    let cells = 0;
    let skipped = 0;
    for (const w of plan.writes) {
      if (!this.canvas.inBounds(w.x, w.y)) {
        skipped++;
        continue;
      }
      const current = this.canvas.get(w.x, w.y);
      if (current.colorId !== w.expect.colorId || current.ownerId !== w.expect.ownerId) {
        skipped++;
        continue;
      }
      if (current.colorId === w.colorId && current.ownerId === w.ownerId) continue;
      const prev = this.canvas.set(w.x, w.y, w.colorId, w.ownerId);
      this.emit({ type: "pixel", kind: plan.kind, x: w.x, y: w.y, userId: w.ownerId, colorId: w.colorId, prevColorId: prev.colorId, prevUserId: prev.ownerId, at: now });
      cells++;
    }
    let bombs = 0;
    for (const { x, y } of plan.bombs) {
      const bomb = this.bombs.remove(x, y);
      if (!bomb) continue;
      this.emit({ type: "bomb_removed", x, y, ownerId: bomb.ownerId, reason: "moderated", removedBy: meta.adminId, at: now });
      bombs++;
    }
    this.emit({ type: "mod_log", adminId: meta.adminId, action: meta.action, targetUserId: meta.targetUserId, params: { ...meta.params, cells, skipped, bombs }, at: now });
    return { ok: true, cells, skipped, bombs };
  }

  /** Call after mutating the balance: records the new balance. */
  private ledger(p: PlayerState, item: LedgerItem, delta: number, reason: LedgerReason, now: number, ref: Record<string, unknown> = {}): void {
    if (delta === 0) return;
    const balanceAfter = item === "coins" ? p.coins : p.inventory[item];
    this.emit({ type: "ledger", userId: p.userId, item, delta, balanceAfter, reason, ref, at: now });
  }

  /** Charges `price` coins; returns a reject code instead if the player cannot afford it. */
  private spend(p: PlayerState, price: number, now: number, ref: Record<string, unknown>): RejectCode | null {
    if (p.coins < price) return "insufficient_coins";
    p.coins -= price;
    this.ledger(p, "coins", -price, "shop", now, ref);
    return null;
  }
}
