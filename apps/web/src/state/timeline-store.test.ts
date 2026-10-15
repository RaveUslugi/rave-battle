import { describe, expect, test } from "bun:test";
import type { TimelineEntry } from "@rave/shared/client";
import { createTimelineStore } from "./timeline-store";
import type { StorageLike } from "./ui-store";

const chat = (id: number, author = 2): TimelineEntry => ({ type: "chat", id, author: { id: author, name: `u${author}` }, text: `m${id}`, at: id });
const boom = (at: number): TimelineEntry => ({ type: "feed", kind: "exploded", actor: { id: 1, name: "a" }, owner: { id: 2, name: "b" }, at });

function memory(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe("timeline store", () => {
  test("history replaces, live entries append, the limit keeps the newest; keys are stable and unique", () => {
    const store = createTimelineStore(null);
    store.getState().setLimit(3);
    store.getState().replace([chat(1), boom(2), chat(3), chat(4)]);
    expect(store.getState().items.map((i) => i.at)).toEqual([2, 3, 4]);
    store.getState().push(boom(5), null);
    store.getState().push(boom(6), null);
    const keys = store.getState().items.map((i) => i.key);
    expect(keys[0]).toBe("c4");
    expect(new Set(keys).size).toBe(3);
    store.getState().setLimit(2);
    expect(store.getState().items.map((i) => i.at)).toEqual([5, 6]);
  });

  test("a replayed chat message is not added twice; deleted ones disappear", () => {
    const store = createTimelineStore(null);
    store.getState().replace([chat(1), boom(2), chat(3)]);
    store.getState().push(chat(3), null);
    expect(store.getState().items).toHaveLength(3);
    store.getState().remove([1, 3, 99]);
    expect(store.getState().items.map((i) => i.type)).toEqual(["feed"]);
  });

  test("unread counts other players' messages while nobody looks at the bottom; history, events and own messages don't count", () => {
    const store = createTimelineStore(null);
    store.getState().replace([chat(1), chat(2)]);
    expect(store.getState().unread).toBe(0);
    store.getState().push(chat(3), 7);
    store.getState().push(chat(4, 7), 7);
    store.getState().push(boom(5), 7);
    expect(store.getState().unread).toBe(1);
    store.getState().setViewing(true);
    expect(store.getState().unread).toBe(0);
    store.getState().push(chat(6), 7);
    expect(store.getState().unread).toBe(0);
    store.getState().setViewing(false);
    store.getState().push(chat(7), null);
    expect(store.getState().unread).toBe(1);
  });

  test("the events switch persists", () => {
    const storage = memory();
    const store = createTimelineStore(storage);
    expect(store.getState().showEvents).toBe(true);
    store.getState().setShowEvents(false);
    expect(createTimelineStore(storage).getState().showEvents).toBe(false);
  });
});
