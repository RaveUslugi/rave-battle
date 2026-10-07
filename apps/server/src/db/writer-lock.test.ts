import { expect, test } from "bun:test";
import postgres from "postgres";
import { TEST_DATABASE_URL } from "./test-db";
import { acquireWriterLock, WRITER_LOCK_KEY } from "./writer-lock";

test("only one writer can hold the lock at a time", async () => {
  let lost = 0;
  const onLost = () => lost++;
  const first = await acquireWriterLock(TEST_DATABASE_URL, { onLost });
  await expect(acquireWriterLock(TEST_DATABASE_URL, { onLost })).rejects.toThrow("already running");
  await first.release();
  const again = await acquireWriterLock(TEST_DATABASE_URL, { onLost });
  await again.release();
  expect(lost).toBe(0);
});

test("losing the connection triggers onLost", async () => {
  let lost = 0;
  const lock = await acquireWriterLock(TEST_DATABASE_URL, { onLost: () => lost++, heartbeatMs: 50 });
  const admin = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const holders = await admin<Array<{ pid: number }>>`
      select pid from pg_locks where locktype = 'advisory' and objid::bigint = ${WRITER_LOCK_KEY}`;
    expect(holders).toHaveLength(1);
    await admin`select pg_terminate_backend(${holders[0]!.pid})`;
    const deadline = Date.now() + 2000;
    while (lost === 0 && Date.now() < deadline) await Bun.sleep(25);
    expect(lost).toBe(1);
    await Bun.sleep(200);
    expect(lost).toBe(1);
  } finally {
    await admin.end();
    await lock.release().catch(() => {});
  }
  const again = await acquireWriterLock(TEST_DATABASE_URL, { onLost: () => {} });
  await again.release();
});
