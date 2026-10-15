import type { TimelineEntry } from "@rave/shared/client";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { browserStorage, type StorageLike } from "./ui-store";

/** A timeline entry with a stable React key: chat messages keep their server id, feed events get a local one. */
export type TimelineItem = TimelineEntry & { key: string };

/** Until the config says otherwise (`chat.historySize`). */
export const DEFAULT_TIMELINE_LIMIT = 100;
const EVENTS_KEY = "rb:chat-events";

export interface TimelineState {
  /** Oldest first. */
  items: TimelineItem[];
  limit: number;
  /** Chat messages from other players that arrived while nobody was looking at the bottom of the feed. */
  unread: number;
  /** The feed is on screen and scrolled to the bottom: new messages are read as they arrive. */
  viewing: boolean;
  /** Show explosions and defuses between the messages. */
  showEvents: boolean;
  replace(entries: TimelineEntry[]): void;
  /** `selfId`: the logged-in player, whose own messages never count as unread. */
  push(entry: TimelineEntry, selfId: number | null): void;
  remove(ids: number[]): void;
  setLimit(limit: number): void;
  setViewing(viewing: boolean): void;
  setShowEvents(show: boolean): void;
}

function readFlag(storage: StorageLike | null, key: string, fallback: boolean): boolean {
  try {
    const raw = storage?.getItem(key);
    return raw === null || raw === undefined ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

export function createTimelineStore(storage: StorageLike | null) {
  let nextId = 1;
  const keyed = (e: TimelineEntry): TimelineItem => ({ ...e, key: e.type === "chat" ? `c${e.id}` : `f${nextId++}` });
  return createStore<TimelineState>()((set) => ({
    items: [],
    limit: DEFAULT_TIMELINE_LIMIT,
    unread: 0,
    viewing: false,
    showEvents: readFlag(storage, EVENTS_KEY, true),
    // History comes right after hello: everything in it counts as already seen.
    replace: (entries) => set((s) => ({ items: entries.slice(-s.limit).map(keyed), unread: 0 })),
    push: (entry, selfId) =>
      set((s) => {
        // A reconnect may replay a message the client already has.
        if (entry.type === "chat" && s.items.some((i) => i.type === "chat" && i.id === entry.id)) return {};
        const counts = entry.type === "chat" && entry.author.id !== selfId && !s.viewing;
        return { items: [...s.items, keyed(entry)].slice(-s.limit), unread: counts ? s.unread + 1 : s.unread };
      }),
    remove: (ids) => {
      const gone = new Set(ids);
      set((s) => ({ items: s.items.filter((i) => i.type !== "chat" || !gone.has(i.id)) }));
    },
    setLimit: (limit) => set((s) => (limit === s.limit ? {} : { limit, items: s.items.slice(-limit) })),
    setViewing: (viewing) => set((s) => (viewing ? { viewing, unread: 0 } : s.viewing ? { viewing } : {})),
    setShowEvents: (showEvents) => {
      try {
        storage?.setItem(EVENTS_KEY, showEvents ? "1" : "0");
      } catch {
        // Not persisted; the choice still applies for this visit.
      }
      set({ showEvents });
    },
  }));
}

export const timelineStore = createTimelineStore(browserStorage());

export function useTimeline<T>(selector: (state: TimelineState) => T): T {
  return useStore(timelineStore, selector);
}
