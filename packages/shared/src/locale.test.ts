import { describe, expect, test } from "bun:test";
import { localeFromDiscord } from "./locale";

describe("localeFromDiscord", () => {
  test("maps Russian and English tags, anything else to null", () => {
    expect(localeFromDiscord("ru")).toBe("ru");
    expect(localeFromDiscord("en-US")).toBe("en");
    expect(localeFromDiscord("EN-gb")).toBe("en");
    expect(localeFromDiscord("uk")).toBeNull();
    expect(localeFromDiscord(null)).toBeNull();
    expect(localeFromDiscord("")).toBeNull();
  });
});
