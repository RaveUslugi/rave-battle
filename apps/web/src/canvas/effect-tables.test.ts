import { describe, expect, test } from "bun:test";
import { defaultConfig, effectColorAt, type PaletteEntry } from "@rave/shared";
import { buildEffectTables, countMoving, effectPhases, shadeCell } from "./effect-tables";

const hexBytes = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
};

const palette = defaultConfig.palette;
const tables = buildEffectTables(palette);

describe("effect tables", () => {
  test("the shader formula matches effectColorAt for every default colour", () => {
    const phases = new Float32Array(256);
    for (const t of [0, 137, 950, 12_345, 7_200_000 + 321]) {
      effectPhases(palette, t, phases);
      for (const entry of palette) {
        for (const [x, y] of [
          [0, 0],
          [5, 3],
          [255, 17],
          [1000, 4000],
        ] as const) {
          const got = shadeCell(tables, phases, entry.id, x, y);
          const want = hexBytes(effectColorAt(entry, x, y, t));
          for (const [k, c] of got.entries()) expect(Math.abs(c - (want[k] ?? 0))).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  test("unknown ids are transparent", () => {
    expect(shadeCell(tables, new Float32Array(256), 250, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  test("only animated colours and drifting gradients count as moving", () => {
    const entries: PaletteEntry[] = [
      { id: 1, type: "solid", base: "#000000", params: {}, unlock: "default" },
      { id: 2, type: "animated", base: "#000000", params: { frames: ["#000000", "#FFFFFF"], periodMs: 1000 }, unlock: "default" },
      { id: 3, type: "gradient", base: "#000000", params: { stops: ["#000000", "#FFFFFF"], scale: 8, angle: 0, speed: 0 }, unlock: "default" },
      { id: 4, type: "gradient", base: "#000000", params: { stops: ["#000000", "#FFFFFF"], scale: 8, angle: 0, speed: 0.5 }, unlock: "default" },
    ];
    const { moving } = buildEffectTables(entries);
    expect([...moving.slice(1, 5)]).toEqual([0, 1, 0, 1]);
    expect(countMoving(new Uint8Array([1, 2, 2, 3, 4, 0]), moving)).toBe(3);
  });

  test("phases stay in [0, 1) at large times", () => {
    const phases = new Float32Array(256);
    effectPhases(palette, 1e12 + 0.5, phases);
    for (const p of phases) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
    }
  });
});
