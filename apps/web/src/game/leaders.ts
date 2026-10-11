export type Board = "artists" | "bombers" | "sappers" | "kamikaze" | "territory";
export type Period = "day" | "week" | "all";

export const BOARD_TABS: Array<{ board: Board; icon: string; title: string; hint: string }> = [
  { board: "artists", icon: "🎨", title: "Художники", hint: "поставленные пиксели" },
  { board: "bombers", icon: "💣", title: "Бомберы", hint: "подрывы на ваших бомбах" },
  { board: "sappers", icon: "🧯", title: "Сапёры", hint: "обезвреженные чужие бомбы" },
  { board: "kamikaze", icon: "💥", title: "Камикадзе", hint: "подрывы на чужих бомбах" },
  { board: "territory", icon: "🗺", title: "Территория", hint: "клеток на холсте сейчас" },
];

const PERIODS: Array<{ period: Period; title: string }> = [
  { period: "day", title: "День" },
  { period: "week", title: "7 дней" },
  { period: "all", title: "Всё время" },
];

export function periodsFor(board: Board): typeof PERIODS {
  return board === "territory" ? [] : PERIODS;
}

/** Plain spaces between thousands: ru-RU grouping uses a no-break space, normalised here. */
export function formatValue(n: number): string {
  return n.toLocaleString("ru-RU").replace(/\s/g, " ");
}
