import { AccessQueue } from "./admin/access-queue";
import { DashboardService } from "./admin/dashboard";
import { PlayerListService } from "./admin/players";
import { AdminService } from "./admin/service";
import { isAdmin } from "./auth/admin";
import { ensurePlayer } from "./auth/ensure-player";
import { restoreDevAdmin } from "./auth/dev-admin";
import { deleteExpiredSessions } from "./auth/session";
import { ChatService } from "./chat/service";
import { loadTimeline } from "./chat/timeline";
import { createDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { acquireWriterLock } from "./db/writer-lock";
import { loadEnv } from "./net/env";
import { Hub } from "./net/hub";
import { Metrics } from "./net/metrics";
import { startServer } from "./net/server";
import { UserDirectory } from "./net/user-directory";
import { bootGame } from "./persistence/boot";
import { HourlyStats } from "./stats/hourly";
import { StatsService } from "./stats/service";

async function main(): Promise<void> {
  const config = loadEnv();
  const lock = await acquireWriterLock(config.databaseUrl, {
    onLost: () => {
      console.error("Fatal: lost the single-writer lock");
      process.exit(1);
    },
  });
  const { db, close } = createDb(config.databaseUrl);
  await runMigrations(db);
  const purgeSessions = () => deleteExpiredSessions(db, Date.now()).catch((error) => console.error("Session cleanup failed", error));
  await purgeSessions();
  setInterval(purgeSessions, 60 * 60 * 1000).unref();

  const users = await UserDirectory.load(db);
  let hub: Hub | undefined;
  const metrics = new Metrics();
  let hourly: HourlyStats | undefined;
  const runtime = await bootGame(db, {
    onCommit: (events) => {
      hub?.handleCommit(events);
      hourly?.record(events);
    },
    onCommitTiming: (ms, events) => {
      metrics.commitMs.observe(ms);
      metrics.commitEvents.observe(events);
    },
  });
  if (config.devLogin) await restoreDevAdmin(db, runtime.engine);
  const hourlyStats = new HourlyStats(db, runtime.season);
  hourly = hourlyStats;
  const accessQueue = new AccessQueue();
  let chat: ChatService | undefined;
  hub = new Hub({
    runtime,
    users,
    isAdmin: (u) => isAdmin(u.discordId, config),
    ensurePlayer: (u) => ensurePlayer({ db, runtime, accessQueue }, u),
    metrics,
    chatMute: (userId) => chat?.muteOf(userId) ?? null,
    onOnline: (count) => hourlyStats.observeOnline(count),
  });
  const flushHourly = () => {
    hourlyStats.observeOnline(hub.onlineCount());
    return hourlyStats.flush().catch((error) => console.error("Hourly stats flush failed", error));
  };
  setInterval(flushHourly, 60_000).unref();
  const chatService = await ChatService.load({ db, runtime, hub, users, metrics, isAdmin: (id) => isAdmin(id, config) });
  chat = chatService;
  hub.seedTimeline(await loadTimeline(db, runtime.season, users, runtime.engine.config.chat.historySize));
  const purgeChat = () => chatService.purge().catch((error) => console.error("Chat cleanup failed", error));
  await purgeChat();
  setInterval(purgeChat, 60 * 60 * 1000).unref();
  const stats = new StatsService(db, runtime, users);
  const admin = new AdminService({ db, runtime, users, stats, accessQueue, isAdmin: (id) => isAdmin(id, config) });
  const dashboard = new DashboardService({
    db,
    runtime,
    users,
    hourly: hourlyStats,
    metrics,
    onlineCount: () => hub.onlineCount(),
    recentModeration: async (limit) => (await admin.modLog({}, limit)).entries,
  });
  const playerList = new PlayerListService({ db, runtime, onlineUserIds: () => hub.onlineUserIds() });
  const server = startServer({ db, runtime, hub, users, config, stats, admin, accessQueue, metrics, chat: chatService, dashboard, playerList });
  console.log(`Rave Battle server listening on :${server.port}`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      console.error(`${signal}: already shutting down, exiting immediately`);
      process.exit(1);
    }
    shuttingDown = true;
    setTimeout(() => {
      console.error("Shutdown timed out");
      process.exit(1);
    }, 10_000).unref();
    console.log(`${signal}: shutting down`);
    // Stop accepting commands and persist everything before closing connections.
    await runtime.stop().catch((error) => console.error("Final commit failed", error));
    await flushHourly();
    hub.closeAll(1012, "server restart");
    hub.stop();
    // Bun 1.3.6: server.stop() never resolves once the server itself closed a websocket — don't wait forever.
    await Promise.race([server.stop(true), Bun.sleep(2000)]);
    await close();
    await lock.release().catch((error) => console.error("Lock release failed", error));
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
