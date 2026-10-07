import { and, eq, gt } from "drizzle-orm";
import type { Db } from "../db/client";
import { sessions, users } from "../db/schema";
import { banFromDate } from "../persistence/codec";

/** The `__Host-` prefix makes browsers require Secure, Path=/ and no Domain, so sibling subdomains cannot plant it. */
export const sessionCookieName = (secure: boolean) => (secure ? "__Host-rb_session" : "rb_session");

export interface SessionUser {
  id: number;
  username: string;
  discordCreatedAt: number;
  /** Epoch ms, Infinity for permanent, null when not banned. */
  bannedUntil: number | null;
  guildMember: boolean;
  /** Hash of the session token; identifies the session without exposing the token. */
  sessionId: string;
}

/** Sessions are stored and identified by the SHA-256 of their token. */
export const sessionIdOf = (token: string) => new Bun.CryptoHasher("sha256").update(token).digest("hex");

export async function createSession(
  db: Db,
  userId: number,
  ttlMs: number,
  now: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const expiresAt = new Date(now + ttlMs);
  await db.insert(sessions).values({ id: sessionIdOf(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function resolveSession(db: Db, token: string, now: number): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      discordCreatedAt: users.discordCreatedAt,
      bannedUntil: users.bannedUntil,
      guildMember: users.guildMember,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionIdOf(token)), gt(sessions.expiresAt, new Date(now))))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    discordCreatedAt: row.discordCreatedAt.getTime(),
    bannedUntil: banFromDate(row.bannedUntil),
    guildMember: row.guildMember,
    sessionId: sessionIdOf(token),
  };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionIdOf(token)));
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

export function readSessionToken(req: Request, secure: boolean): string | null {
  return readCookie(req, sessionCookieName(secure));
}

export function sessionCookie(token: string, expiresAt: Date, secure: boolean): string {
  return [`${sessionCookieName(secure)}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Expires=${expiresAt.toUTCString()}`]
    .concat(secure ? ["Secure"] : [])
    .join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return [`${sessionCookieName(secure)}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"]
    .concat(secure ? ["Secure"] : [])
    .join("; ");
}
