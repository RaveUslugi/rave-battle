import { initTRPC, TRPCError } from "@trpc/server";
import type { SessionUser } from "../auth/session";
import type { AppDeps } from "../net/deps";
import type { UserRateLimiter } from "../net/rate-limit";

export interface TrpcContext {
  deps: AppDeps;
  user: SessionUser | null;
  limiter: UserRateLimiter;
}

const t = initTRPC.context<TrpcContext>().create({ isDev: process.env.NODE_ENV !== "production" });

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

/** Logged-in, rate-limited, and guaranteed to have a player in the engine. */
export const playerProcedure = t.procedure.use(async ({ ctx, next }) => {
  const user = ctx.user;
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (!ctx.limiter.take(user.id)) throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
  await ctx.deps.runtime.addPlayer({
    userId: user.id,
    accountCreatedAt: user.discordCreatedAt,
    guildMember: user.guildMember,
    bannedUntil: user.bannedUntil,
  });
  return next({ ctx: { ...ctx, user } });
});
