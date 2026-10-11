export const BAN_PRESETS = [
  { key: "1h", label: "1 час", ms: 3_600_000 },
  { key: "24h", label: "24 часа", ms: 86_400_000 },
  { key: "7d", label: "7 дней", ms: 7 * 86_400_000 },
  { key: "30d", label: "30 дней", ms: 30 * 86_400_000 },
  { key: "forever", label: "Навсегда", ms: null },
] as const;

export type BanPresetKey = (typeof BAN_PRESETS)[number]["key"];

/** `custom` is a datetime-local value in the admin's time zone. Null means the choice is unusable. */
export function banUntil(choice: { preset: BanPresetKey } | { custom: string }, now: number): number | "permanent" | null {
  if ("preset" in choice) {
    const preset = BAN_PRESETS.find((p) => p.key === choice.preset);
    if (!preset) return null;
    return preset.ms === null ? "permanent" : now + preset.ms;
  }
  if (choice.custom.trim() === "") return null;
  const at = new Date(choice.custom).getTime();
  return Number.isFinite(at) && at > now ? at : null;
}

const MAX_DELTA = 1_000_000;

/** Parses a balance delta such as "+500", "-2" or "0"; an empty field means 0. Null when invalid. */
export function parseDelta(text: string): number | null {
  const t = text.trim().replace("−", "-");
  if (t === "") return 0;
  if (!/^[+-]?\d+$/.test(t)) return null;
  const n = Number(t);
  return Math.abs(n) > MAX_DELTA ? null : n;
}
