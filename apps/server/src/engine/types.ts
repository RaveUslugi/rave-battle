import type { ItemKey, Reward } from "@rave/shared";

export type UserId = number;
export type Inventory = Record<ItemKey, number>;

export interface PlayerState {
  userId: UserId;
  coins: number;
  /** Charges as of `chargesUpdatedAt`; call settleCharges() before reading. */
  charges: number;
  chargesUpdatedAt: number;
  /** Epoch ms; 0 = not frozen. Actions and charge regen are blocked until then. */
  frozenUntil: number;
  chargeCapBonus: number;
  inventory: Inventory;
  unlockedColors: Set<number>;
  /** Index of the next daily reward. */
  dailyStep: number;
  /** dateKey() of the last claim, or null. */
  dailyLastClaim: string | null;
  /** Epoch ms; null = not banned, Infinity = permanent. */
  bannedUntil: number | null;
  /** Why the player is banned; shown to them. */
  banReason: string | null;
  /** Discord account creation time, epoch ms. */
  accountCreatedAt: number;
  /** True when the guild check is disabled or the user is a member. */
  guildMember: boolean;
}

export type RejectCode =
  | "banned"
  | "not_guild_member"
  | "account_too_new"
  | "frozen"
  | "out_of_bounds"
  | "invalid_color"
  | "color_locked"
  | "no_charges"
  | "no_bombs"
  | "bomb_limit"
  | "no_detector"
  | "no_defuser"
  | "insufficient_coins"
  | "boost_limit"
  | "not_for_sale"
  | "already_unlocked"
  | "already_claimed";

export type Rejected = { ok: false; code: RejectCode };

export type LedgerItem = "coins" | ItemKey;
export type LedgerReason = "shop" | "daily" | "explosion" | "bomb_bonus" | "defuse" | "use";
export type StatKey =
  | "pixels"
  | "coinsFromPixels"
  | "bombsTriggered"
  | "explosionsSuffered"
  | "selfExplosions"
  | "defused";

export type EngineEvent =
  | { type: "pixel"; x: number; y: number; userId: UserId; colorId: number; prevColorId: number; prevUserId: UserId; at: number }
  | { type: "bomb_added"; x: number; y: number; ownerId: UserId; at: number }
  | { type: "bomb_removed"; x: number; y: number; ownerId: UserId; reason: "exploded" | "defused"; removedBy: UserId; at: number }
  | { type: "ledger"; userId: UserId; item: LedgerItem; delta: number; balanceAfter: number; reason: LedgerReason; ref: Record<string, unknown>; at: number }
  | { type: "stat"; userId: UserId; day: string; stat: StatKey; delta: number }
  | { type: "color_unlocked"; userId: UserId; colorId: number; source: "shop"; at: number }
  /** Player state changed; the persister upserts the current snapshot. */
  | { type: "player"; userId: UserId };

export interface PlaceCommand {
  x: number;
  y: number;
  colorId: number;
  withBomb: boolean;
}

export type PlaceResult =
  | Rejected
  | { ok: true; outcome: "placed" }
  | { ok: true; outcome: "exploded"; self: boolean; frozenUntil: number; coinsLost: number; bombOwnerId: UserId };

export type DetectResult = Rejected | { ok: true; count: number };
export type DefuseResult = Rejected | { ok: true; found: boolean; reward: number };
export type BuyResult = Rejected | { ok: true };
export type DailyResult = Rejected | { ok: true; reward: Reward };
