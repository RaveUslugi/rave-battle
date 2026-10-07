import { describe, expect, test } from "bun:test";
import { CHUNK_SIZE } from "./constants";
import {
  ClientOp,
  decodeChunkBody,
  decodeChunkDelta,
  decodeClientMessage,
  encodeChunkBody,
  encodeChunkDelta,
  encodePlace,
  encodeSubscribe,
  MAX_SUBSCRIBED_CHUNKS,
} from "./protocol";

describe("client frames", () => {
  test("place round-trips", () => {
    const frame = encodePlace({ reqId: 7, x: 70_000, y: 3, colorId: 31, withBomb: true });
    expect(decodeClientMessage(frame)).toEqual({ op: ClientOp.Place, reqId: 7, x: 70_000, y: 3, colorId: 31, withBomb: true });
  });

  test("subscribe round-trips", () => {
    const frame = encodeSubscribe([{ cx: 0, cy: 1 }, { cx: 2, cy: 3 }]);
    expect(decodeClientMessage(frame)).toEqual({ op: ClientOp.Subscribe, chunks: [{ cx: 0, cy: 1 }, { cx: 2, cy: 3 }] });
  });

  test("decodes frames that are views into a larger buffer", () => {
    const frame = encodePlace({ reqId: 1, x: 2, y: 3, colorId: 4, withBomb: false });
    const padded = new Uint8Array(frame.length + 5);
    padded.set(frame, 5);
    expect(decodeClientMessage(padded.subarray(5))).toMatchObject({ reqId: 1, x: 2, y: 3, colorId: 4 });
  });

  test("malformed frames decode to null", () => {
    const place = encodePlace({ reqId: 1, x: 2, y: 3, colorId: 4, withBomb: false });
    const badFlags = place.slice();
    badFlags[14] = 2;
    const tooMany = encodeSubscribe(Array.from({ length: MAX_SUBSCRIBED_CHUNKS + 1 }, () => ({ cx: 0, cy: 0 })));
    for (const frame of [new Uint8Array(0), new Uint8Array([99]), place.slice(0, 10), badFlags, tooMany, encodeSubscribe([{ cx: 1, cy: 1 }]).slice(0, 5)]) {
      expect(decodeClientMessage(frame)).toBeNull();
    }
  });
});

describe("server frames", () => {
  test("chunk delta round-trips", () => {
    const delta = { cx: 1, cy: 2, fromVersion: 9, toVersion: 10, cells: [{ index: 0, colorId: 5 }, { index: 65_535, colorId: 31 }] };
    expect(decodeChunkDelta(encodeChunkDelta(delta))).toEqual(delta);
  });

  test("chunk delta decoding rejects foreign frames", () => {
    expect(decodeChunkDelta(new Uint8Array([2, 0, 0]))).toBeNull();
  });

  test("chunk body round-trips", () => {
    const colors = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    colors[123] = 7;
    const decoded = decodeChunkBody(encodeChunkBody(42, colors));
    expect(decoded?.version).toBe(42);
    expect(decoded?.colors[123]).toBe(7);
    expect(decodeChunkBody(new Uint8Array(10))).toBeNull();
  });
});
