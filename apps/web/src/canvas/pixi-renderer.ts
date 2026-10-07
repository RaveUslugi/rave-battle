import { CHUNK_SIZE } from "@rave/shared";
import { Application, BufferImageSource, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { Renderer } from "./controller";
import { paintCell, paintRgba } from "./palette";
import type { Camera } from "./viewport";

interface ChunkView {
  colors: Uint8Array;
  rgba: Uint8Array;
  source: BufferImageSource;
  sprite: Sprite;
}

const GRID_MIN_ZOOM = 12;
const BOARD_COLOR = 0x000000;

/**
 * Chunk textures, the board background, the cell grid and the camera transform.
 * Every method is a no-op until `init` resolves and after `destroy`, so late loads/deltas are harmless.
 */
export class PixiRenderer implements Renderer {
  private readonly app = new Application();
  private readonly world = new Container();
  private readonly board = new Graphics();
  private readonly grid = new Graphics();
  private readonly chunks = new Map<string, ChunkView>();
  private readonly dirty = new Set<ChunkView>();
  private lut: Uint8Array = new Uint8Array(256 * 4);
  private canvasSize = { width: 0, height: 0 };
  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  private state: "new" | "initializing" | "ready" | "destroyed" = "new";

  /** Creates the WebGL context and appends the canvas to `host`. */
  async init(host: HTMLElement): Promise<void> {
    if (this.state !== "new") throw new Error("PixiRenderer.init called twice");
    this.state = "initializing";
    await this.app.init({
      resizeTo: host,
      background: "#07020f",
      antialias: false,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    this.state = "ready";
    host.appendChild(this.app.canvas);
    this.world.addChild(this.board);
    this.app.stage.addChild(this.world, this.grid);
    this.app.ticker.add(() => this.flush());
    // Context loss needs no handling here: on `webglcontextrestored` Pixi drops its GPU textures and
    // re-uploads each source from its CPU buffer (our `rgba`) the next time it is drawn.
  }

  get canvasElement(): HTMLCanvasElement {
    return this.app.canvas;
  }

  screenSize(): { w: number; h: number } {
    if (this.state !== "ready") return { w: 0, h: 0 };
    return { w: this.app.screen.width, h: this.app.screen.height };
  }

  /** Syncs the renderer with the host size (Pixi itself only listens to window resizes) and the pixel ratio. */
  resize(): void {
    if (this.state !== "ready") return;
    const resolution = window.devicePixelRatio || 1;
    if (this.app.renderer.resolution !== resolution) this.app.renderer.resolution = resolution;
    this.app.resize();
  }

  /** Safe to call at any time; a renderer whose init is still pending must be destroyed again after it resolves. */
  destroy(): void {
    if (this.state !== "ready") return;
    this.state = "destroyed";
    this.chunks.clear();
    this.dirty.clear();
    this.app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true, context: true });
  }

  /** True once `init` has resolved and until `destroy`. */
  get isReady(): boolean {
    return this.state === "ready";
  }

  setPalette(lut: Uint8Array): void {
    this.lut = lut;
    for (const chunk of this.chunks.values()) {
      paintRgba(chunk.colors, lut, chunk.rgba);
      this.dirty.add(chunk);
    }
  }

  setCanvasSize(width: number, height: number): void {
    if (this.state !== "ready") return;
    this.canvasSize = { width, height };
    this.board.clear().rect(0, 0, width, height).fill(BOARD_COLOR);
    this.drawGrid();
  }

  replaceChunk(cx: number, cy: number, colors: Uint8Array): void {
    if (this.state !== "ready") return;
    const chunk = this.chunks.get(`${cx}:${cy}`) ?? this.createChunk(cx, cy);
    chunk.colors.set(colors);
    paintRgba(chunk.colors, this.lut, chunk.rgba);
    this.dirty.add(chunk);
  }

  applyCells(cx: number, cy: number, cells: Array<{ index: number; colorId: number }>): void {
    const chunk = this.chunks.get(`${cx}:${cy}`);
    if (!chunk) return;
    for (const cell of cells) {
      chunk.colors[cell.index] = cell.colorId;
      paintCell(cell.index, cell.colorId, this.lut, chunk.rgba);
    }
    this.dirty.add(chunk);
  }

  dropChunk(cx: number, cy: number): void {
    const key = `${cx}:${cy}`;
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    this.dirty.delete(chunk);
    this.chunks.delete(key);
    chunk.sprite.destroy({ texture: true, textureSource: true });
  }

  dropAll(): void {
    for (const key of [...this.chunks.keys()]) {
      const [cx, cy] = key.split(":").map(Number) as [number, number];
      this.dropChunk(cx, cy);
    }
  }

  setCamera(camera: Camera): void {
    if (this.state !== "ready") return;
    this.camera = camera;
    const origin = this.origin();
    this.world.scale.set(camera.zoom);
    this.world.position.set(origin.x, origin.y);
    this.drawGrid();
  }

  /** Screen position of canvas point (0, 0), rounded so chunk edges land on whole pixels. */
  private origin(): { x: number; y: number } {
    const { width, height } = this.app.screen;
    const { x, y, zoom } = this.camera;
    return { x: Math.round(width / 2 - x * zoom), y: Math.round(height / 2 - y * zoom) };
  }

  private createChunk(cx: number, cy: number): ChunkView {
    const colors = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const rgba = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * 4);
    // A Uint8Array defaults to "bgra8unorm" in Pixi; our bytes are RGBA.
    const source = new BufferImageSource({ resource: rgba, width: CHUNK_SIZE, height: CHUNK_SIZE, format: "rgba8unorm", scaleMode: "nearest" });
    const sprite = new Sprite(new Texture({ source }));
    sprite.position.set(cx * CHUNK_SIZE, cy * CHUNK_SIZE);
    this.world.addChild(sprite);
    const chunk = { colors, rgba, source, sprite };
    this.chunks.set(`${cx}:${cy}`, chunk);
    return chunk;
  }

  /** Re-uploads changed chunk buffers once per frame (`update()` re-reads the same `rgba` array). */
  private flush(): void {
    for (const chunk of this.dirty) chunk.source.update();
    this.dirty.clear();
  }

  /** Cell grid in screen space, only when zoomed in far enough to be useful. */
  private drawGrid(): void {
    this.grid.clear();
    const { zoom, x, y } = this.camera;
    if (zoom < GRID_MIN_ZOOM || this.canvasSize.width === 0) return;
    const { width, height } = this.app.screen;
    const left = Math.max(0, Math.floor(x - width / 2 / zoom));
    const top = Math.max(0, Math.floor(y - height / 2 / zoom));
    const right = Math.min(this.canvasSize.width, Math.ceil(x + width / 2 / zoom));
    const bottom = Math.min(this.canvasSize.height, Math.ceil(y + height / 2 / zoom));
    if (left > right || top > bottom) return;
    // Same origin as the world transform, so lines sit exactly on cell edges.
    const origin = this.origin();
    const toScreenX = (wx: number) => Math.round(origin.x + wx * zoom) + 0.5;
    const toScreenY = (wy: number) => Math.round(origin.y + wy * zoom) + 0.5;
    for (let gx = left; gx <= right; gx++) this.grid.moveTo(toScreenX(gx), toScreenY(top)).lineTo(toScreenX(gx), toScreenY(bottom));
    for (let gy = top; gy <= bottom; gy++) this.grid.moveTo(toScreenX(left), toScreenY(gy)).lineTo(toScreenX(right), toScreenY(gy));
    this.grid.stroke({ width: 1, color: 0xffffff, alpha: 0.08 });
  }
}
