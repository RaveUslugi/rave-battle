import { CHUNK_SIZE } from "./constants";
import type { GameConfig, ItemKey } from "./config/schema";

export const PROTOCOL_VERSION = 1;
export const MAX_SUBSCRIBED_CHUNKS = 64;

// ---- Client → server: binary frames (little-endian) ----

export const ClientOp = { Subscribe: 1, Place: 2 } as const;

export interface SubscribeMessage {
  op: typeof ClientOp.Subscribe;
  /** Replaces the whole subscription set. */
  chunks: Array<{ cx: number; cy: number }>;
}

export interface PlaceMessage {
  op: typeof ClientOp.Place;
  reqId: number;
  x: number;
  y: number;
  colorId: number;
  withBomb: boolean;
}

export type ClientMessage = SubscribeMessage | PlaceMessage;

// op u8 | reqId u32 | x u32 | y u32 | colorId u8 | flags u8
const PLACE_SIZE = 15;

export function encodeSubscribe(chunks: Array<{ cx: number; cy: number }>): Uint8Array {
  const bytes = new Uint8Array(3 + chunks.length * 4);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, ClientOp.Subscribe);
  view.setUint16(1, chunks.length, true);
  chunks.forEach((c, i) => {
    view.setUint16(3 + i * 4, c.cx, true);
    view.setUint16(5 + i * 4, c.cy, true);
  });
  return bytes;
}

export function encodePlace(m: Omit<PlaceMessage, "op">): Uint8Array {
  const bytes = new Uint8Array(PLACE_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, ClientOp.Place);
  view.setUint32(1, m.reqId, true);
  view.setUint32(5, m.x, true);
  view.setUint32(9, m.y, true);
  view.setUint8(13, m.colorId);
  view.setUint8(14, m.withBomb ? 1 : 0);
  return bytes;
}

/** Parses a client frame; returns null for anything malformed. Never throws. */
export function decodeClientMessage(bytes: Uint8Array): ClientMessage | null {
  if (bytes.byteLength < 1) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const op = view.getUint8(0);
  if (op === ClientOp.Subscribe) {
    if (bytes.byteLength < 3) return null;
    const count = view.getUint16(1, true);
    if (count > MAX_SUBSCRIBED_CHUNKS || bytes.byteLength !== 3 + count * 4) return null;
    const chunks: Array<{ cx: number; cy: number }> = [];
    for (let i = 0; i < count; i++) {
      chunks.push({ cx: view.getUint16(3 + i * 4, true), cy: view.getUint16(5 + i * 4, true) });
    }
    return { op: ClientOp.Subscribe, chunks };
  }
  if (op === ClientOp.Place) {
    if (bytes.byteLength !== PLACE_SIZE) return null;
    const flags = view.getUint8(14);
    if (flags > 1) return null;
    return {
      op: ClientOp.Place,
      reqId: view.getUint32(1, true),
      x: view.getUint32(5, true),
      y: view.getUint32(9, true),
      colorId: view.getUint8(13),
      withBomb: flags === 1,
    };
  }
  return null;
}

// ---- Server → client: binary chunk delta ----

export const ServerOp = { ChunkDelta: 1 } as const;

/** Absolute new colors of changed cells; `index` is row-major inside the chunk. */
export interface ChunkDelta {
  cx: number;
  cy: number;
  fromVersion: number;
  toVersion: number;
  cells: Array<{ index: number; colorId: number }>;
}

// op u8 | cx u16 | cy u16 | from u32 | to u32 | count u32 | count × (index u16, colorId u8)
const DELTA_HEADER = 17;

export function encodeChunkDelta(d: ChunkDelta): Uint8Array {
  const bytes = new Uint8Array(DELTA_HEADER + d.cells.length * 3);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, ServerOp.ChunkDelta);
  view.setUint16(1, d.cx, true);
  view.setUint16(3, d.cy, true);
  view.setUint32(5, d.fromVersion, true);
  view.setUint32(9, d.toVersion, true);
  view.setUint32(13, d.cells.length, true);
  d.cells.forEach((cell, i) => {
    view.setUint16(DELTA_HEADER + i * 3, cell.index, true);
    view.setUint8(DELTA_HEADER + i * 3 + 2, cell.colorId);
  });
  return bytes;
}

