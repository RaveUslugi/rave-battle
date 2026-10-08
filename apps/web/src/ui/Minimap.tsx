import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { fetchOverview } from "../canvas/chunk-loader";
import { minimapLayout, minimapToCanvas, viewportRect } from "../canvas/minimap-math";
import { buildPaletteLut, paintRgba } from "../canvas/palette";
import { gameStore, useGame } from "../state/game-store";
import styles from "./Minimap.module.css";

const BOX = 160;
const REFRESH_MS = 15_000;
const OPEN_KEY = "rb:minimap";

function initiallyOpen(): boolean {
  try {
    const stored = window.localStorage.getItem(OPEN_KEY);
    if (stored !== null) return stored === "1";
  } catch {
    // Blocked storage: fall through to the screen-size default.
  }
  return !window.matchMedia("(max-width: 900px)").matches;
}

/** Whole-canvas overview with the current viewport; click or drag to move the camera there. */
export default function Minimap() {
  const config = useGame((s) => s.config);
  const view = useGame((s) => s.view);
  const [open, setOpen] = useState(initiallyOpen);
  const [image, setImage] = useState<HTMLCanvasElement | null>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
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
    return () => {
      abort.abort();
      clearInterval(id);
    };
  }, [open, config]);

  useEffect(() => {
    const el = mapRef.current;
    if (!el || !layout) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(layout.width * dpr);
    el.height = Math.round(layout.height * dpr);
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, layout.width, layout.height);
    if (image) ctx.drawImage(image, 0, 0, layout.width, layout.height);
    if (view) {
      const r = viewportRect(view, layout);
      ctx.strokeStyle = "#22f3ff";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
  }, [layout, view, image, open]);

  if (!config || !layout) return null;

  const toggle = () =>
    setOpen((was) => {
      try {
        window.localStorage.setItem(OPEN_KEY, was ? "0" : "1");
      } catch {
        // Not remembered; fine.
      }
      return !was;
    });

  const jump = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const cell = minimapToCanvas(layout, event.clientX - rect.left, event.clientY - rect.top, config.canvas);
    gameStore.getState().jumpTo(cell.x, cell.y);
  };

  return (
    <div className={styles.minimap}>
      <button type="button" className={styles.toggle} aria-expanded={open} onClick={toggle}>
        <span aria-hidden="true">🗺 </span>Карта
      </button>
      {open && (
        <canvas
          ref={mapRef}
          className={styles.map}
          style={{ width: layout.width, height: layout.height }}
          role="img"
          aria-label="Миникарта холста"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            jump(e);
          }}
          onPointerMove={(e) => {
            if (e.buttons & 1) jump(e);
          }}
        />
      )}
    </div>
  );
}
