import type { AppDeps } from "../net/deps";
import { authorizeUrl, DiscordError, exchangeCode, fetchProfile, isGuildMember, type DiscordProfile } from "./discord";
import { createSession, readCookie, sessionCookie } from "./session";
import { upsertUser } from "./users";

const STATE_TTL_SECONDS = 600;

/** On https the `__Host-` prefix pins the cookie to this host (it requires Secure and Path=/). */
export function stateCookieName(secure: boolean): string {
  return secure ? "__Host-rb_oauth_state" : "rb_oauth_state";
}

export function stateCookie(value: string, maxAge: number, secure: boolean): string {
  const path = secure ? "/" : "/auth/discord";
  return [`${stateCookieName(secure)}=${value}`, `Path=${path}`, "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`]
    .concat(secure ? ["Secure"] : [])
    .join("; ");
}

export function startDiscordLogin(deps: AppDeps): Response {
  const discord = deps.config.discord!;
  const state = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl(discord, state),
      "Set-Cookie": stateCookie(state, STATE_TTL_SECONDS, deps.config.secureCookies),
    },
  });
}

export async function finishDiscordLogin(req: Request, deps: AppDeps): Promise<Response> {
  const discord = deps.config.discord!;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = readCookie(req, stateCookieName(deps.config.secureCookies));
  if (!state || !expected || state !== expected) return new Response("Invalid OAuth state", { status: 400 });

  const headers = new Headers({ Location: "/" });
  headers.append("Set-Cookie", stateCookie("", 0, deps.config.secureCookies));
  if (url.searchParams.has("error")) {
    headers.set("Location", "/?login_error=denied");
    return new Response(null, { status: 302, headers });
  }
  if (!code) return new Response("Missing authorization code", { status: 400 });
  const fetchFn = deps.fetch ?? fetch;

  let profile: DiscordProfile;
  let guildMember: boolean;
  try {
    const accessToken = await exchangeCode(fetchFn, discord, code);
    profile = await fetchProfile(fetchFn, accessToken);
    guildMember = discord.guildId ? await isGuildMember(fetchFn, accessToken, discord.guildId) : true;
  } catch (error) {
    if (!(error instanceof DiscordError)) throw error;
    console.warn("Discord login failed", error.message);
    headers.set("Location", "/?login_error=discord");
    return new Response(null, { status: 302, headers });
  }

  const id = await upsertUser(deps.db, {
    discordId: profile.id,
    username: profile.username,
    avatar: profile.avatar,
    discordCreatedAt: profile.createdAt,
    guildMember,
  });
  deps.users.set(id, profile.username);
  // Checked inside the command: the player may be created concurrently by another socket.
  await deps.runtime.run((engine) => {
    if (engine.players.has(id)) engine.setAccess(id, { guildMember });
  });
  const { token, expiresAt } = await createSession(deps.db, id, deps.config.sessionTtlMs, Date.now());
  headers.append("Set-Cookie", sessionCookie(token, expiresAt, deps.config.secureCookies));
  return new Response(null, { status: 302, headers });
}
