import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  bigserial,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { ItemKey } from "@rave/shared";
import type { LedgerItem, LedgerReason, ModAction } from "../engine/types";
import { bytes } from "./bytes";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  discordId: text("discord_id").notNull().unique(),
  username: text("username").notNull(),
  avatar: text("avatar"),
  discordCreatedAt: ts("discord_created_at").notNull(),
  /** 9999-12-31 = permanent ban. */
  bannedUntil: ts("banned_until"),
  banReason: text("ban_reason"),
  /** Refreshed on every Discord login; dev users are always members. */
  guildMember: boolean("guild_member").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at"),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const seasons = pgTable("seasons", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  startedAt: ts("started_at").notNull().defaultNow(),
  endedAt: ts("ended_at"),
});

export const playerState = pgTable(
  "player_state",
  {
    userId: integer("user_id").notNull().references(() => users.id),
    seasonId: integer("season_id").notNull().references(() => seasons.id),
    coins: integer("coins").notNull(),
    charges: integer("charges").notNull(),
    chargesUpdatedAt: ts("charges_updated_at").notNull(),
    frozenUntil: ts("frozen_until"),
    chargeCapBonus: integer("charge_cap_bonus").notNull().default(0),
    dailyStep: integer("daily_step").notNull().default(0),
    dailyLastClaim: date("daily_last_claim", { mode: "string" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.seasonId] })],
);

export const inventory = pgTable(
  "inventory",
  {
    userId: integer("user_id").notNull().references(() => users.id),
    seasonId: integer("season_id").notNull().references(() => seasons.id),
    item: text("item").$type<ItemKey>().notNull(),
    amount: integer("amount").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.seasonId, t.item] })],
);

export const unlockedColors = pgTable(
  "unlocked_colors",
  {
    userId: integer("user_id").notNull().references(() => users.id),
    colorId: smallint("color_id").notNull(),
    source: text("source").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.colorId] })],
);

export const ledger = pgTable(
  "ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id),
    seasonId: integer("season_id").notNull().references(() => seasons.id),
    item: text("item").$type<LedgerItem>().notNull(),
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    reason: text("reason").$type<LedgerReason | "start">().notNull(),
    ref: jsonb("ref").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("ledger_user_idx").on(t.userId, t.createdAt)],
);

export const chunkSnapshots = pgTable(
  "chunk_snapshots",
  {
    id: serial("id").primaryKey(),
    seasonId: integer("season_id").notNull().references(() => seasons.id),
    cx: integer("cx").notNull(),
    cy: integer("cy").notNull(),
    colors: bytes("colors").notNull(),
    owners: bytes("owners").notNull(),
    lastEventId: bigint("last_event_id", { mode: "number" }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("chunk_snapshots_lookup_idx").on(t.seasonId, t.cx, t.cy, t.id)],
);

export const pixelEvents = pgTable(
  "pixel_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    seasonId: integer("season_id").notNull().references(() => seasons.id),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    /** Owner of the cell after the event; null = nobody. */
    userId: integer("user_id").references(() => users.id),
    colorId: smallint("color_id").notNull(),
    prevColorId: smallint("prev_color_id").notNull(),
    prevUserId: integer("prev_user_id").references(() => users.id),
    kind: text("kind").$type<"place" | "mod_rollback" | "mod_clear">().notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    index("pixel_events_user_idx").on(t.seasonId, t.userId, t.createdAt),
    index("pixel_events_cell_idx").on(t.seasonId, t.x, t.y, t.id),
  ],
);

export const bombs = pgTable(
  "bombs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    seasonId: integer("season_id").notNull().references(() => seasons.id),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    ownerId: integer("owner_id").notNull().references(() => users.id),
    createdAt: ts("created_at").notNull(),
    removedAt: ts("removed_at"),
    removedReason: text("removed_reason").$type<"exploded" | "defused" | "moderated">(),
    removedBy: integer("removed_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("bombs_active_cell_idx").on(t.seasonId, t.x, t.y).where(sql`removed_at is null`),
    index("bombs_owner_idx").on(t.seasonId, t.ownerId),
  ],
);

export const statsDaily = pgTable(
  "stats_daily",
  {
    userId: integer("user_id").notNull().references(() => users.id),
    seasonId: integer("season_id").notNull().references(() => seasons.id),
    date: date("date", { mode: "string" }).notNull(),
    pixels: integer("pixels").notNull().default(0),
    coinsFromPixels: integer("coins_from_pixels").notNull().default(0),
    bombsTriggered: integer("bombs_triggered").notNull().default(0),
    explosionsSuffered: integer("explosions_suffered").notNull().default(0),
    selfExplosions: integer("self_explosions").notNull().default(0),
    defused: integer("defused").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.seasonId, t.date] })],
);

export const gameConfig = pgTable("game_config", {
  version: serial("version").primaryKey(),
  data: jsonb("data").$type<unknown>().notNull(),
  createdBy: integer("created_by").references(() => users.id),
  comment: text("comment").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const modLog = pgTable("mod_log", {
  id: serial("id").primaryKey(),
  adminId: integer("admin_id").notNull().references(() => users.id),
  action: text("action").$type<ModAction>().notNull(),
  targetUserId: integer("target_user_id").references(() => users.id),
  params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
});
