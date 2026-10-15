import type { PaletteEntry } from "./config/schema";

const parse = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb: number[]) =>
  `#${rgb
    .map((c) => Math.round(c).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
const mix = (a: string, b: string, t: number) => {
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  return toHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
};
/** Position in a looping list of colours: `u` in [0, 1) spans all of them, wrapping from the last back to the first. */
const cycle = (colors: string[], u: number) => {
  const pos = (((u % 1) + 1) % 1) * colors.length;
  const i = Math.floor(pos);
  return mix(colors[i]!, colors[(i + 1) % colors.length]!, pos - i);
};

/**
 * Colour of a palette entry at cell (x, y) at time `t` (ms). The reference for every renderer:
 * the canvas shader, the shop and palette swatches and the admin preview must agree with it.
 * - solid: `base`;
 * - animated: the frames loop once per `periodMs`, blending linearly into the next one;
 * - gradient: the stops repeat every `scale` cells along `angle` (0° = towards +x, 90° = towards +y)
 *   and drift by `speed` periods per second.
 */
export function effectColorAt(entry: PaletteEntry, x: number, y: number, t: number): string {
  if (entry.type === "animated") return cycle(entry.params.frames, t / entry.params.periodMs);
  if (entry.type === "gradient") {
    const { stops, scale, angle, speed } = entry.params;
    const rad = (angle * Math.PI) / 180;
    const along = (x * Math.cos(rad) + y * Math.sin(rad)) / scale;
    return cycle(stops, along + (t / 1000) * speed);
  }
  return entry.base.toUpperCase();
}
