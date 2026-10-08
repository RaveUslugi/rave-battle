import type { PaletteEntry } from "@rave/shared/client";

/** 256 entries × RGBA. Ids missing from the palette stay transparent. Effects render with `base` in v1. */
export function buildPaletteLut(palette: PaletteEntry[]): Uint8Array {
  const lut = new Uint8Array(256 * 4);
  for (const entry of palette) {
    const rgb = Number.parseInt(entry.base.slice(1), 16);
    lut.set([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255], entry.id * 4);
  }
  return lut;
}

export function paintRgba(colors: Uint8Array, lut: Uint8Array, out: Uint8Array): void {
  for (let i = 0; i < colors.length; i++) paintCell(i, colors[i] ?? 0, lut, out);
}

export function paintCell(index: number, colorId: number, lut: Uint8Array, out: Uint8Array): void {
  const from = colorId * 4;
  const to = index * 4;
  out[to] = lut[from] ?? 0;
  out[to + 1] = lut[from + 1] ?? 0;
  out[to + 2] = lut[from + 2] ?? 0;
  out[to + 3] = lut[from + 3] ?? 0;
}
