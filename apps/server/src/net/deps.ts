import type { AccessQueue } from "../admin/access-queue";
import type { DashboardService } from "../admin/dashboard";
import type { PlayerListService } from "../admin/players";
import type { AdminService } from "../admin/service";
import type { ChatService } from "../chat/service";
import type { FetchFn } from "../auth/discord";
import type { Db } from "../db/client";
import type { GameRuntime } from "../persistence/runtime";
import type { StatsService } from "../stats/service";
import type { ServerConfig } from "./env";
import type { Hub } from "./hub";
import type { Metrics } from "./metrics";
import type { KeyedRateLimiter, UserRateLimiter } from "./rate-limit";
import type { UserDirectory } from "./user-directory";

export interface AppDeps {
  db: Db;
  runtime: GameRuntime;
  hub: Hub;
  users: UserDirectory;
  config: ServerConfig;
  stats: StatsService;
  admin: AdminService;
  /** One chain per user for everything touching access: ban, unban, first join. */
  accessQueue: AccessQueue;
  /** Admin dashboard and player table; their procedures answer PRECONDITION_FAILED without them. */
  dashboard?: DashboardService;
  playerList?: PlayerListService;
  /** Text chat; chat procedures answer PRECONDITION_FAILED without it. */
  chat?: ChatService;
  /** Served at GET /metrics when present. */
  metrics?: Metrics;
  /** Outbound HTTP (Discord); injectable for tests. Defaults to global fetch. */
  fetch?: FetchFn;
  /** Per-user rate limit for tRPC; the server creates one when absent. */
  limiter?: UserRateLimiter;
  /** Per-IP rate limit for all /trpc requests; the server creates one when absent. */
  ipLimiter?: KeyedRateLimiter<string>;
  /** Per-IP rate limit for GET /chunk/* and /overview; the server creates one when absent. */
  staticLimiter?: KeyedRateLimiter<string>;
}
