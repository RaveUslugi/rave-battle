import type { IconName } from "../ui/kit/icons";

export type Board = "artists" | "bombers" | "sappers" | "kamikaze" | "territory";
export type Period = "day" | "week" | "all";

/** Board titles and hints are the i18n keys `leaders.<board>` and `leaders.<board>Hint`. */
export const BOARDS: Array<{ board: Board; icon: IconName }> = [
  { board: "artists", icon: "brush" },
  { board: "bombers", icon: "bomb" },
  { board: "sappers", icon: "defuser" },
  { board: "kamikaze", icon: "boom" },
  { board: "territory", icon: "map" },
];

export const PERIODS: Period[] = ["day", "week", "all"];

/** Territory is "now" only: no period choice. */
export function periodsFor(board: Board): Period[] {
  return board === "territory" ? [] : PERIODS;
}
