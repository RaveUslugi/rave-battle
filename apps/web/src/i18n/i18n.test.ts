import { beforeEach, describe, expect, test } from "bun:test";
import { CHAT_SEND_CODES, CLIENT_REJECT_CODES, REJECT_CODES } from "@rave/shared/client";
import { en } from "./en";
import { applyLocale, formatNumber, formatRelative, pickLocale } from "./index";
import { ru } from "./ru";

const keysOf = (o: object, prefix = ""): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v !== null ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

beforeEach(() => applyLocale("ru"));

describe("dictionaries", () => {
  test("ru and en have the same keys and no empty strings", () => {
    expect(keysOf(en).sort()).toEqual(keysOf(ru).sort());
    for (const dict of [ru, en]) {
      const leaves = keysOf(dict).map((k) => k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], dict));
      expect(leaves.every((v) => typeof v === "string" && v.trim() !== "")).toBe(true);
    }
  });

  test("every reject and chat code the server or client produces has a text in both languages", () => {
    for (const dict of [ru, en]) {
      for (const code of [...REJECT_CODES, ...CLIENT_REJECT_CODES]) expect(dict.reject[code]).toBeString();
      for (const code of CHAT_SEND_CODES) expect(dict.chat[code]).toBeString();
    }
  });
});

describe("pickLocale", () => {
  test("server, then the stored guest choice, then the browser, then Russian", () => {
    expect(pickLocale({ fromServer: "en", stored: "ru", languages: ["ru"] })).toBe("en");
    expect(pickLocale({ fromServer: null, stored: "en", languages: ["ru"] })).toBe("en");
    expect(pickLocale({ stored: "de", languages: ["uk-UA", "en-GB"] })).toBe("en");
    expect(pickLocale({ languages: ["fr"] })).toBe("ru");
    expect(pickLocale({})).toBe("ru");
  });
});

describe("formatting", () => {
  test("numbers and relative time follow the language", () => {
    expect(formatNumber(1240, "ru")).toBe("1 240");
    expect(formatNumber(1240, "en")).toBe("1,240");
    expect(formatRelative(0, 5 * 60_000, "ru")).toBe("5 минут назад");
    expect(formatRelative(2 * 3_600_000, 0, "en")).toBe("in 2 hours");
  });

  test("interpolation", async () => {
    const { i18n } = await import("./index");
    expect(i18n.t("chat.cooldown", { seconds: 2 })).toBe("Не так быстро — можно через 2 с");
  });
});
