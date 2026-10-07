import postgres from "postgres";

/** Arbitrary constant shared by all server instances ("RAVE"). */
export const WRITER_LOCK_KEY = 0x52415645;

export interface WriterLockOptions {
  /** Called once if the lock is found to be lost (connection recycled/dropped/terminated). */
  onLost: () => void;
  /** How often to verify the lock. Default 10 000 ms. */
  heartbeatMs?: number;
}

/**
 * The game state assumes a single writer. Holds a session-level advisory lock on a dedicated
 * connection for the process lifetime; a second instance fails to start. A heartbeat verifies the
 * lock is still held by this connection and calls `onLost` once if it is not.
 */
export async function acquireWriterLock(url: string, options: WriterLockOptions): Promise<{ release: () => Promise<void> }> {
  // max_lifetime: null disables postgres.js connection recycling, which would silently drop the lock.
  const sql = postgres(url, { max: 1, onnotice: () => {}, max_lifetime: null });
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stopHeartbeat = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };

  try {
    const [row] = await sql<Array<{ locked: boolean }>>`select pg_try_advisory_lock(${WRITER_LOCK_KEY}) as locked`;
    if (!row?.locked) {
      await sql.end();
      throw new Error("Another server instance is already running against this database");
    }
  } catch (error) {
    await sql.end().catch(() => {});
    throw error;
  }

  let checking = false;
  heartbeat = setInterval(() => {
    if (checking) return;
    checking = true;
    void (async () => {
      let held = false;
      try {
        const [row] = await sql<Array<{ held: boolean }>>`
          select exists(
            select 1 from pg_locks
            where locktype = 'advisory' and classid = 0 and objid::bigint = ${WRITER_LOCK_KEY}
              and objsubid = 1 and pid = pg_backend_pid() and granted
          ) as held`;
        held = row?.held === true;
      } catch {
        held = false;
      }
      checking = false;
      if (!held && heartbeat) {
        stopHeartbeat();
        options.onLost();
      }
    })();
  }, options.heartbeatMs ?? 10_000);
  heartbeat.unref();

  return {
    release: async () => {
      stopHeartbeat();
      try {
        await sql`select pg_advisory_unlock(${WRITER_LOCK_KEY})`;
      } finally {
        await sql.end();
      }
    },
  };
}
