import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "../../../server/src/trpc/router";
import type { ToolsApi } from "../game/tools";

const trpc = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: "/trpc" })] });

/** Turns transport and tRPC errors into the same `{ ok: false, code }` shape the engine uses. */
async function call<T>(run: () => Promise<T>): Promise<T | { ok: false; code: string }> {
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
