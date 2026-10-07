import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createTestDb } from "../db/test-db";
import { T0 } from "../engine/test-utils";
import {
  clearSessionCookie,
  createSession,
  deleteExpiredSessions,
  deleteSession,
  readSessionToken,
  resolveSession,
  sessionCookie,
  sessionCookieName,
} from "./session";
import { upsertUser } from "./users";

const t = createTestDb();
beforeEach(() => t.reset());
afterAll(() => t.close());

const DAY = 86_400_000;
const alice = () => upsertUser(t.db, { discordId: "dev:alice", username: "alice", avatar: null, discordCreatedAt: new Date(Date.UTC(2015, 0, 1)) });

describe("upsertUser", () => {
  test("is idempotent by discord id and refreshes the name", async () => {
    const id = await alice();
    const again = await upsertUser(t.db, { discordId: "dev:alice", username: "alice2", avatar: "abc", discordCreatedAt: new Date(Date.UTC(2015, 0, 1)) });
    expect(again).toBe(id);
  });
});

describe("upsertUser membership", () => {
  test("stores guild membership and refreshes it on the next login", async () => {
    const profile = { discordId: "123", username: "bob", avatar: null, discordCreatedAt: new Date(Date.UTC(2016, 0, 1)) };
    const id = await upsertUser(t.db, { ...profile, guildMember: false });
    const { token } = await createSession(t.db, id, DAY, T0);
    expect((await resolveSession(t.db, token, T0))?.guildMember).toBe(false);
    await upsertUser(t.db, { ...profile, guildMember: true });
    expect((await resolveSession(t.db, token, T0))?.guildMember).toBe(true);
  });
});

describe("sessions", () => {
  test("deleteExpiredSessions removes only expired sessions", async () => {
    const id = await alice();
    const old = await createSession(t.db, id, DAY, T0);
    const fresh = await createSession(t.db, id, 10 * DAY, T0);
    expect(await deleteExpiredSessions(t.db, T0 + 2 * DAY)).toBe(1);
    expect(await resolveSession(t.db, old.token, T0)).toBeNull();
    expect(await resolveSession(t.db, fresh.token, T0)).not.toBeNull();
  });

  test("a fresh session resolves to its user", async () => {
    const id = await alice();
    const { token, expiresAt } = await createSession(t.db, id, 30 * DAY, T0);
    expect(expiresAt.getTime()).toBe(T0 + 30 * DAY);
    expect(await resolveSession(t.db, token, T0)).toEqual({
      id,
      username: "alice",
      discordCreatedAt: Date.UTC(2015, 0, 1),
      bannedUntil: null,
      guildMember: true,
      sessionId: expect.any(String),
    });
  });

  test("expired, unknown and deleted tokens resolve to null", async () => {
    const id = await alice();
    const { token } = await createSession(t.db, id, DAY, T0);
    expect(await resolveSession(t.db, token, T0 + DAY)).toBeNull();
    expect(await resolveSession(t.db, "nope", T0)).toBeNull();
    const fresh = await createSession(t.db, id, DAY, T0);
    await deleteSession(t.db, fresh.token);
    expect(await resolveSession(t.db, fresh.token, T0)).toBeNull();
  });

  test("tokens are random and only their hash is stored", async () => {
    const id = await alice();
    const a = await createSession(t.db, id, DAY, T0);
    const b = await createSession(t.db, id, DAY, T0);
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(43);
    const rows = await t.db.query.sessions.findMany();
    expect(rows.map((r) => r.id)).not.toContain(a.token);
  });
});

describe("cookies", () => {
  test("reads the session token from the Cookie header", () => {
    const req = new Request("http://x/", { headers: { cookie: `a=1; ${sessionCookieName(false)}=tok-en; b=2` } });
    expect(readSessionToken(req, false)).toBe("tok-en");
    expect(readSessionToken(new Request("http://x/"), false)).toBeNull();
  });

  test("reads only the cookie name of the given mode", () => {
    const plain = new Request("http://x/", { headers: { cookie: "rb_session=evil" } });
    expect(readSessionToken(plain, true)).toBeNull();
    const host = new Request("http://x/", { headers: { cookie: "rb_session=evil; __Host-rb_session=good" } });
    expect(readSessionToken(host, true)).toBe("good");
    expect(readSessionToken(host, false)).toBe("evil");
  });

  test("builds hardened Set-Cookie values", () => {
    const value = sessionCookie("tok", new Date(T0), true);
    expect(value).toStartWith("__Host-rb_session=tok; ");
    expect(sessionCookie("tok", new Date(T0), false)).toStartWith("rb_session=tok; ");
    expect(clearSessionCookie(true)).toStartWith("__Host-rb_session=; ");
    for (const part of ["Path=/", "HttpOnly", "SameSite=Lax", "Secure"]) expect(value).toContain(part);
    expect(sessionCookie("tok", new Date(T0), false)).not.toContain("Secure");
    expect(clearSessionCookie(false)).toContain("Max-Age=0");
  });
});
