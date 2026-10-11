import { expect, test } from "bun:test";
import { isAdmin } from "./admin";

const config = (devLogin: boolean) => ({ adminDiscordIds: new Set(["111"]), devLogin });

test("ids from the config are admins", () => {
  expect(isAdmin("111", config(false))).toBe(true);
});

test("the dev admin counts only when dev login is on", () => {
  expect(isAdmin("dev:admin", config(true))).toBe(true);
  expect(isAdmin("dev:admin", config(false))).toBe(false);
});

test("other ids are not admins", () => {
  expect(isAdmin("222", config(true))).toBe(false);
});
