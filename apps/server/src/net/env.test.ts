import { expect, test } from "bun:test";
import { loadEnv } from "./env";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db", PUBLIC_URL: "http://localhost:5173" };

test("defaults and derived values", () => {
  const cfg = loadEnv(base);
  expect(cfg.port).toBe(3000);
  expect(cfg.devLogin).toBe(false);
  expect(cfg.secureCookies).toBe(false);
  expect(cfg.sessionTtlMs).toBe(30 * 86_400_000);
  expect([...cfg.allowedOrigins]).toEqual(["http://localhost:5173"]);
});

test("extra origins are added and https enables secure cookies", () => {
  const cfg = loadEnv({ ...base, PUBLIC_URL: "https://rave.example/app", ALLOWED_ORIGINS: "http://localhost:5173, http://127.0.0.1:5173" });
  expect(cfg.secureCookies).toBe(true);
  expect([...cfg.allowedOrigins].sort()).toEqual(["http://127.0.0.1:5173", "http://localhost:5173", "https://rave.example"]);
});

test("dev login is refused in production", () => {
  expect(() => loadEnv({ ...base, DEV_LOGIN: "1", NODE_ENV: "production" })).toThrow();
  expect(loadEnv({ ...base, DEV_LOGIN: "1" }).devLogin).toBe(true);
});

test("missing required variables fail fast", () => {
  expect(() => loadEnv({ PUBLIC_URL: base.PUBLIC_URL })).toThrow();
});

test("allowed origins are normalised to bare origins", () => {
  const cfg = loadEnv({ ...base, ALLOWED_ORIGINS: "HTTP://LocalHost:5173/" });
  expect([...cfg.allowedOrigins]).toEqual(["http://localhost:5173"]);
});

test("invalid origins and non-http public urls are rejected", () => {
  expect(() => loadEnv({ ...base, ALLOWED_ORIGINS: "null" })).toThrow();
  expect(() => loadEnv({ ...base, ALLOWED_ORIGINS: "javascript:alert(1)" })).toThrow();
  expect(() => loadEnv({ ...base, PUBLIC_URL: "file:///x" })).toThrow();
});

test("dev login is refused on non-local public urls", () => {
  expect(() => loadEnv({ ...base, PUBLIC_URL: "https://rave.example", DEV_LOGIN: "1", NODE_ENV: "development" })).toThrow();
  expect(loadEnv({ ...base, PUBLIC_URL: "http://127.0.0.1:5173", DEV_LOGIN: "1" }).devLogin).toBe(true);
  expect(loadEnv({ ...base, PUBLIC_URL: "http://[::1]:5173", DEV_LOGIN: "1" }).devLogin).toBe(true);
});
