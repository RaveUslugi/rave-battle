import { describe, expect, test } from "bun:test";
import type { PaletteEntry } from "@rave/shared";
import { buildPaletteLut, paintCell, paintRgba } from "./palette";

const palette: PaletteEntry[] = [
  { id: 0, type: "solid", base: "#000000", params: {}, unlock: "default" },
  { id: 3, type: "solid", base: "#FF4500", params: {}, unlock: "default" },
];

describe("palette", () => {
  test("builds an RGBA lookup; unknown ids are transparent", () => {
    const lut = buildPaletteLut(palette);
    expect([...lut.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    expect([...lut.slice(12, 16)]).toEqual([255, 69, 0, 255]);
    expect([...lut.slice(40, 44)]).toEqual([0, 0, 0, 0]);
  });

  test("paintRgba converts a whole color buffer", () => {
    const out = new Uint8Array(8);
    paintRgba(new Uint8Array([3, 0]), buildPaletteLut(palette), out);
    expect([...out]).toEqual([255, 69, 0, 255, 0, 0, 0, 255]);
  });

  test("paintCell updates a single cell", () => {
    const out = new Uint8Array(8);
    paintCell(1, 3, buildPaletteLut(palette), out);
    expect([...out]).toEqual([0, 0, 0, 0, 255, 69, 0, 255]);
  });
});
