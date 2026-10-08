import { describe, expect, test } from "bun:test";
import { TRPCClientError } from "@trpc/client";
import { call } from "./api";

const trpcError = (code: string) =>
  TRPCClientError.from({ error: { message: "x", code: -32000, data: { code, httpStatus: 429 } } });

describe("call", () => {
  test("passes results through", async () => {
    expect(await call(async () => ({ ok: true as const }))).toEqual({ ok: true });
  });

  test("maps tRPC and transport errors to codes", async () => {
    expect(await call(() => Promise.reject(trpcError("TOO_MANY_REQUESTS")))).toEqual({ ok: false, code: "rate_limited" });
    expect(await call(() => Promise.reject(trpcError("UNAUTHORIZED")))).toEqual({ ok: false, code: "unauthorized" });
    expect(await call(() => Promise.reject(trpcError("INTERNAL_SERVER_ERROR")))).toEqual({ ok: false, code: "unavailable" });
    expect(await call(() => Promise.reject(new TypeError("Failed to fetch")))).toEqual({ ok: false, code: "unavailable" });
  });
});
