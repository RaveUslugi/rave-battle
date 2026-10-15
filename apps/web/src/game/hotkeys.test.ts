import { describe, expect, test } from "bun:test";
import { defaultConfig } from "@rave/shared";
import { hotkeyAction, isTypingTarget, stepColor } from "./hotkeys";

const key = (code: string, extra: Partial<KeyboardEvent> = {}) => ({ key: "", code, ctrlKey: false, metaKey: false, altKey: false, ...extra });

describe("hotkeys", () => {
  test("physical keys map to actions in any layout; modifiers are left to the browser", () => {
    expect(hotkeyAction(key("Digit1", { key: "1" }))).toEqual({ type: "tool", tool: "paint" });
    expect(hotkeyAction(key("Digit3", { key: "3" }))).toEqual({ type: "tool", tool: "defuser" });
    expect(hotkeyAction(key("KeyB", { key: "и" }))).toEqual({ type: "bomb" });
    expect(hotkeyAction(key("KeyQ", { key: "й" }))).toEqual({ type: "color", step: -1 });
    expect(hotkeyAction(key("KeyE"))).toEqual({ type: "color", step: 1 });
    expect(hotkeyAction(key("Escape", { key: "Escape" }))).toEqual({ type: "escape" });
    expect(hotkeyAction(key("KeyB", { ctrlKey: true }))).toBeNull();
    expect(hotkeyAction(key("KeyZ"))).toBeNull();
  });

  test("fields swallow the shortcuts", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({ closest: () => ({}) } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ closest: () => null } as unknown as EventTarget)).toBe(false);
  });

  test("colour stepping skips locked colours and wraps", () => {
    const palette = defaultConfig.palette.slice(0, 5);
    const open = (e: { id: number }) => e.id !== 2;
    expect(stepColor(palette, open, 1, 1)).toBe(3);
    expect(stepColor(palette, open, 4, 1)).toBe(0);
    expect(stepColor(palette, open, 0, -1)).toBe(4);
    expect(stepColor(palette, open, 99, -1)).toBe(4);
    expect(stepColor(palette, () => false, 1, 1)).toBe(1);
  });
});
