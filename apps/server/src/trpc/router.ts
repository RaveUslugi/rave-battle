import { itemKeySchema, LOCALES } from "@rave/shared";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { isAdmin } from "../auth/admin";
import { users } from "../db/schema";
import { MOD_ACTIONS } from "../engine/types";
import { DASHBOARD_PERIODS } from "../admin/dashboard";
import { PLAYER_FILTERS, PLAYER_SORTS } from "../admin/players";
import type { ChatService } from "../chat/service";
import type { AppDeps } from "../net/deps";
import { toPlayerView } from "../net/views";
import { BOARDS, PERIODS } from "../stats/leaderboards";
import { adminProcedure, playerProcedure, publicProcedure, router, userProcedure } from "./init";

const TOP = 50;

function need<T>(service: T | undefined, what: string): T {
  if (!service) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${what} is not available` });
  return service;
}

const chatOf = (deps: AppDeps): ChatService => need(deps.chat, "Chat");

/** Counts the action in the metrics once the engine answered. */
async function tracked<T extends { ok: boolean; code?: string }>(deps: AppDeps, type: string, result: Promise<T>): Promise<T> {
  const value = await result;
  deps.metrics?.track(type, value);
  return value;
}

const userId = z.number().int().positive().max(2_147_483_647);
const note = z.string().trim().min(1).max(200);
const delta = z.number().int().min(-1_000_000).max(1_000_000).optional();

const cell = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() });

const nat = z.number().int().nonnegative();
const rect = z.object({ x1: nat, y1: nat, x2: nat, y2: nat });
// A plain union: zod's discriminatedUnion cannot hold several variants with the same `kind`.
const moderationAction = z.union([
  z.object({ kind: z.literal("rollback_player"), userId, from: nat, to: nat, area: rect.nullable(), removeBombs: z.boolean() }).strict(),
  z.object({ kind: z.literal("clear_area"), area: rect, mode: z.literal("fill") }).strict(),
  z.object({ kind: z.literal("clear_area"), area: rect, mode: z.literal("to_time"), at: nat }).strict(),
  z.object({ kind: z.literal("remove_bombs"), userId }).strict(),
  z.object({ kind: z.literal("remove_bombs"), area: rect }).strict(),
]);

/**
 * Everything except pixels (those go over the WebSocket). Mutations run through the runtime, so
 * player updates and feed entries reach WebSocket clients via the commit hook.
 */
export const appRouter = router({
  me: publicProcedure.query(({ ctx }) => {
    if (!ctx.user) return null;
    const engine = ctx.deps.runtime.engine;
    const player = engine.players.has(ctx.user.id)
      ? toPlayerView(engine.players.get(ctx.user.id), engine.config, Date.now(), engine.isUnlimited(ctx.user.id), ctx.deps.chat?.muteOf(ctx.user.id) ?? null)
      : null;
    return { user: ctx.deps.users.ref(ctx.user.id), player, locale: ctx.user.locale };
  }),

  chat: router({
    send: playerProcedure.input(z.object({ text: z.string().max(2000) })).mutation(({ ctx, input }) => chatOf(ctx.deps).send(ctx.user, input.text)),
  }),

  settings: router({
    /** null = follow Discord's language, then the browser's. */
    setLocale: userProcedure.input(z.object({ locale: z.enum(LOCALES).nullable() })).mutation(async ({ ctx, input }) => {
      await ctx.deps.db.update(users).set({ locale: input.locale }).where(eq(users.id, ctx.user.id));
      return { ok: true as const };
    }),
  }),

  admin: router({
    whoami: publicProcedure.query(({ ctx }) => ({ admin: ctx.user !== null && isAdmin(ctx.user.discordId, ctx.deps.config) })),
    dashboard: adminProcedure
      .input(z.object({ period: z.enum(DASHBOARD_PERIODS) }))
      .query(({ ctx, input }) => need(ctx.deps.dashboard, "dashboard").get(input.period)),
    players: router({
      list: adminProcedure
        .input(
          z.object({
            filter: z.enum(PLAYER_FILTERS).default("all"),
            sort: z.enum(PLAYER_SORTS).default("pixels7d"),
            dir: z.enum(["asc", "desc"]).default("desc"),
            page: z.number().int().min(0).max(10_000).default(0),
          }),
        )
        .query(({ ctx, input }) => need(ctx.deps.playerList, "player list").list(input)),
      search: adminProcedure.input(z.object({ q: z.string().trim().min(1).max(64) })).query(({ ctx, input }) => ctx.deps.admin.search(input.q)),
      get: adminProcedure.input(z.object({ userId })).query(async ({ ctx, input }) => {
        const player = await ctx.deps.admin.player(input.userId);
        if (!player) throw new TRPCError({ code: "NOT_FOUND" });
        return player;
      }),
      ban: adminProcedure
        .input(z.object({ userId, until: z.union([z.number().int().positive().max(8_640_000_000_000_000), z.literal("permanent")]), reason: note }))
        .mutation(({ ctx, input }) => ctx.deps.admin.ban(ctx.user, input)),
      unban: adminProcedure.input(z.object({ userId, reason: note })).mutation(({ ctx, input }) => ctx.deps.admin.unban(ctx.user, input)),
      adjust: adminProcedure
        .input(z.object({ userId, changes: z.object({ coins: delta, bomb: delta, detector: delta, defuser: delta }), comment: note }))
        .mutation(({ ctx, input }) => ctx.deps.admin.adjust(ctx.user, input)),
    }),
    chat: router({
      mute: adminProcedure
        .input(z.object({ userId, until: z.union([z.number().int().positive().max(8_640_000_000_000_000), z.literal("permanent")]), reason: note }))
        .mutation(({ ctx, input }) => chatOf(ctx.deps).mute(ctx.user, input)),
      unmute: adminProcedure.input(z.object({ userId, reason: note })).mutation(({ ctx, input }) => chatOf(ctx.deps).unmute(ctx.user, input)),
      delete: adminProcedure
        .input(z.object({ id: z.number().int().positive() }))
        .mutation(({ ctx, input }) => chatOf(ctx.deps).deleteMessage(ctx.user, input.id)),
      deleteRecent: adminProcedure
        .input(
          z.object({
            userId,
            periodMs: z
              .number()
              .int()
              .positive()
              .max(30 * 86_400_000),
          }),
        )
        .mutation(({ ctx, input }) => chatOf(ctx.deps).deleteRecent(ctx.user, input)),
    }),
    // `cursor` is the useInfiniteQuery input name; the service calls it `before`.
    canvas: router({
      inspect: adminProcedure.input(z.object({ cell })).query(async ({ ctx, input }) => {
        const result = await ctx.deps.admin.inspect(input.cell.x, input.cell.y);
        if (!result) throw new TRPCError({ code: "NOT_FOUND" });
        return result;
      }),
      areaOwners: adminProcedure.input(z.object({ area: rect })).query(({ ctx, input }) => ctx.deps.admin.areaOwners(input.area)),
    }),
    moderation: router({
      preview: adminProcedure.input(z.object({ action: moderationAction })).query(({ ctx, input }) => ctx.deps.admin.previewModeration(input.action)),
      // Not `apply`: tRPC reserves that name on routers.
      execute: adminProcedure
        .input(z.object({ action: moderationAction }))
        .mutation(({ ctx, input }) => ctx.deps.admin.applyModeration(ctx.user, input.action)),
    }),
    modLog: adminProcedure
      .input(
        z.object({
          action: z.enum(MOD_ACTIONS).optional(),
          targetUserId: userId.optional(),
          cursor: z.number().int().positive().nullish(),
        }),
      )
      .query(({ ctx, input }) =>
        ctx.deps.admin.modLog({
          ...(input.action !== undefined ? { action: input.action } : {}),
          ...(input.targetUserId !== undefined ? { targetUserId: input.targetUserId } : {}),
          ...(input.cursor != null ? { before: input.cursor } : {}),
        }),
      ),
    config: router({
      current: adminProcedure.query(({ ctx }) => ctx.deps.admin.currentConfig()),
      history: adminProcedure.query(({ ctx }) => ctx.deps.admin.history()),
      get: adminProcedure.input(z.object({ version: z.number().int().positive() })).query(({ ctx, input }) => ctx.deps.admin.configVersion(input.version)),
      save: adminProcedure
        .input(z.object({ baseVersion: z.number().int().positive(), config: z.unknown(), comment: note }))
        .mutation(({ ctx, input }) => ctx.deps.admin.saveConfig(ctx.user, input)),
      rollback: adminProcedure
        .input(z.object({ version: z.number().int().positive(), baseVersion: z.number().int().positive(), comment: note }))
        .mutation(({ ctx, input }) => ctx.deps.admin.rollbackConfig(ctx.user, input)),
    }),
  }),

  shop: router({
    buyItem: playerProcedure.input(z.object({ item: itemKeySchema })).mutation(({ ctx, input }) =>
      tracked(
        ctx.deps,
        "buy",
        ctx.deps.runtime.run((engine, now) => engine.buyItem(ctx.user.id, input.item, now)),
      ),
    ),
    buyChargeBoost: playerProcedure.mutation(({ ctx }) =>
      tracked(
        ctx.deps,
        "buy",
        ctx.deps.runtime.run((engine, now) => engine.buyChargeBoost(ctx.user.id, now)),
      ),
    ),
    buyColor: playerProcedure.input(z.object({ colorId: z.number().int().min(0).max(255) })).mutation(({ ctx, input }) =>
      tracked(
        ctx.deps,
        "buy",
        ctx.deps.runtime.run((engine, now) => engine.buyColor(ctx.user.id, input.colorId, now)),
      ),
    ),
  }),

  daily: router({
    claim: playerProcedure.mutation(({ ctx }) =>
      tracked(
        ctx.deps,
        "daily",
        ctx.deps.runtime.run((engine, now) => engine.claimDaily(ctx.user.id, now)),
      ),
    ),
  }),

  tools: router({
    detect: playerProcedure.input(cell).mutation(({ ctx, input }) =>
      tracked(
        ctx.deps,
        "detect",
        ctx.deps.runtime.run((engine, now) => engine.detect(ctx.user.id, input, now)),
      ),
    ),
    defuse: playerProcedure.input(cell).mutation(({ ctx, input }) =>
      tracked(
        ctx.deps,
        "defuse",
        ctx.deps.runtime.run((engine, now) => engine.defuse(ctx.user.id, input, now)),
      ),
    ),
  }),

  stats: router({
    leaderboard: publicProcedure.input(z.object({ board: z.enum(BOARDS), period: z.enum(PERIODS) })).query(async ({ ctx, input }) => {
      const ranking = await ctx.deps.stats.leaderboards.ranking(input.board, input.period);
      const mine = ctx.user ? ranking.find((r) => r.userId === ctx.user!.id) : undefined;
      return {
        top: ranking.slice(0, TOP).map((r) => ({ rank: r.rank, user: ctx.deps.users.ref(r.userId), value: r.value })),
        me: mine ? { rank: mine.rank, value: mine.value } : null,
      };
    }),
    profile: publicProcedure.input(z.object({ userId: z.number().int().positive().max(2_147_483_647) })).query(async ({ ctx, input }) => {
      const profile = await ctx.deps.stats.profiles.profile(input.userId);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND" });
      return profile;
    }),
  }),
});

export type AppRouter = typeof appRouter;
