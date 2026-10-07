import { CHUNK_SIZE, MAX_SUBSCRIBED_CHUNKS } from "@rave/shared";

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

export function screenToWorld(cam: Camera, size: ScreenSize, sx: number, sy: number): { x: number; y: number } {
  return { x: cam.x + (sx - size.w / 2) / cam.zoom, y: cam.y + (sy - size.h / 2) / cam.zoom };
}

export function worldToScreen(cam: Camera, size: ScreenSize, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - cam.x) * cam.zoom + size.w / 2, y: (wy - cam.y) * cam.zoom + size.h / 2 };
}

/** Zooms by `factor` keeping the canvas point under (sx, sy) in place. */
export function zoomAt(cam: Camera, size: ScreenSize, sx: number, sy: number, factor: number, limits: ZoomLimits): Camera {
  const anchor = screenToWorld(cam, size, sx, sy);
  const zoom = clamp(cam.zoom * factor, limits.min, limits.max);
  return { x: anchor.x - (sx - size.w / 2) / zoom, y: anchor.y - (sy - size.h / 2) / zoom, zoom };
}

/** Drag by (dx, dy) screen pixels. */
export function pan(cam: Camera, dx: number, dy: number): Camera {
  return { x: cam.x - dx / cam.zoom, y: cam.y - dy / cam.zoom, zoom: cam.zoom };
}

export function clampCenter(cam: Camera, canvas: CanvasSize): Camera {
  return { x: clamp(cam.x, 0, canvas.width), y: clamp(cam.y, 0, canvas.height), zoom: cam.zoom };
}

/** Zoom that shows the whole canvas with a 10% margin. */
export function fitZoom(canvas: CanvasSize, size: ScreenSize): number {
  return Math.min(size.w / canvas.width, size.h / canvas.height) * 0.9;
}

/**
 * Chunks intersecting the view, expanded by `margin` chunks, clipped to the canvas, row-major.
 * Capped at the server's subscription limit by keeping the chunks nearest to the view center.
 */
export function visibleChunks(cam: Camera, size: ScreenSize, canvas: CanvasSize, margin: number): Array<{ cx: number; cy: number }> {
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
  if (chunks.length <= MAX_SUBSCRIBED_CHUNKS) return chunks;

  const centerCx = cam.x / CHUNK_SIZE - 0.5;
  const centerCy = cam.y / CHUNK_SIZE - 0.5;
  const distance = (c: { cx: number; cy: number }) => (c.cx - centerCx) ** 2 + (c.cy - centerCy) ** 2;
  return chunks.sort((a, b) => distance(a) - distance(b)).slice(0, MAX_SUBSCRIBED_CHUNKS);
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

/** Parses `?x=&y=&z=`; null when anything is missing or invalid. Clamping is the caller's job. */
export function cameraFromSearch(search: string): Camera | null {
  const params = new URLSearchParams(search);
  const values = ["x", "y", "z"].map((key) => (params.has(key) ? Number(params.get(key)) : Number.NaN));
  const [x, y, zoom] = values as [number, number, number];
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom) || zoom <= 0) return null;
  return { x, y, zoom };
}
