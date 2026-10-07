import { expect, test } from "bun:test";
import { stateCookie, stateCookieName } from "./discord-routes";

test("state cookie is scoped to the auth path over http", () => {
  expect(stateCookieName(false)).toBe("rb_oauth_state");
  expect(stateCookie("v", 600, false)).toBe("rb_oauth_state=v; Path=/auth/discord; HttpOnly; SameSite=Lax; Max-Age=600");
});

test("state cookie uses the __Host- prefix with Path=/ over https", () => {
  expect(stateCookieName(true)).toBe("__Host-rb_oauth_state");
  expect(stateCookie("v", 600, true)).toBe("__Host-rb_oauth_state=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure");
});
