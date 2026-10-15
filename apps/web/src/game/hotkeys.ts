import type { PaletteEntry } from "@rave/shared/client";
import type { ActiveTool } from "../state/ui-store";

export type HotkeyAction = { type: "tool"; tool: ActiveTool } | { type: "bomb" } | { type: "color"; step: 1 | -1 } | { type: "escape" };

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey">;

const TOOL_KEYS: Record<string, ActiveTool> = { Digit1: "paint", Digit2: "detector", Digit3: "defuser" };

/**
 * Desktop shortcuts: 1–3 tools, B "+ bomb", Q/E previous/next colour, Esc. Physical key codes, so the
 * Russian layout works the same; modifier combos stay with the browser.
 */
export function hotkeyAction(e: KeyLike): HotkeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === "Escape") return { type: "escape" };
  const tool = TOOL_KEYS[e.code];
  if (tool) return { type: "tool", tool };
  if (e.code === "KeyB") return { type: "bomb" };
  if (e.code === "KeyQ") return { type: "color", step: -1 };
  if (e.code === "KeyE") return { type: "color", step: 1 };
  return null;
}

/** Typing in a field (chat, dev login) must not switch tools. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  return (target as Element).closest("input, textarea, select, [contenteditable='true']") !== null;
}

/** Open colours only (locked ones are skipped), wrapping around. Returns `current` when nothing else is open. */
export function stepColor(palette: PaletteEntry[], isOpen: (entry: PaletteEntry) => boolean, current: number, step: 1 | -1): number {
  const open = palette.filter(isOpen);
  if (open.length === 0) return current;
  const at = open.findIndex((e) => e.id === current);
  if (at === -1) return open[step === 1 ? 0 : open.length - 1]!.id;
  return open[(at + step + open.length) % open.length]!.id;
}
