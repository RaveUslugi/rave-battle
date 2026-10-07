import { DAY_MS } from "@rave/shared";
import { z } from "zod";

const envSchema = z
  .object({
    DATABASE_URL: z.url(),
    PUBLIC_URL: z.url(),
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

export function loadEnv(source: Record<string, string | undefined> = process.env): ServerConfig {
  const env = envSchema.parse(source);
  const publicUrl = new URL(env.PUBLIC_URL);
  const extra = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
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
