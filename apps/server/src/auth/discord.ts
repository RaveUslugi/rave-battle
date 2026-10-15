import { z } from "zod";

export const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
export const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
export const DISCORD_API = "https://discord.com/api/v10";
const REQUEST_TIMEOUT_MS = 10_000;
const DISCORD_EPOCH = 1_420_070_400_000n;

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface DiscordConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** When set, players must be members of this guild. */
  guildId: string | null;
}

export interface DiscordProfile {
  id: string;
  /** Display name: `global_name` when set, otherwise `username`. */
  username: string;
  avatar: string | null;
  createdAt: Date;
}

export class DiscordError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DiscordError";
  }
}

const tokenSchema = z.object({ access_token: z.string().min(1) });
const userSchema = z.object({
  id: z
    .string()
    .regex(/^[1-9]\d{0,19}$/)
    .refine((id) => BigInt(id) < 2n ** 64n),
  username: z.string().min(1).max(32),
  global_name: z.string().max(32).nullish(),
  avatar: z.string().nullish(),
});
const guildsSchema = z.array(z.object({ id: z.string() }));

export function snowflakeCreatedAt(id: string): Date {
  return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
}

export function authorizeUrl(cfg: DiscordConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    scope: cfg.guildId ? "identify guilds" : "identify",
    state,
  });
  // Discord documents scopes as %20-separated.
  return `${DISCORD_AUTHORIZE_URL}?${params.toString().replaceAll("+", "%20")}`;
}

async function request<T>(fetchFn: FetchFn, url: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw new DiscordError(`Discord request failed: ${String(error)}`, 0);
  }
  if (!res.ok) throw new DiscordError(`Discord responded ${res.status}`, res.status);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new DiscordError("Discord returned invalid JSON", res.status);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new DiscordError("Unexpected Discord response", res.status);
  return parsed.data;
}

export async function exchangeCode(fetchFn: FetchFn, cfg: DiscordConfig, code: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
  });
  const token = await request(
    fetchFn,
    DISCORD_TOKEN_URL,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() },
    tokenSchema,
  );
  return token.access_token;
}

export async function fetchProfile(fetchFn: FetchFn, accessToken: string): Promise<DiscordProfile> {
  const user = await request(fetchFn, `${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } }, userSchema);
  return {
    id: user.id,
    username: user.global_name || user.username,
    avatar: user.avatar ?? null,
    createdAt: snowflakeCreatedAt(user.id),
  };
}

/** A user can be in at most 200 guilds, so one page is the whole list. */
export async function isGuildMember(fetchFn: FetchFn, accessToken: string, guildId: string): Promise<boolean> {
  const guilds = await request(fetchFn, `${DISCORD_API}/users/@me/guilds?limit=200`, { headers: { Authorization: `Bearer ${accessToken}` } }, guildsSchema);
  return guilds.some((g) => g.id === guildId);
}
