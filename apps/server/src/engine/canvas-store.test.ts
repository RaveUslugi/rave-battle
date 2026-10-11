import { describe, expect, test } from "bun:test";
import { CHUNK_SIZE } from "@rave/shared";
import { CanvasStore } from "./canvas-store";

describe("CanvasStore", () => {
  test("empty cell is color 0 owned by nobody", () => {
    const canvas = new CanvasStore(512, 512);
    expect(canvas.get(10, 10)).toEqual({ colorId: 0, ownerId: 0 });
  });

  test("set returns the previous state and get returns the new one", () => {
    const canvas = new CanvasStore(512, 512);
    expect(canvas.set(300, 20, 5, 7)).toEqual({ colorId: 0, ownerId: 0 });
    expect(canvas.set(300, 20, 9, 8)).toEqual({ colorId: 5, ownerId: 7 });
    expect(canvas.get(300, 20)).toEqual({ colorId: 9, ownerId: 8 });
  });

  test("tracks territory per owner", () => {
    const canvas = new CanvasStore(512, 512);
    canvas.set(1, 1, 3, 7);
    canvas.set(2, 1, 3, 7);
    expect(canvas.territoryOf(7)).toBe(2);
    canvas.set(1, 1, 4, 8);
    expect(canvas.territoryOf(7)).toBe(1);
    expect(canvas.territoryOf(8)).toBe(1);
  });

  test("inBounds rejects negatives, overflow and non-integers", () => {
    const canvas = new CanvasStore(512, 512);
    expect(canvas.inBounds(0, 0)).toBe(true);
    expect(canvas.inBounds(511, 511)).toBe(true);
    expect(canvas.inBounds(-1, 0)).toBe(false);
    expect(canvas.inBounds(512, 0)).toBe(false);
    expect(canvas.inBounds(0, 512)).toBe(false);
    expect(canvas.inBounds(1.5, 0)).toBe(false);
  });

  test("chunks are allocated lazily and indexed row-major", () => {
    const canvas = new CanvasStore(512, 512);
    expect(canvas.getChunk(1, 0)).toBeUndefined();
    canvas.set(257, 2, 6, 3);
    const chunk = canvas.getChunk(1, 0);
    expect(chunk?.colors[2 * 256 + 1]).toBe(6);
    expect(chunk?.owners[2 * 256 + 1]).toBe(3);
  });

  test("dimensions must be multiples of the chunk size", () => {
    expect(() => new CanvasStore(500, 512)).toThrow();
  });

  test("resize grows and refuses to shrink", () => {
    const canvas = new CanvasStore(512, 512);
    canvas.resize(768, 512);
    expect(canvas.width).toBe(768);
    expect(canvas.inBounds(700, 0)).toBe(true);
    expect(() => canvas.resize(512, 512)).toThrow();
  });

  test("loadChunk replaces a chunk and rebuilds territory", () => {
    const canvas = new CanvasStore(512, 512);
    canvas.set(0, 0, 1, 9);
    const colors = new Uint8Array(256 * 256);
    const owners = new Int32Array(256 * 256);
    colors[0] = 5;
    owners[0] = 7;
    owners[1] = 7;
    owners[256] = 8;
    canvas.loadChunk(0, 0, { colors, owners });

    expect(canvas.get(0, 0)).toEqual({ colorId: 5, ownerId: 7 });
    expect(canvas.get(0, 1)).toEqual({ colorId: 0, ownerId: 8 });
    expect(canvas.territoryOf(7)).toBe(2);
    expect(canvas.territoryOf(8)).toBe(1);
    expect(canvas.territoryOf(9)).toBe(0);
  });

  test("loadChunk rejects wrongly sized buffers", () => {
    const canvas = new CanvasStore(512, 512);
    expect(() => canvas.loadChunk(0, 0, { colors: new Uint8Array(10), owners: new Int32Array(10) })).toThrow();
  });

  test("colorCount follows set, overwrites and chunk replacement", () => {
    const canvas = new CanvasStore(512, 512);
    expect(canvas.colorCount(0)).toBe(262144);
    canvas.set(1, 1, 3, 7);
    canvas.set(2, 1, 4, 7);
    canvas.set(3, 1, 4, 7);
    canvas.set(1, 1, 4, 8);
    expect(canvas.colorCount(3)).toBe(0);
    expect(canvas.colorCount(4)).toBe(3);
    expect(canvas.colorCount(0)).toBe(262144 - 3);

    const colors = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    colors[0] = 9;
    colors[1] = 9;
    canvas.loadChunk(0, 0, { colors, owners: new Int32Array(CHUNK_SIZE * CHUNK_SIZE) });
    expect(canvas.colorCount(4)).toBe(0);
    expect(canvas.colorCount(9)).toBe(2);
    expect(canvas.colorCount(0)).toBe(262144 - 2);
  });
});
