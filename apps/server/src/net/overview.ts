import { encodeOverview, overviewShape } from "@rave/shared";
import type { CanvasStore } from "../engine/canvas-store";

export function buildOverview(canvas: CanvasStore): Uint8Array {
  const { step, width, height } = overviewShape(canvas.width, canvas.height);
  const colors = new Uint8Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) colors[j * width + i] = canvas.get(i * step, j * step).colorId;
  }
  return encodeOverview({ step, width, height, colors });
}

/** Gzipped overview, rebuilt at most once per `maxAgeMs`: the minimap is a rough picture, not a live view. */
export class OverviewCache {
  private body: Uint8Array<ArrayBuffer> | null = null;
  private builtAt = 0;
  // Canvas size the body was built for: growth must show up at once, not after maxAge.
  private builtWidth = 0;
  private builtHeight = 0;

  constructor(
    private readonly maxAgeMs = 5_000,
    private readonly now: () => number = Date.now,
  ) {}

  get(canvas: CanvasStore): Uint8Array<ArrayBuffer> {
    const now = this.now();
    const resized = canvas.width !== this.builtWidth || canvas.height !== this.builtHeight;
    if (!this.body || resized || now - this.builtAt >= this.maxAgeMs) {
      this.body = Bun.gzipSync(buildOverview(canvas) as Uint8Array<ArrayBuffer>);
      this.builtAt = now;
      this.builtWidth = canvas.width;
      this.builtHeight = canvas.height;
    }
    return this.body;
  }
}
