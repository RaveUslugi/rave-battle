import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { fetchOverview } from "../canvas/chunk-loader";
import { clampRect, minimapLayout, minimapToCanvas, viewportRect, type MinimapLayout } from "../canvas/minimap-math";
import { buildPaletteLut, paintRgba } from "../canvas/palette";
import type { CanvasSize } from "../canvas/viewport";
import { useTranslation } from "../i18n";
import { gameStore, useGame } from "../state/game-store";
import styles from "./Minimap.module.css";

const BOX = 160;
const REFRESH_MS = 15_000;

/** Whole-canvas overview with the current viewport; click or drag to move the camera there. Shown while `open`. */
export default function Minimap({ open, className }: { open: boolean; className?: string }) {
  const config = useGame((s) => s.config);
  const [image, setImage] = useState<HTMLCanvasElement | null>(null);
  const layout = useMemo(() => (config ? minimapLayout(config.canvas, BOX) : null), [config]);

  // Fetch while open and the tab is visible; the server caches the overview for a few seconds anyway.
  useEffect(() => {
    if (!open || !config) return;
    const abort = new AbortController();
    const lut = buildPaletteLut(config.palette);
    const load = () => {
      if (document.hidden) return;
      fetchOverview(abort.signal)
        .then((o) => {
          const img = document.createElement("canvas");
          img.width = o.width;
          img.height = o.height;
          const ctx = img.getContext("2d");
          if (!ctx) return;
          const data = ctx.createImageData(o.width, o.height);
          paintRgba(o.colors, lut, new Uint8Array(data.data.buffer));
          ctx.putImageData(data, 0, 0);
          setImage(img);
        })
        .catch(() => {
          // Offline or aborted: keep the last picture.
        });
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      abort.abort();
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [open, config]);

  if (!config || !layout || !open) return null;
  return (
    <div className={[styles.minimap, className].filter(Boolean).join(" ")}>
      <MinimapMap layout={layout} image={image} canvas={config.canvas} />
    </div>
  );
}

/** The open map: the only part that follows the camera, so a collapsed minimap never redraws. */
function MinimapMap({ layout, image, canvas }: { layout: MinimapLayout; image: HTMLCanvasElement | null; canvas: CanvasSize }) {
  const { t } = useTranslation();
  const view = useGame((s) => s.view);
  const mapRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(layout.width * dpr);
    const h = Math.round(layout.height * dpr);
    // Resizing the backing store reallocates it: only do it when the size actually changes.
    if (el.width !== w) el.width = w;
    if (el.height !== h) el.height = h;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, layout.width, layout.height);
    if (image) ctx.drawImage(image, 0, 0, layout.width, layout.height);
    if (view) {
      const lineWidth = 1.5;
      const r = clampRect(viewportRect(view, layout), layout, lineWidth / 2);
      ctx.strokeStyle = "#3de8ff";
      ctx.lineWidth = lineWidth;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
  }, [layout, view, image]);

  const jump = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const cell = minimapToCanvas(layout, event.clientX - rect.left, event.clientY - rect.top, canvas);
    gameStore.getState().jumpTo(cell.x, cell.y);
  };

  return (
    <canvas
      ref={mapRef}
      className={styles.map}
      style={{ width: layout.width, height: layout.height }}
      role="img"
      aria-label={t("sections.minimapLabel")}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        jump(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) jump(e);
      }}
    />
  );
}
