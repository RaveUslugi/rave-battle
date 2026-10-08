import { useEffect, useMemo, useRef } from "react";
import { fetchOverview } from "../canvas/chunk-loader";
import { minimapLayout } from "../canvas/minimap-math";
import { buildPaletteLut, paintRgba } from "../canvas/palette";
import { heatColor, heatRects, type HeatmapData } from "../game/heatmap";
import { useGame } from "../state/game-store";
import styles from "./Tabs.module.css";

const BOX = 240;

/** Where the player has painted, over a dimmed picture of the canvas. Pixels only — never bombs. */
export function Heatmap({ data }: { data: HeatmapData }) {
  const config = useGame((s) => s.config);
  const ref = useRef<HTMLCanvasElement>(null);
  const layout = useMemo(() => (config ? minimapLayout(config.canvas, BOX) : null), [config]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !layout || !config) return;
    const abort = new AbortController();
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(layout.width * dpr);
    el.height = Math.round(layout.height * dpr);
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const drawHeat = () => {
      for (const r of heatRects(data, layout)) {
        ctx.fillStyle = heatColor(r.t);
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
    };
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, layout.width, layout.height);
    drawHeat();
    fetchOverview(abort.signal)
      .then((o) => {
        const img = document.createElement("canvas");
        img.width = o.width;
        img.height = o.height;
        const ictx = img.getContext("2d");
        if (!ictx) return;
        const pixels = ictx.createImageData(o.width, o.height);
        paintRgba(o.colors, buildPaletteLut(config.palette), new Uint8Array(pixels.data.buffer));
        ictx.putImageData(pixels, 0, 0);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, layout.width, layout.height);
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 0.25;
        // Overview blocks cover `step` cells each; the last row/column may run past the canvas edge.
        ctx.drawImage(img, 0, 0, o.width * o.step * layout.scale, o.height * o.step * layout.scale);
        ctx.globalAlpha = 1;
        drawHeat();
      })
      .catch(() => {
        // No background picture: the heat alone is still useful.
      });
    return () => abort.abort();
  }, [data, layout, config]);

  if (!layout) return null;
  return <canvas ref={ref} className={styles.heatmap} style={{ width: layout.width, height: layout.height }} role="img" aria-label="Тепловая карта поставленных пикселей" />;
}
