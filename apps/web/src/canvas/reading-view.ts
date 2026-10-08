import type { Reading } from "../state/readings-store";
import type { Camera, ScreenSize } from "./viewport";

/** Below this zoom a cell is too small for a digit. */
export const READING_MIN_ZOOM = 6;
export const MAX_DRAWN_READINGS = 400;

/** Minesweeper-like: grey 0, cyan 1, green 2, yellow 3, pink 4+. */
const COLORS = [0x9aa0b4, 0x22f3ff, 0x39ff88, 0xffe14d, 0xff2bd6];

export function readingColor(count: number): number {
  return COLORS[Math.min(count, COLORS.length - 1)]!;
}

/** Readings whose cell is on screen, newest first, at most `max`. */
export function visibleReadings(readings: Reading[], cam: Camera, size: ScreenSize, max = MAX_DRAWN_READINGS): Reading[] {
  if (cam.zoom < READING_MIN_ZOOM) return [];
  const halfW = size.w / 2 / cam.zoom;
  const halfH = size.h / 2 / cam.zoom;
  const left = cam.x - halfW - 1;
  const right = cam.x + halfW;
  const top = cam.y - halfH - 1;
  const bottom = cam.y + halfH;
  const out: Reading[] = [];
  for (let i = readings.length - 1; i >= 0 && out.length < max; i--) {
    const r = readings[i]!;
    if (r.x >= left && r.x <= right && r.y >= top && r.y <= bottom) out.push(r);
  }
  return out;
}
