/** Moderation log actions. Shared so the admin UI never imports server source. */
export const MOD_ACTIONS = [
  "ban",
  "unban",
  "player_edit",
  "config_save",
  "config_rollback",
  "rollback_player",
  "clear_area",
  "remove_bombs",
  "chat_mute",
  "chat_unmute",
  "chat_delete",
] as const;
export type ModAction = (typeof MOD_ACTIONS)[number];

/** Inclusive canvas rectangle. */
export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Largest area one moderation action may touch (e.g. 256×256). */
export const MAX_AREA_CELLS = 65_536;
/** Most cells one whole-canvas player rollback may touch. */
export const MAX_ROLLBACK_CELLS = 200_000;

export const rectCells = (r: Rect) => (r.x2 - r.x1 + 1) * (r.y2 - r.y1 + 1);

/** Corner order does not matter: returns x1 ≤ x2, y1 ≤ y2. */
export function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) };
}
