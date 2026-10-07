import type { FetchFn } from "../auth/discord";
import type { Db } from "../db/client";
import type { GameRuntime } from "../persistence/runtime";
import type { ServerConfig } from "./env";
import type { Hub } from "./hub";
import type { KeyedRateLimiter, UserRateLimiter } from "./rate-limit";
import type { UserDirectory } from "./user-directory";

export interface AppDeps {
  db: Db;
  runtime: GameRuntime;
  hub: Hub;
  users: UserDirectory;
  config: ServerConfig;
  /** Outbound HTTP (Discord); injectable for tests. Defaults to global fetch. */
  fetch?: FetchFn;
  /** Per-user rate limit for tRPC; the server creates one when absent. */
  limiter?: UserRateLimiter;
  /** Per-IP rate limit for all /trpc requests; the server creates one when absent. */
  ipLimiter?: KeyedRateLimiter<string>;
}
