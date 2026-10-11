import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
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
  await ensurePlayer({ db: t.db, runtime }, session);
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
  await ensurePlayer({ db: t.db, runtime }, session);
  expect(runtime.engine.players.get(id).bannedUntil).toBeNull();
});
