import { normalizeRect, type Rect } from "@rave/shared/client";

type Cell = { x: number; y: number };

/** Second tap closes the rectangle; the first one only remembers the corner. */
export function tapCorner(corner: Cell | null, cell: Cell): { corner: Cell | null; area: Rect | null } {
  if (!corner) return { corner: cell, area: null };
  return { corner: null, area: normalizeRect(corner, cell) };
}
