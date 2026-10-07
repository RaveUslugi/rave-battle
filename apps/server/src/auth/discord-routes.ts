import type { AppDeps } from "../net/deps";
import { authorizeUrl, DiscordError, exchangeCode, fetchProfile, isGuildMember, type DiscordProfile } from "./discord";
import { createSession, readCookie, sessionCookie } from "./session";
import { upsertUser } from "./users";

const STATE_COOKIE = "rb_oauth_state";
const STATE_PATH = "/auth/discord";
const STATE_TTL_SECONDS = 600;

function stateCookie(value: string, maxAge: number, secure: boolean): string {
  return [`${STATE_COOKIE}=${value}`, `Path=${STATE_PATH}`, "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`]
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
  const expected = readCookie(req, STATE_COOKIE);
  if (!code || !state || !expected || state !== expected) return new Response("Invalid OAuth state", { status: 400 });

  const headers = new Headers({ Location: "/" });
  headers.append("Set-Cookie", stateCookie("", 0, deps.config.secureCookies));
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
