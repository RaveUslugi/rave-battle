import type { Db } from "../db/client";
import type { UserDirectory } from "../net/user-directory";
import type { GameRuntime } from "../persistence/runtime";
import { Leaderboards } from "./leaderboards";
import { Profiles } from "./profiles";

/** Read-only statistics for the meta UI. */
export class StatsService {
  readonly leaderboards: Leaderboards;
  readonly profiles: Profiles;

  constructor(db: Db, runtime: GameRuntime, users: UserDirectory, now: () => number = Date.now) {
    this.leaderboards = new Leaderboards(db, runtime, now);
    this.profiles = new Profiles(db, runtime, users, now);
  }
}
