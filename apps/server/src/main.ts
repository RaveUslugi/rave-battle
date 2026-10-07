import { createDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { acquireWriterLock } from "./db/writer-lock";
import { loadEnv } from "./net/env";
import { Hub } from "./net/hub";
import { startServer } from "./net/server";
import { UserDirectory } from "./net/user-directory";
import { bootGame } from "./persistence/boot";

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

  const users = await UserDirectory.load(db);
  let hub: Hub | undefined;
  const runtime = await bootGame(db, { onCommit: (events) => hub?.handleCommit(events) });
  hub = new Hub({ runtime, users });
  const server = startServer({ db, runtime, hub, users, config });
  console.log(`Rave Battle server listening on :${server.port}`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal}: shutting down`);
    // Stop accepting commands and persist everything before closing connections.
    await runtime.stop().catch((error) => console.error("Final commit failed", error));
    hub?.stop();
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
