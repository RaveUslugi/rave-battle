import { type ConfigIssue, configIssuesFromZod, gameConfigSchema, type GameConfig, type PaletteEntry } from "@rave/shared";

export const SECTIONS = [
  "canvas",
  "charges",
  "coinsPerPixel",
  "explosion",
  "bombs",
  "antiFarm",
  "defuse",
  "shop",
  "starting",
  "daily",
  "access",
  "chat",
] as const;
/** "general" collects issues whose path does not belong to any section. */
export type Section = (typeof SECTIONS)[number] | "palette" | "general";
export type Issues = Partial<Record<Section, string[]>>;

export interface Draft {
  /** Pretty JSON per non-palette section, as the admin typed it. */
  texts: Record<(typeof SECTIONS)[number], string>;
  palette: PaletteEntry[];
}

const ALL_SECTIONS: readonly string[] = [...SECTIONS, "palette"];
const MISSING = "—";

export function draftFrom(config: GameConfig): Draft {
  const texts = {} as Draft["texts"];
  for (const key of SECTIONS) texts[key] = JSON.stringify(config[key], null, 2);
  return { texts, palette: structuredClone(config.palette) };
}

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  return path.reduce<string>((acc, part) => {
    if (typeof part === "number") return `${acc}[${part}]`;
    return acc === "" ? String(part) : `${acc}.${String(part)}`;
  }, "");
}

function addIssue(issues: Issues, path: ReadonlyArray<PropertyKey>, message: string): void {
  const [head, ...rest] = path;
  const section = (ALL_SECTIONS.includes(String(head)) ? head : "general") as Section;
  const where = section === "palette" ? formatPath(path) : section === "general" ? formatPath(path) : formatPath(rest);
  if (where === "palette") {
    issues.palette ??= [];
    issues.palette.push(message);
    return;
  }
  issues[section] ??= [];
  issues[section].push(where === "" ? message : `${where}: ${message}`);
}

const num = (v: unknown) => (typeof v === "number" || typeof v === "bigint" ? String(v) : "?");

function boundText(params: Record<string, unknown>, kind: "min" | "max"): string {
  const value = num(kind === "min" ? params.minimum : params.maximum);
  const inclusive = params.inclusive !== false;
  if (params.origin === "array") return kind === "min" ? `Минимум ${value} элем.` : `Максимум ${value} элем.`;
  if (params.origin === "string") return kind === "min" ? `Минимум ${value} симв.` : `Максимум ${value} симв.`;
  if (kind === "min") return inclusive ? `Не меньше ${value}` : `Больше ${value}`;
  return inclusive ? `Не больше ${value}` : `Меньше ${value}`;
}

/** Text for an issue code from the server or the shared schema. */
export function issueText(issue: ConfigIssue): string {
  const p = issue.params ?? {};
  switch (issue.code) {
    case "canvas_shrink":
      return `Холст может только расти (сейчас ${num(p.current)})`;
    case "color_in_use_removed":
      return `Цвет ${num(p.id)} есть на холсте (${num(p.used)} пикс.) — удалить нельзя`;
    case "color_in_use_type_changed":
      return `Цвет ${num(p.id)} есть на холсте — менять его тип нельзя`;
    case "duplicate_palette_id":
      return `Цвет ${num(p.id)} встречается дважды`;
    case "shop_color_needs_price":
      return `Цвету ${num(p.id)} из магазина нужна цена`;
    case "base_color_missing":
      return `Базовый цвет ${num(p.id)} должен быть в палитре и открыт по умолчанию`;
    case "unknown_timezone":
      return "Неизвестный часовой пояс";
    case "zod_too_small":
      return boundText(p, "min");
    case "zod_too_big":
      return boundText(p, "max");
    case "zod_not_multiple_of":
      return `Должно быть кратно ${num(p.divisor)}`;
    case "zod_invalid_type":
      return typeof p.expected === "string" ? `Неверный тип: нужен ${p.expected}` : "Неверный тип";
    case "zod_invalid_format":
      return "Неверный формат";
    case "zod_unrecognized_keys":
      return "Лишние поля";
    case "zod_invalid_union":
    case "zod_invalid_value":
      return "Недопустимое значение";
    default:
      return "Некорректное значение";
  }
}

const pathParts = (path: string) => (path === "" ? [] : path.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p)));

/** Server issues carry dot-joined paths ("palette.3.price"); numeric parts become indexes. */
export function serverIssues(list: ConfigIssue[]): Issues {
  const issues: Issues = {};
  for (const issue of list) addIssue(issues, pathParts(issue.path), issueText(issue));
  return issues;
}

/** Parses every section and runs the shared schema; issues are grouped by section (path[0]). */
export function checkDraft(draft: Draft): { config: GameConfig | null; issues: Issues } {
  const issues: Issues = {};
  const raw: Record<string, unknown> = { palette: draft.palette };
  for (const key of SECTIONS) {
    try {
      raw[key] = JSON.parse(draft.texts[key]);
    } catch (e) {
      issues[key] = [`Ошибка JSON: ${e instanceof Error ? e.message : String(e)}`];
    }
  }
  if (Object.keys(issues).length > 0) return { config: null, issues };

  const parsed = gameConfigSchema.safeParse(raw);
  if (parsed.success) return { config: parsed.data, issues };
  for (const issue of configIssuesFromZod(parsed.error.issues)) addIssue(issues, pathParts(issue.path), issueText(issue));
  return { config: null, issues };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const show = (v: unknown) => (v === undefined ? MISSING : JSON.stringify(v));

function walk(a: unknown, b: unknown, path: string, out: Array<{ path: string; before: string; after: string }>): void {
  if (isObject(a) && isObject(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[key], b[key], path === "" ? key : `${path}.${key}`, out);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) walk(a[i], b[i], `${path}[${i}]`, out);
  } else if (JSON.stringify(a) !== JSON.stringify(b)) {
    out.push({ path, before: show(a), after: show(b) });
  }
}

/** Changed leaves "path: before → after"; palette entries are matched by id ("palette#33.price"). */
export function configDiff(before: GameConfig, after: GameConfig): Array<{ path: string; before: string; after: string }> {
  const out: Array<{ path: string; before: string; after: string }> = [];
  const { palette: pa, ...restA } = before;
  const { palette: pb, ...restB } = after;
  walk(restA, restB, "", out);

  const byIdA = new Map(pa.map((e) => [e.id, e]));
  const byIdB = new Map(pb.map((e) => [e.id, e]));
  const ids = [...new Set([...byIdA.keys(), ...byIdB.keys()])].sort((x, y) => x - y);
  for (const id of ids) {
    const a = byIdA.get(id);
    const b = byIdB.get(id);
    if (a === undefined || b === undefined) out.push({ path: `palette#${id}`, before: show(a), after: show(b) });
    else walk(a, b, `palette#${id}`, out);
  }
  return out;
}
