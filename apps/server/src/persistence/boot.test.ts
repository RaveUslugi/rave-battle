import { afterAll, beforeEach, expect, test } from "bun:test";
import { createTestDb, insertUser } from "../db/test-db";
import { T0 } from "../engine/test-utils";
import { bootGame } from "./boot";

const t = createTestDb();
beforeEach(() => t.reset());
afterAll(() => t.close());

test("bootGame wires loadGame into a runtime that survives restarts", async () => {
  const a = await insertUser(t.db, "a");
  const options = { now: () => T0, flushIntervalMs: 0, onFatal: () => {} };

  const first = await bootGame(t.db, options);
  await first.addPlayer({ userId: a, accountCreatedAt: Date.UTC(2020, 0, 1), guildMember: true });
  await first.run((engine, now) => engine.placePixel(a, { x: 300, y: 300, colorId: 4, withBomb: false }, now));

  const second = await bootGame(t.db, options);
  expect(second.engine.canvas.get(300, 300)).toEqual({ colorId: 4, ownerId: a });
  await second.stop();
});
