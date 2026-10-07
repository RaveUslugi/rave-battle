import { describe, expect, test } from "bun:test";
import { eventsOf, makeEngine, T0 } from "./test-utils";

function armed(cells: Array<[number, number, number]>) {
  const ctx = makeEngine();
  for (const [x, y, ownerId] of cells) ctx.bombs.add({ x, y, ownerId, createdAt: T0 });
  return ctx;
}

describe("detect", () => {
  test("returns the number of bombs in the 3x3 square and spends one use", () => {
    const { engine, addPlayer } = armed([[4, 4, 9], [5, 6, 9], [6, 6, 9], [8, 8, 9]]);
    const a = addPlayer(1);
    expect(engine.detect(1, { x: 5, y: 5 }, T0)).toEqual({ ok: true, count: 3 });
    expect(a.inventory.detector).toBe(4);
    expect(eventsOf(engine.drainEvents(), "ledger")).toEqual([
      { type: "ledger", userId: 1, item: "detector", delta: -1, balanceAfter: 4, reason: "use", ref: {}, at: T0 },
    ]);
  });

  test("works at the canvas corner", () => {
    const { engine, addPlayer } = armed([[0, 0, 9], [1, 1, 9]]);
    addPlayer(1);
    expect(engine.detect(1, { x: 0, y: 0 }, T0)).toEqual({ ok: true, count: 2 });
  });

  test("rejects without uses, out of bounds and while frozen", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    expect(engine.detect(1, { x: -1, y: 0 }, T0)).toEqual({ ok: false, code: "out_of_bounds" });
    a.frozenUntil = T0 + 1;
    expect(engine.detect(1, { x: 0, y: 0 }, T0)).toEqual({ ok: false, code: "frozen" });
    a.frozenUntil = 0;
    a.inventory.detector = 0;
    expect(engine.detect(1, { x: 0, y: 0 }, T0)).toEqual({ ok: false, code: "no_detector" });
    expect(engine.drainEvents()).toEqual([]);
  });
});

describe("defuse", () => {
  test("removes someone else's bomb and pays the reward", () => {
    const { engine, bombs, addPlayer } = armed([[5, 5, 9]]);
    addPlayer(9);
    const a = addPlayer(1);
    a.inventory.defuser = 2;
    expect(engine.defuse(1, { x: 5, y: 5 }, T0)).toEqual({ ok: true, found: true, reward: 20 });
    expect(bombs.get(5, 5)).toBeUndefined();
    expect(a.inventory.defuser).toBe(1);
    expect(a.coins).toBe(120);

    const events = engine.drainEvents();
    expect(eventsOf(events, "bomb_removed")).toEqual([
      { type: "bomb_removed", x: 5, y: 5, ownerId: 9, reason: "defused", removedBy: 1, at: T0 },
    ]);
    expect(eventsOf(events, "stat").map((e) => [e.userId, e.stat])).toEqual([[1, "defused"]]);
    expect(eventsOf(events, "ledger").map((e) => [e.item, e.delta, e.reason])).toEqual([
      ["defuser", -1, "use"],
      ["coins", 20, "defuse"],
    ]);
  });

  test("defusing your own bomb gives nothing", () => {
    const { engine, bombs, addPlayer } = armed([[5, 5, 1]]);
    const a = addPlayer(1);
    a.inventory.defuser = 1;
    expect(engine.defuse(1, { x: 5, y: 5 }, T0)).toEqual({ ok: true, found: true, reward: 0 });
    expect(bombs.get(5, 5)).toBeUndefined();
    expect(a.coins).toBe(100);
    expect(eventsOf(engine.drainEvents(), "stat")).toEqual([]);
  });

  test("an empty cell still burns the use", () => {
    const { engine, addPlayer } = makeEngine();
    const a = addPlayer(1);
    a.inventory.defuser = 1;
    expect(engine.defuse(1, { x: 5, y: 5 }, T0)).toEqual({ ok: true, found: false, reward: 0 });
    expect(a.inventory.defuser).toBe(0);
  });

  test("rejects without uses", () => {
    const { engine, addPlayer } = makeEngine();
    addPlayer(1);
    expect(engine.defuse(1, { x: 5, y: 5 }, T0)).toEqual({ ok: false, code: "no_defuser" });
  });
});
