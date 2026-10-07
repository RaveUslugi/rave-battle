import { describe, expect, test } from "bun:test";
import {
  authorizeUrl,
  DiscordError,
  exchangeCode,
  fetchProfile,
  isGuildMember,
  snowflakeCreatedAt,
  type DiscordConfig,
  type FetchFn,
} from "./discord";

const cfg: DiscordConfig = { clientId: "cid", clientSecret: "secret", redirectUri: "http://localhost:5173/auth/discord/callback", guildId: "42" };

function fakeFetch(respond: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { fn, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("discord", () => {
  test("snowflake timestamps use the Discord epoch", () => {
    expect(snowflakeCreatedAt("175928847299117063").toISOString()).toBe("2016-04-30T11:18:25.796Z");
  });

  test("authorize URL carries client, redirect, scopes and state", () => {
    const url = new URL(authorizeUrl(cfg, "st4te"));
    expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "cid",
      response_type: "code",
      redirect_uri: cfg.redirectUri,
      scope: "identify guilds",
      state: "st4te",
    });
    expect(authorizeUrl(cfg, "s")).toContain("scope=identify%20guilds");
    expect(new URL(authorizeUrl({ ...cfg, guildId: null }, "s")).searchParams.get("scope")).toBe("identify");
  });

  test("exchanges the code with a form-encoded POST", async () => {
    const { fn, calls } = fakeFetch(() => json({ access_token: "tok", token_type: "Bearer" }));
    expect(await exchangeCode(fn, cfg, "the-code")).toBe("tok");
    expect(calls[0]?.url).toBe("https://discord.com/api/oauth2/token");
    expect(calls[0]?.init?.method).toBe("POST");
    const body = new URLSearchParams(String(calls[0]?.init?.body));
    expect(Object.fromEntries(body)).toEqual({
      client_id: "cid",
      client_secret: "secret",
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: cfg.redirectUri,
    });
  });

  test("HTTP errors, network errors and unexpected shapes become DiscordError", async () => {
    await expect(exchangeCode(fakeFetch(() => json({ error: "invalid_grant" }, 400)).fn, cfg, "c")).rejects.toBeInstanceOf(DiscordError);
    const offline: FetchFn = async () => {
      throw new TypeError("network down");
    };
    await expect(exchangeCode(offline, cfg, "c")).rejects.toBeInstanceOf(DiscordError);
    await expect(fetchProfile(fakeFetch(() => json({ nope: 1 })).fn, "tok")).rejects.toBeInstanceOf(DiscordError);
  });

  test("profile prefers the global display name and derives the account age", async () => {
    const { fn, calls } = fakeFetch(() => json({ id: "175928847299117063", username: "neko", global_name: "Neko Raver", avatar: "abc" }));
    expect(await fetchProfile(fn, "tok")).toEqual({
      id: "175928847299117063",
      username: "Neko Raver",
      avatar: "abc",
      createdAt: new Date("2016-04-30T11:18:25.796Z"),
    });
    expect(calls[0]?.url).toBe("https://discord.com/api/v10/users/@me");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer tok");
    const plain = fakeFetch(() => json({ id: "1", username: "neko", global_name: null, avatar: null }));
    expect((await fetchProfile(plain.fn, "tok")).username).toBe("neko");
  });

  test("guild membership is read from the user's guild list", async () => {
    const { fn, calls } = fakeFetch(() => json([{ id: "7" }, { id: "42" }]));
    expect(await isGuildMember(fn, "tok", "42")).toBe(true);
    expect(await isGuildMember(fn, "tok", "99")).toBe(false);
    expect(calls[0]?.url).toBe("https://discord.com/api/v10/users/@me/guilds?limit=200");
  });
});
