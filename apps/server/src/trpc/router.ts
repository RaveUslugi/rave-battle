import { itemKeySchema } from "@rave/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isAdmin } from "../auth/admin";
import { MOD_ACTIONS } from "../engine/types";
import { toPlayerView } from "../net/views";
import { BOARDS, PERIODS } from "../stats/leaderboards";
import { adminProcedure, playerProcedure, publicProcedure, router } from "./init";

const TOP = 50;

const userId = z.number().int().positive().max(2_147_483_647);
const note = z.string().trim().min(1).max(200);
const delta = z.number().int().min(-1_000_000).max(1_000_000).optional();

const cell = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() });

/**
 * Everything except pixels (those go over the WebSocket). Mutations run through the runtime, so
 * player updates and feed entries reach WebSocket clients via the commit hook.
 */
export const appRouter = router({
  me: publicProcedure.query(({ ctx }) => {
    if (!ctx.user) return null;
    const engine = ctx.deps.runtime.engine;
    const player = engine.players.has(ctx.user.id)
      ? toPlayerView(engine.players.get(ctx.user.id), engine.config, Date.now(), engine.isUnlimited(ctx.user.id))
      : null;
    return { user: ctx.deps.users.ref(ctx.user.id), player };
  }),

  admin: router({
    whoami: publicProcedure.query(({ ctx }) => ({ admin: ctx.user !== null && isAdmin(ctx.user.discordId, ctx.deps.config) })),
    players: router({
      search: adminProcedure.input(z.object({ q: z.string().trim().min(1).max(64) })).query(({ ctx, input }) => ctx.deps.admin.search(input.q)),
      get: adminProcedure.input(z.object({ userId })).query(async ({ ctx, input }) => {
        const player = await ctx.deps.admin.player(input.userId);
        if (!player) throw new TRPCError({ code: "NOT_FOUND" });
        return player;
      }),
      ban: adminProcedure
        .input(z.object({ userId, until: z.union([z.number().int().positive(), z.literal("permanent")]), reason: note }))
        .mutation(({ ctx, input }) => ctx.deps.admin.ban(ctx.user, input)),
      unban: adminProcedure.input(z.object({ userId, reason: note })).mutation(({ ctx, input }) => ctx.deps.admin.unban(ctx.user, input)),
      adjust: adminProcedure
        .input(z.object({ userId, changes: z.object({ coins: delta, bomb: delta, detector: delta, defuser: delta }), comment: note }))
        .mutation(({ ctx, input }) => ctx.deps.admin.adjust(ctx.user, input)),
    }),
    // `cursor` is the useInfiniteQuery input name; the service calls it `before`.
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
    buyItem: playerProcedure
      .input(z.object({ item: itemKeySchema }))
      .mutation(({ ctx, input }) => ctx.deps.runtime.run((engine, now) => engine.buyItem(ctx.user.id, input.item, now))),
    buyChargeBoost: playerProcedure.mutation(({ ctx }) =>
      ctx.deps.runtime.run((engine, now) => engine.buyChargeBoost(ctx.user.id, now)),
    ),
    buyColor: playerProcedure
      .input(z.object({ colorId: z.number().int().min(0).max(255) }))
      .mutation(({ ctx, input }) => ctx.deps.runtime.run((engine, now) => engine.buyColor(ctx.user.id, input.colorId, now))),
  }),

  daily: router({
    claim: playerProcedure.mutation(({ ctx }) => ctx.deps.runtime.run((engine, now) => engine.claimDaily(ctx.user.id, now))),
  }),

  tools: router({
    detect: playerProcedure
      .input(cell)
      .mutation(({ ctx, input }) => ctx.deps.runtime.run((engine, now) => engine.detect(ctx.user.id, input, now))),
    defuse: playerProcedure
      .input(cell)
      .mutation(({ ctx, input }) => ctx.deps.runtime.run((engine, now) => engine.defuse(ctx.user.id, input, now))),
  }),

  stats: router({
    leaderboard: publicProcedure
      .input(z.object({ board: z.enum(BOARDS), period: z.enum(PERIODS) }))
      .query(async ({ ctx, input }) => {
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
