import { describe, expect, test } from "bun:test";
import { configChangeIssues } from "./config-change";
import { makeEngine } from "./test-utils";

function setup() {
  const { cfg, canvas } = makeEngine();
  return { prev: cfg, canvas, next: structuredClone(cfg) };
}

describe("configChangeIssues", () => {
  test("shrinking the canvas is rejected with a path", () => {
    const { prev, next, canvas } = setup();
    next.canvas.width = 256;
    expect(configChangeIssues(prev, next, canvas).map((i) => i.path)).toEqual(["canvas.width"]);
  });

  test("shrinking the canvas height is rejected with a path", () => {
    const { prev, next, canvas } = setup();
    next.canvas.height = 256;
    expect(configChangeIssues(prev, next, canvas).map((i) => i.path)).toEqual(["canvas.height"]);
  });

  test("color 0 cannot be removed even on an empty canvas", () => {
    const { prev, next, canvas } = setup();
    expect(canvas.colorCount(0)).toBe(canvas.width * canvas.height);
    next.palette = next.palette.filter((e) => e.id !== 0);
    expect(configChangeIssues(prev, next, canvas).map((i) => i.path)).toEqual(["palette"]);
  });

  test("growing or keeping the canvas is fine", () => {
    const { prev, next, canvas } = setup();
    next.canvas.height = 768;
    expect(configChangeIssues(prev, next, canvas)).toEqual([]);
  });

  test("an unused color can be removed, a used one cannot", () => {
    const { prev, next, canvas } = setup();
    next.palette = next.palette.filter((e) => e.id !== 32);
    expect(configChangeIssues(prev, next, canvas)).toEqual([]);
    canvas.set(1, 1, 32, 5);
    expect(configChangeIssues(prev, next, canvas).map((i) => i.path)).toEqual(["palette"]);
  });

  test("changing the type of a used color is rejected", () => {
    const { prev, next, canvas } = setup();
    canvas.set(1, 1, 32, 5);
    next.palette.find((e) => e.id === 32)!.type = "animated";
    expect(configChangeIssues(prev, next, canvas)).toHaveLength(1);
  });

  test("changing base or price of a used color is fine", () => {
    const { prev, next, canvas } = setup();
    canvas.set(1, 1, 32, 5);
    const entry = next.palette.find((e) => e.id === 32)!;
    entry.base = "#123456";
    entry.price = 999;
    expect(configChangeIssues(prev, next, canvas)).toEqual([]);
  });
});
