import { expect, test } from "bun:test";
import { TEST_DATABASE_URL } from "./test-db";
import { acquireWriterLock } from "./writer-lock";

test("only one writer can hold the lock at a time", async () => {
  const first = await acquireWriterLock(TEST_DATABASE_URL);
  await expect(acquireWriterLock(TEST_DATABASE_URL)).rejects.toThrow("already running");
  await first.release();
  const again = await acquireWriterLock(TEST_DATABASE_URL);
  await again.release();
});
