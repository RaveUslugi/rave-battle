import type { MinimapLayout } from "../canvas/minimap-math";

export interface HeatmapData {
  step: number;
  width: number;
  height: number;
  cells: Array<[number, number]>;
}

/** One rectangle per non-empty block in map pixels; `t` = log-scaled intensity in [0, 1]. */
export function heatRects(h: HeatmapData, layout: MinimapLayout) {
  const max = Math.max(1, ...h.cells.map(([, n]) => n));
  const side = h.step * layout.scale;
  return h.cells.map(([index, n]) => ({
    x: (index % h.width) * side,
    y: Math.floor(index / h.width) * side,
    w: side,
    h: side,
    t: Math.log(1 + n) / Math.log(1 + max),
  }));
}

/** Neon cyan (cold) to pink (hot), more opaque when hotter. */
export function heatColor(t: number): string {
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  const alpha = Math.round((0.35 + 0.65 * t) * 100) / 100;
  return `rgba(${mix(34, 255)}, ${mix(243, 43)}, ${mix(255, 214)}, ${alpha})`;
}
