import { CHUNK_SIZE } from "@rave/shared";
import type { UserId } from "./types";

export interface CellState {
  colorId: number;
  ownerId: UserId;
}

export interface Chunk {
  colors: Uint8Array;
  owners: Int32Array;
}

function assertChunkAligned(width: number, height: number): void {
  if (width <= 0 || height <= 0 || width % CHUNK_SIZE !== 0 || height % CHUNK_SIZE !== 0) {
    throw new Error(`Canvas ${width}x${height} must be positive multiples of ${CHUNK_SIZE}`);
  }
}

const chunkKey = (cx: number, cy: number) => `${cx}:${cy}`;
const localIndex = (x: number, y: number) => (y % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE);

export class CanvasStore {
  private chunks = new Map<string, Chunk>();
  private territory = new Map<UserId, number>();
  /** Cells per non-zero color id across loaded chunks. */
  private colorCounts = new Float64Array(256);

  constructor(
    private _width: number,
    private _height: number,
  ) {
    assertChunkAligned(_width, _height);
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  inBounds(x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this._width && y < this._height;
  }

  get(x: number, y: number): CellState {
    const chunk = this.chunks.get(chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE)));
    if (!chunk) return { colorId: 0, ownerId: 0 };
    const i = localIndex(x, y);
    return { colorId: chunk.colors[i] ?? 0, ownerId: chunk.owners[i] ?? 0 };
  }

  /** Writes a cell and returns its previous state. Caller must check inBounds(). */
  set(x: number, y: number, colorId: number, ownerId: UserId): CellState {
    const chunk = this.ensureChunk(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));
    const i = localIndex(x, y);
    const prev: CellState = { colorId: chunk.colors[i] ?? 0, ownerId: chunk.owners[i] ?? 0 };
    chunk.colors[i] = colorId;
    chunk.owners[i] = ownerId;
    this.addTerritory(prev.ownerId, -1);
    this.addTerritory(ownerId, 1);
    if (prev.colorId !== 0) this.colorCounts[prev.colorId]! -= 1;
    if (colorId !== 0) this.colorCounts[colorId]! += 1;
    return prev;
  }

  getChunk(cx: number, cy: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cy));
  }

  /** Replaces a whole chunk (recovery) and rebuilds territory for its cells. */
  loadChunk(cx: number, cy: number, chunk: Chunk): void {
    const cells = CHUNK_SIZE * CHUNK_SIZE;
    if (chunk.colors.length !== cells || chunk.owners.length !== cells) {
      throw new Error(`Chunk ${cx}:${cy} must have ${cells} cells`);
    }
    const key = chunkKey(cx, cy);
    const old = this.chunks.get(key);
    if (old) {
      for (const owner of old.owners) this.addTerritory(owner, -1);
      for (const color of old.colors) if (color !== 0) this.colorCounts[color]! -= 1;
    }
    for (const owner of chunk.owners) this.addTerritory(owner, 1);
    for (const color of chunk.colors) if (color !== 0) this.colorCounts[color]! += 1;
    this.chunks.set(key, chunk);
  }

  territoryOf(userId: UserId): number {
    return this.territory.get(userId) ?? 0;
  }

  /** Cells painted with the color; for 0 (background) every cell not painted by another color. */
  colorCount(colorId: number): number {
    if (colorId !== 0) return this.colorCounts[colorId] ?? 0;
    let painted = 0;
    for (let i = 1; i < this.colorCounts.length; i++) painted += this.colorCounts[i]!;
    return this._width * this._height - painted;
  }

  /** Cells owned per user (only users with at least one cell). */
  territories(): IterableIterator<[UserId, number]> {
    return this.territory.entries();
  }

  resize(width: number, height: number): void {
    assertChunkAligned(width, height);
    if (width < this._width || height < this._height) {
      throw new Error(`Canvas can only grow: ${this._width}x${this._height} -> ${width}x${height}`);
    }
    this._width = width;
    this._height = height;
  }

  private ensureChunk(cx: number, cy: number): Chunk {
    const key = chunkKey(cx, cy);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = {
        colors: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE),
        owners: new Int32Array(CHUNK_SIZE * CHUNK_SIZE),
      };
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  private addTerritory(ownerId: UserId, delta: number): void {
    if (ownerId === 0) return;
    const next = (this.territory.get(ownerId) ?? 0) + delta;
    if (next === 0) this.territory.delete(ownerId);
    else this.territory.set(ownerId, next);
  }
}
