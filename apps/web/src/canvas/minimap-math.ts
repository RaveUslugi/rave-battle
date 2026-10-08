import type { Camera, CanvasSize, ScreenSize } from "./viewport";

/** CSS size of the map and CSS pixels per canvas cell. */
export interface MinimapLayout {
  width: number;
  height: number;
  scale: number;
}

export function minimapLayout(canvas: CanvasSize, box: number): MinimapLayout {
  const scale = box / Math.max(canvas.width, canvas.height);
  return { width: Math.round(canvas.width * scale), height: Math.round(canvas.height * scale), scale };
}

export function minimapToCanvas(layout: MinimapLayout, px: number, py: number, canvas: CanvasSize): { x: number; y: number } {
  const clamp = (v: number, max: number) => Math.min(max - 1, Math.max(0, Math.floor(v)));
  return { x: clamp(px / layout.scale, canvas.width), y: clamp(py / layout.scale, canvas.height) };
}

export function viewportRect(view: { camera: Camera; screen: ScreenSize }, layout: MinimapLayout) {
  const halfW = view.screen.w / 2 / view.camera.zoom;
  const halfH = view.screen.h / 2 / view.camera.zoom;
  return {
    x: (view.camera.x - halfW) * layout.scale,
    y: (view.camera.y - halfH) * layout.scale,
    w: 2 * halfW * layout.scale,
    h: 2 * halfH * layout.scale,
  };
}

/** Keeps a rectangle inside the map, `inset` from each edge, so the frame stays visible. */
export function clampRect(rect: { x: number; y: number; w: number; h: number }, layout: MinimapLayout, inset: number) {
  const x0 = Math.max(inset, rect.x);
  const y0 = Math.max(inset, rect.y);
  const x1 = Math.min(layout.width - inset, rect.x + rect.w);
  const y1 = Math.min(layout.height - inset, rect.y + rect.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}
