import type { ServerMessage, UserRef } from "@rave/shared/client";
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

/** Feed text split into plain strings and player names (clickable in the UI). */
export function feedParts(e: FeedMessage): Array<string | UserRef> {
  const own = e.actor.id === e.owner.id;
  if (e.kind === "exploded") return own ? ["💥 ", e.actor, " подорвался на своей бомбе"] : ["💥 ", e.actor, " подорвался на бомбе ", e.owner];
  return own ? ["🧯 ", e.actor, " снял свою бомбу"] : ["🧯 ", e.actor, " обезвредил бомбу ", e.owner];
}

/** Who and whose bomb — never where. */
export function feedText(e: FeedMessage): string {
  return feedParts(e)
    .map((p) => (typeof p === "string" ? p : p.name))
    .join("");
}

export const feedStore = createFeedStore();

export function useFeed<T>(selector: (state: FeedState) => T): T {
  return useStore(feedStore, selector);
}
