import { DAY_MS } from "@rave/shared";
import { z } from "zod";
import type { DiscordConfig } from "../auth/discord";

const httpUrl = z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
  message: "must be an http(s) URL",
});

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** `KEY=` in .env means "not set". */
const optionalString = z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional());

const splitList = (value: string) => value.split(",").map((s) => s.trim()).filter(Boolean);

const envSchema = z
  .object({
    DATABASE_URL: z.url(),
    PUBLIC_URL: httpUrl,
    PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
    ALLOWED_ORIGINS: z.string().default(""),
    DEV_LOGIN: z.enum(["0", "1"]).default("0"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
    ADMIN_DISCORD_IDS: z
      .string()
      .default("")
      .refine((v) => splitList(v).every((s) => /^\d+$/.test(s)), { message: "comma-separated numeric Discord ids" }),
    DISCORD_CLIENT_ID: optionalString,
    DISCORD_CLIENT_SECRET: optionalString,
    DISCORD_GUILD_ID: z.preprocess((value) => (value === "" ? undefined : value), z.string().regex(/^\d+$/).optional()),
  })
  .refine((env) => !(env.DEV_LOGIN === "1" && env.NODE_ENV === "production"), {
    message: "DEV_LOGIN must be disabled in production",
    path: ["DEV_LOGIN"],
  })
  .refine((env) => !(env.DEV_LOGIN === "1" && !LOCAL_HOSTNAMES.has(new URL(env.PUBLIC_URL).hostname)), {
    message: "DEV_LOGIN is only allowed when PUBLIC_URL is localhost",
    path: ["DEV_LOGIN"],
  })
  .refine((env) => (env.DISCORD_CLIENT_ID === undefined) === (env.DISCORD_CLIENT_SECRET === undefined), {
    message: "DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET must be set together",
    path: ["DISCORD_CLIENT_ID"],
  })
  .refine((env) => env.NODE_ENV !== "production" || env.DISCORD_CLIENT_ID !== undefined, {
    message: "Discord login must be configured in production",
    path: ["DISCORD_CLIENT_ID"],
  });

export interface ServerConfig {
  databaseUrl: string;
  port: number;
  publicOrigin: string;
  /** Origins allowed to open the WebSocket (cookie-authenticated, so this blocks cross-site hijacking). */
  allowedOrigins: Set<string>;
  devLogin: boolean;
  secureCookies: boolean;
  sessionTtlMs: number;
  /** Discord ids with admin rights. */
  adminDiscordIds: Set<string>;
  /** null when Discord login is not configured (development). */
  discord: DiscordConfig | null;
}

function normaliseOrigin(entry: string): string {
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    throw new Error(`Invalid ALLOWED_ORIGINS entry: ${entry}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Invalid ALLOWED_ORIGINS entry: ${entry}`);
  return url.origin;
}

export function loadEnv(source: Record<string, string | undefined> = process.env): ServerConfig {
  const env = envSchema.parse(source);
  const publicUrl = new URL(env.PUBLIC_URL);
  const extra = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean).map(normaliseOrigin);
  return {
    databaseUrl: env.DATABASE_URL,
    port: env.PORT,
    publicOrigin: publicUrl.origin,
    allowedOrigins: new Set([publicUrl.origin, ...extra]),
    devLogin: env.DEV_LOGIN === "1",
    secureCookies: publicUrl.protocol === "https:",
    sessionTtlMs: env.SESSION_TTL_DAYS * DAY_MS,
    adminDiscordIds: new Set(splitList(env.ADMIN_DISCORD_IDS)),
    discord:
      env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET
        ? {
            clientId: env.DISCORD_CLIENT_ID,
            clientSecret: env.DISCORD_CLIENT_SECRET,
            redirectUri: `${publicUrl.origin}/auth/discord/callback`,
            guildId: env.DISCORD_GUILD_ID ?? null,
          }
        : null,
  };
}
