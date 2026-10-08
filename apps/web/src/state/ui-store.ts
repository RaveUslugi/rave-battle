import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

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
  selectColor(id: number): void;
  setBombMode(on: boolean): void;
  select(cell: { x: number; y: number } | null): void;
  pushToast(kind: Toast["kind"], text: string): number;
  dismissToast(id: number): void;
  setExplosion(info: Omit<ExplosionInfo, "id"> | null): void;
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
    pushToast: (kind, text) => {
      const id = nextId++;
      // Repeated clicks must not stack copies; the new id restarts the dismiss timer.
      set((s) => ({ toasts: [...s.toasts.filter((t) => t.kind !== kind || t.text !== text), { id, kind, text }].slice(-MAX_TOASTS) }));
      return id;
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    setExplosion: (info) => set({ explosion: info ? { ...info, id: nextId++ } : null }),
  }));
}

function browserStorage(): StorageLike | null {
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
