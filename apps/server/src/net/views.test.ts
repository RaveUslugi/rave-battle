import { describe, expect, test } from "bun:test";
import { makeEngine, T0 } from "../engine/test-utils";
import type { EngineEvent } from "../engine/types";
import { UserDirectory } from "./user-directory";
import { buildChunkDeltas, buildFeed, ChunkVersions, toPlaceResultView, toPlayerView } from "./views";

const directory = () => {
  const users = new UserDirectory();
  users.set(1, "alice");
  users.set(2, "bob");
  return users;
};

describe("toPlayerView", () => {
  test("settles charges on a copy and never mutates the engine state", () => {
    const { cfg, addPlayer } = makeEngine();
    const p = addPlayer(1);
    p.charges = 0;
    p.chargesUpdatedAt = T0;
    const view = toPlayerView(p, cfg, T0 + 65_000, false);
    expect(view.unlimited).toBe(false);
    expect(view.charges).toBe(2);
    expect(view.chargeCap).toBe(10);
    expect(p.charges).toBe(0);
    expect(p.chargesUpdatedAt).toBe(T0);
  });

  test("maps a permanent ban and sorts unlocked colors", () => {
    const { cfg, addPlayer } = makeEngine();
    const p = addPlayer(1);
    p.bannedUntil = Number.POSITIVE_INFINITY;
    p.unlockedColors = new Set([40, 33]);
    const view = toPlayerView(p, cfg, T0, false);
    expect(view.bannedUntil).toBe("permanent");
    expect(view.unlockedColors).toEqual([33, 40]);
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });

  test("passes the unlimited flag through", () => {
    const { cfg, addPlayer } = makeEngine();
    expect(toPlayerView(addPlayer(1), cfg, T0, true).unlimited).toBe(true);
  });
});

describe("toPlaceResultView", () => {
  test("replaces the bomb owner id with a user ref", () => {
    const view = toPlaceResultView(
      { ok: true, outcome: "exploded", self: false, frozenUntil: T0, coinsLost: 10, bombOwnerId: 1 },
      directory(),
    );
    expect(view).toEqual({ ok: true, outcome: "exploded", self: false, frozenUntil: T0, coinsLost: 10, bombOwner: { id: 1, name: "alice" } });
  });
});

describe("buildChunkDeltas", () => {
  const pixel = (x: number, y: number, colorId: number): EngineEvent => ({
    type: "pixel", x, y, userId: 1, colorId, prevColorId: 0, prevUserId: 0, at: T0,
  });

  test("groups pixels by chunk, keeps the last color per cell and bumps versions", () => {
    const versions = new ChunkVersions();
    const deltas = buildChunkDeltas([pixel(1, 1, 3), pixel(1, 1, 4), pixel(300, 2, 5), { type: "player", userId: 1 }], versions);
    expect(deltas).toEqual([
      { cx: 0, cy: 0, fromVersion: 0, toVersion: 1, cells: [{ index: 257, colorId: 4 }] },
      { cx: 1, cy: 0, fromVersion: 0, toVersion: 1, cells: [{ index: 2 * 256 + 44, colorId: 5 }] },
    ]);
    expect(buildChunkDeltas([pixel(2, 1, 6)], versions)[0]).toMatchObject({ fromVersion: 1, toVersion: 2 });
    expect(versions.get(0, 0)).toBe(2);
  });
});

describe("buildFeed", () => {
  test("announces explosions and defuses without coordinates", () => {
    const events: EngineEvent[] = [
      { type: "bomb_removed", x: 5, y: 5, ownerId: 1, reason: "exploded", removedBy: 2, at: T0 },
      { type: "bomb_removed", x: 6, y: 6, ownerId: 2, reason: "defused", removedBy: 1, at: T0 + 1 },
    ];
    const feed = buildFeed(events, directory());
    expect(feed).toEqual([
      { type: "feed", kind: "exploded", actor: { id: 2, name: "bob" }, owner: { id: 1, name: "alice" }, at: T0 },
      { type: "feed", kind: "defused", actor: { id: 1, name: "alice" }, owner: { id: 2, name: "bob" }, at: T0 + 1 },
    ]);
    for (const message of feed) expect(Object.keys(message).sort()).toEqual(["actor", "at", "kind", "owner", "type"]);
  });
});
