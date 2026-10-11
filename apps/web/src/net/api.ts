import type { ItemKey, Reward } from "@rave/shared/client";
import { TRPCClientError } from "@trpc/client";
import type { ToolsApi } from "../game/tools";
import { trpcClient as trpc } from "./trpc";

/** Turns transport and tRPC errors into the same `{ ok: false, code }` shape the engine uses. */
export async function call<T>(run: () => Promise<T>): Promise<T | { ok: false; code: string }> {
  try {
    return await run();
  } catch (error) {
    const code = error instanceof TRPCClientError ? (error.data as { code?: string } | undefined)?.code : undefined;
    if (code === "TOO_MANY_REQUESTS") return { ok: false, code: "rate_limited" };
    if (code === "UNAUTHORIZED") return { ok: false, code: "unauthorized" };
    return { ok: false, code: "unavailable" };
  }
}

export const toolsApi: ToolsApi = {
  detect: (cell) => call(() => trpc.tools.detect.mutate(cell)),
  defuse: (cell) => call(() => trpc.tools.defuse.mutate(cell)),
};

export type BuyAnswer = { ok: true } | { ok: false; code: string };
export type ClaimAnswer = { ok: true; reward: Reward } | { ok: false; code: string };

/** Never throw: transport failures come back as `{ ok: false, code }` like engine rejects. */
export const shopApi = {
  buyItem: (item: ItemKey): Promise<BuyAnswer> => call(() => trpc.shop.buyItem.mutate({ item })),
  buyChargeBoost: (): Promise<BuyAnswer> => call(() => trpc.shop.buyChargeBoost.mutate()),
  buyColor: (colorId: number): Promise<BuyAnswer> => call(() => trpc.shop.buyColor.mutate({ colorId })),
};

export const dailyApi = {
  claim: (): Promise<ClaimAnswer> => call(() => trpc.daily.claim.mutate()),
};
