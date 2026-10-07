import { describe, expect, test } from "bun:test";
import type { ChunkDelta } from "@rave/shared";
import { ChunkSync } from "./chunk-sync";

const delta = (fromVersion: number, toVersion: number, cells = [{ index: 1, colorId: 5 }]): ChunkDelta => ({
  cx: 0,
  cy: 0,
  fromVersion,
  toVersion,
  cells,
});
const colors = new Uint8Array(4);

function readyAt(version: number) {
  const sync = new ChunkSync();
  sync.track(0, 0);
  sync.onLoaded(0, 0, 1, version, colors);
  return sync;
}

describe("ChunkSync", () => {
  test("tracking a chunk requests one load", () => {
    const sync = new ChunkSync();
    expect(sync.track(0, 0)).toEqual([{ type: "load", cx: 0, cy: 0, requestId: 1 }]);
    expect(sync.track(0, 0)).toEqual([]);
  });

  test("a loaded chunk is replaced and then follows deltas", () => {
    const sync = new ChunkSync();
    sync.track(0, 0);
    expect(sync.onLoaded(0, 0, 1, 3, colors)).toEqual([{ type: "replace", cx: 0, cy: 0, colors }]);
    expect(sync.onDelta(delta(3, 4))).toEqual([{ type: "apply", cx: 0, cy: 0, cells: [{ index: 1, colorId: 5 }] }]);
  });

  test("deltas buffered while loading are replayed or dropped by version", () => {
    const sync = new ChunkSync();
    sync.track(0, 0);
    sync.onDelta(delta(2, 3));
    sync.onDelta(delta(3, 4, [{ index: 2, colorId: 6 }]));
    expect(sync.onLoaded(0, 0, 1, 3, colors)).toEqual([
      { type: "replace", cx: 0, cy: 0, colors },
      { type: "apply", cx: 0, cy: 0, cells: [{ index: 2, colorId: 6 }] },
    ]);
    expect(sync.onDelta(delta(4, 5))).toHaveLength(1);
  });

  test("a gap in the buffered deltas triggers a reload", () => {
    const sync = new ChunkSync();
    sync.track(0, 0);
    sync.onDelta(delta(5, 6));
    expect(sync.onLoaded(0, 0, 1, 3, colors)).toEqual([
      { type: "replace", cx: 0, cy: 0, colors },
      { type: "load", cx: 0, cy: 0, requestId: 2 },
    ]);
  });

  test("stale deltas are dropped; a gap reloads and keeps the delta for replay", () => {
    const sync = readyAt(3);
    expect(sync.onDelta(delta(2, 3))).toEqual([]);
    expect(sync.onDelta(delta(5, 6))).toEqual([{ type: "load", cx: 0, cy: 0, requestId: 2 }]);
    expect(sync.onLoaded(0, 0, 2, 5, colors)).toEqual([
      { type: "replace", cx: 0, cy: 0, colors },
      { type: "apply", cx: 0, cy: 0, cells: [{ index: 1, colorId: 5 }] },
    ]);
  });

  test("an acknowledged version above the local one reloads a ready chunk", () => {
    const sync = readyAt(3);
    expect(sync.onAck(0, 0, 3)).toEqual([]);
    expect(sync.onAck(0, 0, 4)).toEqual([{ type: "load", cx: 0, cy: 0, requestId: 2 }]);
  });

  test("an ack above the loaded version reloads once the body arrives", () => {
    const sync = new ChunkSync();
    sync.track(0, 0);
    expect(sync.onAck(0, 0, 4)).toEqual([]);
    expect(sync.onLoaded(0, 0, 1, 3, colors)).toEqual([
      { type: "replace", cx: 0, cy: 0, colors },
      { type: "load", cx: 0, cy: 0, requestId: 2 },
    ]);
    expect(sync.onLoaded(0, 0, 2, 4, colors)).toEqual([{ type: "replace", cx: 0, cy: 0, colors }]);
    expect(sync.onDelta(delta(4, 5))).toHaveLength(1);
  });

  test("an ack already covered by the loaded body needs no reload", () => {
    const sync = new ChunkSync();
    sync.track(0, 0);
    sync.onAck(0, 0, 4);
    expect(sync.onLoaded(0, 0, 1, 4, colors)).toEqual([{ type: "replace", cx: 0, cy: 0, colors }]);
  });

  test("retry keeps the acknowledged version", () => {
    const sync = new ChunkSync();
    sync.track(0, 0);
    sync.onAck(0, 0, 4);
    sync.retry(0, 0, 1);
    expect(sync.onLoaded(0, 0, 2, 3, colors)).toEqual([
      { type: "replace", cx: 0, cy: 0, colors },
      { type: "load", cx: 0, cy: 0, requestId: 3 },
    ]);
  });

  test("results of superseded loads are ignored", () => {
    const sync = new ChunkSync();
    sync.track(0, 0);
    sync.untrack(0, 0);
    sync.track(0, 0);
    expect(sync.onLoaded(0, 0, 1, 3, colors)).toEqual([]);
    expect(sync.onLoaded(0, 0, 2, 3, colors)).toHaveLength(1);
  });

  test("untracked chunks ignore deltas and acks", () => {
    const sync = readyAt(3);
    sync.untrack(0, 0);
    expect(sync.onDelta(delta(3, 4))).toEqual([]);
    expect(sync.onAck(0, 0, 9)).toEqual([]);
  });

  test("retry reissues only the current failed load; reset forgets everything", () => {
    const sync = new ChunkSync();
    sync.track(0, 0);
    expect(sync.retry(0, 0, 1)).toEqual([{ type: "load", cx: 0, cy: 0, requestId: 2 }]);
    expect(sync.retry(0, 0, 1)).toEqual([]);
    sync.reset();
    expect(sync.onDelta(delta(0, 1))).toEqual([]);
    expect(sync.track(0, 0)).toEqual([{ type: "load", cx: 0, cy: 0, requestId: 3 }]);
  });
});
