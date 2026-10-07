import postgres from "postgres";

/** Arbitrary constant shared by all server instances ("RAVE"). */
const WRITER_LOCK_KEY = 0x52415645;

/**
 * The game state assumes a single writer. Holds a session-level advisory lock on a dedicated
 * connection for the process lifetime; a second instance fails to start.
 */
export async function acquireWriterLock(url: string): Promise<{ release: () => Promise<void> }> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const [row] = await sql<Array<{ locked: boolean }>>`select pg_try_advisory_lock(${WRITER_LOCK_KEY}) as locked`;
  if (!row?.locked) {
    await sql.end();
    throw new Error("Another server instance is already running against this database");
  }
  return {
    release: async () => {
      await sql`select pg_advisory_unlock(${WRITER_LOCK_KEY})`;
      await sql.end();
    },
  };
}
