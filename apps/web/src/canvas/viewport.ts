import { CHUNK_SIZE, MAX_SUBSCRIBED_CHUNKS } from "@rave/shared/client";

/** `x`, `y`: canvas coordinates at the screen center; `zoom`: screen pixels per canvas pixel. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface ScreenSize {
  w: number;
  h: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface ZoomLimits {
  min: number;
  max: number;
}

export const MAX_ZOOM = 64;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finite = (...values: number[]) => values.every(Number.isFinite);

export function screenToWorld(cam: Camera, size: ScreenSize, sx: number, sy: number): { x: number; y: number } {
  return { x: cam.x + (sx - size.w / 2) / cam.zoom, y: cam.y + (sy - size.h / 2) / cam.zoom };
}

export function worldToScreen(cam: Camera, size: ScreenSize, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - cam.x) * cam.zoom + size.w / 2, y: (wy - cam.y) * cam.zoom + size.h / 2 };
}

/** Zooms by `factor` keeping the canvas point under (sx, sy) in place. */
export function zoomAt(cam: Camera, size: ScreenSize, sx: number, sy: number, factor: number, limits: ZoomLimits): Camera {
  // Non-finite input or result (NaN from a broken event, zero-size screen) keeps the camera as is.
  if (!finite(cam.x, cam.y, cam.zoom, size.w, size.h, sx, sy, factor)) return cam;
  const anchor = screenToWorld(cam, size, sx, sy);
  const zoom = clamp(cam.zoom * factor, limits.min, limits.max);
  const next = { x: anchor.x - (sx - size.w / 2) / zoom, y: anchor.y - (sy - size.h / 2) / zoom, zoom };
  return finite(next.x, next.y, next.zoom) ? next : cam;
}

/** Drag by (dx, dy) screen pixels. */
export function pan(cam: Camera, dx: number, dy: number): Camera {
  // Non-finite input or result keeps the camera as is.
  const next = { x: cam.x - dx / cam.zoom, y: cam.y - dy / cam.zoom, zoom: cam.zoom };
  return finite(cam.x, cam.y, cam.zoom, dx, dy, next.x, next.y) ? next : cam;
}

/** A non-finite center coordinate falls back to the middle of the canvas. */
export function clampCenter(cam: Camera, canvas: CanvasSize): Camera {
  return {
    x: Number.isFinite(cam.x) ? clamp(cam.x, 0, canvas.width) : canvas.width / 2,
    y: Number.isFinite(cam.y) ? clamp(cam.y, 0, canvas.height) : canvas.height / 2,
    zoom: cam.zoom,
  };
}

/** Zoom that shows the whole canvas with a 10% margin. */
export function fitZoom(canvas: CanvasSize, size: ScreenSize): number {
  return Math.min(size.w / canvas.width, size.h / canvas.height) * 0.9;
}

/**
 * Chunks intersecting the view, expanded by `margin` chunks, clipped to the canvas, row-major.
 * Capped at the server's subscription limit: on-screen chunks first, then margin chunks, each group
 * nearest to the view center first; the kept chunks are returned row-major.
 */
export function visibleChunks(cam: Camera, size: ScreenSize, canvas: CanvasSize, margin: number): Array<{ cx: number; cy: number }> {
  const chunks = chunkRange(cam, size, canvas, margin);
  if (chunks.length <= MAX_SUBSCRIBED_CHUNKS) return chunks;

  const centerCx = cam.x / CHUNK_SIZE - 0.5;
  const centerCy = cam.y / CHUNK_SIZE - 0.5;
  const distance = (c: { cx: number; cy: number }) => (c.cx - centerCx) ** 2 + (c.cy - centerCy) ** 2;
  const byDistance = (a: { cx: number; cy: number }, b: { cx: number; cy: number }) => distance(a) - distance(b);
  const onScreen = chunkRange(cam, size, canvas, 0);
  const onScreenKeys = new Set(onScreen.map((c) => `${c.cx}:${c.cy}`));
  const rest = chunks.filter((c) => !onScreenKeys.has(`${c.cx}:${c.cy}`));
  return [...onScreen.sort(byDistance), ...rest.sort(byDistance)]
    .slice(0, MAX_SUBSCRIBED_CHUNKS)
    .sort((a, b) => a.cy - b.cy || a.cx - b.cx);
}

function chunkRange(cam: Camera, size: ScreenSize, canvas: CanvasSize, margin: number): Array<{ cx: number; cy: number }> {
  const topLeft = screenToWorld(cam, size, 0, 0);
  const bottomRight = screenToWorld(cam, size, size.w, size.h);
  const maxCx = canvas.width / CHUNK_SIZE - 1;
  const maxCy = canvas.height / CHUNK_SIZE - 1;
  const cx0 = clamp(Math.floor(topLeft.x / CHUNK_SIZE) - margin, 0, maxCx);
  const cy0 = clamp(Math.floor(topLeft.y / CHUNK_SIZE) - margin, 0, maxCy);
  const cx1 = clamp(Math.ceil(bottomRight.x / CHUNK_SIZE) - 1 + margin, 0, maxCx);
  const cy1 = clamp(Math.ceil(bottomRight.y / CHUNK_SIZE) - 1 + margin, 0, maxCy);

  const chunks: Array<{ cx: number; cy: number }> = [];
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) chunks.push({ cx, cy });
  return chunks;
}

export function cellAt(cam: Camera, size: ScreenSize, sx: number, sy: number, canvas: CanvasSize): { x: number; y: number } | null {
  const world = screenToWorld(cam, size, sx, sy);
  const x = Math.floor(world.x);
  const y = Math.floor(world.y);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
  return { x, y };
}

export function cameraToSearch(cam: Camera): string {
  return `?x=${Math.round(cam.x)}&y=${Math.round(cam.y)}&z=${Number(cam.zoom.toFixed(2))}`;
}

/** Writes the camera into an existing query string without touching other parameters. */
export function mergeCameraSearch(search: string, cam: Camera): string {
  const params = new URLSearchParams(search);
  const camera = new URLSearchParams(cameraToSearch(cam));
  for (const [key, value] of camera) params.set(key, value);
  return `?${params.toString()}`;
}

/** Parses `?x=&y=&z=`; null when anything is missing, empty or invalid. Clamping is the caller's job. */
export function cameraFromSearch(search: string): Camera | null {
  const params = new URLSearchParams(search);
  // Number("") is 0, so an empty value must be rejected before conversion.
  const values = ["x", "y", "z"].map((key) => (params.get(key)?.trim() ? Number(params.get(key)) : Number.NaN));
  const [x, y, zoom] = values as [number, number, number];
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom) || zoom <= 0) return null;
  return { x, y, zoom };
}

const WHEEL_ZOOM_SPEED = 0.004;
const WHEEL_LINE_PX = 16;
const MAX_WHEEL_DELTA_PX = 300;

/**
 * Zoom factor for one wheel event: about 1.5x per mouse notch (deltaY 100), proportionally less for
 * trackpads. `deltaMode`: 0 pixels, 1 lines, 2 pages.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number, pageHeight: number): number {
  const px = deltaY * (deltaMode === 1 ? WHEEL_LINE_PX : deltaMode === 2 ? pageHeight : 1);
  const capped = Math.max(-MAX_WHEEL_DELTA_PX, Math.min(MAX_WHEEL_DELTA_PX, px));
  return Math.exp(-capped * WHEEL_ZOOM_SPEED);
}
