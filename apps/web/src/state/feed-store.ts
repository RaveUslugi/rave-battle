import type { ServerMessage } from "@rave/shared/client";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

type FeedMessage = Extract<ServerMessage, { type: "feed" }>;
export type FeedEntry = FeedMessage & { id: number };

export const FEED_LIMIT = 20;

export interface FeedState {
  /** Oldest first. */
  entries: FeedEntry[];
  replace(entries: FeedMessage[]): void;
  push(entry: FeedMessage): void;
}

export function createFeedStore() {
  let nextId = 1;
  const withId = (m: FeedMessage): FeedEntry => ({ ...m, id: nextId++ });
  return createStore<FeedState>()((set) => ({
    entries: [],
    replace: (entries) => set({ entries: entries.slice(-FEED_LIMIT).map(withId) }),
    push: (entry) => set((s) => ({ entries: [...s.entries, withId(entry)].slice(-FEED_LIMIT) })),
  }));
}

/** Who and whose bomb — never where. */
export function feedText(e: FeedMessage): string {
  const own = e.actor.id === e.owner.id;
  if (e.kind === "exploded") return own ? `💥 ${e.actor.name} подорвался на своей бомбе` : `💥 ${e.actor.name} подорвался на бомбе ${e.owner.name}`;
  return own ? `🧯 ${e.actor.name} снял свою бомбу` : `🧯 ${e.actor.name} обезвредил бомбу ${e.owner.name}`;
}

export const feedStore = createFeedStore();

export function useFeed<T>(selector: (state: FeedState) => T): T {
  return useStore(feedStore, selector);
}
