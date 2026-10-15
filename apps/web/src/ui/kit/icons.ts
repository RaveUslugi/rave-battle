/**
 * Pixel icons on a 16×16 grid. Paths use only h/v segments, so they stay crisp at 16/20/24/32 px.
 * `evenodd` icons cut holes (rings, checks inside shields). The coin is the only two-colour icon.
 */
export interface IconShape {
  d: string;
  evenOdd?: boolean;
  /** Fixed fills instead of currentColor, one per path. */
  layers?: Array<{ d: string; fill: string }>;
}

export const ICONS = {
  brush: { d: "M12 1h2v1h1v2h-1v1h-1v1h-1v1h-1v1h-1v1H9v1H8V9H7V8h1V7h1V6h1V5h1V4h1V3h-1V2h1z M3 10h3v1h1v2H7v1H6v1H1v-1h1v-3h1z" },
  bomb: { d: "M4 5h6v1h1v1h1v1h1v4h-1v1h-1v1h-1v1H4v-1H3v-1H2v-1H1V8h1V7h1V6h1z M10 3h2v2h-2z M12 1h1v1h1v1h-1V2h-1z" },
  detector: {
    d: "M6 1h4v1h2v1h1v2h1v6h-1v2h-1v1h-2v1H6v-1H4v-1H3v-2H2V5h1V3h1V2h2z M6 4h4v1h1v1h1v4h-1v1h-1v1H6v-1H5v-1H4V6h1V5h1z M7 7h2v2H7z",
    evenOdd: true,
  },
  defuser: {
    d: "M2 1h12v7h-1v2h-1v1h-1v1h-1v1H9v1H7v-1H6v-1H5v-1H4v-1H3V8H2z M4 6h2v1h1v1h1V7h1V6h1V5h1V4h2v2h-1v1h-1v1h-1v1H9v1H7V9H6V8H5V7H4z",
    evenOdd: true,
  },
  shop: { d: "M0 2h3v1h1v1h11v2h-1v2h-1v2H5v1h9v2H4v-1H3V4H2V3H0z M4 13h3v3H4z M11 13h3v3h-3z" },
  daily: { d: "M1 5h14v4h-1v6H2V9H1z M7 5h2v10H7z M3 1h3v1h1v2h2V2h1V1h3v2h-1v1h-1v1H4V4H3z", evenOdd: true },
  trophy: { d: "M3 1h10v2h2v3h-1v1h-1v1h-2v1h-1v1H9v2h2v1h1v3H4v-3h1v-1h2v-2H6V9H5V8H3V7H2V6H1V3h2z" },
  user: { d: "M5 1h6v1h1v4h-1v1H5V6H4V2h1z M2 9h12v1h1v5H1v-5h1z" },
  users: { d: "M2 2h5v5H2z M0 9h9v6H0z M10 3h4v4h-4z M10 9h6v6h-6z" },
  map: { d: "M1 1h14v14H1z M3 3h10v10H3z M5 5h5v4H5z", evenOdd: true },
  eye: { d: "M5 4h6v1h2v1h1v1h1v2h-1v1h-1v1h-2v1H5v-1H3v-1H2V9H1V7h1V6h1V5h2z M6 6h4v4H6z M7 7h2v2H7z", evenOdd: true },
  close: { d: "M2 2h3v1h1v1h1v1h2V4h1V3h1V2h3v3h-1v1h-1v1h-1v2h1v1h1v1h1v3h-3v-1h-1v-1H9v-1H7v1H6v1H5v1H2v-3h1v-1h1v-1h1V7H4V6H3V5H2z" },
  lock: { d: "M5 1h6v1h1v4h1v9H3V6h1V2h1z M6 3h4v3H6z M7 9h2v3H7z", evenOdd: true },
  charge: {
    d: "M8 0h5v1h-1v1h-1v2h-1v1h4v2h-1v1h-1v1h-1v1h-1v1H8v1H7v1H6v1H5v1H3v-2h1v-2h1v-2h1V9H2V7h1V6h1V5h1V4h1V3h1V1h1z",
  },
  check: { d: "M13 3h2v3h-1v1h-1v1h-1v1h-1v1h-1v1H9v1H8v1H6v-1H5v-1H4v-1H3V9H2V8h3v1h1v1h2V9h1V8h1V7h1V6h1V5h1z" },
  boom: { d: "M7 0h2v4h1V3h1V2h2v2h-1v1h-1v1h4v2h-3v1h1v1h1v1h1v2h-2v-1h-1v-1H9v4H7v-4H6v1H5v1H3v-2h1v-1h1V9h1V8H2V6h4V5H5V4H4V2h2v1h1z" },
  freeze: {
    d: "M7 0h2v3h1V2h1v2H9v2h2V5h1v2h1V6h2v2h-2v1h-1V8h-1v1H9v2h2v2h-1v-1H9v3H7v-3H6v1H5v-2h2V9H5v1H4V9H3v1H1V8h2V7h1v1h1V7h2V5H5V4h1V2h1z",
  },
  effect: { d: "M7 1h2v4h1v1h1v1h4v2h-4v1h-1v1H9v4H7v-4H6v-1H5V9H1V7h4V6h1V5h1z" },
  plus: { d: "M7 2h2v5h5v2H9v5H7V9H2V7h5z" },
  minus: { d: "M2 7h12v2H2z" },
  chevronDown: { d: "M3 5h2v1h1v1h1v1h2V7h1V6h1V5h2v2h-1v1h-1v1h-1v1H9v1H7v-1H6V9H5V8H4V7H3z" },
  send: { d: "M1 1h2v1h2v1h2v1h2v1h2v1h2v1h2v2h-2v1h-2v1H9v1H7v1H5v1H3v1H1v-6h7V7H1z" },
  chat: { d: "M1 2h14v9H7v1H6v1H5v1H3v-3H1z M4 5h8v1H4z M4 8h5v1H4z", evenOdd: true },
  menu: { d: "M1 1h6v6H1z M9 1h6v6H9z M1 9h6v6H1z M9 9h6v6H9z" },
  search: { d: "M5 1h5v1h1v1h1v5h-1v1h-1v1H5V9H4V8H3V3h1V2h1z M6 3h3v1h1v3H9v1H6V7H5V4h1z M11 10h2v1h1v1h1v2h-2v-1h-1v-1h-1z", evenOdd: true },
  chart: { d: "M1 9h3v6H1z M6 5h3v10H6z M11 1h3v14h-3z" },
  sliders: { d: "M1 3h14v2H1z M1 7h14v2H1z M1 11h14v2H1z M4 2h2v4H4z M10 6h2v4h-2z M6 10h2v4H6z" },
  list: { d: "M1 2h2v2H1z M5 2h10v2H5z M1 7h2v2H1z M5 7h10v2H5z M1 12h2v2H1z M5 12h7v2H5z" },
  back: { d: "M6 3h2v2H7v1h8v2H7v1h1v2H6v-1H5V9H4V8H3V7h1V6h1V5h1z" },
  ban: {
    d: "M5 1h6v1h2v2h1v1h1v6h-1v1h-1v2h-2v1H5v-1H3v-2H2v-1H1V5h1V4h1V2h2z M6 3h4v1h1v1h-1v1H9v1H8v1H7v1H6v1H5v1H4V6h1V5h1z M11 6h1v4h-1v1h-1v1H6v-1h1v-1h1V9h1V8h1V7h1z",
    evenOdd: true,
  },
  undo: { d: "M5 2h2v2h5v1h1v1h1v5h-1v1h-1v1H6v-2h5v-1h1V7h-1V6H7v2H5V7H4V6H3V5h1V4h1z" },
  area: { d: "M1 1h4v2H3v2H1z M11 1h4v4h-2V3h-2z M1 11h2v2h2v2H1z M13 11h2v4h-4v-2h2z M7 1h2v2H7z M7 13h2v2H7z M1 7h2v2H1z M13 7h2v2h-2z" },
  pointer: { d: "M2 1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v2H9v1h1v2h1v2H9v-1H8v-2H7v-1H6v1H5v1H4v1H2z" },
  coin: {
    d: "",
    layers: [
      { d: "M5 1h6v1h2v2h1v8h-1v2h-2v1H5v-1H3v-2H2V4h1V2h2z", fill: "#ffc83d" },
      { d: "M7 4h2v8H7z M5 3h1v1H5z", fill: "#a86f12" },
    ],
  },
} satisfies Record<string, IconShape>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];
