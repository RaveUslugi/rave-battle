import { DAY_MS } from "@rave/shared";
import { z } from "zod";

const httpUrl = z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
  message: "must be an http(s) URL",
});

const envSchema = z
  .object({
    DATABASE_URL: z.url(),
    PUBLIC_URL: httpUrl,
    PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
    ALLOWED_ORIGINS: z.string().default(""),
    DEV_LOGIN: z.enum(["0", "1"]).default("0"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  })
  .refine((env) => !(env.DEV_LOGIN === "1" && env.NODE_ENV === "production"), {
    message: "DEV_LOGIN must be disabled in production",
    path: ["DEV_LOGIN"],
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
  };
}
