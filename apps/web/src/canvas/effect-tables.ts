import type { PaletteEntry } from "@rave/shared/client";

/** Rows of colours per palette entry: row 0 is `base`, rows 1..MAX_STOPS are frames or stops. */
export const COLOR_ROWS = 9;
const MAX_STOPS = COLOR_ROWS - 1;
const IDS = 256;

export const KIND = { solid: 0, animated: 1, gradient: 2 } as const;

/** What the chunk shader reads, as data textures 256 wide (one column per palette id). */
export interface EffectTables {
  /** 256 × COLOR_ROWS RGBA8. Ids missing from the palette stay transparent. */
  colors: Uint8Array;
  /** 256 RGBA32F: (kind, colour count, cos(angle) / scale, sin(angle) / scale). */
  params: Float32Array;
  /** 1 where the colour changes over time, so the renderer knows when phases need updating. */
  moving: Uint8Array;
}

const rgb = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export function buildEffectTables(palette: PaletteEntry[]): EffectTables {
  const colors = new Uint8Array(IDS * COLOR_ROWS * 4);
  const params = new Float32Array(IDS * 4);
  const moving = new Uint8Array(IDS);
  const put = (id: number, row: number, hex: string) => {
    colors.set([...rgb(hex), 255], (row * IDS + id) * 4);
  };
  for (const entry of palette) {
    put(entry.id, 0, entry.base);
    if (entry.type === "solid") continue;
    const list = (entry.type === "animated" ? entry.params.frames : entry.params.stops).slice(0, MAX_STOPS);
    for (const [i, hex] of list.entries()) put(entry.id, i + 1, hex);
    const at = entry.id * 4;
    params[at] = KIND[entry.type];
    params[at + 1] = list.length;
    if (entry.type === "gradient") {
      const rad = (entry.params.angle * Math.PI) / 180;
      params[at + 2] = Math.cos(rad) / entry.params.scale;
      params[at + 3] = Math.sin(rad) / entry.params.scale;
    }
    moving[entry.id] = entry.type === "animated" || entry.params.speed > 0 ? 1 : 0;
  }
  return { colors, params, moving };
}

/**
 * Each entry's time offset in cycles at `t` ms, wrapped to [0, 1). Computed here in doubles so the
 * shader never handles large times (a float32 `time` would lose precision after a few hours).
 */
export function effectPhases(palette: PaletteEntry[], t: number, out: Float32Array): void {
  for (const entry of palette) {
    const cycles = entry.type === "animated" ? t / entry.params.periodMs : entry.type === "gradient" ? (t / 1000) * entry.params.speed : 0;
    out[entry.id] = cycles - Math.floor(cycles);
  }
}

/** Number of cells in `colors` whose colour moves over time. */
export function countMoving(colors: Uint8Array, moving: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < colors.length; i++) n += moving[colors[i] ?? 0] ?? 0;
  return n;
}

/**
 * The chunk fragment shader in JS, line for line (tests compare it with `effectColorAt`).
 * Returns RGBA bytes of palette id `id` at world cell (x, y).
 */
export function shadeCell(tables: EffectTables, phases: Float32Array, id: number, x: number, y: number): number[] {
  const color = (row: number) => [...tables.colors.subarray((row * IDS + id) * 4, (row * IDS + id) * 4 + 4)];
  const at = id * 4;
  const kind = tables.params[at] ?? 0;
  if (kind < 0.5) return color(0);
  let u = phases[id] ?? 0;
  if (kind > 1.5) u += x * (tables.params[at + 2] ?? 0) + y * (tables.params[at + 3] ?? 0);
  const count = Math.round(tables.params[at + 1] ?? 1);
  const pos = (u - Math.floor(u)) * count;
  const i = Math.min(Math.floor(pos), count - 1);
  const a = color(1 + i);
  const b = color(1 + ((i + 1) % count));
  return a.map((c, k) => Math.round(c + ((b[k] ?? 0) - c) * (pos - i)));
}
