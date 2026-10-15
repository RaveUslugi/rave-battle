import { beforeEach, expect, test } from "bun:test";
import { applyLocale } from "../i18n";
import { rejectText } from "./messages";

beforeEach(() => applyLocale("ru"));

test("known codes have a human text", () => {
  expect(rejectText("no_charges")).toBe("Нет зарядов");
  expect(rejectText("frozen")).toBe("Вы заморожены");
  expect(rejectText("not_guild_member")).toContain("участник");
  expect(rejectText("login_required")).toBe("Войдите, чтобы играть");
});

test("unknown codes fall back to a generic text", () => {
  expect(rejectText("something_new")).toBe("Действие не удалось");
});

test("texts follow the interface language", () => {
  applyLocale("en");
  expect(rejectText("no_charges")).toBe("No charges left");
  expect(rejectText("something_new")).toBe("The action failed");
});