export function decodeChunkDelta(bytes: Uint8Array): ChunkDelta | null {
  if (bytes.byteLength < DELTA_HEADER) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== ServerOp.ChunkDelta) return null;
  const count = view.getUint32(13, true);
  if (bytes.byteLength !== DELTA_HEADER + count * 3) return null;
  const cells: ChunkDelta["cells"] = [];
  for (let i = 0; i < count; i++) {
    cells.push({ index: view.getUint16(DELTA_HEADER + i * 3, true), colorId: view.getUint8(DELTA_HEADER + i * 3 + 2) });
  }
  return {
    cx: view.getUint16(1, true),
    cy: view.getUint16(3, true),
    fromVersion: view.getUint32(5, true),
    toVersion: view.getUint32(9, true),
    cells,
  };
}

// ---- HTTP chunk body: version u32 | colors (CHUNK_SIZE²) ----

export function encodeChunkBody(version: number, colors: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(4 + colors.byteLength);
  new DataView(bytes.buffer).setUint32(0, version, true);
  bytes.set(colors, 4);
  return bytes;
}

export function decodeChunkBody(bytes: Uint8Array): { version: number; colors: Uint8Array } | null {
  if (bytes.byteLength !== 4 + CHUNK_SIZE * CHUNK_SIZE) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { version: view.getUint32(0, true), colors: bytes.slice(4) };
}

// ---- GET /overview: the whole canvas sampled down for the minimap ----

export const OVERVIEW_MAX_SIDE = 256;

export interface Overview {
  /** Canvas cells per overview cell (the top-left cell of each block is sampled). */
  step: number;
  width: number;
  height: number;
  colors: Uint8Array;
}

export function overviewShape(canvasWidth: number, canvasHeight: number): Omit<Overview, "colors"> {
  const step = Math.max(1, Math.ceil(Math.max(canvasWidth, canvasHeight) / OVERVIEW_MAX_SIDE));
  return { step, width: Math.ceil(canvasWidth / step), height: Math.ceil(canvasHeight / step) };
}

/** u16 LE step, width, height, then width×height color ids. */
export function encodeOverview(o: Overview): Uint8Array {
  const bytes = new Uint8Array(6 + o.colors.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, o.step, true);
  view.setUint16(2, o.width, true);
  view.setUint16(4, o.height, true);
  bytes.set(o.colors, 6);
  return bytes;
}

export function decodeOverview(bytes: Uint8Array): Overview | null {
  if (bytes.byteLength < 6) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const step = view.getUint16(0, true);
  const width = view.getUint16(2, true);
  const height = view.getUint16(4, true);
  if (bytes.byteLength !== 6 + width * height) return null;
  return { step, width, height, colors: bytes.slice(6) };
}

// ---- Server → client: JSON text messages ----

export interface UserRef {
  id: number;
  name: string;
}

export interface PlayerView {
  coins: number;
  /** Settled at the time the view was built; the client regenerates locally from here. */
  charges: number;
  chargesUpdatedAt: number;
  chargeCap: number;
  frozenUntil: number;
  inventory: Record<ItemKey, number>;
  unlockedColors: number[];
  dailyStep: number;
  dailyLastClaim: string | null;
  bannedUntil: number | "permanent" | null;
  /** "ok", or why the player may only watch (ban, not in the guild, account too new). Freeze is separate. */
  access: "ok" | "banned" | "not_guild_member" | "account_too_new";
  /** Dev account: spends nothing and cannot be frozen. */
  unlimited: boolean;
  /** Server clock when this view was built: lets the client compare server timestamps despite clock skew. */
  serverNow: number;
}

export type PlaceResultView =
  | { ok: true; outcome: "placed" }
  | { ok: true; outcome: "exploded"; self: boolean; frozenUntil: number; coinsLost: number; bombOwner: UserRef }
  | { ok: false; code: string };

export type ServerMessage =
  | {
      type: "hello";
      protocol: number;
      /**
       * Changes on every server start. When it differs from the previous connection's, the client must
       * drop all loaded chunks and their versions.
       */
      bootId: string;
      user: UserRef | null;
      config: GameConfig;
      player: PlayerView | null;
    }
  | { type: "player"; player: PlayerView }
  | { type: "placed"; reqId: number; result: PlaceResultView }
  | { type: "feed"; kind: "exploded" | "defused"; actor: UserRef; owner: UserRef; at: number }
  /** Sent once right after `hello`: the latest feed entries, oldest first. Replaces whatever the client showed before. */
  | { type: "feed_history"; entries: Array<Extract<ServerMessage, { type: "feed" }>> }
  | { type: "online"; count: number }
  /**
   * Answer to SUBSCRIBE listing only newly added chunks with their current version. Deltas for them
   * follow from that version on, so a client must reload any chunk loaded at a lower version.
   * Versions are only comparable within one `bootId`.
   */
  | { type: "subscribed"; chunks: Array<{ cx: number; cy: number; version: number }> };
