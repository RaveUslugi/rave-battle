import { describe, expect, test } from "bun:test";
import { defaultConfig } from "@rave/shared";
import type { Timers } from "../net/socket";
import { CanvasController, type ChunkLoader, type Renderer } from "./controller";

function harness() {
  const calls: string[] = [];
  const renderer: Renderer = {
    setPalette: () => calls.push("palette"),
    setCanvasSize: (w, h) => calls.push(`size:${w}x${h}`),
    replaceChunk: (cx, cy, colors) => calls.push(`replace:${cx}:${cy}:${colors[0]}`),
    applyCells: (cx, cy, cells) => calls.push(`apply:${cx}:${cy}:${cells.map((c) => `${c.index}=${c.colorId}`).join(",")}`),
    dropChunk: (cx, cy) => calls.push(`drop:${cx}:${cy}`),
    dropAll: () => calls.push("dropAll"),
  };
  const loads: Array<{ cx: number; cy: number; resolve: (v: { version: number; colors: Uint8Array }) => void; reject: (e: unknown) => void }> = [];
  const loadChunk: ChunkLoader = (cx, cy) => new Promise((resolve, reject) => loads.push({ cx, cy, resolve, reject }));
  const subscriptions: string[][] = [];
  const retries: Array<() => void> = [];
  const timeouts: Array<() => void> = [];
  const timers: Timers = {
    set: (fn, ms) => {
      (ms === 100 ? timeouts : retries).push(fn);
      return ms;
    },
    clear: () => {},
  };
  const controller = new CanvasController({
    renderer,
    loadChunk,
    socket: { subscribe: (chunks) => subscriptions.push(chunks.map((c) => `${c.cx}:${c.cy}`)) },
    retryMs: 10,
    loadTimeoutMs: 100,
    timers,
  });
  return { controller, calls, loads, subscriptions, retries, timeouts };
}

const hello = (bootId: string) => ({ bootId, config: defaultConfig });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("CanvasController", () => {
  test("hello configures the palette and canvas size", () => {
    const h = harness();
    h.controller.onHello(hello("b1"));
    expect(h.calls).toEqual(["palette", "size:512x512"]);
  });

  test("a live config update re-applies palette and size without dropping chunks", () => {
    const h = harness();
    h.controller.onHello(hello("b1"));
    h.calls.length = 0;
    h.controller.onConfig({ ...defaultConfig, canvas: { width: 1024, height: 768 }, palette: defaultConfig.palette.slice(0, 4) });
    expect(h.calls).toEqual(["palette", "size:1024x768"]);
  });

  test("visible chunks are subscribed and loaded", async () => {
    const h = harness();
    h.controller.onHello(hello("b1"));
    h.controller.setVisible([
      { cx: 0, cy: 0 },
      { cx: 1, cy: 0 },
    ]);
    expect(h.subscriptions).toEqual([["0:0", "1:0"]]);
    expect(h.loads.map((l) => `${l.cx}:${l.cy}`)).toEqual(["0:0", "1:0"]);
    h.loads[0]!.resolve({ version: 2, colors: new Uint8Array([7]) });
    await flush();
    expect(h.calls).toContain("replace:0:0:7");
  });

  test("chunks leaving the view are dropped; an unchanged view does not resubscribe", () => {
    const h = harness();
    h.controller.onHello(hello("b1"));
    h.controller.setVisible([
      { cx: 0, cy: 0 },
      { cx: 1, cy: 0 },
    ]);
    h.controller.setVisible([{ cx: 0, cy: 0 }]);
    expect(h.calls).toContain("drop:1:0");
    expect(h.subscriptions.at(-1)).toEqual(["0:0"]);
    h.controller.setVisible([{ cx: 0, cy: 0 }]);
    expect(h.subscriptions).toHaveLength(2);
  });

  test("deltas and acks reach ready chunks", async () => {
    const h = harness();
    h.controller.onHello(hello("b1"));
    h.controller.setVisible([{ cx: 0, cy: 0 }]);
    h.loads[0]!.resolve({ version: 2, colors: new Uint8Array([0]) });
    await flush();
    h.controller.onDelta({ cx: 0, cy: 0, fromVersion: 2, toVersion: 3, cells: [{ index: 5, colorId: 9 }] });
    expect(h.calls).toContain("apply:0:0:5=9");
    h.controller.onAck([{ cx: 0, cy: 0, version: 7 }]);
    expect(h.loads).toHaveLength(2);
  });

  test("a new boot id drops everything; the same boot id keeps chunks", async () => {
    const h = harness();
    h.controller.onHello(hello("b1"));
    h.controller.setVisible([{ cx: 0, cy: 0 }]);
    h.controller.onHello(hello("b1"));
    expect(h.calls).not.toContain("dropAll");
    h.controller.onHello(hello("b2"));
    expect(h.calls).toContain("dropAll");
    h.controller.setVisible([{ cx: 0, cy: 0 }]);
    expect(h.loads).toHaveLength(2);
    expect(h.subscriptions).toHaveLength(2);
  });

  test("failed loads are retried", async () => {
    const h = harness();
    h.controller.onHello(hello("b1"));
    h.controller.setVisible([{ cx: 0, cy: 0 }]);
    h.loads[0]!.reject(new Error("offline"));
    await flush();
    expect(h.retries).toHaveLength(1);
    h.retries[0]!();
    expect(h.loads).toHaveLength(2);
  });

  test("a load that never settles times out, is retried, and its late result is ignored", async () => {
    const h = harness();
    h.controller.onHello(hello("b1"));
    h.controller.setVisible([{ cx: 0, cy: 0 }]);
    expect(h.timeouts).toHaveLength(1);
    h.timeouts[0]!();
    expect(h.retries).toHaveLength(1);
    h.retries[0]!();
    expect(h.loads).toHaveLength(2);
    h.loads[0]!.resolve({ version: 1, colors: new Uint8Array([3]) });
    await flush();
    expect(h.calls).not.toContain("replace:0:0:3");
    h.loads[1]!.resolve({ version: 2, colors: new Uint8Array([4]) });
    await flush();
    expect(h.calls).toContain("replace:0:0:4");
  });
});
