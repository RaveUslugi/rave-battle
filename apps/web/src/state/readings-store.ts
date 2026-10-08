import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { browserStorage, type StorageLike } from "./ui-store";

/** One detector result: `count` bombs in the 3×3 square around (x, y), measured at local time `at`. */
export interface Reading {
  x: number;
  y: number;
  count: number;
  at: number;
}

export const READING_TTL_MS = 24 * 60 * 60 * 1000;
export const READING_FADE_MS = 60 * 60 * 1000;
export const MAX_READINGS = 2000;

export interface ReadingsState {
  userId: number | null;
  /** Oldest first, at most one per cell. */
  readings: Reading[];
  setUser(userId: number | null): void;
  add(reading: Reading): void;
  prune(): void;
}

const keyOf = (userId: number) => `rb:readings:${userId}`;

function isReading(value: unknown): value is Reading {
  const r = value as Reading;
  return (
    typeof r === "object" && r !== null &&
    Number.isInteger(r.x) && Number.isInteger(r.y) && Number.isInteger(r.count) && r.count >= 0 && Number.isFinite(r.at)
  );
}

/** Drops expired readings and keeps the newest MAX_READINGS. */
function fresh(readings: Reading[], now: number): Reading[] {
  return readings.filter((r) => now - r.at < READING_TTL_MS).slice(-MAX_READINGS);
}

/**
 * Detector results live only on this device (spec: no sync, the server never says a reading went stale).
 * Ages use the local clock on both ends, so clock skew does not matter here.
 */
export function createReadingsStore(storage: StorageLike | null, clock: () => number = Date.now) {
  const load = (userId: number): Reading[] => {
    try {
      const parsed: unknown = JSON.parse(storage?.getItem(keyOf(userId)) ?? "[]");
      return Array.isArray(parsed) ? fresh(parsed.filter(isReading), clock()) : [];
    } catch {
      return [];
    }
  };
  const save = (userId: number, readings: Reading[]) => {
    try {
      storage?.setItem(keyOf(userId), JSON.stringify(readings));
    } catch {
      // Full or blocked storage: readings stay for this session only.
    }
  };
  return createStore<ReadingsState>()((set, get) => ({
    userId: null,
    readings: [],
    setUser: (userId) => {
      if (userId === get().userId) return;
      set({ userId, readings: userId === null ? [] : load(userId) });
    },
    add: (reading) => {
      const { userId, readings } = get();
      if (userId === null) return;
      const next = fresh([...readings.filter((r) => r.x !== reading.x || r.y !== reading.y), reading], clock());
      set({ readings: next });
      save(userId, next);
    },
    prune: () => {
      const { userId, readings } = get();
      const next = fresh(readings, clock());
      if (next.length === readings.length) return;
      set({ readings: next });
      if (userId !== null) save(userId, next);
    },
  }));
}

/** 1 when fresh, fading linearly to 0.3 at READING_FADE_MS and staying there. */
export function readingAlpha(ageMs: number): number {
  return 1 - 0.7 * Math.min(1, Math.max(0, ageMs) / READING_FADE_MS);
}

export function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  return `${Math.floor(minutes / 60)} ч назад`;
}

export function readingAt(readings: Reading[], cell: { x: number; y: number }): Reading | null {
  return readings.find((r) => r.x === cell.x && r.y === cell.y) ?? null;
}

export const readingsStore = createReadingsStore(browserStorage());

export function useReadings<T>(selector: (state: ReadingsState) => T): T {
  return useStore(readingsStore, selector);
}
