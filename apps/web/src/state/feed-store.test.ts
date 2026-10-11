import { describe, expect, test } from "bun:test";
import { createFeedStore, feedParts, feedText, FEED_LIMIT } from "./feed-store";

const entry = (actor: string, owner: string, kind: "exploded" | "defused" = "exploded", at = 1) =>
  ({ type: "feed", kind, actor: { id: actor.length, name: actor }, owner: { id: owner.length, name: owner }, at }) as const;

describe("feed store", () => {
  test("history replaces, live entries append, both keep the latest FEED_LIMIT with fresh ids", () => {
    const store = createFeedStore();
    store.getState().replace([entry("a", "bb")]);
    store.getState().push(entry("ccc", "dddd"));
    const ids = store.getState().entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
    store.getState().replace([entry("x", "yy")]);
    expect(store.getState().entries.map((e) => e.actor.name)).toEqual(["x"]);
    for (let i = 0; i < FEED_LIMIT + 5; i++) store.getState().push(entry("a", "bb", "defused", i));
    expect(store.getState().entries).toHaveLength(FEED_LIMIT);
    expect(store.getState().entries.at(-1)?.at).toBe(FEED_LIMIT + 4);
  });

  test("texts", () => {
    expect(feedText(entry("bob", "alice"))).toBe("💥 bob подорвался на бомбе alice");
    expect(feedText({ ...entry("bob", "bob"), owner: { id: 3, name: "bob" }, actor: { id: 3, name: "bob" } })).toBe("💥 bob подорвался на своей бомбе");
    expect(feedText(entry("eve", "alice", "defused"))).toBe("🧯 eve обезвредил бомбу alice");
    expect(feedText({ ...entry("eve", "eve", "defused"), owner: { id: 3, name: "eve" }, actor: { id: 3, name: "eve" } })).toBe("🧯 eve снял свою бомбу");
  });

  test("parts keep names as user references", () => {
    expect(feedParts(entry("bob", "alice"))).toEqual(["💥 ", { id: 3, name: "bob" }, " подорвался на бомбе ", { id: 5, name: "alice" }]);
    const self = { ...entry("bob", "bob"), actor: { id: 3, name: "bob" }, owner: { id: 3, name: "bob" } };
    expect(feedParts(self)).toEqual(["💥 ", { id: 3, name: "bob" }, " подорвался на своей бомбе"]);
  });
});
