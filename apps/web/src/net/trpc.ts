import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "../../../server/src/trpc/router";

// The server rejects batches over 10 calls (`maxBatchSize`).
export const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: "/trpc", maxItems: 10 })] });

export const queryClient = new QueryClient({
  // Game state arrives over the WebSocket; queries here are slow-changing stats.
  // One retry for network and server failures; a 4xx (not found, rate limit) will not change on retry.
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failures, error) => failures < 1 && !(error instanceof TRPCClientError && (error.data?.httpStatus ?? 500) < 500),
    },
  },
});

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();
