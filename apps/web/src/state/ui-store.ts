import type { Rect } from "@rave/shared/client";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Tool } from "../game/tools";
import type { SheetHeight } from "../ui/kit/Sheet";
import type { IconName } from "../ui/kit/icons";

export type ActiveTool = "paint" | Tool | "inspect" | "area";

/** A section of the side panel (desktop) or the bottom sheet (phone); the chat is a section only on the phone. */
export type Panel = "chat" | "shop" | "daily" | "leaders" | "profile";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** What the admin canvas page works on. `corner` is the first tap of an area on a touch screen. */
export interface ModerationTarget {
  cell: { x: number; y: number } | null;
  area: Rect | null;
  corner: { x: number; y: number } | null;
}

export type ToastTone = "error" | "success" | "info";

export interface Toast {
  id: number;
  tone: ToastTone;
  text: string;
  icon?: IconName;
  /** Repeats of the same message while it was on screen. */
  count: number;
}

export interface ExplosionInfo {
  id: number;
  self: boolean;
  coinsLost: number;
  frozenUntil: number;
  bombOwner: string;
  at: number;
}

export interface UiState {
  selectedColor: number;
  bombMode: boolean;
  /** Cell picked by a touch tap, waiting for confirmation. */
  selection: { x: number; y: number } | null;
  toasts: Toast[];
  explosion: ExplosionInfo | null;
  /** What a tap does. Bomb mode only applies to "paint". */
  tool: ActiveTool;
  /** The side panel tab, or null when closed. */
  panel: Panel | null;
  /** Whose profile the profile tab shows; null = the logged-in player. */
  profileUserId: number | null;
  moderation: ModerationTarget;
  /** Last picked colours, newest first: the phone dock shows them. */
  recentColors: number[];
  sheetHeight: SheetHeight;
  /** Phone: the full colour grid above the dock. */
  paletteOpen: boolean;
  /** Desktop: the chat block folded down to its header. */
  chatCollapsed: boolean;
  minimapOpen: boolean;
  /** Shop offer to scroll to and highlight, e.g. after tapping a tool with nothing left. */
  shopFocus: string | null;
  setTool(tool: ActiveTool): void;
  inspectCell(cell: { x: number; y: number }): void;
  setArea(area: Rect | null): void;
  setCorner(corner: { x: number; y: number } | null): void;
  selectColor(id: number): void;
  setBombMode(on: boolean): void;
  select(cell: { x: number; y: number } | null): void;
  pushToast(tone: ToastTone, text: string, icon?: IconName): number;
  dismissToast(id: number): void;
  setExplosion(info: Omit<ExplosionInfo, "id"> | null): void;
  togglePanel(panel: Panel): void;
  openPanel(panel: Panel): void;
  closePanel(): void;
  openProfile(userId: number | null): void;
  openShop(focus: string | null): void;
  setSheetHeight(height: SheetHeight): void;
  setPaletteOpen(open: boolean): void;
  setChatCollapsed(collapsed: boolean): void;
  setMinimapOpen(open: boolean): void;
}

const COLOR_KEY = "rb:color";
const RECENT_KEY = "rb:recent-colors";
const MINIMAP_KEY = "rb:minimap";
const MAX_TOASTS = 4;
export const RECENT_COLORS = 8;
/** Yellow in the default palette: visible on the black board. */
export const DEFAULT_COLOR = 5;

function readColor(storage: StorageLike | null): number {
  try {
    const raw = storage?.getItem(COLOR_KEY);
    const value = raw == null ? Number.NaN : Number(raw);
    return Number.isInteger(value) && value >= 0 && value <= 255 ? value : DEFAULT_COLOR;
  } catch {
    return DEFAULT_COLOR;
  }
}

function readRecent(storage: StorageLike | null, selected: number): number[] {
  let stored: number[] = [];
  try {
    const raw = JSON.parse(storage?.getItem(RECENT_KEY) ?? "[]");
    if (Array.isArray(raw)) stored = raw.filter((v): v is number => Number.isInteger(v) && v >= 0 && v <= 255);
  } catch {
    // Broken or blocked storage: start from the selected colour.
  }
  return [selected, ...stored.filter((v) => v !== selected)].slice(0, RECENT_COLORS);
}

function write(storage: StorageLike | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the choice just won't survive a reload.
  }
}

export function createUiStore(storage: StorageLike | null) {
  let nextId = 1;
  const initialColor = readColor(storage);
  return createStore<UiState>()((set) => ({
    selectedColor: initialColor,
    bombMode: false,
    selection: null,
    toasts: [],
    explosion: null,
    tool: "paint",
    panel: null,
    profileUserId: null,
    moderation: { cell: null, area: null, corner: null },
    recentColors: readRecent(storage, initialColor),
    sheetHeight: "half",
    paletteOpen: false,
    chatCollapsed: false,
    minimapOpen: (() => {
      try {
        return storage?.getItem(MINIMAP_KEY) !== "0";
      } catch {
        return true;
      }
    })(),
    shopFocus: null,
    // The pending selection meant something else under the previous tool.
    // A half-made area corner belongs to the previous tool too.
    setTool: (tool) => set((s) => ({ tool, selection: null, ...(s.moderation.corner ? { moderation: { ...s.moderation, corner: null } } : {}) })),
    selectColor: (id) =>
      set((s) => {
        const recentColors = [id, ...s.recentColors.filter((c) => c !== id)].slice(0, RECENT_COLORS);
        write(storage, COLOR_KEY, String(id));
        write(storage, RECENT_KEY, JSON.stringify(recentColors));
        return { selectedColor: id, recentColors };
      }),
    setBombMode: (bombMode) => set({ bombMode }),
    select: (selection) => set({ selection }),
    inspectCell: (cell) => set({ moderation: { cell, area: null, corner: null } }),
    setArea: (area) => set({ moderation: { cell: null, area, corner: null } }),
    setCorner: (corner) => set((s) => ({ moderation: { ...s.moderation, corner } })),
    pushToast: (tone, text, icon) => {
      const id = nextId++;
      // Repeated clicks must not stack copies: the repeat counts up, and the new id restarts the dismiss timer.
      set((s) => {
        const same = s.toasts.find((t) => t.tone === tone && t.text === text);
        const toast: Toast = { id, tone, text, count: (same?.count ?? 0) + 1, ...(icon ? { icon } : {}) };
        return { toasts: [...s.toasts.filter((t) => t !== same), toast].slice(-MAX_TOASTS) };
      });
      return id;
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    setExplosion: (info) => set({ explosion: info ? { ...info, id: nextId++ } : null }),
    togglePanel: (panel) => set((s) => ({ panel: s.panel === panel ? null : panel, shopFocus: null })),
    openPanel: (panel) => set({ panel, shopFocus: null }),
    closePanel: () => set({ panel: null }),
    openProfile: (profileUserId) => set({ panel: "profile", profileUserId }),
    openShop: (shopFocus) => set({ panel: "shop", shopFocus }),
    setSheetHeight: (sheetHeight) => set({ sheetHeight }),
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    setChatCollapsed: (chatCollapsed) => set({ chatCollapsed }),
    setMinimapOpen: (minimapOpen) => {
      write(storage, MINIMAP_KEY, minimapOpen ? "1" : "0");
      set({ minimapOpen });
    },
  }));
}

export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export const uiStore = createUiStore(browserStorage());

export function useUi<T>(selector: (state: UiState) => T): T {
  return useStore(uiStore, selector);
}
