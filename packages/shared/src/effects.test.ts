import { describe, expect, test } from "bun:test";
import type { PaletteEntry } from "./config/schema";
import { effectColorAt } from "./effects";

const animated: PaletteEntry = {
  id: 40,
  type: "animated",
  base: "#ff0000",
  unlock: "shop",
  price: 1,
  params: { frames: ["#000000", "#FFFFFF"], periodMs: 1000 },
};
const gradient: PaletteEntry = {
  id: 41,
  type: "gradient",
  base: "#000000",
  unlock: "shop",
  price: 1,
  params: { stops: ["#000000", "#FF0000"], scale: 10, angle: 0, speed: 0 },
};

describe("effectColorAt", () => {
  test("solid is its base everywhere, always", () => {
    expect(effectColorAt({ id: 1, type: "solid", base: "#00ff7f", unlock: "default", params: {} }, 3, 9, 12345)).toBe("#00FF7F");
  });

  test("animated loops through its frames once per period, blending", () => {
    expect(effectColorAt(animated, 0, 0, 0)).toBe("#000000");
    expect(effectColorAt(animated, 5, 5, 250)).toBe("#808080");
    expect(effectColorAt(animated, 0, 0, 500)).toBe("#FFFFFF");
    expect(effectColorAt(animated, 0, 0, 1000)).toBe("#000000");
  });

  test("gradient repeats every `scale` cells along the angle and drifts with speed", () => {
    expect(effectColorAt(gradient, 0, 0, 0)).toBe("#000000");
    expect(effectColorAt(gradient, 2.5, 99, 0)).toBe("#800000");
    expect(effectColorAt(gradient, 10, 0, 0)).toBe("#000000");
    const vertical = { ...gradient, params: { ...gradient.params, angle: 90 } } as PaletteEntry;
    expect(effectColorAt(vertical, 99, 5, 0)).toBe("#FF0000");
    const drifting = { ...gradient, params: { ...gradient.params, speed: 0.25 } } as PaletteEntry;
    expect(effectColorAt(drifting, 0, 0, 1000)).toBe("#800000");
    // Negative coordinates wrap like positive ones.
    expect(effectColorAt(gradient, -2.5, 0, 0)).toBe("#800000");
  });
});
