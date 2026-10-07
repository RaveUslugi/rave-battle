import { itemKeySchema } from "@rave/shared";
import { z } from "zod";
import { toPlayerView } from "../net/views";
import { playerProcedure, publicProcedure, router } from "./init";

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
      ? toPlayerView(engine.players.get(ctx.user.id), engine.config, Date.now())
      : null;
    return { user: ctx.deps.users.ref(ctx.user.id), player };
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
});

export type AppRouter = typeof appRouter;
