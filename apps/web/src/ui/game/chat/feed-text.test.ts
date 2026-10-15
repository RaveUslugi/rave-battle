import { beforeEach, describe, expect, test } from "bun:test";
import type { FeedMessage } from "@rave/shared/client";
import { applyLocale } from "../../../i18n";
import { feedIcon, feedParts, feedText, isAtBottom } from "./feed-text";

const bob = { id: 3, name: "bob" };
const alice = { id: 5, name: "alice" };
const event = (kind: FeedMessage["kind"], actor = bob, owner = alice): FeedMessage => ({ type: "feed", kind, actor, owner, at: 1 });

beforeEach(() => applyLocale("ru"));

describe("feed text", () => {
  test("names stay player references, in the language's word order", () => {
    expect(feedParts(event("exploded"))).toEqual([bob, " подорвался на бомбе ", alice]);
    expect(feedText(event("exploded", bob, bob))).toBe("bob подорвался на своей бомбе");
    expect(feedText(event("defused"))).toBe("bob обезвредил бомбу alice");
    applyLocale("en");
    expect(feedParts(event("defused"))).toEqual([bob, " defused ", alice, "'s bomb"]);
  });

  test("names that look like placeholders are not interpolated again", () => {
    const tricky = { id: 9, name: "{{owner}}" };
    expect(feedParts(event("exploded", tricky))).toEqual([tricky, " подорвался на бомбе ", alice]);
  });

  test("icons by kind", () => {
    expect(feedIcon(event("exploded"))).toEqual({ icon: "boom", tone: "red" });
    expect(feedIcon(event("exploded", bob, bob))).toEqual({ icon: "boom", tone: "gold" });
    expect(feedIcon(event("defused"))).toEqual({ icon: "defuser", tone: "lime" });
  });

  test("bottom detection allows a little slack", () => {
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(true);
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 580, clientHeight: 400 })).toBe(true);
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 400 })).toBe(false);
  });
});
