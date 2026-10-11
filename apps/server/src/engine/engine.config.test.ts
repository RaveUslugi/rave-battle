import { describe, expect, test } from "bun:test";
import { eventsOf, makeEngine, T0 } from "./test-utils";

const admin = 99;
const change = (baseVersion: number, comment = "c") => ({ baseVersion, adminId: admin, comment, action: "config_save" as const });
const pl = (x: number, y: number) => ({ x, y, colorId: 3, withBomb: false });

describe("applyConfig", () => {
  test("applies a new config, bumps the version and emits events", () => {
    const { engine, cfg } = makeEngine();
    engine.drainEvents();
    const next = structuredClone(cfg);
    next.coinsPerPixel = 5;
    expect(engine.applyConfig(next, change(1, "tweak"), T0)).toEqual({ ok: true, version: 2 });
    expect(engine.config).toBe(next);
    expect(engine.configVersion).toBe(2);
    const events = engine.drainEvents();
    expect(eventsOf(events, "config_changed")).toEqual([
      { type: "config_changed", version: 2, config: next, createdBy: admin, comment: "tweak", at: T0 },
    ]);
    expect(eventsOf(events, "mod_log")).toEqual([
      { type: "mod_log", adminId: admin, action: "config_save", targetUserId: null, params: { version: 2, comment: "tweak" }, at: T0 },
    ]);
  });

  test("a stale base version is rejected without side effects", () => {
    const { engine, cfg } = makeEngine();
    engine.drainEvents();
    const next = structuredClone(cfg);
    expect(engine.applyConfig(next, change(0), T0)).toEqual({ ok: false, code: "stale", currentVersion: 1 });
    expect(engine.config).toBe(cfg);
    expect(engine.configVersion).toBe(1);
    expect(engine.drainEvents()).toEqual([]);
  });

  test("the canvas can grow and the new area is playable", () => {
    const { engine, canvas, cfg, addPlayer } = makeEngine();
    addPlayer(1);
    const next = structuredClone(cfg);
    next.canvas.width = 768;
    expect(engine.applyConfig(next, change(1), T0).ok).toBe(true);
    expect(canvas.width).toBe(768);
    expect(engine.placePixel(1, pl(600, 5), T0).ok).toBe(true);
    expect(eventsOf(engine.drainEvents(), "config_changed")).toHaveLength(1);
  });

  test("shrinking the canvas is invalid", () => {
    const { engine, cfg } = makeEngine();
    engine.drainEvents();
    const next = structuredClone(cfg);
    next.canvas.width = 256;
    const res = engine.applyConfig(next, change(1), T0);
    expect(res).toMatchObject({ ok: false, code: "invalid" });
    expect(engine.configVersion).toBe(1);
    expect(engine.drainEvents()).toEqual([]);
  });

  test("the new limits apply to existing players", () => {
    const { engine, cfg, addPlayer } = makeEngine();
    const p = addPlayer(1);
    expect(p.charges).toBe(10);
    const next = structuredClone(cfg);
    next.charges.max = 3;
    engine.applyConfig(next, change(1), T0);
    expect(engine.placePixel(1, pl(1, 1), T0).ok).toBe(true);
    expect(p.charges).toBe(2);
  });

  test("a rollback records the source version", () => {
    const { engine, cfg } = makeEngine();
    engine.drainEvents();
    engine.applyConfig(structuredClone(cfg), { ...change(1, "back"), action: "config_rollback", fromVersion: 1 }, T0);
    const [log] = eventsOf(engine.drainEvents(), "mod_log");
    expect(log).toMatchObject({ action: "config_rollback", params: { version: 2, comment: "back", fromVersion: 1 } });
  });
});
