import { CONFIG_SECTIONS, type ConfigIssue, type ConfigSectionId, configIssuesFromZod, type GameConfig, gameConfigSchema, sectionOf } from "@rave/shared";
import { formatNumber, i18n } from "../../i18n";

/** Problems by dot-joined path ("charges.max", "palette.3.price", "palette"). */
export type Issues = Map<string, string[]>;

const t = i18n.t.bind(i18n);
const n = (v: unknown) => (typeof v === "number" ? formatNumber(v) : String(v ?? "?"));

function bound(p: Record<string, unknown>, kind: "min" | "max"): string {
  const value = n(kind === "min" ? p.minimum : p.maximum);
  if (p.origin === "array") return t(kind === "min" ? "admin.issue.minItems" : "admin.issue.maxItems", { n: value });
  if (p.origin === "string") return t(kind === "min" ? "admin.issue.minChars" : "admin.issue.maxChars", { n: value });
  const exclusive = p.inclusive === false;
  if (kind === "min") return t(exclusive ? "admin.issue.minExclusive" : "admin.issue.min", { n: value });
  return t(exclusive ? "admin.issue.maxExclusive" : "admin.issue.max", { n: value });
}

/** Text for an issue from the shared schema or the server. */
export function issueText(issue: ConfigIssue): string {
  const p = issue.params ?? {};
  switch (issue.code) {
    case "canvas_shrink":
    case "color_in_use_removed":
    case "color_in_use_type_changed":
    case "duplicate_palette_id":
    case "shop_color_needs_price":
    case "base_color_missing":
    case "unknown_timezone":
      return t(`admin.issue.${issue.code}`, { id: n(p.id), current: n(p.current), used: n(p.used) });
    case "zod_too_small":
      return bound(p, "min");
    case "zod_too_big":
      return bound(p, "max");
    case "zod_not_multiple_of":
      return t("admin.issue.multipleOf", { n: n(p.divisor) });
    case "zod_invalid_type":
      return t("admin.issue.type");
    case "zod_invalid_format":
      return t("admin.issue.format");
    case "zod_unrecognized_keys":
      return t("admin.issue.extra");
    case "zod_invalid_union":
    case "zod_invalid_value":
      return t("admin.issue.value");
    default:
      return t("admin.issue.fallback");
  }
}

export function issuesByPath(list: ConfigIssue[]): Issues {
  const out: Issues = new Map();
  for (const issue of list) out.set(issue.path, [...(out.get(issue.path) ?? []), issueText(issue)]);
  return out;
}

/** Validates a draft with the shared schema. */
export function checkConfig(draft: GameConfig): { config: GameConfig | null; issues: Issues } {
  const parsed = gameConfigSchema.safeParse(draft);
  if (parsed.success) return { config: parsed.data, issues: new Map() };
  return { config: null, issues: issuesByPath(configIssuesFromZod(parsed.error.issues)) };
}

/** Issues at `path` or below it ("daily.rewards" also gets "daily.rewards.2.amount"). */
export function issuesUnder(issues: Issues, path: string): string[] {
  return [...issues].flatMap(([p, list]) => (p === path || p.startsWith(`${path}.`) ? list : []));
}

/** Sections with at least one issue (the menu marks them). */
export function sectionsWithIssues(issues: Issues): Set<ConfigSectionId> {
  return new Set([...issues.keys()].map((p) => sectionOf(p)).filter((s): s is ConfigSectionId => s !== null));
}

export function getAt(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o === null || typeof o !== "object" ? undefined : (o as Record<string, unknown>)[k]), obj);
}

/** A copy of `obj` with `path` set to `value`; only the objects on the path are copied. */
export function setAt<T>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split(".");
  const key = head as string;
  const base = (Array.isArray(obj) ? [...obj] : { ...(obj as object) }) as Record<string, unknown>;
  base[key] = rest.length === 0 ? value : setAt(base[key], rest.join("."), value);
  return base as T;
}

/** Sections whose content differs between the saved config and the draft. */
export function changedSections(saved: GameConfig, draft: GameConfig): Set<ConfigSectionId> {
  return new Set(CONFIG_SECTIONS.filter((s) => JSON.stringify(saved[s]) !== JSON.stringify(draft[s])));
}

const MISSING = "—";
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
  for (const id of [...new Set([...byIdA.keys(), ...byIdB.keys()])].sort((x, y) => x - y)) {
    const a = byIdA.get(id);
    const b = byIdB.get(id);
    if (a === undefined || b === undefined) out.push({ path: `palette#${id}`, before: show(a), after: show(b) });
    else walk(a, b, `palette#${id}`, out);
  }
  return out;
}
