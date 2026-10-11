import { expect, test } from "bun:test";
import { clientIp } from "./client-ip";

const req = (xff?: string) => new Request("http://x/", xff === undefined ? {} : { headers: { "x-forwarded-for": xff } });

test("without trust the header is ignored", () => {
  expect(clientIp(req("1.1.1.1"), "9.9.9.9", false)).toBe("9.9.9.9");
});

test("with trust the last entry wins", () => {
  expect(clientIp(req("1.1.1.1, 2.2.2.2"), "9.9.9.9", true)).toBe("2.2.2.2");
});

test("empty or missing header falls back to the peer", () => {
  expect(clientIp(req(""), "9.9.9.9", true)).toBe("9.9.9.9");
  expect(clientIp(req(), "9.9.9.9", true)).toBe("9.9.9.9");
});

test("no peer means unknown", () => {
  expect(clientIp(req(), undefined, false)).toBe("unknown");
  expect(clientIp(req(), undefined, true)).toBe("unknown");
});
