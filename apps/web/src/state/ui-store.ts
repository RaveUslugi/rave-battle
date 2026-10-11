import type { Rect } from "@rave/shared/client";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Tool } from "../game/tools";

export type ActiveTool = "paint" | Tool | "inspect" | "area";

export type Panel = "shop" | "daily" | "leaders" | "profile" | "moderation";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** What the admin moderation panel works on. `corner` is the first tap of an area on a touch screen. */
export interface ModerationTarget {
  cell: { x: number; y: number } | null;
  area: Rect | null;
  corner: { x: number; y: number } | null;
}

export interface Toast {
  id: number;
  kind: "error" | "info";
  text: string;
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
  setTool(tool: ActiveTool): void;
  inspectCell(cell: { x: number; y: number }): void;
  setArea(area: Rect | null): void;
  setCorner(corner: { x: number; y: number } | null): void;
  selectColor(id: number): void;
  setBombMode(on: boolean): void;
  select(cell: { x: number; y: number } | null): void;
  pushToast(kind: Toast["kind"], text: string): number;
  dismissToast(id: number): void;
  setExplosion(info: Omit<ExplosionInfo, "id"> | null): void;
  togglePanel(panel: Panel): void;
  openPanel(panel: Panel): void;
  closePanel(): void;
  openProfile(userId: number | null): void;
}

const COLOR_KEY = "rb:color";
const MAX_TOASTS = 4;
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

export function createUiStore(storage: StorageLike | null) {
  let nextId = 1;
  return createStore<UiState>()((set) => ({
    selectedColor: readColor(storage),
    bombMode: false,
    selection: null,
    toasts: [],
    explosion: null,
    tool: "paint",
    panel: null,
    profileUserId: null,
    moderation: { cell: null, area: null, corner: null },
    // The pending selection meant something else under the previous tool.
    setTool: (tool) => set({ tool, selection: null }),
    selectColor: (id) => {
      try {
        storage?.setItem(COLOR_KEY, String(id));
      } catch {
        // Private mode or blocked storage: the choice just won't survive a reload.
      }
      set({ selectedColor: id });
    },
    setBombMode: (bombMode) => set({ bombMode }),
    select: (selection) => set({ selection }),
    inspectCell: (cell) => set((s) => ({ panel: "moderation", moderation: { ...s.moderation, cell, area: null } })),
    setArea: (area) => set({ panel: "moderation", moderation: { cell: null, area, corner: null } }),
    setCorner: (corner) => set((s) => ({ moderation: { ...s.moderation, corner } })),
    pushToast: (kind, text) => {
      const id = nextId++;
      // Repeated clicks must not stack copies; the new id restarts the dismiss timer.
      set((s) => ({ toasts: [...s.toasts.filter((t) => t.kind !== kind || t.text !== text), { id, kind, text }].slice(-MAX_TOASTS) }));
      return id;
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    setExplosion: (info) => set({ explosion: info ? { ...info, id: nextId++ } : null }),
    togglePanel: (panel) => set((s) => ({ panel: s.panel === panel ? null : panel })),
    openPanel: (panel) => set({ panel }),
    closePanel: () => set({ panel: null }),
    openProfile: (profileUserId) => set({ panel: "profile", profileUserId }),
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
