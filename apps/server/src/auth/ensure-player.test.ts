import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { AccessQueue } from "../admin/access-queue";
import { users } from "../db/schema";
import { createTestDb, insertUser } from "../db/test-db";
import { bootGame } from "../persistence/boot";
import type { GameRuntime } from "../persistence/runtime";
import { createSession, resolveSession } from "./session";
import { ensurePlayer } from "./ensure-player";

const t = createTestDb();
let runtime: GameRuntime;

beforeEach(async () => {
  await t.reset();
  runtime = await bootGame(t.db, { flushIntervalMs: 0, onFatal: () => {} });
});
afterEach(() => runtime.stop());
afterAll(() => t.close());

test("a ban committed between resolveSession and ensurePlayer is applied", async () => {
  const id = await insertUser(t.db, "racer");
  const { token } = await createSession(t.db, id, 86_400_000, Date.now());
  const session = (await resolveSession(t.db, token, Date.now()))!;
  expect(session.bannedUntil).toBeNull();
  // The ban lands in the DB after the session was resolved; the player is not in the engine yet.
  await t.db.update(users).set({ bannedUntil: new Date(Date.now() + 3_600_000), banReason: "raced" }).where(eq(users.id, id));
  await ensurePlayer({ db: t.db, runtime, accessQueue: new AccessQueue() }, session);
  const player = runtime.engine.players.get(id);
  expect(player.banReason).toBe("raced");
  expect(player.bannedUntil).toBeGreaterThan(Date.now());
  const res = await runtime.run((e, now) => e.placePixel(id, { x: 1, y: 1, colorId: 3, withBomb: false }, now));
  expect(res).toEqual({ ok: false, code: "banned" });
});

test("an unchanged row leaves the player as created", async () => {
  const id = await insertUser(t.db, "calm");
  const { token } = await createSession(t.db, id, 86_400_000, Date.now());
  const session = (await resolveSession(t.db, token, Date.now()))!;
  await ensurePlayer({ db: t.db, runtime, accessQueue: new AccessQueue() }, session);
  expect(runtime.engine.players.get(id).bannedUntil).toBeNull();
});

test("a second concurrent first join returns only after the re-read was applied", async () => {
  for (let i = 0; i < 10; i++) {
    const id = await insertUser(t.db, `twin${i}`);
    const { token } = await createSession(t.db, id, 86_400_000, Date.now());
    const session = (await resolveSession(t.db, token, Date.now()))!;
    await t.db.update(users).set({ bannedUntil: new Date(Date.now() + 3_600_000), banReason: "raced" }).where(eq(users.id, id));
    const queue = new AccessQueue();
    const first = ensurePlayer({ db: t.db, runtime, accessQueue: queue }, session);
    // Take the batch now: the player is no longer "pending", so a second addPlayer resolves without waiting for the commit.
    void runtime.flush();
    for (let k = 0; k < 3; k++) await Promise.resolve();
    const second = ensurePlayer({ db: t.db, runtime, accessQueue: queue }, session).then(() => runtime.engine.players.get(id).banReason);
    expect(await second).toBe("raced");
    await first;
  }
});
