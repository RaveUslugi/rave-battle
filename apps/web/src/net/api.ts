import type { ChatSendCode, ItemKey, Locale, Reward } from "@rave/shared/client";
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

export type ChatAnswer =
  | { ok: true; id: number }
  | { ok: false; code: Exclude<ChatSendCode, "muted" | "cooldown"> | "unauthorized" | "rate_limited" | "unavailable" }
  | { ok: false; code: "muted"; until: number | "permanent" }
  | { ok: false; code: "cooldown"; retryAt: number };

export const chatApi = {
  send: (text: string): Promise<ChatAnswer> => call(() => trpc.chat.send.mutate({ text })) as Promise<ChatAnswer>,
  /** Admin only; the server checks the rights. */
  remove: (id: number): Promise<{ ok: boolean }> => call(() => trpc.admin.chat.delete.mutate({ id })),
};

export const settingsApi = {
  setLocale: (locale: Locale | null): Promise<{ ok: boolean }> => call(() => trpc.settings.setLocale.mutate({ locale })),
};
